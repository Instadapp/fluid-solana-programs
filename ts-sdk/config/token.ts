import * as anchor from "@coral-xyz/anchor";

import { MintKeys } from "../mint";

export type TokenConfig = {
  token: MintKeys;
  fee: anchor.BN;
  maxUtilization: anchor.BN;
};

export const tokenConfig: TokenConfig[] = [
  {
    token: MintKeys.WSOL,
    fee: new anchor.BN(1000), // 10% fee on interest (1000 = 10%)
    maxUtilization: new anchor.BN(9500), // 95% max utilization (9500 = 95%)
  },
];
