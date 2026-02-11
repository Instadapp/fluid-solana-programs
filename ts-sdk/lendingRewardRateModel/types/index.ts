import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export type LendingRewardsRateModelParams = {
  startTvl: BN;
  duration: BN;
  rewardAmount: BN;
  configurator: PublicKey;
  startTime: BN;
};
