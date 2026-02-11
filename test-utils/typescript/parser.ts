import {
  BorshInstructionCoder,
  BorshEventCoder,
  BorshCoder,
  BN,
  EventParser,
  Coder,
  Idl,
} from "@coral-xyz/anchor";
import {
  Connection,
  ParsedTransactionWithMeta,
  PublicKey,
  PartiallyDecodedInstruction,
} from "@solana/web3.js";

import oracleIdl from "../target/idl/oracle.json";
import vaultIdl from "../target/idl/vaults.json";

interface ProgramConfig {
  programId: PublicKey;
  idl: Idl;
}

interface ReturnField {
  name: string;
  type: string;
}

interface ReturnTypeConfig {
  programId: PublicKey;
  function: string;
  returns: ReturnField[];
}

interface ParsedInstruction {
  program: string;
  programId: string;
  instruction: string;
  params: Record<string, any>;
  accounts: Record<string, string>;
  returns: any;
  events: Array<{ name: string; data: Record<string, any> }>;
}

const RETURN_TYPES: ReturnTypeConfig[] = [
  {
    programId: new PublicKey("jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc"),
    function: "get_both_exchange_rate",
    returns: [
      { name: "liquidate", type: "u128" },
      { name: "operate", type: "u128" },
    ],
  },
  {
    programId: new PublicKey("jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi"),
    function: "operate",
    returns: [
      { name: "nft_id", type: "u32" },
      { name: "new_col", type: "i128" },
      { name: "new_debt", type: "i128" },
    ],
  },
  {
    programId: new PublicKey("jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi"),
    function: "liquidate",
    returns: [
      { name: "col_amount", type: "u128" },
      { name: "debt_amount", type: "u128" },
    ],
  },
];

class SolanaTransactionParser {
  private connection: Connection;
  private programs: Map<string, ProgramConfig>;
  private coders: Map<
    string,
    { instruction: BorshInstructionCoder; coder: Coder }
  >;
  private returnTypes: Map<string, Map<string, ReturnField[]>>;

  constructor(
    rpcUrl: string,
    programs: ProgramConfig[],
    returnTypeConfigs: ReturnTypeConfig[]
  ) {
    this.connection = new Connection(rpcUrl);
    this.programs = new Map(programs.map((p) => [p.programId.toString(), p]));
    this.coders = new Map(
      programs.map((p) => [
        p.programId.toString(),
        {
          instruction: new BorshInstructionCoder(p.idl),
          coder: new BorshCoder(p.idl),
        },
      ])
    );
    this.returnTypes = new Map();

    for (const config of returnTypeConfigs) {
      const programIdStr = config.programId.toString();
      if (!this.returnTypes.has(programIdStr)) {
        this.returnTypes.set(programIdStr, new Map());
      }
      this.returnTypes.get(programIdStr)!.set(config.function, config.returns);
    }
  }

  async parseTransaction(txSignature: string): Promise<ParsedInstruction[]> {
    const tx = await this.connection.getParsedTransaction(txSignature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!tx?.meta) throw new Error("Transaction not found");

    const instructionMeta = this.buildInstructionMeta(tx);
    const returnData = this.extractReturnData(tx, instructionMeta);
    const events = this.extractEvents(tx);

    return this.buildResults(tx, returnData, events);
  }

  private buildInstructionMeta(tx: ParsedTransactionWithMeta) {
    const meta = new Map<number, { name: string; programId: string }>();

    tx.transaction.message.instructions.forEach((ix, index) => {
      const programIdStr = ix.programId.toString();
      const coder = this.coders.get(programIdStr);
      const partialIx = ix as PartiallyDecodedInstruction;

      if (coder?.instruction && partialIx.data) {
        const decoded = coder.instruction.decode(partialIx.data, "base58");
        if (decoded) {
          meta.set(index, { name: decoded.name, programId: programIdStr });
        }
      }
    });

    return meta;
  }

  private buildResults(
    tx: ParsedTransactionWithMeta,
    returnData: Map<number, any>,
    events: Map<number, Array<{ name: string; data: Record<string, any> }>>
  ): ParsedInstruction[] {
    const results: ParsedInstruction[] = [];

    tx.transaction.message.instructions.forEach((ix, index) => {
      const programIdStr = ix.programId.toString();
      const programConfig = this.programs.get(programIdStr);
      const coder = this.coders.get(programIdStr);
      const partialIx = ix as PartiallyDecodedInstruction;

      if (programConfig && coder?.instruction && partialIx.data) {
        const decoded = coder.instruction.decode(partialIx.data, "base58");
        if (decoded) {
          results.push({
            program: programConfig.idl.metadata.name,
            programId: programIdStr,
            instruction: decoded.name,
            params: this.serializeParams(decoded.data),
            accounts: this.decodeAccounts(
              programConfig.idl,
              decoded.name,
              partialIx.accounts.map((acc) => acc.toString())
            ),
            returns: returnData.get(index) || null,
            events: events.get(index) || [],
          });
        }
      }
    });

    return results;
  }

