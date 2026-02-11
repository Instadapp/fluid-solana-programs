import fs from "fs";
import path from "path";
import { spawn, spawnSync } from "child_process";
import cliProgress from "cli-progress";
import ComputeBudgetLogger from "../test-utils/typescript/computeBudgetLogger";
import {
  ProgramDefinition,
  PROGRAMS,
  ROOT_DIR,
  RUST_TEST_PACKAGE,
  TS_TEST_ROOT,
  getComputeStatTargets,
  listProgramSummaries,
  selectPrograms,
} from "./utils/programs";
import { runBuildTasks } from "./utils/builders";

const BUNX_COMMAND = "bunx";
const CARGO_COMMAND = "cargo";

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  // Colors
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  // Bright variants
  brightCyan: "\x1b[96m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightMagenta: "\x1b[95m",
  brightBlue: "\x1b[94m",
};

const style = {
  header: (s: string) => `${c.bold}${c.brightCyan}${s}${c.reset}`,
  success: (s: string) => `${c.bold}${c.brightGreen}${s}${c.reset}`,
  error: (s: string) => `${c.bold}${c.red}${s}${c.reset}`,
  warn: (s: string) => `${c.yellow}${s}${c.reset}`,
  info: (s: string) => `${c.cyan}${s}${c.reset}`,
  dim: (s: string) => `${c.dim}${s}${c.reset}`,
  bold: (s: string) => `${c.bold}${s}${c.reset}`,
  program: (s: string) => `${c.bold}${c.brightMagenta}${s}${c.reset}`,
  stat: (s: string) => `${c.brightYellow}${s}${c.reset}`,
  accent: (s: string) => `${c.brightBlue}${s}${c.reset}`,
};

const icons = {
  pass: `${c.brightGreen}✔${c.reset}`,
  fail: `${c.red}✖${c.reset}`,
  skip: `${c.yellow}○${c.reset}`,
  run: `${c.brightCyan}▶${c.reset}`,
  rust: `${c.yellow}🦀${c.reset}`,
  ts: `${c.brightBlue}TS${c.reset}`,
  build: `${c.brightMagenta}⚡${c.reset}`,
  stats: `${c.brightCyan}📊${c.reset}`,
  arrow: `${c.dim}›${c.reset}`,
  dot: `${c.dim}·${c.reset}`,
};

function printBanner() {
  const banner = `
${c.brightCyan}╔════════════════════════════════════════════════════════════════════════╗
║                                                                        ║
║   ${c.bold}     ██╗██╗   ██╗██████╗     ██╗     ███████╗███╗   ██╗██████╗ ${c.reset}${c.brightCyan}      ║
║   ${c.bold}     ██║██║   ██║██╔══██╗    ██║     ██╔════╝████╗  ██║██╔══██╗${c.reset}${c.brightCyan}      ║
║   ${c.bold}     ██║██║   ██║██████╔╝    ██║     █████╗  ██╔██╗ ██║██║  ██║${c.reset}${c.brightCyan}      ║
║   ${c.bold}██   ██║██║   ██║██╔═══╝     ██║     ██╔══╝  ██║╚██╗██║██║  ██║${c.reset}${c.brightCyan}      ║
║   ${c.bold}╚█████╔╝╚██████╔╝██║         ███████╗███████╗██║ ╚████║██████╔╝${c.reset}${c.brightCyan}      ║
║   ${c.bold} ╚════╝  ╚═════╝ ╚═╝         ╚══════╝╚══════╝╚═╝  ╚═══╝╚═════╝ ${c.reset}${c.brightCyan}      ║
║                                                      ${c.dim}Test Runner${c.reset}${c.brightCyan}      ║
╚════════════════════════════════════════════════════════════════════════╝${c.reset}
`;
  console.log(banner);
}

function printSection(title: string, icon: string = icons.run) {
  const line = `${c.dim}${"─".repeat(60)}${c.reset}`;
  console.log(`\n${line}`);
  console.log(`  ${icon}  ${style.header(title)}`);
  console.log(`${line}\n`);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(0);
  return `${mins}m ${secs}s`;
}

