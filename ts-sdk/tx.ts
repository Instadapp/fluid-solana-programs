import axios from "axios";
import { BorshInstructionCoder } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";

// Types
interface SquadsTransaction {
  transaction: {
    account: {
      message: {
        instructions: Array<{
          programIdIndex: number;
          accountIndexes: number[];
          data: number[];
        }>;
        accountKeys: string[];
        addressTableLookups?: Array<{
          accountKey: string;
          writableIndexes: number[];
          readonlyIndexes: number[];
        }>;
      };
    };
    metadata: {
      info: {
        memo: string;
      };
    };
  };
}

interface DecodedInstruction {
  programId: string;
  programName: string;
  instructionName: string;
  accounts: string[];
  decodedData: any;
  rawData: number[];
}

interface DecodedTransaction {
  transactionId: string;
  memo: string;
  instructions: DecodedInstruction[];
}

// Program ID mappings
const PROGRAM_MAPPINGS: Record<string, { name: string; idlUrl: string }> = {
  jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC: {
    name: "LIQUIDITY_PROGRAM",
    idlUrl:
      "https://raw.githubusercontent.com/jup-ag/jupiter-lend/refs/heads/main/target/idl/liquidity.json",
  },
  jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9: {
    name: "LENDING_PROGRAM",
    idlUrl:
      "https://raw.githubusercontent.com/jup-ag/jupiter-lend/refs/heads/main/target/idl/lending.json",
  },
  jup7TthsMgcR9Y3L277b8Eo9uboVSmu1utkuXHNUKar: {
    name: "LRRM_PROGRAM",
    idlUrl:
      "https://raw.githubusercontent.com/jup-ag/jupiter-lend/refs/heads/main/target/idl/lending_reward_rate_model.json",
  },
  jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc: {
    name: "ORACLE_PROGRAM",
    idlUrl:
      "https://raw.githubusercontent.com/jup-ag/jupiter-lend/refs/heads/main/target/idl/oracle.json",
  },
  jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi: {
    name: "VAULTS_PROGRAM",
    idlUrl:
      "https://raw.githubusercontent.com/jup-ag/jupiter-lend/refs/heads/main/target/idl/vaults.json",
  },
};

// Cache for IDLs and Coders
const idlCache: Record<string, any> = {};
const coderCache: Record<string, BorshInstructionCoder> = {};

// Solana connection - you can change this to mainnet or your preferred RPC
const connection = new Connection("https://api.mainnet-beta.solana.com");

/**
 * Get lookup table accounts using Solana web3.js
 */
async function getLookupTableAccounts(lookupTableAddresses: PublicKey) {
  const lookupTableAccounts = [];
  const account = await connection.getAddressLookupTable(lookupTableAddresses);
  if (account && account.value) {
    lookupTableAccounts.push(account.value);
  } else {
    throw new Error(
      `Lookup table not found: ${lookupTableAddresses.toBase58()}`
    );
  }
  return lookupTableAccounts;
}

class JupiterTransactionDecoder {
  /**
   * Fetch address table lookup accounts using Solana web3.js
   */
  private async fetchAddressTableAccounts(
    addressTableKey: string
  ): Promise<string[]> {
    try {
      console.log(`📋 Fetching address table: ${addressTableKey}`);

      const lookupTablePubkey = new PublicKey(addressTableKey);
      const lookupTableAccounts = await getLookupTableAccounts(
        lookupTablePubkey
      );

      if (lookupTableAccounts.length > 0) {
        const addresses = lookupTableAccounts[0].state.addresses.map((pubkey) =>
          pubkey.toBase58()
        );
        return addresses;
      }

      return [];
    } catch (error) {
      console.warn(
        `⚠️ Failed to fetch address table ${addressTableKey}: ${error}`
      );
      return [];
    }
  }

  /**
   * Resolve all account keys including address table lookups
   */
  private async resolveAccountKeys(
    baseAccountKeys: string[],
    addressTableLookups: Array<{
      accountKey: string;
      writableIndexes: number[];
      readonlyIndexes: number[];
    }>
  ): Promise<string[]> {
    const resolvedKeys = [...baseAccountKeys];

    for (const lookup of addressTableLookups) {
      const tableAccounts = await this.fetchAddressTableAccounts(
        lookup.accountKey
      );

      // Add writable accounts from the lookup table
      for (const index of lookup.writableIndexes) {
        if (tableAccounts[index]) {
          resolvedKeys.push(tableAccounts[index]);
        }
      }

      // Add readonly accounts from the lookup table
      for (const index of lookup.readonlyIndexes) {
        if (tableAccounts[index]) {
          resolvedKeys.push(tableAccounts[index]);
        }
      }
    }

    return resolvedKeys;
  }

