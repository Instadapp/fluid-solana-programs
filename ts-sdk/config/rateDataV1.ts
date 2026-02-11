import { MintKeys } from "../mint";

export type RateDataV1Params = {
  token: MintKeys;
  kink: number;
  rateAtUtilizationZero: number;
  rateAtUtilizationKink: number;
  rateAtUtilizationMax: number;
};

export const rateDataV1: RateDataV1Params[] = [
  // {
  //   token: MintInfo.getMint(MintKeys.ETH),
  //   kink: 9000,
  //   rate_at_utilization_zero: 0,
  //   rate_at_utilization_kink: 300, // 3%
  //   rate_at_utilization_max: 10000, // 100%
  // },
  {
    token: MintKeys.WSOL,
    kink: 9000,
    rateAtUtilizationZero: 0,
    rateAtUtilizationKink: 300, // 3%
    rateAtUtilizationMax: 10000, // 100%
  },
];