function formatTestResult(
  passed: number,
  failed: number,
  total: number,
  skipped: number,
  durationMs?: number
): string {
  const status = failed === 0 ? icons.pass : icons.fail;
  const passStr = `${c.brightGreen}${passed} passed${c.reset}`;
  const failStr =
    failed > 0
      ? `${c.red}${failed} failed${c.reset}`
      : `${c.dim}0 failed${c.reset}`;
  const skipStr = skipped > 0 ? `, ${skipped} skipped` : "";
  const timeStr = durationMs
    ? ` ${c.dim}in ${formatDuration(durationMs)}${c.reset}`
    : "";

  return `    ${status} ${passStr}, ${failStr} ${c.dim}(${total} total${skipStr})${c.reset}${timeStr}\n`;
}

interface TestDetail {
  name: string;
  status: "pass" | "fail" | "skip";
}

function printVerboseTests(tests: TestDetail[]) {
  const maxShow = 50;
  const toShow = tests.slice(0, maxShow);

  toShow.forEach((test, i) => {
    const isLast = i === toShow.length - 1 && tests.length <= maxShow;
    const prefix = isLast ? "└" : "├";
    const icon =
      test.status === "pass"
        ? `${c.brightGreen}✔${c.reset}`
        : test.status === "fail"
        ? `${c.red}✖${c.reset}`
        : `${c.yellow}○${c.reset}`;
    console.log(
      `    ${c.dim}${prefix}${c.reset} ${icon} ${c.dim}${test.name}${c.reset}`
    );
  });

  if (tests.length > maxShow) {
    console.log(
      `    ${c.dim}└ ... and ${tests.length - maxShow} more${c.reset}`
    );
  }
}

interface TestCliOptions {
  program?: string;
  ts: boolean;
  rust: boolean;
  skipBuild: boolean;
  verifiableBuild: boolean;
  listPrograms: boolean;
  verbose: boolean;
  help: boolean;
  cargoArgs: string[];
}

interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
  command: string;
}

interface TestFailure {
  target: string;
  command: string;
  output: string;
}

interface TestRunResult {
  success: boolean;
  failures: TestFailure[];
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
}

interface TestTarget {
  program: ProgramDefinition;
  absolutePath: string;
  relativePath: string;
}

interface RustTestProgress {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  currentTest: string;
  tests: TestDetail[];
}

function parseArgs(argv: string[]): TestCliOptions {
  const options: TestCliOptions = {
    ts: false,
    rust: false,
    skipBuild: false,
    verifiableBuild: false,
    listPrograms: false,
    verbose: false,
    help: false,
    cargoArgs: [],
  };

  let i = 0;
  let foundDoubleDash = false;

  while (i < argv.length) {
    const arg = argv[i];

    // Handle double dash separator for cargo args
    if (arg === "--" && !foundDoubleDash) {
      foundDoubleDash = true;
      i++;
      continue;
    }

    // After double dash, everything goes to cargo
    if (foundDoubleDash) {
      options.cargoArgs.push(arg);
      i++;
      continue;
    }

    switch (arg) {
      case "--ts":
      case "-t":
        options.ts = true;
        break;
      case "--rust":
      case "-r":
        options.rust = true;
        break;
      case "--skip-build":
        options.skipBuild = true;
        break;
      case "--verifiable":
        options.verifiableBuild = true;
        break;
      case "--list-programs":
        options.listPrograms = true;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--program":
      case "-p":
        if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
          options.program = argv[i + 1];
          i++; // Skip next arg as it's the program name
        } else {
          throw new Error("Missing value for --program flag.");
        }
        break;
      default:
        break;
    }
    i++;
  }

  // Default to running all tests if none specified
  if (!options.ts && !options.rust) {
    options.ts = true;
    options.rust = true;
  }

  return options;
}

function printUsage() {
  console.log(`
Usage: pnpm test [options] [-- cargo-args]

Flags (order-independent):
  --program, -p <name>   Filter to a single program (default: all)
  --ts, -t               Run TypeScript (Vitest) suites
  --rust, -r             Run Rust integration suites
  --skip-build           Skip rebuilding Anchor programs
  --verifiable           Pass --verifiable to Anchor builds
  --list-programs        Show all supported program identifiers
  --verbose              Print underlying command output even on success
  --help, -h             Show this message

After a double dash (--), you can pass additional arguments to cargo test.

Examples:
  pnpm test                                    # Build all + run all tests
  pnpm test --skip-build                       # Run all tests without building
  pnpm test --rust --skip-build                # Run only Rust tests without building
  pnpm test --ts --program vaults              # Run only TypeScript tests for vaults
  pnpm test --rust --program vaults            # Run only Rust tests for vaults
  pnpm test --ts --rust --program lending      # Run both TS and Rust tests for lending
  pnpm test --rust -- --nocapture              # Run Rust tests with cargo's --nocapture flag
  pnpm test --rust -- liquidate_test           # Run only tests matching "liquidate_test"
`);
}