  private serializeParams(data: any): Record<string, any> {
    return Object.entries(data).reduce((acc, [key, value]) => {
      acc[key] = value instanceof BN ? value.toString() : value;
      return acc;
    }, {} as Record<string, any>);
  }

  private decodeAccounts(
    idl: Idl,
    instructionName: string,
    accountKeys: string[]
  ): Record<string, string> {
    const accounts: Record<string, string> = {};

    try {
      const instructionDef = idl.instructions.find(
        (ix) => ix.name === instructionName
      );

      if (!instructionDef?.accounts) {
        accountKeys.forEach((key, i) => {
          accounts[`account_${i}`] = key;
        });
        return accounts;
      }

      const flattenAccounts = (
        accs: any[],
        prefix = ""
      ): Array<{ name: string }> => {
        const result: Array<{ name: string }> = [];

        for (const acc of accs) {
          if ("accounts" in acc) {
            // Nested account structure
            result.push(
              ...flattenAccounts(acc.accounts, acc.name ? `${acc.name}.` : "")
            );
          } else {
            // Regular account
            result.push({ name: prefix + acc.name });
          }
        }

        return result;
      };

      const flatAccounts = flattenAccounts(instructionDef.accounts);

      accountKeys.forEach((key, i) => {
        if (i < flatAccounts.length) {
          accounts[flatAccounts[i].name] = key;
        } else {
          // Extra accounts beyond IDL definition
          accounts[`account_${i}`] = key;
        }
      });
    } catch (e) {
      console.warn(
        `Failed to decode accounts for instruction ${instructionName}:`,
        e
      );
      accountKeys.forEach((key, i) => {
        accounts[`account_${i}`] = key;
      });
    }

    return accounts;
  }

  private extractReturnData(
    tx: ParsedTransactionWithMeta,
    instructionMeta: Map<number, { name: string; programId: string }>
  ): Map<number, any> {
    const returnDataMap = new Map<number, any>();
    if (!tx.meta?.logMessages) return returnDataMap;

    const instructionStack: number[] = [];
    let topLevelIndex = -1;

    for (const log of tx.meta.logMessages) {
      const invokeMatch = log.match(/Program \w+ invoke \[(\d+)\]/);
      if (invokeMatch) {
        const depth = parseInt(invokeMatch[1]);
        if (depth === 1) {
          topLevelIndex++;
          instructionStack.push(topLevelIndex);
        } else {
          instructionStack.push(topLevelIndex);
        }
        continue;
      }

      if (log.startsWith("Program return:")) {
        const parts = log.split(" ");
        if (parts.length >= 4) {
          const currentIndex = instructionStack[instructionStack.length - 1];
          const ixMeta = instructionMeta.get(currentIndex);

          if (ixMeta && currentIndex !== undefined) {
            const buffer = Buffer.from(parts[3], "base64");
            returnDataMap.set(
              currentIndex,
              this.parseReturnData(buffer, ixMeta.programId, ixMeta.name)
            );
          }
        }
        continue;
      }

      if (log.match(/Program \w+ (success|failed)/)) {
        instructionStack.pop();
      }
    }

    return returnDataMap;
  }

  private parseReturnData(
    buffer: Buffer,
    programId: string,
    instructionName: string
  ): any {
    const returnFields = this.returnTypes.get(programId)?.get(instructionName);
    if (!returnFields) {
      return { raw: buffer.toString("base64"), hex: buffer.toString("hex") };
    }

    try {
      const result: any = {};
      let offset = 0;

      for (const field of returnFields) {
        const { value, size } = this.readType(buffer, offset, field.type);
        result[field.name] = value;
        offset += size;
      }

      return result;
    } catch (e) {
      console.warn(`Failed to decode return data for ${instructionName}:`, e);
      return { raw: buffer.toString("base64"), hex: buffer.toString("hex") };
    }
  }

