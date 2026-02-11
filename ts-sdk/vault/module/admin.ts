import { Keypair, PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";

import { getVaultConfig, InitVaultConfigParams } from "../config/vault";
import { TransactionBuilder } from "../../builder";
import { EnhancedContext } from "../context/lookup";
import liquidityJson from "../../../target/idl/liquidity.json";
import { Vaults } from "../../../target/types/vaults";

export type UpdateCoreSettingsParams = {
  supplyRateMagnifier: number;
  borrowRateMagnifier: number;
  collateralFactor: number;
  liquidationThreshold: number;
  liquidationMaxLimit: number;
  withdrawGap: number;
  liquidationPenalty: number;
  borrowFee: number;
};

export class AdminModule extends EnhancedContext {
  constructor(authority: Keypair, program: Program<Vaults>) {
    super(authority, program);
  }

  createTxBuilder(): TransactionBuilder {
    const txBuilder = new TransactionBuilder(
      this.program.provider.connection,
      this.authority
    );

    txBuilder.addSigner(this.authority);

    return txBuilder;
  }

  async initVaultAdminIx(admin: PublicKey) {
    return await this.program.methods
      .initVaultAdmin(new PublicKey(liquidityJson.address), admin)
      .accounts(this.getInitializeVaultAdminContext())
      .instruction();
  }

  async initVaultAdmin() {
    try {
      await this.program.account.vaultAdmin.fetch(this.get_vault_admin());
    } catch (error) {
      const ix = await this.program.methods
        .initVaultAdmin(
          new PublicKey(liquidityJson.address),
          this.authority.publicKey
        )
        .accounts(this.getInitializeVaultAdminContext())
        .instruction();

      const txBuilder = this.createTxBuilder();

      txBuilder.addInstruction(ix);

      const tx = await txBuilder.execute();

      return tx;
    }
  }

  async initVaultStateIx(vaultId: number) {
    return await this.program.methods
      .initVaultState(vaultId)
      .accounts(await this.getInitVaultStateContext(vaultId))
      .instruction();
  }

  async initVaultConfigIx(vaultId: number, params: InitVaultConfigParams) {
    return await this.program.methods
      .initVaultConfig(vaultId, params)
      .accounts(
        this.getInitVaultConfigContext(
          vaultId,
          params.supplyToken,
          params.borrowToken,
          params.oracle
        )
      )
      .instruction();
  }

  async initVaultState(vaultId: number) {
    try {
      await this.program.account.vaultState.fetch(
        this.get_vault_state({ vaultId })
      );
    } catch (error) {
      const ix = await this.program.methods
        .initVaultState(vaultId)
        .accounts(await this.getInitVaultStateContext(vaultId))
        .instruction();

      const txBuilder = this.createTxBuilder();
      txBuilder.addInstruction(ix);

      const tx = await txBuilder.execute();
      return tx;
    }
  }

  async initBranchIx(vaultId: number, branchId: number) {
    return await this.program.methods
      .initBranch(vaultId, branchId)
      .accounts(this.getInitBranchContext(vaultId, branchId))
      .instruction();
  }

  async initBranch(vaultId: number, branchId: number[]) {
    const txBuilder = this.createTxBuilder();

    for (const id of branchId) {
      try {
        await this.program.account.branch.fetch(
          this.get_branch({ vaultId, branchId: id })
        );
      } catch (error) {
        const ix = await this.program.methods
          .initBranch(vaultId, id)
          .accounts(this.getInitBranchContext(vaultId, id))
          .instruction();

        txBuilder.addInstruction(ix);
      }
    }

    const tx = await txBuilder.execute();

    return tx;
  }

  async initTickIx(vaultId: number, tick: number) {
    return await this.program.methods
      .initTick(vaultId, tick)
      .accounts(this.getInitTickContext(vaultId, tick))
      .instruction();
  }

  async initTick(vaultId: number, tick: number[]) {
    const txBuilder = this.createTxBuilder();

    for (const id of tick) {
      const tickData = await this.readTick({ vaultId, tick: id });

      if (!tickData) {
        const ix = await this.program.methods
          .initTick(vaultId, id)
          .accounts(this.getInitTickContext(vaultId, id))
          .instruction();

        txBuilder.addInstruction(ix);
      }
    }

    const tx = await txBuilder.execute();

    return tx;
  }

  async initTickHasDebtArrayIx(vaultId: number, index: number) {
    return await this.program.methods
      .initTickHasDebtArray(vaultId, index)
      .accounts(this.getInitTickHasDebtArrayContext(vaultId, index))
      .instruction();
  }

  async initTickHasDebtArray(vaultId: number, mapId: number[]) {
    const txBuilder = this.createTxBuilder();

    for (const id of mapId) {
      try {
        await this.program.account.tickHasDebtArray.fetch(
          this.get_tick_has_debt({ vaultId, index: id })
        );
      } catch (error) {
        const ix = await this.program.methods
          .initTickHasDebtArray(vaultId, id)
          .accounts(this.getInitTickHasDebtArrayContext(vaultId, id))
          .instruction();

        txBuilder.addInstruction(ix);
      }
    }

    const tx = await txBuilder.execute();

    return tx;
  }

  async initTickIdLiquidationIx(
    vaultId: number,
    tick: number,
    totalIds: number = 0
  ) {
    return await this.program.methods
      .initTickIdLiquidation(vaultId, tick, totalIds)
      .accounts(await this.getInitTickIdLiquidationContext(vaultId, tick))
      .instruction();
  }

  async initTickIdLiquidation(vaultId: number, tick: number[]) {
    const txBuilder = this.createTxBuilder();

    for (const id of tick) {
      const totalIds = (await this.readTick({ vaultId, tick: id })).totalIds;

      const tickIdData = await this.readTickIdLiquidation({
        vaultId,
        tick: id,
        totalIds,
      });

      if (!tickIdData) {
        const ix = await this.program.methods
          .initTickIdLiquidation(vaultId, id, totalIds)
          .accounts(await this.getInitTickIdLiquidationContext(vaultId, id))
          .instruction();

        txBuilder.addInstruction(ix);
      }
    }

    const tx = await txBuilder.execute();

    return tx;
  }

  async updateCoreSettings(vaultId: number, params: UpdateCoreSettingsParams) {
    const ix = await this.program.methods
      .updateCoreSettings(vaultId, params)
      .accounts(await this.getAdminContext(vaultId))
      .instruction();

    const txBuilder = this.createTxBuilder();
    txBuilder.addInstruction(ix);

    const tx = await txBuilder.execute();

    return tx;
  }
}