function runCommand(
  command: string,
  args: string[],
  options?: { cwd?: string }
): CommandResult {
  const result = spawnSync(command, args, {
    cwd: options?.cwd ?? ROOT_DIR,
    env: process.env,
    encoding: "utf-8",
  });

  return {
    success: result.status === 0,
    stdout: (result.stdout ?? "").toString(),
    stderr: (result.stderr ?? "").toString(),
    status: result.status,
    command: `${command} ${args.join(" ")}`,
  };
}

function collectTsTargets(programs: ProgramDefinition[]): TestTarget[] {
  const targets: TestTarget[] = [];

  programs.forEach((program) => {
    if (!program.testDir) return;
    const directory = path.join(TS_TEST_ROOT, program.testDir);
    if (!fs.existsSync(directory)) return;

    const stack: string[] = [directory];
    while (stack.length) {
      const current = stack.pop()!;
      const entries = fs.readdirSync(current, { withFileTypes: true });
      entries.forEach((entry) => {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(entryPath);
        } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
          targets.push({
            program,
            absolutePath: entryPath,
            relativePath: path.relative(ROOT_DIR, entryPath),
          });
        }
      });
    }
  });

  return targets.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function createProgressBar(programName: string) {
  const paddedName = programName.padEnd(12);
  return new cliProgress.SingleBar(
    {
      format: `  ${c.dim}▸${c.reset} ${c.bold}${c.brightMagenta}${paddedName}${c.reset} ${c.dim}│${c.reset}${c.brightGreen}{bar}${c.reset}${c.dim}│${c.reset} ${c.bold}{value}${c.reset}${c.dim}/${c.reset}{total} ${c.dim}›${c.reset} ${c.cyan}{current}${c.reset}`,
      barCompleteChar: "█",
      barIncompleteChar: "░",
      hideCursor: true,
      autopadding: true,
      barsize: 20,
    },
    cliProgress.Presets.shades_classic
  );
}

function logFailures(title: string, failures: TestFailure[]) {
  console.error(`\n${c.red}╔${"═".repeat(58)}╗${c.reset}`);
  console.error(
    `${c.red}║${c.reset}  ${icons.fail} ${style.error(
      title + " FAILED"
    )}${" ".repeat(Math.max(0, 46 - title.length))}${c.red}║${c.reset}`
  );
  console.error(`${c.red}╚${"═".repeat(58)}╝${c.reset}\n`);
  failures.forEach((failure, index) => {
    console.error(
      `  ${c.dim}[${index + 1}]${c.reset} ${style.program(failure.target)}`
    );
    console.error(
      `      ${c.dim}cmd:${c.reset} ${c.cyan}${failure.command}${c.reset}`
    );
    console.error(`      ${c.dim}${"─".repeat(50)}${c.reset}`);
    console.error(
      `${c.dim}${failure.output.trim() || "[no output]"}${c.reset}`
    );
    console.error(`  ${c.dim}${"─".repeat(54)}${c.reset}\n`);
  });
}

function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;]*m/g, "");
}

function extractJsonArray(text: string): string {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    return "[]";
  }
  return text.slice(start, end + 1);
}

function countVitestTests(targetPaths: string[]): number {
  if (!targetPaths.length) {
    return 0;
  }
  const args = ["vitest", "list", ...targetPaths, "--json"];
  const result = runCommand(BUNX_COMMAND, args);
  if (!result.success) {
    return 0;
  }
  const jsonText = extractJsonArray(`${result.stdout}\n${result.stderr}`);
  try {
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed)) {
      return parsed.length;
    }
  } catch {
    // ignore parse errors, fall through to zero
  }
  return 0;
}

interface VitestRunResult {
  success: boolean;
  output: string;
  passed: number;
  failed: number;
  skipped: number;
  command: string;
  durationMs: number;
  tests: TestDetail[];
}

