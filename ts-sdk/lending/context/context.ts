import {
  Keypair,
  SystemProgram,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { MPL_TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata";

import { State } from "./state";
import { LIQUIDITY_PROGRAM } from "../../address";
import { mint as MintInfo, MintKeys } from "../../mint";
import { Lending } from "../../../target/types/lending";

export class Context extends State {
  constructor(authority: Keypair, program: Program<Lending>) {
    super(authority, program);
  }

  getInitClaimAccountContext = (
    { mint, user }: { mint: MintKeys; user: PublicKey },
    signer: PublicKey = this.authority.publicKey
  ) => {
    return {
      signer,
      claimAccount: this.get_claim_account(mint, user),
      systemProgram: SystemProgram.programId,
    };
  };

  getInitLendingAdminContext(authority: PublicKey = this.authority.publicKey) {
    return {
      authority,
      lending_admin: this.get_lending_admin(),
      system_program: SystemProgram.programId,
    };
  }

  getInitLendingContext(
    mint: keyof typeof MintKeys,
    signer: PublicKey = this.authority.publicKey
  ) {
    const [metadataAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID).toBuffer(),
        this.get_f_token_mint(mint).toBuffer(),
      ],
      new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)
    );

    return {
      signer,
      lendingAdmin: this.get_lending_admin(),
      mint: MintInfo.getMint(mint),
      fTokenMint: this.get_f_token_mint(mint),
      metadataAccount,
      lending: this.get_lending(mint),
      tokenReservesLiquidity: this.get_liquidity_reserve(mint),
      tokenProgram: MintInfo.getTokenProgramForKey(mint),
      systemProgram: SystemProgram.programId,
      sysvarInstruction: SYSVAR_INSTRUCTIONS_PUBKEY,
      metadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    };
  }

  getSetRewardsRateModelContext(
    mintKey: MintKeys,
    newRewardsRateModel: PublicKey,
    signer: PublicKey = this.authority.publicKey
  ) {
    return {
      signer,
      lendingAdmin: this.get_lending_admin(),
      lending: this.get_lending(mintKey),
      fTokenMint: this.get_f_token_mint(mintKey),
      newRewardsRateModel,
      supplyTokenReservesLiquidity: this.get_liquidity_reserve(mintKey),
      systemProgram: SystemProgram.programId,
    };
  }

  getUpdateRebalancerContext(signer: PublicKey = this.authority.publicKey) {
    return {
      signer,
      lendingAdmin: this.get_lending_admin(),
    };
  }

  getUpdateAuthContext(authority: PublicKey = this.authority.publicKey) {
    return {
      signer: authority,
      lendingAdmin: this.get_lending_admin(),
    };
  }

  getUpdateRateContext(mintKey: MintKeys) {
    return {
      lending: this.get_lending(mintKey),
      mint: MintInfo.getMint(mintKey),
      fTokenMint: this.get_f_token_mint(mintKey),
      supplyTokenReservesLiquidity: this.get_liquidity_reserve(mintKey),
      rewardsRateModel: this.get_lending_rewards_rate_model(mintKey),
    };
  }

  getRebalanceContext(
    mintKey: MintKeys,
    signer: PublicKey = this.authority.publicKey
  ) {
    return {
      signer,
      depositorTokenAccount: MintInfo.getUserTokenAccount(mintKey, signer),
      lendingAdmin: this.get_lending_admin(),
      lending: this.get_lending(mintKey),
      mint: MintInfo.getMint(mintKey),
      fTokenMint: this.get_f_token_mint(mintKey),

      supplyTokenReservesLiquidity: this.get_liquidity_reserve(mintKey),
      lendingSupplyPositionOnLiquidity:
        this.get_lending_supply_position(mintKey),
      rateModel: this.get_rate_model(mintKey),
      vault: MintInfo.getUserTokenAccountWithPDA(mintKey, this.get_liquidity()), // owner is liquidity PDA
      liquidity: this.get_liquidity(),
      liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
      rewardsRateModel: this.get_lending_rewards_rate_model(mintKey),
      tokenProgram: MintInfo.getTokenProgramForKey(mintKey),
      associatedTokenProgram: MintInfo.getAssociatedTokenProgram(),
      systemProgram: SystemProgram.programId,
      sysvarInstruction: SYSVAR_INSTRUCTIONS_PUBKEY,
    };
  }

  getDepositContext(
    mint: keyof typeof MintKeys,
    user: Keypair = this.authority
  ) {
    const token_program = MintInfo.getTokenProgramForKey(mint);

    return {
      signer: user.publicKey,
      depositorTokenAccount: MintInfo.getUserTokenAccount(
        mint,
        user.publicKey,
        token_program
      ),
      recipientTokenAccount: MintInfo.getUserFTokenAccount(
        this.get_f_token_mint(mint),
        user.publicKey,
        token_program
      ),
      lendingAdmin: this.get_lending_admin(),
      lending: this.get_lending(mint),
      mint: MintInfo.getMint(mint),
      fTokenMint: this.get_f_token_mint(mint),

      supplyTokenReservesLiquidity: this.get_liquidity_reserve(mint),
      lendingSupplyPositionOnLiquidity: this.get_lending_supply_position(mint),
      rateModel: this.get_rate_model(mint),
      vault: MintInfo.getUserTokenAccountWithPDA(mint, this.get_liquidity()), // owner is liquidity PDA
      liquidity: this.get_liquidity(),
      liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
      rewardsRateModel: this.get_lending_rewards_rate_model(mint),
      tokenProgram: MintInfo.getTokenProgramForKey(mint),
      associatedTokenProgram: MintInfo.getAssociatedTokenProgram(),
      systemProgram: SystemProgram.programId,
      sysvarInstruction: SYSVAR_INSTRUCTIONS_PUBKEY,
    };
  }

  getWithdrawContext(
    mint: keyof typeof MintKeys,
    user: Keypair = this.authority
  ) {
    return {
      signer: user.publicKey,
      ownerTokenAccount: MintInfo.getUserFTokenAccount(
        this.get_f_token_mint(mint),
        user.publicKey
      ),
      recipientTokenAccount: MintInfo.getUserTokenAccount(mint, user.publicKey),
      lendingAdmin: this.get_lending_admin(),
      lending: this.get_lending(mint),
      mint: MintInfo.getMint(mint),
      claimAccount: this.get_claim_account(mint, this.get_lending_admin()),
      fTokenMint: this.get_f_token_mint(mint),
      supplyTokenReservesLiquidity: this.get_liquidity_reserve(mint),
      lendingSupplyPositionOnLiquidity: this.get_lending_supply_position(mint),
      rateModel: this.get_rate_model(mint),
      vault: MintInfo.getUserTokenAccountWithPDA(mint, this.get_liquidity()), // owner is liquidity PDA
      liquidity: this.get_liquidity(),
      liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
      rewardsRateModel: this.get_lending_rewards_rate_model(mint),
      tokenProgram: MintInfo.getTokenProgramForKey(mint),
      associatedTokenProgram: MintInfo.getAssociatedTokenProgram(),
      systemProgram: SystemProgram.programId,
      sysvarInstruction: SYSVAR_INSTRUCTIONS_PUBKEY,
    };
  }
}
