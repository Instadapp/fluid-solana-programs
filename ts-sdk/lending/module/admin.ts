import { Keypair, PublicKey } from "@solana/web3.js";

import { MintKeys, mint as MintInfo } from "../../mint";
import { Context } from "../context";
import { TransactionBuilder } from "../../builder";
import { LIQUIDITY_PROGRAM, REBALANCER } from "../../address";
import { Lending } from "../../../target/types/lending";
import { Program } from "@coral-xyz/anchor";

export class AdminModule extends Context {
  constructor(authority: Keypair, program: Program<Lending>) {
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

  async listPDAs() {
    const mintKeys = [MintKeys.WSOL];

    this.get_lending_admin().toString();

    for (const mintKey of mintKeys) {
      this.get_lending(mintKey).toString();
      this.get_f_token_mint(mintKey).toString();
      this.get_liquidity_reserve(mintKey).toString();
    }
  }

  async initLendingAdminIx(authority: PublicKey, rebalancer: PublicKey) {
    return await this.program.methods
      .initLendingAdmin(new PublicKey(LIQUIDITY_PROGRAM), rebalancer, authority)
      .accounts(this.getInitLendingAdminContext())
      .instruction();
  }

  async initLendingAdmin(
    authority: PublicKey,
    rebalancer: PublicKey
  ): Promise<string> {
    try {
      await this.program.account.lendingAdmin.fetch(this.get_lending_admin());
    } catch {
      const txBuilder = this.createTxBuilder();
      const ix = await this.initLendingAdminIx(authority, rebalancer);
      const tx = await txBuilder.addInstruction(ix).execute();
      return tx;
    }
  }

  async initLendingIx(mintKey: MintKeys, signer?: PublicKey) {
    return await this.program.methods
      .initLending(mintKey, new PublicKey(LIQUIDITY_PROGRAM))
      .accounts(this.getInitLendingContext(mintKey, signer))
      .instruction();
  }

  async initLending(mintKeys: MintKeys[], signer?: PublicKey) {
    const txBuilder = this.createTxBuilder();

    for (const mintKey of mintKeys) {
      console.log(`  - MINT: ${mintKey}`);
      try {
        // check if the lending account already exists
        await this.program.account.lending.fetch(this.get_lending(mintKey));
      } catch {
        // lending account doesn't exist, initialize it
        const ix = await this.initLendingIx(mintKey, signer);
        txBuilder.addInstruction(ix);
      }
    }

    const tx = await txBuilder.execute();
    return tx;
  }

  async SetRewardsRateModelIx(
    mintKey: MintKeys,
    newRewardsRateModel: PublicKey
  ) {
    return await this.program.methods
      .setRewardsRateModel(MintInfo.getMint(mintKey))
      .accounts(
        this.getSetRewardsRateModelContext(mintKey, newRewardsRateModel)
      )
      .instruction();
  }

  async SetRewardsRateModel(
    mintKey: MintKeys,
    newRewardsRateModel: PublicKey
  ): Promise<string> {
    const txBuilder = this.createTxBuilder();
    const ix = await this.SetRewardsRateModelIx(mintKey, newRewardsRateModel);

    const tx = await txBuilder.addInstruction(ix).execute();
    return tx;
  }

  async rebalanceIx(mintKey: MintKeys, rebalancer: PublicKey) {
    return await this.program.methods
      .rebalance()
      .accounts(this.getRebalanceContext(mintKey, rebalancer))
      .instruction();
  }

  async updateRebalancerIx(newRebalancer: string) {
    return await this.program.methods
      .updateRebalancer(new PublicKey(newRebalancer))
      .accounts(this.getUpdateRebalancerContext())
      .instruction();
  }

  async updateRateIx(mintKey: MintKeys) {
    return await this.program.methods
      .updateRate()
      .accounts(this.getUpdateRateContext(mintKey))
      .instruction();
  }
}
