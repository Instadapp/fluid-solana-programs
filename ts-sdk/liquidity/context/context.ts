import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import { PDA } from "./pda";
import { mint as MintInfo, MintKeys } from "../../mint";
import { Liquidity } from "../../../target/types/liquidity";

export class Context extends PDA {
  constructor(authority: Keypair, program: Program<Liquidity>) {
    super(authority, program);
  }

  getInitLiquidityContext = (signer: PublicKey = this.authority.publicKey) => {
    return {
      signer,
      liquidity: this.get_liquidity(),
      authList: this.get_auth_list(),
      systemProgram: SystemProgram.programId,
    };
  };

  getInitTokenReserveContext = (
    { mint }: { mint: MintKeys },
    signer: PublicKey = this.authority.publicKey
  ) => {
    const liquidityPDA = this.get_liquidity();
    const tokenProgram = MintInfo.getTokenProgramForKey(mint);

    return {
      authority: signer,
      liquidity: liquidityPDA,
      authList: this.get_auth_list(),
      mint: MintInfo.getMint(mint),
      vault: MintInfo.getUserTokenAccountWithPDA(mint, liquidityPDA),
      rateModel: this.get_rate_model(mint),
      tokenReserve: this.get_reserve(mint),

      tokenProgram: tokenProgram,
      systemProgram: SystemProgram.programId,
      associatedTokenProgram: MintInfo.getAssociatedTokenProgram(),
    };
  };

  getInitNewProtocolContext = (
    {
      protocol,
      supplyMint,
      borrowMint,
    }: { protocol: PublicKey; supplyMint: MintKeys; borrowMint: MintKeys },
    signer: PublicKey = this.authority.publicKey
  ) => {
    return {
      authority: signer,
      liquidity: this.get_liquidity(),
      authList: this.get_auth_list(),
      userSupplyPosition: this.get_user_supply_position(supplyMint, protocol),
      userBorrowPosition: this.get_user_borrow_position(borrowMint, protocol),
      systemProgram: SystemProgram.programId,
    };
  };

  getUpdateAuthContext = (signer: PublicKey = this.authority.publicKey) => {
    return {
      authority: signer,
      liquidity: this.get_liquidity(),
      authList: this.get_auth_list(),
    };
  };

  getUpdateGuardianContext = (signer: PublicKey = this.authority.publicKey) => {
    return {
      authority: signer,
      liquidity: this.get_liquidity(),
      authList: this.get_auth_list(),
    };
  };

  getUpdateRevenueCollectorContext = (
    signer: PublicKey = this.authority.publicKey
  ) => {
    return {
      authority: signer,
      liquidity: this.get_liquidity(),
    };
  };

  getCollectRevenueContext = (
    { mint, revenueCollector }: { mint: MintKeys; revenueCollector: PublicKey },
    signer: PublicKey = this.authority.publicKey
  ) => {
    return {
      authority: signer,
      liquidity: this.get_liquidity(),
      authList: this.get_auth_list(),
      mint: MintInfo.getMint(mint),
      revenueCollectorAccount: MintInfo.getUserTokenAccountWithPDA(
        mint,
        revenueCollector
      ),
      revenueCollector,
      tokenReserve: this.get_reserve(mint),
      vault: MintInfo.getUserTokenAccountWithPDA(mint, this.get_liquidity()),
      tokenProgram: MintInfo.getTokenProgramForKey(mint),
      associatedTokenProgram: MintInfo.getAssociatedTokenProgram(),
      systemProgram: SystemProgram.programId,
    };
  };

  getChangeStatusContext = (signer: PublicKey = this.authority.publicKey) => {
    return {
      authority: signer,
      liquidity: this.get_liquidity(),
      authList: this.get_auth_list(),
    };
  };

  getUpdateRateDataV1Context = (
    { mint }: { mint: MintKeys },
    signer: PublicKey = this.authority.publicKey
  ) => {
    return {
      authority: signer,
      authList: this.get_auth_list(),
      rateModel: this.get_rate_model(mint),
      mint: MintInfo.getMint(mint),
      tokenReserve: this.get_reserve(mint),
    };
  };

  getUpdateRateDataV2Context = (
    { mint }: { mint: MintKeys },
    signer: PublicKey = this.authority.publicKey
  ) => {
    return this.getUpdateRateDataV1Context({ mint }, signer);
  };

