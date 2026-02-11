import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";

import { TransactionBuilder } from "../builder";

import { Flashloan } from "../../target/types/flashloan";
import { Context } from "./context";
import { LIQUIDITY_PROGRAM } from "../address";
import { MintKeys } from "../mint";

export class UserModule extends Context {
  constructor(authority: Keypair, program: Program<Flashloan>) {
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

  async getFlashloanFee(): Promise<number> {
    const context = this.getFlashloanProtocolContext();

    return (
      await this.program.account.flashloanAdmin.fetch(context.flashloanAdmin)
    ).flashloanFee;
  }

  async initFlashloanAdmin(authority?: PublicKey, flashloanFee: number = 0) {
    const context = this.getInitFlashloanAdminContext();

    const txBuilder = this.createTxBuilder();

    const ix = await this.program.methods
      .initFlashloanAdmin(
        authority,
        flashloanFee,
        new PublicKey(LIQUIDITY_PROGRAM)
      )
      .accounts(context)
      .instruction();

    txBuilder.addInstruction(ix);

    return txBuilder.execute();
  }

  async flashBorrowIx(
    amount: BN,
    mint: keyof typeof MintKeys,
    signer: PublicKey = this.authority.publicKey
  ) {
    const context = this.getFlashloanContext(signer, mint);

    return await this.program.methods
      .flashloanBorrow(amount)
      .accounts(context)
      .instruction();
  }

  async flashPaybackIx(
    amount: BN,
    mint: keyof typeof MintKeys,
    signer: PublicKey = this.authority.publicKey
  ) {
    const context = this.getFlashloanContext(signer, mint);

    return await this.program.methods
      .flashloanPayback(amount)
      .accounts(context)
      .instruction();
  }

  async flashloanIx(
    amount: BN,
    mint: keyof typeof MintKeys,
    signer: PublicKey = this.authority.publicKey
  ) {
    const borrowIx = await this.flashBorrowIx(amount, mint, signer);

    const paybackAmount = amount.mul(
      new BN(10000 + (await this.getFlashloanFee())).div(new BN(10000))
    );

    const paybackIx = await this.flashPaybackIx(paybackAmount, mint, signer);

    return [borrowIx, paybackIx];
  }
}
