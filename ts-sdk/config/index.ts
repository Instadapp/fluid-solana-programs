import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

import { MintKeys, mint as MintInfo } from "../mint";

export type SupplyConfig = {
  token: PublicKey;
  mode: number;
  expandPercent: anchor.BN;
  expandDuration: anchor.BN;
  baseWithdrawalLimit: anchor.BN;
};

const SUPPLY_CONFIG: Record<string, SupplyConfig> = {
  WSOL: {
    token: MintInfo.getMint(MintKeys.WSOL),
    mode: 1,
    expandPercent: new anchor.BN(3500), // 35%
    expandDuration: new anchor.BN(21600), // 6hrs
    baseWithdrawalLimit: new anchor.BN(1000 * 10 ** 9), // 1000 WSOL
  },
  USDC: {
    token: MintInfo.getMint(MintKeys.USDC),
    mode: 1,
    expandPercent: new anchor.BN(3500), // 35%
    expandDuration: new anchor.BN(21600), // 6hrs
    baseWithdrawalLimit: new anchor.BN(1e6 * 1e6), // 1M USDC
  },
  USDT: {
    token: MintInfo.getMint(MintKeys.USDT),
    mode: 1,
    expandPercent: new anchor.BN(3500), // 35%
    expandDuration: new anchor.BN(21600), // 6hrs
    baseWithdrawalLimit: new anchor.BN(1e6 * 1e6), // 1M USDC
  },
  EURC: {
    token: MintInfo.getMint(MintKeys.EURC),
    mode: 1,
    expandPercent: new anchor.BN(3500), // 35%
    expandDuration: new anchor.BN(21600), // 6hrs
    baseWithdrawalLimit: new anchor.BN(1e6 * 1e6), // 1M EURC
  },
};

export type BorrowConfig = {
  token: PublicKey;
  mode: number;
  expandPercent: anchor.BN;
  expandDuration: anchor.BN;
  baseDebtCeiling: anchor.BN;
  maxDebtCeiling: anchor.BN;
};

const BORROW_CONFIG: Record<string, BorrowConfig> = {
  USDC: {
    token: MintInfo.getMint(MintKeys.USDC),
    mode: 1, // with interest
    expandPercent: new anchor.BN(3500), // 35%
    expandDuration: new anchor.BN(21600), // 6hrs
    baseDebtCeiling: new anchor.BN(1e6 * 1e6), // 1M USDC
    maxDebtCeiling: new anchor.BN(1e6 * 1e6), // 1M USDC
  },
  EURC: {
    token: MintInfo.getMint(MintKeys.EURC),
    mode: 1, // with interest
    expandPercent: new anchor.BN(3500), // 35%
    expandDuration: new anchor.BN(21600), // 6hrs
    baseDebtCeiling: new anchor.BN(1e6 * 1e6), // 1M EURC
    maxDebtCeiling: new anchor.BN(1e6 * 1e6), // 1M EURC
  },
};

export const getSupplyConfig = (protocol: PublicKey, mint: MintKeys) => {
  return {
    user: protocol,
    ...SUPPLY_CONFIG[mint],
  };
};

export const getBorrowConfig = (protocol: PublicKey, mint: MintKeys) => {
  return {
    user: protocol,
    ...BORROW_CONFIG[mint],
  };
};
