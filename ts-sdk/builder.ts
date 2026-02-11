import {
  Connection,
  Keypair,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  Commitment,
  VersionedTransaction,
  PublicKey,
  SendTransactionError,
} from "@solana/web3.js";
import {
  TransactionMessage,
  ComputeBudgetProgram, // Add this import
} from "@solana/web3.js";

/**
 * Options for transaction execution
 */
export interface TxExecuteOptions {
  /** Skip transaction simulation prior to sending */
  skipPreflight?: boolean;
  /** Desired commitment level for transaction confirmation */
  commitment?: Commitment;
  /** Commitment level to use for preflight simulation */
  preflightCommitment?: Commitment;
  /** Maximum number of times to retry failed transactions */
  maxRetries?: number;
}

/**
 * Transaction builder for creating and executing Solana transactions
 */
export class TransactionBuilder {
  private connection: Connection;
  private instructions: TransactionInstruction[] = [];
  private signers: Keypair[] = [];
  private feePayer: Keypair;
  private defaultOptions: TxExecuteOptions = {
    skipPreflight: false,
    commitment: "confirmed",
    preflightCommitment: "confirmed",
    maxRetries: 3,
  };
  lookupTableAddress: PublicKey | null = null;
  lookupTableCache: Map<string, any> = new Map();

  /**
   * Create a new transaction builder
   * @param connection The Solana connection to use
   * @param feePayer The fee payer for the transaction
   */
  constructor(connection: Connection, feePayer: Keypair) {
    this.connection = connection;
    this.feePayer = feePayer;
  }

  public isExecutable(): boolean {
    return this.instructions.length > 0;
  }

  /**
   * Add an instruction to the transaction
   * @param instruction The instruction to add
   * @param signers Optional additional signers required for this instruction
   * @returns This builder instance for chaining
   */
  public addInstruction(
    instruction: TransactionInstruction,
    signers: Keypair[] = []
  ): TransactionBuilder {
    this.instructions.push(instruction);

    // Add new signers, avoiding duplicates
    for (const signer of signers) {
      if (!this.signers.find((s) => s.publicKey.equals(signer.publicKey))) {
        this.signers.push(signer);
      }
    }

    return this;
  }

  /**
   * Add multiple instructions to the transaction
   * @param instructions The instructions to add
   * @param signers Optional additional signers required for these instructions
   * @returns This builder instance for chaining
   */
  public addInstructions(
    instructions: TransactionInstruction[],
    signers: Keypair[] = []
  ): TransactionBuilder {
    for (const instruction of instructions) {
      this.instructions.push(instruction);
    }

    // Add new signers, avoiding duplicates
    for (const signer of signers) {
      if (!this.signers.find((s) => s.publicKey.equals(signer.publicKey))) {
        this.signers.push(signer);
      }
    }

    return this;
  }

  /**
   * Add a signer to the transaction
   * @param signer The signer to add
   * @returns This builder instance for chaining
   */
  public addSigner(signer: Keypair): TransactionBuilder {
    if (!this.signers.find((s) => s.publicKey.equals(signer.publicKey))) {
      this.signers.push(signer);
    }
    return this;
  }

  /**
   * Set the fee payer for the transaction
   * @param feePayer The fee payer keypair
   * @returns This builder instance for chaining
   */
  public setFeePayer(feePayer: Keypair): TransactionBuilder {
    this.feePayer = feePayer;

    // Make sure fee payer is in signers
    if (!this.signers.find((s) => s.publicKey.equals(feePayer.publicKey))) {
      this.signers.push(feePayer);
    }

    return this;
  }

  /**
   * Build the transaction without executing it
   * @returns The built transaction
   */
  async build(): Promise<Transaction> {
    if (this.instructions.length === 0) {
      throw new Error("No instructions added to transaction");
    }

    const transaction = new Transaction();

    for (const instruction of this.instructions) {
      transaction.add(instruction);
    }

    const latestBlockhash = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = latestBlockhash.blockhash;
    transaction.feePayer = this.feePayer.publicKey;

    return transaction;
  }

