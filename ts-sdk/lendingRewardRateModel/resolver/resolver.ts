import { Program } from "@coral-xyz/anchor";
import { Lending } from "../../../target/types/lending";
import { LendingRewardRateModel } from "../../../target/types/lending_reward_rate_model";
import { PDA } from "../context/pda";

import { anchor as localProvider } from "../../connection";
import { Keypair, PublicKey } from "@solana/web3.js";
import LendingRewardRateModelJson from "../../../target/idl/lending_reward_rate_model.json";
import { BN } from "@coral-xyz/anchor";
import { signer } from "../../auth";
import { readableConsoleDump } from "../../util";
import { MintKeys, mint as MintInfo } from "../../mint";

type RewardsRate = {
  mint: PublicKey;
  startTvl: BN;
  duration: BN;
  startTime: BN;
  yearlyReward: BN;
  nextDuration: BN;
  nextRewardAmount: BN;
  bump: number;
};

export class LendingRewardRateModelResolver {
  private program: Program<Lending>;
  private pda: PDA;

  /// @dev precision used for exchange prices
  private EXCHANGE_PRICES_PRECISION: BN = new BN(1_000_000_000_000); // 1e12

  /// @dev Ignoring leap years
  private SECONDS_PER_YEAR: BN = new BN(365 * 24 * 60 * 60);

  /// @dev max allowed reward rate is 50%
  private MAX_REWARDS_RATE: BN = new BN(50).mul(this.EXCHANGE_PRICES_PRECISION); // 50%;

  constructor(authority: Keypair) {
    this.program = new Program(
      LendingRewardRateModelJson,
      localProvider.getProvider()
    );
    this.pda = new PDA(authority);
  }

  private async getRewardsRate(rate_model: RewardsRate, total_assets: BN) {
    if (total_assets.lt(rate_model.startTvl)) {
      return {
        rate: new BN(0),
        rewardsEnded: false,
        rewardsStartTime: rate_model.startTime,
      };
    }

    const rate = rate_model.yearlyReward
      .mul(this.EXCHANGE_PRICES_PRECISION)
      .div(total_assets);

    if (rate.gt(this.MAX_REWARDS_RATE)) {
      return {
        rate: this.MAX_REWARDS_RATE,
        rewardsEnded: false,
        rewardsStartTime: rate_model.startTime,
      };
    }

    return {
      rate,
      rewardsEnded: false,
      rewardsStartTime: rate_model.startTime,
    };
  }

  async getRate(mint: MintKeys, total_assets: BN) {
    // new rewards rate model
    const current_rate_model =
      await this.program.account.lendingRewardsRateModel.fetch(
        this.pda.get_lending_rewards_rate_model(mint)
      );

    return this.getRewardsRate(current_rate_model, total_assets);
  }

  /**
   * Reads the authority from the lending rewards admin account.
   * This fetches the admin account and returns its authority.
   */
  async getAuthority(): Promise<PublicKey> {
    // Use the correct program type: LendingRewardRateModel
    const program = new Program<LendingRewardRateModel>(
      LendingRewardRateModelJson,
      localProvider.getProvider()
    );
    const adminPda = this.pda.get_lending_rewards_admin();
    // The admin account is of type LendingRewardsAdmin
    const adminAccount = await program.account.lendingRewardsAdmin.fetch(
      adminPda
    );
    return adminAccount.authority;
  }

  async getAuths(): Promise<PublicKey[]> {
    // Use the correct program type: LendingRewardRateModel
    const program = new Program<LendingRewardRateModel>(
      LendingRewardRateModelJson,
      localProvider.getProvider()
    );
    const adminPda = this.pda.get_lending_rewards_admin();
    // The admin account is of type LendingRewardsAdmin
    const adminAccount = await program.account.lendingRewardsAdmin.fetch(
      adminPda
    );
    return adminAccount.auths;
  }

  async getLendingProgram(): Promise<PublicKey> {
    // Use the correct program type: LendingRewardRateModel
    const program = new Program<LendingRewardRateModel>(
      LendingRewardRateModelJson,
      localProvider.getProvider()
    );
    const adminPda = this.pda.get_lending_rewards_admin();
    // The admin account is of type LendingRewardsAdmin
    const adminAccount = await program.account.lendingRewardsAdmin.fetch(
      adminPda
    );
    return adminAccount.lendingProgram;
  }

  /**
   * Fetches all config data for a specific mint address.
   * Returns the full LendingRewardsRateModel account for the given mint.
   * @param mint The mint address to fetch config for.
   */
  async getConfigForMint(mint: PublicKey): Promise<any> {
    // Use the correct program type: LendingRewardRateModel
    const program = new Program<LendingRewardRateModel>(
      LendingRewardRateModelJson,
      localProvider.getProvider()
    );
    // Derive the PDA for the LendingRewardsRateModel for this mint
    const [rateModelPda] = await PublicKey.findProgramAddress(
      [Buffer.from("lending_rewards_rate_model"), mint.toBuffer()],
      program.programId
    );
    // Fetch the account data
    const rateModelAccount =
      await program.account.lendingRewardsRateModel.fetch(rateModelPda);
    return rateModelAccount;
  }
}

async function main() {
  const resolver = new LendingRewardRateModelResolver(signer.payer);
  console.log(
    "admin authority:",
    readableConsoleDump(await resolver.getAuthority())
  );
  console.log("auths:", readableConsoleDump(await resolver.getAuths()));
  console.log(
    "lending_program:",
    readableConsoleDump(await resolver.getLendingProgram())
  );

  // Fetch config for all specified mints as PublicKeys from the actual token list
  // and log the MintKey string itself
  const mints = [
    MintKeys.USDC,
    MintKeys.USDT,
    MintKeys.USDS,
    MintKeys.USDG,
    MintKeys.EURC,
    MintKeys.WSOL,
  ];

  for (const mint of mints) {
    const config = await resolver.getConfigForMint(MintInfo.getMint(mint));
    console.log(`Config for mint ${mint}: `, readableConsoleDump(config));
  }

  //   const rate = await resolver.getRate(
  //     MintKeys.WSOL,
  //     new BN(1000000000000000000)
  //   );
  //   console.log(rate);
}

main();