  getUpdateTokenConfigContext = (
    { mint }: { mint: MintKeys },
    signer: PublicKey = this.authority.publicKey
  ) => {
    return {
      authority: signer,
      authList: this.get_auth_list(),
      rateModel: this.get_rate_model(mint),
      mint: MintInfo.getMint(mint),
      tokenReserve: this.get_reserve(mint),
    };
  };

  getUpdateUserClassContext = (
    signer: PublicKey = this.authority.publicKey
  ) => {
    return {
      authority: signer,
      authList: this.get_auth_list(),
    };
  };

  getUpdateUserWithdrawalLimitContext = (
    { protocol, mint }: { protocol: PublicKey; mint: MintKeys },
    signer: PublicKey = this.authority.publicKey
  ) => {
    return {
      authority: signer,
      authList: this.get_auth_list(),
      userSupplyPosition: this.get_user_supply_position(mint, protocol),
    };
  };

  getUpdateUserSupplyConfigContext = (
    { protocol, mint }: { protocol: PublicKey; mint: MintKeys },
    signer: PublicKey = this.authority.publicKey
  ) => {
    return {
      authority: signer,
      protocol,
      authList: this.get_auth_list(),
      rateModel: this.get_rate_model(mint),
      mint: MintInfo.getMint(mint),
      tokenReserve: this.get_reserve(mint),
      userSupplyPosition: this.get_user_supply_position(mint, protocol),
    };
  };

  getUpdateUserBorrowConfigContext = (
    { protocol, mint }: { protocol: PublicKey; mint: MintKeys },
    signer: PublicKey = this.authority.publicKey
  ) => {
    return {
      authority: signer,
      authList: this.get_auth_list(),
      protocol,
      rateModel: this.get_rate_model(mint),
      mint: MintInfo.getMint(mint),
      tokenReserve: this.get_reserve(mint),
      userBorrowPosition: this.get_user_borrow_position(mint, protocol),
    };
  };

  getPauseUserContext = (
    {
      protocol,
      supplyMint,
      borrowMint,
    }: {
      protocol: PublicKey;
      supplyMint: MintKeys;
      borrowMint: MintKeys;
    },
    signer: PublicKey = this.authority.publicKey
  ) => {
    return {
      authority: signer,
      authList: this.get_auth_list(),
      userSupplyPosition: this.get_user_supply_position(supplyMint, protocol),
      userBorrowPosition: this.get_user_borrow_position(borrowMint, protocol),
    };
  };

  getUnpauseUserContext = (
    {
      protocol,
      supplyMint,
      borrowMint,
    }: {
      protocol: PublicKey;
      supplyMint: MintKeys;
      borrowMint: MintKeys;
    },
    signer: PublicKey = this.authority.publicKey
  ) => {
    return this.getPauseUserContext(
      { protocol, supplyMint, borrowMint },
      signer
    );
  };

  getUpdateExchangePriceContext = ({ mint }: { mint: MintKeys }) => {
    return {
      tokenReserve: this.get_reserve(mint),
      rateModel: this.get_rate_model(mint),
    };
  };

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

  getCloseClaimAccountContext = (
    { mint, user }: { mint: MintKeys; user: PublicKey },
    signer: PublicKey = this.authority.publicKey
  ) => {
    return {
      user,
      claimAccount: this.get_claim_account(mint, user),
      systemProgram: SystemProgram.programId,
    };
  };

  getClaimContext = (
    {
      mint,
      user,
      recipient,
    }: { mint: MintKeys; user: PublicKey; recipient: PublicKey },
    signer: PublicKey = this.authority.publicKey
  ) => {
    return {
      user,
      liquidity: this.get_liquidity(),
      tokenReserve: this.get_reserve(mint),
      recipientTokenAccount: MintInfo.getUserTokenAccountWithPDA(
        mint,
        recipient
      ),
      vault: MintInfo.getUserTokenAccountWithPDA(mint, this.get_liquidity()),
      claimAccount: this.get_claim_account(mint, user),
      mint: MintInfo.getMint(mint),
      tokenProgram: MintInfo.getTokenProgramForKey(mint),
      associatedTokenProgram: MintInfo.getAssociatedTokenProgram(),
    };
  };
}
