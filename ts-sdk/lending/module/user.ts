import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";

import { mint, MintKeys } from "../../mint";
import { AdminModule } from "./admin";
import { Lending } from "../../../target/types/lending";
import { mint as MintInfo } from "../../mint";
import { connection } from "../../connection";
import { LIQUIDITY_PROGRAM } from "../../address";

export class UserModule extends AdminModule {
  constructor(authority: Keypair, program: Program<Lending>) {
    super(authority, program);
  }

  async depositWithMinSharesAmountOutIx(
    mint: keyof typeof MintKeys,
    amount: BN,
    minSharesAmountOut: BN,
    user: Keypair
  ) {
    return await this.program.methods
      .depositWithMinAmountOut(amount, minSharesAmountOut)
      .accounts(this.getDepositContext(mint, user))
      .instruction();
  }

  async depositIx(mint: keyof typeof MintKeys, amount: BN, user: Keypair) {
    return await this.program.methods
      .deposit(amount)
      .accounts(this.getDepositContext(mint, user))
      .instruction();
  }

  async initClaimAccount(user: PublicKey) {
    const txBuilder = this.createTxBuilder();

    const mintKeys = [
      MintKeys.EURC,
      MintKeys.USDC,
      MintKeys.USDT,
      MintKeys.WSOL,
    ];

    for (const mint of mintKeys) {
      const getClaimAccount = this.get_claim_account(mint, user);

      try {
        const claimAccount = await connection.getAccountInfo(getClaimAccount);
        if (claimAccount?.owner.toString() !== LIQUIDITY_PROGRAM) {
          throw new Error("Claim account not found");
        }
      } catch (error) {
        const claimAccountContext = this.getInitClaimAccountContext({
          mint,
          user: user,
        } as any);

        const claimAccountIx = await this.liquidityProgram.methods
          .initClaimAccount(MintInfo.getMint(mint), user)
          .accounts(claimAccountContext)
          .instruction();

        txBuilder.addInstruction(claimAccountIx);
      }
    }

    const tx = await txBuilder.execute();
    return tx;
  }

  async deposit(mint: keyof typeof MintKeys, amount: BN, user: Keypair) {
    const txBuilder = this.createTxBuilder();

    const ix = await this.depositIx(mint, amount, user);
    txBuilder.addInstruction(ix);

    const tx = await txBuilder.execute();
    return tx;
  }

  async mintWithMaxAssetsIx(
    mint: keyof typeof MintKeys,
    shares: BN,
    maxAssets: BN,
    user: Keypair
  ) {
    return await this.program.methods
      .mintWithMaxAssets(shares, maxAssets)
      .accounts(this.getDepositContext(mint, user))
      .instruction();
  }

  async mintIx(mint: keyof typeof MintKeys, shares: BN, user: Keypair) {
    return await this.program.methods
      .mint(shares)
      .accounts(this.getDepositContext(mint, user))
      .instruction();
  }

  async redeemWithMinAmountOutIx(
    mint: keyof typeof MintKeys,
    shares: BN,
    minAmountOut: BN,
    user: Keypair
  ) {
    return await this.program.methods
      .redeemWithMinAmountOut(shares, minAmountOut)
      .accounts(this.getWithdrawContext(mint, user))
      .instruction();
  }

  async redeemIx(mint: keyof typeof MintKeys, shares: BN, user: Keypair) {
    return await this.program.methods
      .redeem(shares)
      .accounts(this.getWithdrawContext(mint, user))
      .instruction();
  }

  async withdrawWithMaxSharesBurnIx(
    mint: keyof typeof MintKeys,
    amount: BN,
    maxShares: BN,
    user: Keypair
  ) {
    return await this.program.methods
      .withdrawWithMaxSharesBurn(amount, maxShares)
      .accounts(this.getWithdrawContext(mint, user))
      .instruction();
  }

  async withdrawIx(mint: keyof typeof MintKeys, amount: BN, user: Keypair) {
    return await this.program.methods
      .withdraw(amount)
      .accounts(this.getWithdrawContext(mint, user))
      .instruction();
  }

  async withdraw(mint: keyof typeof MintKeys, amount: BN, user: Keypair) {
    const txBuilder = this.createTxBuilder();
    const ix = await this.withdrawIx(mint, amount, user);
    txBuilder.addInstruction(ix);

    const tx = await txBuilder.execute();
    return tx;
  }

  // async transferAuthority(newAuthority: PublicKey) {
  //   const txBuilder = this.createTxBuilder();

  //   const ix = await this.program.methods
  //     .transferAuthority(newAuthority)
  //     .accounts({
  //       signer: this.authority.publicKey,
  //       lendingAdmin: this.get_lending_admin(),
  //     })
  //     .instruction();

  //   txBuilder.addInstruction(ix);

  //   const tx = await txBuilder.execute();
  //   return tx;
  // }
}
