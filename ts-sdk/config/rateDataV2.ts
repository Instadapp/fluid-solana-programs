import { MintKeys } from "../mint";

export type RateDataV2Params = {
  token: MintKeys;
  kink1: number;
  kink2: number;
  rateAtUtilizationZero: number;
  rateAtUtilizationKink1: number;
  rateAtUtilizationKink2: number;
  rateAtUtilizationMax: number;
};

export const rateDataV2: RateDataV2Params[] = [
  {
    token: MintKeys.USDC,
    kink1: 8500,
    kink2: 9300,
    rateAtUtilizationZero: 0, // 2%
    rateAtUtilizationKink1: 600, // 6%
    rateAtUtilizationKink2: 800, // 8%
    rateAtUtilizationMax: 10000, // 100%
  },
  {
    token: MintKeys.USDT,
    kink1: 8500,
    kink2: 9300,
    rateAtUtilizationZero: 0, // 2%
    rateAtUtilizationKink1: 600, // 6%
    rateAtUtilizationKink2: 800, // 8%
    rateAtUtilizationMax: 10000, // 100%
  },
];
