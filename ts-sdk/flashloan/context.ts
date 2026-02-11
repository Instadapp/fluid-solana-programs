import {
  Keypair,
  SystemProgram,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { MPL_TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata";

import { LIQUIDITY_PROGRAM } from "../address";
import { mint as MintInfo, MintKeys } from "../mint";
import { Flashloan } from "../../target/types/flashloan";
import { PDA } from "./pda";

export class Context extends PDA {
  constructor(authority: Keypair, program: Program<Flashloan>) {
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

  getInitFlashloanAdminContext(
    authority: PublicKey = this.authority.publicKey
  ) {
    return {
      signer: authority,
      flashloanAdmin: this.get_flashloan_admin(),
      system_program: SystemProgram.programId,
    };
  }

  getFlashloanProtocolContext(authority: PublicKey = this.authority.publicKey) {
    return {
      authority,
      flashloanAdmin: this.get_flashloan_admin(),
    };
  }

  getFlashloanContext(
    user: PublicKey,
    mint: keyof typeof MintKeys,
    signer: PublicKey = this.authority.publicKey
  ) {
    return {
      signer,
      flashloanAdmin: this.get_flashloan_admin(),
      signerBorrowTokenAccount: MintInfo.getUserTokenAccount(mint, user),
      mint: MintInfo.getMint(mint),
      flashloanTokenReservesLiquidity: this.get_liquidity_reserve(mint),
      flashloanBorrowPositionOnLiquidity:
        this.get_flashloan_borrow_position(mint),
      rateModel: this.get_rate_model(mint),
      vault: MintInfo.getUserTokenAccountWithPDA(mint, this.get_liquidity()),
      liquidity: this.get_liquidity(),
      liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
      tokenProgram: MintInfo.getTokenProgramForKey(mint),
      associatedTokenProgram: MintInfo.getAssociatedTokenProgram(),
      systemProgram: SystemProgram.programId,
      instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
    };
  }
}
