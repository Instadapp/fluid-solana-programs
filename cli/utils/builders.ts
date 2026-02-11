import { execFile } from "child_process";
import { promisify } from "util";
import { Listr } from "listr2";
import { ProgramDefinition, ROOT_DIR } from "./programs";

const execFileAsync = promisify(execFile);

export interface BuildOptions {
  verifiable?: boolean;
  concurrency?: number;
}

async function buildProgram(
  program: ProgramDefinition,
  options: BuildOptions = {}
) {
  const args = ["build", "--program-name", program.anchorName];
  if (options.verifiable) {
    args.push("--verifiable");
  }

  return execFileAsync("anchor", args, {
    cwd: ROOT_DIR,
    env: process.env,
    maxBuffer: 1024 * 1024 * 10,
  });
}

export async function runBuildTasks(
  programs: ProgramDefinition[],
  options: BuildOptions = {}
) {
  if (!programs.length) {
    throw new Error("No programs selected for build.");
  }

  const uniquePrograms = [
    ...new Map(
      programs.map((program) => [program.anchorName, program])
    ).values(),
  ];

  const tasks = new Listr(
    uniquePrograms.map((program) => ({
      title: `Building ${program.displayName}`,
      task: async (ctx, task) => {
        const result = await buildProgram(program, options);
        const output = result.stdout?.toString().trim();
        if (output) {
          task.output = output;
        }
      },
    })),
    {
      concurrent: options.concurrency ? options.concurrency > 1 : false,
      rendererOptions: {
        collapseErrors: false,
      },
    }
  );

  await tasks.run();
}
