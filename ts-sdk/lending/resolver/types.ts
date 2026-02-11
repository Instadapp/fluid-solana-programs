import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import { UserSupplyData } from "../../liquidity/resolver/types";

/**
 * FToken details containing token information, balances, and rates
 */
export interface FTokenDetails {
  tokenAddress: PublicKey; // fToken address (PDA)
  name: string; // fToken name
  symbol: string; // fToken symbol
  decimals: number; // fToken decimals
  underlyingAddress: PublicKey; // Underlying token address
  totalAssets: BN; // Total underlying assets managed by this fToken
  totalSupply: BN; // Total fToken supply
  conversionRateToShares: BN; // Example conversion rate for 1 asset to shares
  conversionRateToAssets: BN; // Example conversion rate for 1 share to assets
  rewardsRate: BN; // Current rewards rate
  supplyRate: BN; // Current supply rate from liquidity
  rebalanceDifference: BN; // Difference between totalAssets and liquidity balance
  userSupplyData: UserSupplyData; // User's supply data from liquidity
}

/**
 * User position for a specific fToken
 */
export interface UserPosition {
  fTokenShares: BN; // User's fToken balance
  underlyingAssets: BN; // Equivalent underlying asset amount
  underlyingBalance: BN; // User's balance of underlying token
  allowance: BN; // User's allowance of underlying token to fToken
}

/**
 * Combined FToken details with user position information
 */
export interface FTokenDetailsUserPosition {
  fTokenDetails: FTokenDetails;
  userPosition: UserPosition;
}

/**
 * Rewards rate model configuration information
 */
export interface RewardsRateModelConfig {
  duration: BN;
  startTime: BN;
  endTime: BN;
  startTvl: BN;
  maxRate: BN;
  rewardAmount: BN;
  initiator: PublicKey;
}

/**
 * Preview data for deposit/withdraw operations
 */
export interface PreviewData {
  previewDeposit: BN;
  previewMint: BN;
  previewWithdraw: BN;
  previewRedeem: BN;
}

/**
 * Internal data for an fToken
 */
export interface FTokenInternalData {
  liquidity: PublicKey;
  lendingFactory: PublicKey;
  lendingRewardsRateModel: PublicKey;
  rebalancer: PublicKey;
  liquidityBalance: BN;
  liquidityExchangePrice: BN;
  tokenExchangePrice: BN;
}

/**
 * Constants used in lending calculations
 */
export const LENDING_CONSTANTS = {
  EXCHANGE_PRICES_PRECISION: new BN(1e12), // 1e12
  SECONDS_PER_YEAR: new BN(31536000),
  MAX_REWARDS_RATE: new BN(50 * 1e12), // 50%
};