  /**
   * Convert hex values to decimal strings recursively
   */
  private convertHexToDecimal(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    // Handle BN (BigNumber) objects
    if (
      obj instanceof BN ||
      (obj &&
        typeof obj === "object" &&
        obj.constructor &&
        obj.constructor.name === "BN")
    ) {
      return obj.toString(10); // Convert BN to decimal string
    }

    // Handle objects with _bn property (BN serialized objects)
    if (
      obj &&
      typeof obj === "object" &&
      obj._bn &&
      typeof obj._bn === "string"
    ) {
      return obj._bn; // Return the decimal string directly
    }

    // Handle hex strings (starting with 0x)
    if (typeof obj === "string" && obj.startsWith("0x")) {
      try {
        // Convert hex string to decimal
        const decimal = parseInt(obj, 16);
        return decimal.toString();
      } catch (error) {
        // If conversion fails, return original string
        return obj;
      }
    }

    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map((item) => this.convertHexToDecimal(item));
    }

    // Handle objects
    if (typeof obj === "object") {
      const converted: any = {};
      for (const [key, value] of Object.entries(obj)) {
        converted[key] = this.convertHexToDecimal(value);
      }
      return converted;
    }

    // Handle numbers that might be in hex format
    if (typeof obj === "number") {
      return obj.toString();
    }

    // Return primitive values as-is
    return obj;
  }

  /**
   * Fetch IDL for a given program ID
   */
  private async fetchIDL(programId: string): Promise<any> {
    if (idlCache[programId]) {
      return idlCache[programId];
    }

    const mapping = PROGRAM_MAPPINGS[programId];
    if (!mapping) {
      throw new Error(`Unknown program ID: ${programId}`);
    }

    try {
      console.log(`📥 Fetching IDL for ${mapping.name}...`);
      const response = await axios.get(mapping.idlUrl);
      const idl = response.data;
      idlCache[programId] = idl;
      console.log(`✅ IDL loaded for ${mapping.name}`);
      return idl;
    } catch (error) {
      throw new Error(`Failed to fetch IDL for ${mapping.name}: ${error}`);
    }
  }

  /**
   * Get or create BorshInstructionCoder instance
   */
  private async getCoder(programId: string): Promise<BorshInstructionCoder> {
    if (coderCache[programId]) {
      return coderCache[programId];
    }

    const idl = await this.fetchIDL(programId);
    const coder = new BorshInstructionCoder(idl);
    coderCache[programId] = coder;

    return coder;
  }

  /**
   * Decode a single instruction using Anchor's BorshInstructionCoder
   */
  private async decodeInstruction(
    instruction: {
      programIdIndex: number;
      accountIndexes: number[];
      data: number[];
    },
    resolvedAccountKeys: string[]
  ): Promise<DecodedInstruction> {
    const programId = resolvedAccountKeys[instruction.programIdIndex];
    const mapping = PROGRAM_MAPPINGS[programId];

    if (!mapping) {
      return {
        programId,
        programName: "UNKNOWN_PROGRAM",
        instructionName: "unknown",
        accounts: instruction.accountIndexes.map(
          (idx) => resolvedAccountKeys[idx] || `UNKNOWN_ACCOUNT_${idx}`
        ),
        decodedData: { error: "Unknown program ID" },
        rawData: instruction.data,
      };
    }

    try {
      // Get the BorshInstructionCoder instance
      const coder = await this.getCoder(programId);

      // Convert instruction data to Buffer
      const instructionData = Buffer.from(instruction.data);

      // Use Anchor's BorshInstructionCoder.decode() method
      const decoded = coder.decode(instructionData, "base58");

      if (!decoded) {
        return {
          programId,
          programName: mapping.name,
          instructionName: "unknown",
          accounts: instruction.accountIndexes.map(
            (idx) => resolvedAccountKeys[idx] || `UNKNOWN_ACCOUNT_${idx}`
          ),
          decodedData: {
            error: "Could not decode instruction with BorshInstructionCoder",
          },
          rawData: instruction.data,
        };
      }

      // Convert hex values to decimal strings in the decoded data
      const convertedDecodedData = this.convertHexToDecimal(decoded.data);

      return {
        programId,
        programName: mapping.name,
        instructionName: decoded.name,
        accounts: instruction.accountIndexes.map(
          (idx) => resolvedAccountKeys[idx] || `UNKNOWN_ACCOUNT_${idx}`
        ),
        decodedData: convertedDecodedData,
        rawData: instruction.data,
      };
    } catch (error) {
      console.warn(
        `⚠️ Failed to decode instruction for ${mapping.name}: ${error}`
      );

      // Fallback: provide basic information
      return {
        programId,
        programName: mapping.name,
        instructionName: "decode_error",
        accounts: instruction.accountIndexes.map(
          (idx) => resolvedAccountKeys[idx] || `UNKNOWN_ACCOUNT_${idx}`
        ),
        decodedData: {
          error: `Decode failed: ${error}`,
          discriminator: instruction.data.slice(0, 8),
          note: "Raw instruction data available in rawData field",
        },
        rawData: instruction.data,
      };
    }
  }

  /**
   * Main decode function - decodes a complete transaction
   */
  async decodeTransaction(txId: string): Promise<DecodedTransaction> {
    try {
      console.log(`🔍 Fetching transaction: ${txId}`);

      // Fetch transaction data
      const txResponse = await axios.get(
        `https://v4-api.squads.so/transactionV2/${txId}`
      );
      const txData: SquadsTransaction = txResponse.data;

      console.log("✅ Transaction data fetched successfully");

      const instructions = txData.transaction.account.message.instructions;
      const baseAccountKeys = txData.transaction.account.message.accountKeys;
      const addressTableLookups =
        txData.transaction.account.message.addressTableLookups || [];
      const memo = JSON.parse(txData.transaction.metadata.info.memo).memo;

      console.log(`📋 Base account keys: ${baseAccountKeys.length}`);
      console.log(`📋 Address table lookups: ${addressTableLookups.length}`);

      // Resolve all account keys including address table lookups
      const resolvedAccountKeys = await this.resolveAccountKeys(
        baseAccountKeys,
        addressTableLookups
      );

      console.log(
        `📋 Total resolved account keys: ${resolvedAccountKeys.length}`
      );
      console.log(`📋 Processing ${instructions.length} instructions...`);

      // Decode all instructions
      const decodedInstructions: DecodedInstruction[] = [];

      for (let i = 0; i < instructions.length; i++) {
        console.log(`🔄 Decoding instruction ${i + 1}/${instructions.length}`);
        const decoded = await this.decodeInstruction(
          instructions[i],
          resolvedAccountKeys
        );
        decodedInstructions.push(decoded);
      }

      const result: DecodedTransaction = {
        transactionId: txId,
        memo,
        instructions: decodedInstructions,
      };

      console.log("🎉 Decoding completed!");
      return result;
    } catch (error) {
      throw new Error(`Failed to decode transaction: ${error}`);
    }
  }

  /**
   * Utility method to decode a single instruction data buffer
   */
  async decodeInstructionData(
    programId: string,
    instructionData: Buffer
  ): Promise<any> {
    try {
      const coder = await this.getCoder(programId);
      const decoded = coder.decode(instructionData, "base58");
      return this.convertHexToDecimal(decoded);
    } catch (error) {
      throw new Error(`Failed to decode instruction data: ${error}`);
    }
  }

  /**
   * Get all available instruction names for a program
   */
  async getInstructionNames(programId: string): Promise<string[]> {
    try {
      const idl = await this.fetchIDL(programId);
      return idl.instructions?.map((instr: any) => instr.name) || [];
    } catch (error) {
      throw new Error(`Failed to get instruction names: ${error}`);
    }
  }

  /**
   * Decode instruction data from raw bytes array (like from your JSON data)
   */
  async decodeInstructionFromRawData(
    programId: string,
    rawData: number[]
  ): Promise<any> {
    try {
      const coder = await this.getCoder(programId);
      const instructionBuffer = Buffer.from(rawData);
      const decoded = coder.decode(instructionBuffer);
      return this.convertHexToDecimal(decoded);
    } catch (error) {
      throw new Error(`Failed to decode instruction from raw data: ${error}`);
    }
  }

  /**
   * Utility method to manually convert hex string to decimal
   */
  static hexToDecimal(hexString: string): string {
    if (typeof hexString !== "string" || !hexString.startsWith("0x")) {
      return hexString;
    }
    try {
      return parseInt(hexString, 16).toString();
    } catch (error) {
      return hexString;
    }
  }

  /**
   * Utility method to convert BN to decimal string
   */
  static bnToDecimal(bn: any): string {
    if (
      bn instanceof BN ||
      (bn &&
        typeof bn === "object" &&
        bn.constructor &&
        bn.constructor.name === "BN")
    ) {
      return bn.toString(10);
    }
    return bn;
  }
}

