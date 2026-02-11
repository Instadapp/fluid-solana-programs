import fs from "fs";
import path from "path";

interface ProgramStats {
  [instructionName: string]: {
    avgComputeUnit: number;
    minComputeUnit: number;
    maxComputeUnit: number;
    medianComputeUnit: number;
    totalRuns: number;
    allValues: number[];
  };
}

class ComputeBudgetLogger {
  logBudget: boolean;
  computeMap: Map<string, number[]>;
  programNames: Map<string, string>;
  private budgetDir: string;

  constructor(budgetDir: string = ".compute_budget") {
    this.computeMap = new Map();
    this.logBudget = true;
    this.programNames = new Map();
    this.budgetDir = budgetDir;
    this.ensureBudgetDirExists();
  }

  setProgramName(programId: string, name: string) {
    this.programNames.set(programId, name);
  }

  private ensureBudgetDirExists() {
    if (!fs.existsSync(this.budgetDir)) {
      fs.mkdirSync(this.budgetDir, { recursive: true });
    }
  }

  private getProgramStatsPath(programName: string): string {
    const sanitizedName = programName.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.budgetDir, `${sanitizedName}.json`);
  }

  private loadProgramStats(programName: string): ProgramStats {
    const filePath = this.getProgramStatsPath(programName);

    if (fs.existsSync(filePath)) {
      try {
        const data = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(data);

        for (const [instruction, stats] of Object.entries(parsed)) {
          const statData = stats as any;
          if (!statData.minComputeUnit || !statData.maxComputeUnit) {
            statData.minComputeUnit = statData.avgComputeUnit;
            statData.maxComputeUnit = statData.avgComputeUnit;
            statData.medianComputeUnit = statData.avgComputeUnit;
            statData.allValues = statData.allValues || [];
          }
        }

        return parsed;
      } catch (error) {
        console.warn(`Failed to load stats for ${programName}:`, error);
      }
    }

    return {};
  }

  private saveProgramStats(programName: string, stats: ProgramStats) {
    const filePath = this.getProgramStatsPath(programName);

    try {
      const cleanStats: any = {};
      for (const [instruction, data] of Object.entries(stats)) {
        cleanStats[instruction] = {
          avgComputeUnit: data.avgComputeUnit,
          minComputeUnit: data.minComputeUnit,
          maxComputeUnit: data.maxComputeUnit,
          medianComputeUnit: data.medianComputeUnit,
          totalRuns: data.totalRuns,
          // Only store last 1000 values to prevent huge files
          allValues: data.allValues.slice(-1000),
        };
      }

      fs.writeFileSync(filePath, JSON.stringify(cleanStats, null, 2));
    } catch (error) {
      console.error(`Failed to save stats for ${programName}:`, error);
    }
  }

  private updatePersistentStats() {
    const programGroups: Record<
      string,
      Array<{ instruction: string; values: number[] }>
    > = {};

    // Group by program
    for (const [key, values] of this.computeMap.entries()) {
      const [program, instruction] = key.split("::");
      if (!programGroups[program]) {
        programGroups[program] = [];
      }
      programGroups[program].push({ instruction, values });
    }

    // Update stats for each program
    for (const [programName, instructions] of Object.entries(programGroups)) {
      const existingStats = this.loadProgramStats(programName);

      for (const { instruction, values } of instructions) {
        const newMin = Math.min(...values);
        const newMax = Math.max(...values);
        const newAvg = values.reduce((a, b) => a + b, 0) / values.length;
        const newRuns = values.length;

        if (existingStats[instruction]) {
          const existing = existingStats[instruction];
          const oldAvg = existing.avgComputeUnit;
          const oldRuns = existing.totalRuns;
          const oldMin = existing.minComputeUnit;
          const oldMax = existing.maxComputeUnit;
          const oldValues = existing.allValues || [];

          const oldTotal = oldAvg * oldRuns;
          const newTotal = newAvg * newRuns;
          const combinedTotal = oldTotal + newTotal;
          const combinedRuns = oldRuns + newRuns;
          const combinedAvg = combinedTotal / combinedRuns;

          const combinedValues = [...oldValues, ...values];
          const combinedMin = Math.min(oldMin, newMin);
          const combinedMax = Math.max(oldMax, newMax);
          const combinedMedian = this.calculateMedian(combinedValues);

          existingStats[instruction] = {
            avgComputeUnit: Math.round(combinedAvg),
            minComputeUnit: combinedMin,
            maxComputeUnit: combinedMax,
            medianComputeUnit: Math.round(combinedMedian),
            totalRuns: combinedRuns,
            allValues: combinedValues,
          };
        } else {
          // New instruction
          const median = this.calculateMedian(values);
          existingStats[instruction] = {
            avgComputeUnit: Math.round(newAvg),
            minComputeUnit: newMin,
            maxComputeUnit: newMax,
            medianComputeUnit: Math.round(median),
            totalRuns: newRuns,
            allValues: [...values],
          };
        }
      }

      this.saveProgramStats(programName, existingStats);
    }
  }

  loadAndDisplayPersistentStats() {
    const allStats: Record<string, ProgramStats> = {};

    if (!fs.existsSync(this.budgetDir)) {
      console.log("No persistent stats found.");
      return allStats;
    }

    const files = fs
      .readdirSync(this.budgetDir)
      .filter((f) => f.endsWith(".json"));

    for (const file of files) {
      const programName = path.basename(file, ".json");
      const stats = this.loadProgramStats(programName);
      if (Object.keys(stats).length > 0) {
        allStats[programName] = stats;
      }
    }

    if (Object.keys(allStats).length > 0) {
      console.log("=".repeat(50));

      for (const [program, instructions] of Object.entries(allStats)) {
        console.log(`\n📊 ${program}`);
        const tableData = Object.entries(instructions).map(
          ([instruction, data]) => ({
            Instruction: instruction,
            Min: data.minComputeUnit,
            Avg: data.avgComputeUnit,
            Median: data.medianComputeUnit,
            Max: data.maxComputeUnit,
            "Total Runs": data.totalRuns,
          })
        );
        console.table(tableData);
      }
    } else {
      console.log("No persistent stats available yet.");
    }

    return allStats;
  }

  getPersistentProgramStats(programName: string): ProgramStats {
    return this.loadProgramStats(programName);
  }

  clearPersistentStats(programName?: string) {
    if (programName) {
      const filePath = this.getProgramStatsPath(programName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } else {
      if (fs.existsSync(this.budgetDir)) {
        const files = fs
          .readdirSync(this.budgetDir)
          .filter((f) => f.endsWith(".json"));
        for (const file of files) {
          fs.unlinkSync(path.join(this.budgetDir, file));
        }
      }
    }
  }

  saveToPersistentStorage() {
    if (this.computeMap.size === 0) {
      console.log("No data to save.");
      return;
    }

    this.updatePersistentStats();
  }

  private getProgramDisplayName(programId: string): string {
    if (this.programNames.has(programId)) {
      return this.programNames.get(programId)!;
    }

    if (programId.length > 8) {
      return `${programId.slice(0, 4)}...${programId.slice(-4)}`;
    }

    return programId;
  }

  private createKey(programId: string, instruction: string): string {
    const displayName = this.getProgramDisplayName(programId);
    return `${displayName}::${instruction}`;
  }

  parseProgramLogs(logs: string[]) {
    const result: Record<string, number> = {};
    const programStack: Array<{
      programId: string;
      depth: number;
      instruction: string | null;
    }> = [];

    for (const log of logs) {
      const invokeMatch = log.match(/Program (\w+) invoke \[(\d+)\]/);
      if (invokeMatch) {
        const [, programId, depth] = invokeMatch;
        programStack.push({
          programId,
          depth: parseInt(depth),
          instruction: null,
        });
        continue;
      }

      const instructionMatch = log.match(/Program log: Instruction: (\w+)/);
      if (instructionMatch) {
        const instruction = instructionMatch[1];
        for (let i = programStack.length - 1; i >= 0; i--) {
          if (!programStack[i].instruction) {
            programStack[i].instruction = instruction;
            break;
          }
        }
        continue;
      }

      const computeMatch = log.match(
        /Program (\w+) consumed (\d+) of \d+ compute units/
      );
      if (computeMatch) {
        const [, programId, computeUnits] = computeMatch;
        const consumed = parseInt(computeUnits);

        for (let i = programStack.length - 1; i >= 0; i--) {
          if (
            programStack[i].programId === programId &&
            programStack[i].instruction
          ) {
            const instruction = programStack[i].instruction;
            const key = this.createKey(programId, instruction);

            if (result[key]) {
              result[key] += consumed;
            } else {
              result[key] = consumed;
            }
            break;
          }
        }
        continue;
      }

      const successMatch = log.match(/Program (\w+) success/);
      if (successMatch) {
        const programId = successMatch[1];
        for (let i = programStack.length - 1; i >= 0; i--) {
          if (programStack[i].programId === programId) {
            programStack.splice(i, 1);
            break;
          }
        }
        continue;
      }
    }

    return result;
  }

  extractComputeBudget(logs: Array<string>) {
    const programLogs = this.parseProgramLogs(logs);

    for (const [k, v] of Object.entries(programLogs)) {
      if (!this.computeMap.has(k)) this.computeMap.set(k, []);
      this.computeMap.get(k)!.push(v as number);
    }
  }

  logComputeBudgetDetailed() {
    const stats: Array<{
      "Program::Instruction": string;
      min: number;
      avg: number;
      median: number;
      max: number;
      "# calls": number;
    }> = [];

    for (const [functionName, values] of this.computeMap.entries()) {
      if (values.length === 0) continue;

      const min = Math.min(...values);
      const max = Math.max(...values);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const median = this.calculateMedian(values);
      const calls = values.length;

      stats.push({
        "Program::Instruction": functionName,
        min: min,
        avg: Math.round(avg),
        median: Math.round(median),
        max: max,
        "# calls": calls,
      });
    }

    stats.sort((a, b) =>
      a["Program::Instruction"].localeCompare(b["Program::Instruction"])
    );

    if (this.logBudget && stats.length > 0) {
      console.table(stats);
    }

    return stats;
  }

  logComputeBudget() {
    // this.logComputeBudgetDetailed();
    this.saveToPersistentStorage();
  }

  printPersistentStatsTable(programName: string) {
    const stats = this.loadProgramStats(programName);

    if (Object.keys(stats).length === 0) {
      console.log(`No persistent stats found for program: ${programName}`);
      return;
    }

    const data = Object.entries(stats).map(([instruction, data]) => ({
      programInstruction: `${programName}::${instruction}`,
      min: data.minComputeUnit,
      avg: data.avgComputeUnit,
      median: data.medianComputeUnit,
      max: data.maxComputeUnit,
      calls: data.totalRuns,
    }));

    console.log(`\n📊 Compute Budget Report for ${programName}`);
    this.printFormattedTable(data);
  }

  printFormattedTable(
    data: Array<{
      programInstruction: string;
      min: number;
      avg: number;
      median: number;
      max: number;
      calls: number;
    }>
  ) {
    const headers = [
      "Program::Instruction",
      "min",
      "avg",
      "median",
      "max",
      "# calls",
    ];
    const colWidths = [50, 10, 10, 10, 10, 10];

    const separator = colWidths.map((w) => "-".repeat(w)).join("-+-") + "-";
    console.log("-" + separator);

    const headerRow = headers.map((h, i) => h.padEnd(colWidths[i])).join(" | ");
    console.log("| " + headerRow + " |");

    console.log("-" + separator);

    data.forEach((row) => {
      const values = [
        row.programInstruction.padEnd(colWidths[0]),
        row.min.toString().padStart(colWidths[1]),
        row.avg.toString().padStart(colWidths[2]),
        row.median.toString().padStart(colWidths[3]),
        row.max.toString().padStart(colWidths[4]),
        row.calls.toString().padStart(colWidths[5]),
      ];
      console.log("| " + values.join(" | ") + " |");
    });

    console.log("-" + separator);
  }

  calculateMedian(values: number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  clear() {
    this.computeMap.clear();
  }

  getSummary() {
    const totalCalls = Array.from(this.computeMap.values()).reduce(
      (total, values) => total + values.length,
      0
    );

    const allValues = Array.from(this.computeMap.values()).flat();
    const totalComputeUnits = allValues.reduce((sum, val) => sum + val, 0);
    const avgComputePerCall =
      totalCalls > 0 ? totalComputeUnits / totalCalls : 0;

    const uniquePrograms = new Set(
      Array.from(this.computeMap.keys()).map((key) => key.split("::")[0])
    ).size;

    return {
      uniquePrograms,
      totalInstructions: this.computeMap.size,
      totalCalls,
      totalComputeUnits,
      avgComputePerCall: Math.round(avgComputePerCall),
    };
  }
}

export default ComputeBudgetLogger;