async function runVitestProgram(
  targets: TestTarget[],
  bar: cliProgress.SingleBar
): Promise<VitestRunResult> {
  if (!targets.length) {
    return {
      success: true,
      output: "",
      passed: 0,
      failed: 0,
      skipped: 0,
      command: "",
      durationMs: 0,
      tests: [],
    };
  }

  const targetPaths = targets.map((target) => target.relativePath);
  const totalHint = countVitestTests(targetPaths);
  const args = ["vitest", "run", ...targetPaths];
  const command = `${BUNX_COMMAND} ${args.join(" ")}`;
  const startTime = Date.now();

  return new Promise<VitestRunResult>((resolve) => {
    const vitestProcess = spawn(BUNX_COMMAND, args, {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let combinedOutput = "";
    let buffer = "";
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let currentTest = "starting...";
    let barTotal = Math.max(totalHint, 1);
    let summaryTotalHint = 0;
    const testDetails: TestDetail[] = [];

    bar.start(barTotal, 0, { current: currentTest });

    const updateBar = () => {
      const completed = passed + failed + skipped;
      if (completed > barTotal) {
        barTotal = completed;
        bar.setTotal(barTotal);
      }
      bar.update(completed, { current: currentTest });
    };

    const handleTestsSummary = (line: string) => {
      const summary = line.replace(/^Tests\s+/, "").trim();
      const totalMatch = summary.match(/\((\d+)\)/);
      if (totalMatch) {
        summaryTotalHint = Math.max(
          summaryTotalHint,
          parseInt(totalMatch[1], 10)
        );
      }
      const withoutTotal = summary.replace(/\((\d+)\)/, "").trim();
      const segments = withoutTotal
        .split("|")
        .map((segment) => segment.trim())
        .filter(Boolean);

      segments.forEach((segment) => {
        const match = segment.match(/(\d+)\s+(\w+)/);
        if (!match) return;
        const value = parseInt(match[1], 10);
        const label = match[2].toLowerCase();
        if (label.startsWith("passed")) {
          passed = Math.max(passed, value);
        } else if (label.startsWith("failed")) {
          failed = Math.max(failed, value);
        } else if (label.startsWith("skipped")) {
          skipped = Math.max(skipped, value);
        }
      });
    };

    const handleLine = (rawLine: string) => {
      const line = stripAnsi(rawLine);
      const trimmed = line.trim();
      if (!trimmed) return;

      if (/^\s*✓\s+/.test(line)) {
        if (/\(\d+\s+tests?/.test(line)) {
          // File summary line with "(X tests | Y skipped)"
          const summaryMatch = line.match(/\(([^)]+)\)/);
          if (summaryMatch) {
            const parts = summaryMatch[1]
              .split("|")
              .map((part) => part.trim())
              .filter(Boolean);
            parts.forEach((part) => {
              if (part.includes("skipped")) {
                const value = parseInt(part, 10);
                if (!Number.isNaN(value)) {
                  skipped = Math.max(skipped, value);
                }
              }
            });
          }
        } else {
          const name = trimmed
            .replace(/^✓\s+/, "")
            .replace(/\s+\d+m?s$/, "")
            .trim();
          currentTest = name;
          testDetails.push({ name, status: "pass" });
          passed += 1;
          updateBar();
        }
        return;
      }

      if (/^\s*[✗×]\s+/.test(line)) {
        const name = trimmed
          .replace(/^[✗×]\s+/, "")
          .replace(/\s+\d+m?s$/, "")
          .trim();
        currentTest = `${name} (fail)`;
        testDetails.push({ name, status: "fail" });
        failed += 1;
        updateBar();
        return;
      }

      if (/^\s*Tests\s+/.test(trimmed)) {
        handleTestsSummary(trimmed);
        if (summaryTotalHint > barTotal) {
          barTotal = summaryTotalHint;
          bar.setTotal(barTotal);
        }
        updateBar();
        return;
      }
    };

    const handleChunk = (chunk: string) => {
      combinedOutput += chunk;
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      lines.forEach(handleLine);
    };

    vitestProcess.stdout?.on("data", (data) => handleChunk(data.toString()));
    vitestProcess.stderr?.on("data", (data) => handleChunk(data.toString()));

    vitestProcess.on("error", (error) => {
      combinedOutput += `\n[vitest error] ${error.message}\n`;
    });

    vitestProcess.on("close", (code) => {
      if (buffer.length > 0) {
        handleLine(buffer);
      }
      const observedTotal = passed + failed + skipped;
      const summaryExecuted =
        summaryTotalHint > 0
          ? Math.max(summaryTotalHint, observedTotal)
          : observedTotal;
      const finalTotal = Math.max(summaryExecuted, barTotal);
      if (finalTotal > barTotal) {
        barTotal = finalTotal;
        bar.setTotal(barTotal);
      }
      bar.update(Math.min(observedTotal, barTotal), {
        current: currentTest || "done",
      });
      bar.stop();

      resolve({
        success: code === 0,
        output: combinedOutput,
        passed,
        failed,
        skipped,
        command,
        durationMs: Date.now() - startTime,
        tests: testDetails,
      });
    });
  });
}

async function runTsTests(
  programs: ProgramDefinition[],
  options: TestCliOptions,
  logger: ComputeBudgetLogger
): Promise<TestRunResult> {
  const targets = collectTsTargets(programs);

  if (!targets.length) {
    console.log(
      `  ${icons.skip} ${style.dim(
        "No TypeScript tests match the current selection."
      )}`
    );
    return { success: true, failures: [] };
  }

  printSection("TypeScript Tests", icons.ts);

  const failures: TestFailure[] = [];
  let totalTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  // Group targets by program
  const targetsByProgram = new Map<string, TestTarget[]>();
  targets.forEach((target) => {
    const programId = target.program.id;
    if (!targetsByProgram.has(programId)) {
      targetsByProgram.set(programId, []);
    }
    targetsByProgram.get(programId)!.push(target);
  });

  // Run tests for each program
  for (const [programId, programTargets] of targetsByProgram) {
    const program = programs.find((p) => p.id === programId)!;

    const bar = createProgressBar(program.displayName);
    const result = await runVitestProgram(programTargets, bar);

    const programTotal = result.passed + result.failed + result.skipped;
    totalTests += programTotal;
    totalPassed += result.passed;
    totalFailed += result.failed;
    totalSkipped += result.skipped;

    if (options.verbose && result.tests.length > 0) {
      printVerboseTests(result.tests);
    }

    console.log(
      formatTestResult(
        result.passed,
        result.failed,
        programTotal,
        result.skipped,
        result.durationMs
      )
    );

    if (!result.success) {
      failures.push({
        target: program.displayName,
        command: result.command,
        output: result.output.trim(),
      });
    }
  }

  const statTargets = getComputeStatTargets(programs);
  if (statTargets.length && logger) {
    console.log(`\n  ${icons.stats} ${style.info("Compute Unit Stats")}\n`);
    statTargets.forEach((programName) =>
      logger.printPersistentStatsTable(programName)
    );
  }

  if (failures.length) {
    logFailures("TypeScript tests", failures);
    return {
      success: false,
      failures,
      totalTests,
      passedTests: totalPassed,
      failedTests: totalFailed,
    };
  }

  const skipText = totalSkipped ? `, ${totalSkipped} skipped` : "";
  console.log(
    `\n  ${icons.pass} ${style.success("All TypeScript tests passed")}: ${
      c.brightGreen
    }${totalPassed} passed${c.reset} ${c.dim}(${totalTests} total${skipText})${
      c.reset
    }\n`
  );
  return {
    success: true,
    failures: [],
    totalTests,
    passedTests: totalPassed,
    failedTests: totalFailed,
  };
}

function parseRustTestOutput(output: string): RustTestProgress {
  const lines = output.split("\n");
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  let skippedTests = 0;
  let currentTest = "";
  let expectedTotal = 0;
  const tests: TestDetail[] = [];
  const seenTests = new Set<string>();

  for (const line of lines) {
    // Match "running X tests" line
    const runningMatch = line.match(/^running (\d+) tests?/);
    if (runningMatch) {
      expectedTotal = parseInt(runningMatch[1], 10);
    }

    // Match test result lines like "test vaults::liquidate_test::tests::test_absorb_branch_negative ... ok"
    const testMatch = line.match(
      /^test\s+(.+?)\s+\.\.\.\s+(ok|FAILED|ignored)/
    );
    if (testMatch) {
      const testName = testMatch[1];
      const status = testMatch[2];

      // Extract a shorter test name for display
      const parts = testName.split("::");
      currentTest = parts[parts.length - 1] || testName;

      // Track test details (avoid duplicates)
      if (!seenTests.has(currentTest)) {
        seenTests.add(currentTest);
        tests.push({
          name: currentTest,
          status:
            status === "ok" ? "pass" : status === "FAILED" ? "fail" : "skip",
        });
      }

      if (status === "ok") {
        passedTests++;
      } else if (status === "FAILED") {
        failedTests++;
      } else if (status === "ignored") {
        skippedTests++;
      }
    }

    // Match summary line like "test result: ok. 154 passed; 0 failed; 3 ignored"
    const summaryMatch = line.match(
      /test result:.*?(\d+)\s+passed;\s+(\d+)\s+failed(?:;\s+(\d+)\s+ignored)?/
    );
    if (summaryMatch) {
      const finalPassed = parseInt(summaryMatch[1], 10);
      const finalFailed = parseInt(summaryMatch[2], 10);
      const finalSkipped =
        summaryMatch[3] !== undefined ? parseInt(summaryMatch[3], 10) : 0;

      // Use the summary as the definitive count (take the highest values we've seen)
      if (finalPassed > 0 || finalFailed > 0 || finalSkipped > 0) {
        passedTests = Math.max(passedTests, finalPassed);
        failedTests = Math.max(failedTests, finalFailed);
        skippedTests = Math.max(skippedTests, finalSkipped);
        totalTests = passedTests + failedTests + skippedTests;
      }
    }
  }

  // Use expected total if we haven't calculated a total yet
  if (totalTests === 0) {
    totalTests =
      expectedTotal > 0
        ? expectedTotal
        : passedTests + failedTests + skippedTests;
  }

  return {
    totalTests,
    passedTests,
    failedTests,
    skippedTests,
    currentTest,
    tests,
  };
}

async function runRustTests(
  programs: ProgramDefinition[],
  options: TestCliOptions
): Promise<TestRunResult> {
  const targets = programs.filter((program) => Boolean(program.rustFilter));

  if (!targets.length) {
    console.log(
      `  ${icons.skip} ${style.dim(
        "No Rust tests match the current selection."
      )}`
    );
    return { success: true, failures: [] };
  }

  printSection("Rust Integration Tests", icons.rust);

  const failures: TestFailure[] = [];
  let totalTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkippedRust = 0;

  for (const target of targets) {
    const args = [
      "test",
      "--package",
      RUST_TEST_PACKAGE,
      "--",
      target.rustFilter!,
      ...options.cargoArgs,
    ];

    const startTime = Date.now();
    const cargoProcess = spawn(CARGO_COMMAND, args, {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let combinedOutput = "";
    let bar: cliProgress.SingleBar | null = null;
    let hasStarted = false;
    let lastProgress: RustTestProgress = {
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      currentTest: "",
      skippedTests: 0,
      tests: [],
    };

    const updateProgress = (newData: string) => {
      combinedOutput += newData;
      const progress = parseRustTestOutput(combinedOutput);

      if (progress.totalTests > 0 && !hasStarted) {
        hasStarted = true;
        bar = createProgressBar(target.displayName);
        bar.start(progress.totalTests, 0, { current: "starting..." });
      }

      if (
        bar &&
        (progress.currentTest ||
          progress.passedTests + progress.failedTests + progress.skippedTests >
            0)
      ) {
        const completed =
          progress.passedTests + progress.failedTests + progress.skippedTests;
        const total = Math.max(progress.totalTests, completed);
        bar.setTotal(total);
        bar.update(completed, {
          current: progress.currentTest || "testing...",
        });
        lastProgress = progress;
      }
    };

    cargoProcess.stdout?.on("data", (data) => {
      updateProgress(data.toString());
    });

    cargoProcess.stderr?.on("data", (data) => {
      updateProgress(data.toString());
    });

    const exitCode = await new Promise<number>((resolve) => {
      cargoProcess.on("close", (code) => {
        resolve(code ?? 1);
      });
    });

    if (bar) {
      bar.stop();
    }

    const finalProgress = parseRustTestOutput(combinedOutput);
    totalTests += finalProgress.totalTests;
    totalPassed += finalProgress.passedTests;
    totalFailed += finalProgress.failedTests;
    totalSkippedRust += finalProgress.skippedTests;

    const durationMs = Date.now() - startTime;

    // Only track results if there were actual tests
    if (finalProgress.totalTests > 0) {
      if (exitCode !== 0) {
        failures.push({
          target: target.displayName,
          command: `${CARGO_COMMAND} ${args.join(" ")}`,
          output: combinedOutput.trim(),
        });
      }

      if (options.verbose && finalProgress.tests.length > 0) {
        printVerboseTests(finalProgress.tests);
      }

      console.log(
        formatTestResult(
          finalProgress.passedTests,
          finalProgress.failedTests,
          finalProgress.totalTests,
          finalProgress.skippedTests,
          durationMs
        )
      );
    }
  }

  if (failures.length) {
    logFailures("Rust tests", failures);
    return {
      success: false,
      failures,
      totalTests,
      passedTests: totalPassed,
      failedTests: totalFailed,
    };
  }

  const skipText = totalSkippedRust ? `, ${totalSkippedRust} skipped` : "";
  console.log(
    `\n  ${icons.pass} ${style.success("All Rust tests passed")}: ${
      c.brightGreen
    }${totalPassed} passed${c.reset} ${c.dim}(${totalTests} total${skipText})${
      c.reset
    }\n`
  );
  return {
    success: true,
    failures: [],
    totalTests,
    passedTests: totalPassed,
    failedTests: totalFailed,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const options = parseArgs(argv);

  if (options.help) {
    printUsage();
    return;
  }

  if (options.listPrograms) {
    console.table(listProgramSummaries());
    return;
  }

  const totalStartTime = Date.now();
  printBanner();

  const programs = selectPrograms(options.program);
  const programNames = programs.map((p) => p.displayName).join(", ");
  console.log(
    `  ${icons.arrow} ${style.dim("Target:")} ${style.program(
      programs.length === PROGRAMS.length ? "All Programs" : programNames
    )}`
  );
  console.log(
    `  ${icons.arrow} ${style.dim("Mode:")} ${
      options.ts && options.rust
        ? "TS + Rust"
        : options.ts
        ? "TypeScript"
        : "Rust"
    }\n`
  );

  if (!options.skipBuild) {
    const buildTargets =
      programs.length === PROGRAMS.length ? PROGRAMS : programs;
    printSection("Building Programs", icons.build);
    await runBuildTasks(buildTargets, { verifiable: options.verifiableBuild });
  } else {
    console.log(`  ${icons.skip} ${style.dim("Build step skipped")}\n`);
  }

  const logger = options.ts ? new ComputeBudgetLogger() : null;
  if (logger) {
    logger.clearPersistentStats();
  }

  const tsResult = options.ts
    ? await runTsTests(programs, options, logger!)
    : { success: true, failures: [] };

  const rustResult = options.rust
    ? await runRustTests(programs, options)
    : { success: true, failures: [] };

  const totalDuration = Date.now() - totalStartTime;
  const allPassed = tsResult.success && rustResult.success;

  // Print final summary
  console.log(`${c.dim}${"─".repeat(60)}${c.reset}`);
  if (allPassed) {
    console.log(
      `  ${icons.pass} ${style.success("All tests passed")} ${
        c.dim
      }in ${formatDuration(totalDuration)}${c.reset}\n`
    );
  } else {
    console.log(
      `  ${icons.fail} ${style.error("Some tests failed")} ${
        c.dim
      }in ${formatDuration(totalDuration)}${c.reset}\n`
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`\n${c.red}╔${"═".repeat(58)}╗${c.reset}`);
  console.error(
    `${c.red}║${c.reset}  ${icons.fail} ${style.error(
      "TEST RUNNER CRASHED"
    )}${" ".repeat(35)}${c.red}║${c.reset}`
  );
  console.error(`${c.red}╚${"═".repeat(58)}╝${c.reset}\n`);
  if (error instanceof Error) {
    console.error(`  ${c.dim}Error:${c.reset} ${error.message}`);
  } else {
    console.error(`  ${c.dim}Error:${c.reset}`, error);
  }
  process.exit(1);
});
