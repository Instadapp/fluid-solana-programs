import { BN, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";

import { AdminModule } from "./admin";
import { Vaults } from "../../../target/types/vaults";

enum TransferType {
  skip = 0,
  direct = 1,
  claim = 2,
}

export const enumMap = {
  [TransferType.skip]: { skip: {} },
  [TransferType.direct]: { direct: {} },
  [TransferType.claim]: { claim: {} },
};

export class UserModule extends AdminModule {
  constructor(authority: Keypair, program: Program<Vaults>) {
    super(authority, program);
  }

  async getInitPositionIx(vaultId: number, user: PublicKey) {
    const vaultState = await this.readVaultState({ vaultId });

    if (!vaultState) {
      throw new Error("Vault state not found");
    }

    const positionId = vaultState.nextPositionId;

    return await this.program.methods
      .initPosition(vaultId, positionId)
      .accounts(this.getInitPositionContext(vaultId, positionId, user))
      .instruction();
  }

  async initPosition(vaultId: number) {
    const txBuilder = this.createTxBuilder();

    const vaultState = await this.readVaultState({ vaultId });

    if (!vaultState) {
      throw new Error("Vault state not found");
    }

    const positionId = vaultState.nextPositionId;

    const ix = await this.program.methods
      .initPosition(vaultId, positionId)
      .accounts(this.getInitPositionContext(vaultId, positionId))
      .instruction();

    txBuilder.addInstruction(ix);

    const tx = await txBuilder.execute();
    console.log(" - initPosition TX:", tx);

    return positionId;
  }

  async createOperateTransaction(
    vaultId: number,
    operateInstruction: TransactionInstruction
  ): Promise<string> {
    let lookupTableAddress = this.vaultLookupTables.get(vaultId);

    if (!lookupTableAddress) {
      lookupTableAddress = await this.initializeVaultLookupTable(vaultId);
    }

    const instructions = [operateInstruction];

    const versionedTx = await this.altManager.createVersionedTransaction(
      instructions,
      [lookupTableAddress]
    );

    return await this.altManager.sendVersionedTransaction(versionedTx, [
      this.authority,
    ]);
  }

  async findPositionIds(vaultId: number): Promise<number[]> {
    return this.altManager.findPositionsByOwner(
      this.program,
      this.authority.publicKey,
      vaultId
    );
  }

  // async transferAuthority(newAuthority: PublicKey) {
  //   const txBuilder = this.createTxBuilder();
  //   const ix = await this.program.methods
  //     .transferAuthority(newAuthority)
  //     .accounts({
  //       signer: this.authority.publicKey,
  //       vaultAdmin: this.get_vault_admin(),
  //     })
  //     .instruction();

  //   txBuilder.addInstruction(ix);

  //   const tx = await txBuilder.execute();
  //   console.log(" - transferAuthority TX:", tx);

  //   return tx;
  // }

  async deposit(vaultId: number, positionId: number, amount: BN) {
    const {
      accounts,
      remainingAccounts,
      remainingAccountsIndices,
      otherIxs,
      lookupTable,
    } = await this.getOperateContext({
      vaultId,
      positionId,
      newCol: amount,
      signer: this.authority.publicKey,
    });

    const ixs = [];

    if (otherIxs.length > 0) {
      console.log(" - otherIxs:", otherIxs.length);
      ixs.push(...otherIxs);
    }

    const ix = await this.program.methods
      .operate(
        amount,
        new BN(0),
        { direct: {} },
        Buffer.from(remainingAccountsIndices)
      )
      .accounts(accounts)
      .remainingAccounts(remainingAccounts)
      .instruction();

    ixs.push(ix);

    const versionedTx = await this.altManager.createVersionedTransaction(
      ixs,
      [lookupTable],
      1_000_000
    );

    return this.altManager.sendVersionedTransaction(versionedTx, [
      this.authority,
    ]);
  }

  async borrow(
    vaultId: number,
    positionId: number,
    amount: BN,
    transferType: TransferType = TransferType.direct
  ) {
    const { accounts, remainingAccounts, remainingAccountsIndices, otherIxs } =
      await this.getOperateContext({
        vaultId,
        positionId,
        newDebt: amount,
        signer: this.authority.publicKey,
      });

    console.log(" - remainingAccountsIndices:", remainingAccountsIndices);

    const ixs = [];

    if (otherIxs.length > 0) {
      ixs.push(...otherIxs);
    }

    const ix = await this.program.methods
      .operate(
        new BN(0),
        amount,
        enumMap[transferType],
        Buffer.from(remainingAccountsIndices)
      )
      .accounts(accounts)
      .remainingAccounts(remainingAccounts)
      .instruction();

    ixs.push(ix);

    const versionedTx = await this.altManager.createVersionedTransaction(
      ixs,
      [this.vaultLookupTables.get(vaultId)],
      1_000_000
    );

    return this.altManager.sendVersionedTransaction(versionedTx, [
      this.authority,
    ]);
  }

  async simulateLiquidate(vaultId: number, user: PublicKey, to: PublicKey) {
    process.env.TEST_MODE_JEST = "true";

    console.log("Checking vaultId for liquidations: ", vaultId);

    const {
      accounts,
      remainingAccounts,
      remainingAccountsIndices,
      otherIxs,
      lookupTable,
    } = await this.getLiquidateContext({
      vaultId,
      signer: user,
      to,
      sources: [],
      oraclePrice: new BN(0),
    });

    const ixs = [];

    if (otherIxs.length > 0) {
      ixs.push(...otherIxs);
    }

    const maxDebtAmount = new BN(2).pow(new BN(64)).sub(new BN(1));

    const ix = await this.program.methods
      .liquidate(
        maxDebtAmount,
        new BN(0),
        false,
        { direct: {} },
        Buffer.from(remainingAccountsIndices)
      )
      .accounts(accounts)
      .remainingAccounts(remainingAccounts)
      .instruction();

    ixs.push(ix);

    const versionedTx = await this.altManager.createVersionedTransaction(
      ixs,
      [lookupTable],
      1_000_000
    );

    function parseVaultLiquidationErrors(logs) {
      const results = [];

      logs.forEach((log, index) => {
        if (log.includes("VaultLiquidationResult:")) {
          // Extract the values from the log message
          const match = log.match(/VaultLiquidationResult: \[([^\]]+)\]/);
          if (match) {
            const values = match[1].split(", ").map((v) => v.trim());
            results.push({
              amtOut: values[0] || "0",
              amtIn: values[1] || "0",
              topTick: values[2] || "undefined",
            });
          }
        }
      });

      return results;
    }

    const result = await this.altManager.simulateVersionedTransaction(
      versionedTx,
      [this.authority]
    );

    return parseVaultLiquidationErrors(result.logs);
  }

  async liquidate(
    vaultId: number,
    user: PublicKey,
    debtAmount: BN,
    absorb: boolean,
    to: PublicKey
  ) {
    const {
      accounts,
      remainingAccounts,
      remainingAccountsIndices,
      otherIxs,
      lookupTable,
    } = await this.getLiquidateContext({
      vaultId,
      signer: user,
      to,
      sources: [],
      oraclePrice: new BN(0),
    });

    const ixs = [];

    if (otherIxs.length > 0) {
      ixs.push(...otherIxs);
    }

    const ix = await this.program.methods
      .liquidate(
        debtAmount,
        new BN(0),
        absorb,
        { direct: {} },
        Buffer.from(remainingAccountsIndices)
      )
      .accounts(accounts)
      .remainingAccounts(remainingAccounts)
      .instruction();

    ixs.push(ix);

    const versionedTx = await this.altManager.createVersionedTransaction(
      ixs,
      [lookupTable],
      1_000_000
    );

    return this.altManager.sendVersionedTransaction(versionedTx, [
      this.authority,
    ]);
  }
}