  /**
   * Execute the transaction
   * @param options Options for transaction execution
   * @returns Promise with the transaction signature
   */
  public async execute(options: TxExecuteOptions = {}): Promise<string> {
    const mergedOptions = { ...this.defaultOptions, ...options };

    if (!this.isExecutable()) {
      return null;
      // throw new Error("No instructions added to transaction");
    }

    try {
      const transaction = await this.build();

      // Send and confirm transaction
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        this.signers,
        {
          skipPreflight: mergedOptions.skipPreflight,
          commitment: mergedOptions.commitment,
          preflightCommitment: mergedOptions.preflightCommitment,
        }
      );

      return signature;
    } catch (error) {
      console.error("Error executing transaction:", error);
      throw error;
    }
  }

  /**
   * Clear all instructions and signers except the fee payer
   * @returns This builder instance for chaining
   */
  public clear(): TransactionBuilder {
    this.instructions = [];
    this.signers = [this.feePayer];
    return this;
  }

  /**
   * Get the number of instructions in the transaction
   * @returns The number of instructions
   */
  public getInstructionCount(): number {
    return this.instructions.length;
  }

  /**
   * Get all signers for the transaction
   * @returns Array of signers
   */
  public getSigners(): Keypair[] {
    return [...this.signers];
  }

  /**
   * Check if transaction will exceed the size limit
   * @returns True if transaction might be too large
   */
  public isTransactionTooLarge(): boolean {
    // Rough estimate - Solana's limit is 1232 bytes
    // Each instruction is roughly 100-200 bytes depending on accounts
    return this.instructions.length > 10;
  }

  async getLookupTableAccounts(
    lookupTableAddresses: PublicKey[]
  ): Promise<any[]> {
    const lookupTableAccounts = [];

    for (const address of lookupTableAddresses) {
      const cacheKey = address.toBase58();
      if (this.lookupTableCache.has(cacheKey)) {
        lookupTableAccounts.push(this.lookupTableCache.get(cacheKey));
        continue;
      }

      const account = await this.connection.getAddressLookupTable(address);

      if (account && account.value) {
        this.lookupTableCache.set(cacheKey, account.value);
        lookupTableAccounts.push(account.value);
      } else {
        throw new Error(`Lookup table not found: ${address.toBase58()}`);
      }
    }

    return lookupTableAccounts;
  }

  async sendVersionedTransaction(
    transaction: VersionedTransaction,
    signers: Keypair[]
  ): Promise<string> {
    transaction.sign(signers);

    try {
      const txid = await this.connection.sendTransaction(transaction);
      return txid;
    } catch (error) {
      if (error instanceof SendTransactionError) {
        console.error("Transaction failed:");
        console.error("Error message:", error.message);

        // Get and display the full logs
        if (error.logs) {
          console.error("Transaction logs:");
          error.logs.forEach((log, i) => console.error(`${i}: ${log}`));
        }
      }
      throw error;
    }
  }

  async createVersionedTransaction(
    instructions: any[],
    lookupTableAddresses: PublicKey[],
    payer: PublicKey,
    computeUnits?: number | null,
    computeUnitPrice?: number | null
  ): Promise<VersionedTransaction> {
    const { blockhash } = await this.connection.getLatestBlockhash();
    const lookupTableAccounts = await this.getLookupTableAccounts(
      lookupTableAddresses
    );

    // Create an array to hold all instructions
    const allInstructions = [];

    // Add compute budget instructions if needed
    if (computeUnits) {
      allInstructions.push(
        ComputeBudgetProgram.setComputeUnitLimit({
          units: computeUnits,
        })
      );
    }

    // Add compute unit price instruction if needed
    if (computeUnitPrice) {
      allInstructions.push(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: computeUnitPrice,
        })
      );
    }

    // Add the original instructions
    allInstructions.push(...instructions);

    const messageV0 = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: allInstructions,
    }).compileToV0Message(lookupTableAccounts);

    return new VersionedTransaction(messageV0);
  }
}