// Usage example
async function main(txId: string) {
  const decoder = new JupiterTransactionDecoder();

  try {
    const decoded = await decoder.decodeTransaction(txId);

    console.log("\n" + "=".repeat(60));
    console.log("📊 DECODED TRANSACTION SUMMARY");
    console.log("=".repeat(60));
    console.log(`Transaction ID: ${decoded.transactionId}`);
    console.log(`Memo: ${decoded.memo}`);
    console.log(`Instructions: ${decoded.instructions.length}\n`);

    decoded.instructions.forEach((instr, i) => {
      console.log(`\n${"─".repeat(40)}`);
      console.log(`📝 INSTRUCTION ${i + 1}`);
      console.log(`${"─".repeat(40)}`);
      console.log(`Program: ${instr.programName}`);
      console.log(`Instruction: ${instr.instructionName}`);
      console.log(`Program ID: ${instr.programId}`);
      console.log(`Accounts (${instr.accounts.length}):`);
      instr.accounts.forEach((acc, idx) => {
        console.log(`  [${idx}] ${acc}`);
      });
      console.log(`Decoded Data (Hex converted to Decimal):`);
      console.log(JSON.stringify(instr.decodedData, null, 2));
    });
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

// Export the class and utility functions
export { JupiterTransactionDecoder };
export default JupiterTransactionDecoder;

// Run the example
main("2zFwjQcHNXByCS3ZTnNzyW8N9kLfs2x3Jf8daVHDnFLg");
