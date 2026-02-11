import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import { PDA } from "./pda";
import { mint as MintInfo, MintKeys } from "../../mint";
import { PdaUtils } from "../../lending/context/pda";

const pdaUtilsLending = new PdaUtils();

export class Context extends PDA {
  constructor(authority: Keypair) {
    super(authority);
  }

  getInitLendingRewardsAdminContext = (
    admin: PublicKey = this.authority.publicKey
  ) => {
    return {
      signer: admin,
      lendingRewardsAdmin: this.get_lending_rewards_admin(),
      systemProgram: SystemProgram.programId,
    };
  };

  getInitLendingRewardRateModelContext = (
    mint: keyof typeof MintKeys,
    admin: PublicKey = this.authority.publicKey
  ) => {
    return {
      authority: admin,
      lendingRewardsAdmin: this.get_lending_rewards_admin(),
      mint: MintInfo.getMint(mint),
      lendingRewardsRateModel: this.get_lending_rewards_rate_model(mint),
      systemProgram: SystemProgram.programId,
    };
  };

  // prettier-ignore
  getLendingRewardsContext(mint: keyof typeof MintKeys, admin: PublicKey = this.authority.publicKey) {
    return {
      lendingRewardsRateModel: this.get_lending_rewards_rate_model(mint),
      authority: admin,
      lendingRewardsAdmin: this.get_lending_rewards_admin(),
      mint: MintInfo.getMint(mint),
      lendingAccount: pdaUtilsLending.get_lending(mint),
      fTokenMint: pdaUtilsLending.get_f_token_mint(mint),
      supplyTokenReservesLiquidity:
        pdaUtilsLending.get_liquidity_reserve(mint),
      lendingProgram: pdaUtilsLending.programId,
    };
  }

  getTransitionToNextRewardsContext = (mint: keyof typeof MintKeys) => {
    return {
      lendingRewardsAdmin: this.get_lending_rewards_admin(),
      lendingAccount: pdaUtilsLending.get_lending(mint),
      mint: MintInfo.getMint(mint),
      fTokenMint: pdaUtilsLending.get_f_token_mint(mint),
      supplyTokenReservesLiquidity: pdaUtilsLending.get_liquidity_reserve(mint),
      lendingRewardsRateModel: this.get_lending_rewards_rate_model(mint),
      lendingProgram: pdaUtilsLending.programId,
    };
  };
}
