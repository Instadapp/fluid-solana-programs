import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

// Vault Type Definitions

export interface ConstantViews {
  liquidity: PublicKey;
  supply: PublicKey;
  borrow: PublicKey;
  supplyToken: PublicKey;
  borrowToken: PublicKey;
  vaultId: number;
  vaultType: number;
}

export interface Configs {
  supplyRateMagnifier: BN;
  borrowRateMagnifier: BN;
  collateralFactor: BN;
  liquidationThreshold: BN;
  liquidationMaxLimit: BN;
  withdrawalGap: BN;
  liquidationPenalty: BN;
  borrowFee: BN;
  oracle: PublicKey;
  rebalancer: PublicKey;
  oraclePriceOperate?: BN;
  oraclePriceLiquidate?: BN;
  lastUpdateTimestamp?: BN;
}

export interface ExchangePricesAndRates {
  lastStoredLiquiditySupplyExchangePrice: BN;
  lastStoredLiquidityBorrowExchangePrice: BN;
  lastStoredVaultSupplyExchangePrice: BN;
  lastStoredVaultBorrowExchangePrice: BN;
  liquiditySupplyExchangePrice: BN;
  liquidityBorrowExchangePrice: BN;
  vaultSupplyExchangePrice: BN;
  vaultBorrowExchangePrice: BN;
  supplyRateLiquidity: BN;
  borrowRateLiquidity: BN;
  supplyRateVault: BN;
  borrowRateVault: BN;
  rewardsOrFeeRateSupply: BN;
  rewardsOrFeeRateBorrow: BN;
}

export interface TotalSupplyAndBorrow {
  totalSupplyVault: BN;
  totalBorrowVault: BN;
  totalSupplyLiquidityOrDex: BN;
  totalBorrowLiquidityOrDex: BN;
  absorbedSupply: BN;
  absorbedBorrow: BN;
}

export interface LimitsAndAvailability {
  withdrawLimit: BN;
  withdrawableUntilLimit: BN;
  withdrawable: BN;
  borrowLimit: BN;
  borrowLimitUtilization: BN;
  borrowableUntilLimit: BN;
  borrowable: BN;
  minimumBorrowing: BN;
}

export interface CurrentBranchState {
  status: number;
  minimaTick: number;
  debtFactor: BN;
  partials: BN;
  debtLiquidity: BN;
  baseBranchId: number;
  baseBranchMinima: number;
}

export interface VaultState {
  topTick: number;
  currentBranch: number;
  totalBranch: number;
  totalSupply: BN;
  totalBorrow: BN;
  totalPositions: number;
  currentBranchState: CurrentBranchState;
}

export interface UserPosition {
  nftId: number;
  owner: PublicKey;
  isSupplyPosition: boolean;
  supply: BN;
  beforeSupply: BN;
  dustBorrow: BN;
  beforeDustBorrow: BN;
  tick: number;
  tickId: number;
  borrow: BN;
  beforeBorrow: BN;
  isLiquidated: boolean;
}

export interface LiquidationStruct {
  vault: PublicKey;
  token0In: PublicKey;
  token0Out: PublicKey;
  token1In: PublicKey;
  token1Out: PublicKey;
  inAmt: BN;
  outAmt: BN;
  inAmtWithAbsorb: BN;
  outAmtWithAbsorb: BN;
  absorbAvailable: boolean;
}

export interface AbsorbStruct {
  vault: PublicKey;
  absorbAvailable: boolean;
}

export interface VaultEntireData {
  vault: PublicKey;
  isSmartCol: boolean;
  isSmartDebt: boolean;
  constantViews: ConstantViews;
  configs: Configs;
  exchangePricesAndRates: ExchangePricesAndRates;
  limitsAndAvailability: LimitsAndAvailability;
  liquidityUserSupplyData: any; // UserSupplyData from liquidity resolver
  liquidityUserBorrowData: any; // UserBorrowData from liquidity resolver
  vaultState: VaultState;
  totalSupplyAndBorrow: TotalSupplyAndBorrow;
}

// Additional utility types

export interface VaultHealthData {
  utilizationRate: BN;
  liquidationRisk: "LOW" | "MEDIUM" | "HIGH";
  totalValueLocked: BN;
  healthFactor: BN;
}

export interface TickData {
  tick: number;
  isLiquidated: boolean;
  totalIds: number;
  rawDebt: BN;
  isFullyLiquidated: boolean;
  liquidationBranchId: number;
  debtFactor: BN;
}

export interface BranchData {
  branchId: number;
  status: number; // 0=not liquidated, 1=liquidated, 2=merged, 3=closed
  minimaTick: number;
  minimaTickPartials: number;
  debtLiquidity: BN;
  debtFactor: BN;
  connectedBranchId: number;
  connectedMinimaTick: number;
}

export interface PositionData {
  isSupplyOnlyPosition: boolean; // 0 = borrow position; 1 = supply position
  tick: number;
  tickId: number;
  supplyAmount: BN;
  dustDebtAmount: BN;
}

// Enums and constants
export enum VaultType {
  VAULT_T1_TYPE = 1,
  VAULT_T2_SMART_COL_TYPE = 2,
  VAULT_T3_SMART_DEBT_TYPE = 3,
  VAULT_T4_SMART_COL_SMART_DEBT_TYPE = 4,
}

export enum LiquidationRisk {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
}

export enum BranchStatus {
  NOT_LIQUIDATED = 0,
  LIQUIDATED = 1,
  MERGED = 2,
  CLOSED = 3,
}

// Error types
export class VaultResolverError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = "VaultResolverError";
  }
}

// Utility functions
export function tickHelper(tickData: number): number {
  if (tickData === 0) return Number.MIN_SAFE_INTEGER;

  const isPositive = (tickData & 1) === 1;
  const absoluteValue = (tickData >> 1) & 0x7ffff; // 19 bits

  return isPositive ? absoluteValue : -absoluteValue;
}

export function fromBigNumber(
  value: BN,
  exponentSize: number,
  exponentMask: number
): BN {
  const coefficient = value.shln(exponentSize);
  const exponent = value.and(new BN(exponentMask));
  return coefficient.shln(exponent.toNumber());
}

// Constants
export const VAULT_CONSTANTS = {
  EXCHANGE_PRICES_PRECISION: new BN(10).pow(new BN(12)),
  FOUR_DECIMALS: new BN(10000),
  NATIVE_TOKEN_ADDRESS: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  DEAD_ADDRESS: "0x000000000000000000000000000000000000dEaD",
  MIN_TICK: -16383,
  MAX_TICK: 16383,
  DEFAULT_EXPONENT_SIZE: 8,
  DEFAULT_EXPONENT_MASK: 0xff,
  X8: 0xff,
  X10: 0x3ff,
  X16: 0xffff,
  X19: 0x7ffff,
  X20: 0xfffff,
  X24: 0xffffff,
  X25: 0x1ffffff,
  X30: 0x3fffffff,
  X32: 0xffffffff,
  X33: 0x1ffffffff,
  X50: 0x3ffffffffffff,
  X64: 0xffffffffffffffff,
  X128: new BN(2).pow(new BN(128)).sub(new BN(1)),
} as const;
