import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { divCeil } from "../../util";

/**
 * Rate data for V1 model with a single kink point
 */
export interface RateDataV1 {
  token: PublicKey;
  rateAtUtilizationZero: BN;
  kink: BN;
  rateAtUtilizationKink: BN;
  rateAtUtilizationMax: BN;
}

/**
 * Rate data for V2 model with two kink points
 */
export interface RateDataV2 {
  token: PublicKey;
  rateAtUtilizationZero: BN;
  kink1: BN;
  rateAtUtilizationKink1: BN;
  kink2: BN;
  rateAtUtilizationKink2: BN;
  rateAtUtilizationMax: BN;
}

/**
 * Combined rate data with a version identifier
 */
export interface RateData {
  token: PublicKey;
  version: number;
  rateDataV1: RateDataV1;
  rateDataV2: RateDataV2;
}

/**
 * Overall token data including rates, exchange prices, and amounts
 */
export interface OverallTokenData {
  rateData: RateData;
  supplyExchangePrice: BN;
  borrowExchangePrice: BN;
  borrowRate: BN;
  fee: BN;
  lastStoredUtilization: BN;
  lastUpdateTimestamp: BN;
  maxUtilization: BN;
  supplyRawInterest: BN;
  supplyInterestFree: BN;
  borrowRawInterest: BN;
  borrowInterestFree: BN;
  totalSupply: BN;
  totalBorrow: BN;
  revenue: BN;
  supplyRate: BN;
}

/**
 * User supply data for a specific token
 */
export interface UserSupplyData {
  modeWithInterest: boolean;
  supply: BN;
  withdrawalLimit: BN;
  lastUpdateTimestamp: BN;
  expandPercent: BN;
  expandDuration: BN;
  baseWithdrawalLimit: BN;
  withdrawableUntilLimit: BN;
  withdrawable: BN;
}

/**
 * User borrow data for a specific token
 */
export interface UserBorrowData {
  modeWithInterest: boolean;
  borrow: BN;
  borrowLimit: BN;
  lastUpdateTimestamp: BN;
  expandPercent: BN;
  expandDuration: BN;
  baseBorrowLimit: BN;
  maxBorrowLimit: BN;
  borrowLimitUtilization: BN;
  borrowableUntilLimit: BN;
  borrowable: BN;
}

/**
 * Constants used across the resolver
 */
export const CONSTANTS = {
  EXCHANGE_PRICES_PRECISION: new BN(1_000_000_000_000), // 1e12
  FOUR_DECIMALS: new BN(10000), // 100% in basis points
  DEFAULT_MAX_UTILIZATION: new BN(9500), // 95% default max utilization
};

/**
 * Helper functions for calculations
 */
export const LiquidityCalcs = {
  /**
   * Calculate revenue for a token
   */
  calcRevenue: (
    totalAmounts: any,
    exchangePricesAndConfig: any,
    liquidityTokenBalance: BN
  ): BN => {
    if (
      !totalAmounts ||
      !exchangePricesAndConfig ||
      liquidityTokenBalance.isZero()
    ) {
      return new BN(0);
    }

    // M-08 Incorrect rounding in calc_revenue
    // Calculate normalized supply and borrow amounts
    const supplyWithInterest = divCeil(
      totalAmounts.supplyRawInterest.mul(
        exchangePricesAndConfig.supplyExchangePrice
      ),
      CONSTANTS.EXCHANGE_PRICES_PRECISION
    );

    const borrowWithInterest = totalAmounts.borrowRawInterest
      .mul(exchangePricesAndConfig.borrowExchangePrice)
      .div(CONSTANTS.EXCHANGE_PRICES_PRECISION);

    const totalSupply = supplyWithInterest.add(totalAmounts.supplyInterestFree);
    const totalBorrow = borrowWithInterest.add(totalAmounts.borrowInterestFree);

    // Revenue is excess of balance over net liquidity
    const expectedBalance = totalSupply.sub(totalBorrow);

    if (liquidityTokenBalance.gt(expectedBalance)) {
      return liquidityTokenBalance.sub(expectedBalance);
    }

    return new BN(0);
  },

  /**
   * Calculate the withdrawal limit before an operation
   */
  calcWithdrawalLimit: (userSupply: any): BN => {
    // In a real implementation, this would incorporate time-based expansion
    return userSupply.withdrawalLimit || new BN(0);
  },

  /**
   * Calculate the borrow limit before an operation
   */
  calcBorrowLimit: (userBorrow: any): BN => {
    // In a real implementation, this would incorporate time-based expansion
    return userBorrow.borrowLimit || new BN(0);
  },
};
