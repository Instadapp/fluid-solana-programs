import path from "path";

// We're in cli/utils, so go up two levels to get to project root
const ROOT_DIR = path.resolve(__dirname, "../..");

export { ROOT_DIR };
export const TS_TEST_ROOT = path.join(ROOT_DIR, "__tests__");
export const RUST_TEST_PACKAGE = "tests";

const RAW_PROGRAMS = [
  {
    id: "liquidity",
    displayName: "Liquidity",
    anchorName: "liquidity",
    testDir: "liquidity",
    rustFilter: "liquidity",
    computeStats: ["Liquidity"],
    aliases: ["liq"],
  },
  {
    id: "lending",
    displayName: "Lending",
    anchorName: "lending",
    testDir: "lending",
    rustFilter: "lending",
    computeStats: ["Lending", "Liquidity", "LendingRewardsRateModel"],
    aliases: ["lend"],
  },
  {
    id: "vaults",
    displayName: "Vaults",
    anchorName: "vaults",
    testDir: "vaults",
    rustFilter: "vaults",
    computeStats: ["Vaults", "Liquidity", "Oracle"],
    aliases: ["vault"],
  },
  {
    id: "flashloan",
    displayName: "Flash Loan",
    anchorName: "flashloan",
    testDir: "flashloan",
    rustFilter: "flashloan",
    computeStats: ["Flashloan", "Liquidity"],
    aliases: ["flash-loan", "flash_loan"],
  },
  {
    id: "oracle",
    displayName: "Oracle",
    anchorName: "oracle",
    testDir: undefined,
    rustFilter: "oracle",
    computeStats: ["Oracle"],
  },
  {
    id: "lending_reward_rate_model",
    displayName: "Lending Reward Rate Model",
    anchorName: "lending_reward_rate_model",
    testDir: undefined,
    rustFilter: "lrrm",
    computeStats: ["LendingRewardsRateModel"],
    aliases: ["lrrm", "reward_rate_model"],
  },
] as const;

export type ProgramId = (typeof RAW_PROGRAMS)[number]["id"];

export interface ProgramDefinition {
  id: ProgramId;
  displayName: string;
  anchorName: string;
  testDir?: string;
  rustFilter?: string;
  computeStats?: string[];
  aliases?: string[];
}

export const PROGRAMS: ProgramDefinition[] = RAW_PROGRAMS.map((program) => ({
  ...program,
  computeStats: [...(program.computeStats ?? [])],
  aliases: "aliases" in program ? [...program.aliases] : undefined,
}));

const PROGRAM_LOOKUP = new Map<string, ProgramDefinition>();

PROGRAMS.forEach((program) => {
  const keys = new Set<string>();
  keys.add(program.id);
  keys.add(program.anchorName);
  keys.add(program.displayName);
  if (program.testDir) keys.add(program.testDir);
  program.aliases?.forEach((alias) => keys.add(alias));

  keys.forEach((key) => PROGRAM_LOOKUP.set(normalizeProgramKey(key), program));
});

export function normalizeProgramKey(value: string | undefined): string {
  if (!value) return "";
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase()
    .trim();
}

export function resolveProgram(value: string): ProgramDefinition | undefined {
  if (!value) return undefined;
  const normalized = normalizeProgramKey(value);
  if (normalized === "all") return undefined;
  return PROGRAM_LOOKUP.get(normalized);
}

export function selectPrograms(programArg?: string): ProgramDefinition[] {
  const normalized = normalizeProgramKey(programArg);
  if (!normalized || normalized === "all") {
    return [...PROGRAMS];
  }

  const program = resolveProgram(normalized);
  if (!program) {
    throw new Error(
      `Unknown program "${programArg}". Use "pnpm test --list-programs" to see supported values.`
    );
  }

  return [program];
}

export function listProgramSummaries() {
  return PROGRAMS.map((program) => ({
    program: program.id,
    name: program.displayName,
    anchor: program.anchorName,
    tsTests: Boolean(program.testDir),
    rustTests: Boolean(program.rustFilter),
  }));
}

export function getComputeStatTargets(programs: ProgramDefinition[]): string[] {
  const targets = new Set<string>();
  programs.forEach((program) => {
    program.computeStats?.forEach((value) => targets.add(value));
  });
  return Array.from(targets.values());
}
