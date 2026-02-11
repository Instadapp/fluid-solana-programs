import { listProgramSummaries, selectPrograms } from "./utils/programs";
import { runBuildTasks } from "./utils/builders";

interface BuildCliOptions {
  program?: string;
  verifiable: boolean;
  listPrograms: boolean;
}

function parseArgs(argv: string[]): BuildCliOptions {
  const options: BuildCliOptions = {
    verifiable: argv.includes("--verifiable"),
    listPrograms: argv.includes("--list-programs"),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--program" || arg === "-p") {
      options.program = argv[i + 1];
      i += 1;
    }
  }

  return options;
}

async function main() {
  const argv = process.argv.slice(2);
  const options = parseArgs(argv);

  if (options.listPrograms) {
    console.table(listProgramSummaries());
    return;
  }

  const programs = selectPrograms(options.program);
  const title =
    programs.length === 1
      ? `🔨 Building ${programs[0].displayName}`
      : "🔨 Building all programs";

  console.log(`\n${title}\n`);
  await runBuildTasks(programs, { verifiable: options.verifiable });
  console.log("\n✅ Build complete!\n");
}

main().catch((error) => {
  console.error("\n❌ Build failed!\n");
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