  private readType(
    buffer: Buffer,
    offset: number,
    type: string
  ): { value: any; size: number } {
    const readers: Record<string, () => { value: any; size: number }> = {
      u8: () => ({ value: buffer.readUInt8(offset), size: 1 }),
      i8: () => ({ value: buffer.readInt8(offset), size: 1 }),
      u16: () => ({ value: buffer.readUInt16LE(offset), size: 2 }),
      i16: () => ({ value: buffer.readInt16LE(offset), size: 2 }),
      u32: () => ({ value: buffer.readUInt32LE(offset), size: 4 }),
      i32: () => ({ value: buffer.readInt32LE(offset), size: 4 }),
      u64: () => ({
        value: new BN(buffer.slice(offset, offset + 8), "le").toString(),
        size: 8,
      }),
      i64: () => {
        const bn = new BN(buffer.slice(offset, offset + 8), "le");
        const isNegative = buffer[offset + 7] & 0x80;
        return {
          value: isNegative
            ? bn.sub(new BN(2).pow(new BN(64))).toString()
            : bn.toString(),
          size: 8,
        };
      },
      u128: () => ({
        value: new BN(buffer.slice(offset, offset + 16), "le").toString(),
        size: 16,
      }),
      i128: () => {
        const bn = new BN(buffer.slice(offset, offset + 16), "le");
        const isNegative = buffer[offset + 15] & 0x80;
        return {
          value: isNegative
            ? bn.sub(new BN(2).pow(new BN(128))).toString()
            : bn.toString(),
          size: 16,
        };
      },
      bool: () => ({ value: buffer.readUInt8(offset) === 1, size: 1 }),
      publicKey: () => ({
        value: new PublicKey(buffer.slice(offset, offset + 32)).toString(),
        size: 32,
      }),
    };

    return (
      readers[type]?.() || {
        value: buffer.slice(offset).toString("hex"),
        size: buffer.length - offset,
      }
    );
  }

  private extractEvents(
    tx: ParsedTransactionWithMeta
  ): Map<number, Array<{ name: string; data: Record<string, any> }>> {
    const eventsMap = new Map<
      number,
      Array<{ name: string; data: Record<string, any> }>
    >();
    if (!tx.meta?.logMessages) return eventsMap;

    const logs = tx.meta.logMessages;

    for (const [programId, coderInfo] of this.coders.entries()) {
      try {
        const parser = new EventParser(
          new PublicKey(programId),
          coderInfo.coder
        );
        const invocations = this.findProgramInvocations(logs, programId);

        for (const invocation of invocations) {
          const invocationLogs = logs.slice(
            invocation.logStart,
            invocation.logEnd
          );
          const events = Array.from(parser.parseLogs(invocationLogs)).map(
            (event) => ({
              name: event.name,
              data: this.serializeParams(event.data),
            })
          );

          if (events.length > 0) {
            const existing = eventsMap.get(invocation.instructionIndex) || [];
            eventsMap.set(invocation.instructionIndex, [
              ...existing,
              ...events,
            ]);
          }
        }
      } catch (e) {
        console.warn(`Failed to parse events for program ${programId}:`, e);
      }
    }

    return eventsMap;
  }

  private findProgramInvocations(
    logs: string[],
    programId: string
  ): Array<{ instructionIndex: number; logStart: number; logEnd: number }> {
    const invocations: Array<{
      instructionIndex: number;
      logStart: number;
      logEnd: number;
    }> = [];
    let topLevelIndex = -1;
    let currentInvocation: {
      instructionIndex: number;
      logStart: number;
    } | null = null;
    let depth = 0;

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];

      const invokeMatch = log.match(/Program (\w+) invoke \[(\d+)\]/);
      if (invokeMatch) {
        const [, logProgramId, logDepth] = invokeMatch;
        const depthNum = parseInt(logDepth);

        if (depthNum === 1) {
          topLevelIndex++;
          if (logProgramId === programId) {
            currentInvocation = {
              instructionIndex: topLevelIndex,
              logStart: i,
            };
            depth = 1;
          }
        } else if (currentInvocation && depthNum > depth) {
          depth = depthNum;
        }
      }

      if (currentInvocation && log.match(/Program \w+ (success|failed)/)) {
        depth--;
        if (depth === 0) {
          invocations.push({
            instructionIndex: currentInvocation.instructionIndex,
            logStart: currentInvocation.logStart,
            logEnd: i + 1,
          });
          currentInvocation = null;
        }
      }
    }

    return invocations;
  }
}

async function main() {
  const parser = new SolanaTransactionParser(
    "https://api.mainnet-beta.solana.com",
    [
      {
        programId: new PublicKey("jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc"),
        idl: oracleIdl as Idl,
      },
      {
        programId: new PublicKey("jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi"),
        idl: vaultIdl as Idl,
      },
    ],
    RETURN_TYPES
  );

  const result = await parser.parseTransaction(
    "GswZvNLsPycgcmVB4rg5pXVeXi3tBsR3DpGbyVbZLXW76Dt9Q1LWue68H61nVCQBzoWUU5H6JpChsBzetAEhnHd"
  );

  console.log(JSON.stringify(result, null, 2));
}

main();
