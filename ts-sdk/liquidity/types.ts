import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

import { MintKeys } from "../mint";

export interface PauseUserParams {
  protocol: PublicKey;
  supplyMint: MintKeys;
  borrowMint: MintKeys;
  supplyStatus: number;
  borrowStatus: number;
}

export type InitProtocolParams = {
  protocol: PublicKey;
  supplyMint: MintKeys;
  borrowMint: MintKeys;
};

export type UpdateUserSupplyConfigParams = {
  mint: MintKeys;
  newSupplyConfig: UserSupplyConfig;
};

export type UpdateUserBorrowConfigParams = {
  mint: MintKeys;
  newBorrowConfig: UserBorrowConfig;
};

export type TokenConfig = {
  token: MintKeys;
  fee: anchor.BN;
  maxUtilization: anchor.BN;
};

export type RateDataV1Params = {
  token: MintKeys;
  kink: number;
  rateAtUtilizationZero: number;
  rateAtUtilizationKink: number;
  rateAtUtilizationMax: number;
};

export type RateDataV2Params = {
  token: MintKeys;
  kink1: number;
  kink2: number;
  rateAtUtilizationZero: number;
  rateAtUtilizationKink1: number;
  rateAtUtilizationKink2: number;
  rateAtUtilizationMax: number;
};

export type UserSupplyConfig = {
  user: PublicKey;
  token: PublicKey;
  mode: number;
  expandPercent: anchor.BN;
  expandDuration: anchor.BN;
  baseWithdrawalLimit: anchor.BN;
};

export type UserBorrowConfig = {
  user: PublicKey;
  token: PublicKey;
  mode: number;
  expandPercent: anchor.BN;
  expandDuration: anchor.BN;
  baseDebtCeiling: anchor.BN;
  maxDebtCeiling: anchor.BN;
};
