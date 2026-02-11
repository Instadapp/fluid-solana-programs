import {
  Connection,
  PublicKey,
  AddressLookupTableProgram,
  TransactionMessage,
  VersionedTransaction,
  SendTransactionError,
  SystemProgram,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
  SimulatedTransactionResponse, // Add this import
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export class AccountLookupTableManager {
  connection: Connection;
  authority: Keypair;
  lookupTableAddress: PublicKey | null = null;
  lookupTableCache: Map<string, any> = new Map();

  constructor(connection: Connection, authority: Keypair) {
    this.connection = connection;
    this.authority = authority;
  }

  async createLookupTable(): Promise<PublicKey> {
    // prettier-ignore
    const [lookupTableInst, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
        authority: this.authority.publicKey,
        payer: this.authority.publicKey,
        recentSlot: await this.connection.getSlot(),
      });

    const transaction = new Transaction();

    transaction.add(lookupTableInst);
    transaction.feePayer = this.authority.publicKey;

    await sendAndConfirmTransaction(this.connection, transaction, [
      this.authority,
    ]);

    console.log(`Created lookup table: ${lookupTableAddress.toBase58()}`);

    this.lookupTableAddress = lookupTableAddress;
    return lookupTableAddress;
  }

  async addAddressesToLookupTable(
    addresses: PublicKey[],
    lookupTableAddress?: PublicKey
  ): Promise<string> {
    const tableAddress = lookupTableAddress || this.lookupTableAddress;

    if (!tableAddress) {
      throw new Error("No lookup table address provided or created");
    }

    const existingAccounts = (
      await this.getLookupTableAccounts([tableAddress])
    )[0].state.addresses;

    const accountsToAdd = addresses.filter(
      (address) =>
        !existingAccounts.some(
          (account) => account.toString() === address.toString()
        )
    );

    if (accountsToAdd.length === 0) {
      return "No accounts to add";
    }

    const addAddressesInstruction = AddressLookupTableProgram.extendLookupTable(
      {
        payer: this.authority.publicKey,
        authority: this.authority.publicKey,
        lookupTable: tableAddress,
        addresses: accountsToAdd,
      }
    );

    const transaction = new Transaction();
    transaction.add(addAddressesInstruction);
    transaction.feePayer = this.authority.publicKey;

    return await sendAndConfirmTransaction(this.connection, transaction, [
      this.authority,
    ]);
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

  /**
   * Create a versioned transaction using lookup tables with compute budget options
   * @param instructions Array of instructions
   * @param lookupTableAddresses Array of lookup table addresses
   * @param computeUnits Optional maximum compute units (null means use default)
   * @param computeUnitPrice Optional compute unit price in micro-lamports (null means use default)
   */
  async createVersionedTransaction(
    instructions: any[],
    lookupTableAddresses: PublicKey[],
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
      payerKey: this.authority.publicKey,
      recentBlockhash: blockhash,
      instructions: allInstructions,
    }).compileToV0Message(lookupTableAccounts);

    return new VersionedTransaction(messageV0);
  }

  /**
   * Send a versioned transaction with compute budget options
   * @param instructions Array of instructions
   * @param lookupTableAddresses Array of lookup table addresses
   * @param signers Array of signers
   * @param options Optional settings for compute budget and priority fees
   */
  async createAndSendTransaction(
    instructions: any[],
    lookupTableAddresses: PublicKey[],
    signers: Keypair[] = [this.authority],
    options: {
      computeUnits?: number;
      computeUnitPrice?: number;
    } = {}
  ): Promise<string> {
    const { computeUnits, computeUnitPrice } = options;

    // Create the transaction with compute budget settings
    const transaction = await this.createVersionedTransaction(
      instructions,
      lookupTableAddresses,
      computeUnits,
      computeUnitPrice
    );

    // Send the transaction
    return this.sendVersionedTransaction(transaction, signers);
  }

  async simulateVersionedTransaction(
    transaction: VersionedTransaction,
    signers: Keypair[] = [this.authority]
  ): Promise<SimulatedTransactionResponse> {
    transaction.sign(signers);

    try {
      const txid = await this.connection.simulateTransaction(transaction);
      return txid.value;
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

  async sendVersionedTransaction(
    transaction: VersionedTransaction,
    signers: Keypair[] = [this.authority]
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

  async findPositionsByOwner(
    program: any,
    ownerAddress: PublicKey,
    vaultId: number
  ): Promise<number[]> {
    const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
      ownerAddress,
      { programId: TOKEN_PROGRAM_ID }
    );

    // Filter for position token accounts (NFTs with amount = 1)
    const positionTokens = tokenAccounts.value.filter((account) => {
      const tokenAmount = account.account.data.parsed.info.tokenAmount;
      return tokenAmount.amount === "1" && tokenAmount.decimals === 0;
    });

    const positions: number[] = [];

    // For each position token, check if it matches our position mint pattern
    for (const tokenAccount of positionTokens) {
      const mintAddress = new PublicKey(
        tokenAccount.account.data.parsed.info.mint
      );

      try {
        const vaultState = await program.account.vaultState.fetch(
          this.getPdaAddress([
            Buffer.from("vault_state"),
            Buffer.from(vaultId.toString()),
          ])
        );

        const nextPositionId = vaultState.nextPositionId;

        // Start checking from the latest position backwards
        for (let posId = nextPositionId - 1; posId >= 0; posId--) {
          const expectedMint = this.getPdaAddress([
            Buffer.from("position_mint"),
            Buffer.from(vaultId.toString()),
            Buffer.from(posId.toString()),
          ]);

          if (expectedMint.equals(mintAddress)) {
            positions.push(posId);
            break;
          }
        }
      } catch (error) {
        continue;
      }
    }

    return positions;
  }

  private getPdaAddress(seeds: Buffer[], programId?: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      seeds,
      programId || new PublicKey("your_program_id_here")
    );
    return pda;
  }
}
