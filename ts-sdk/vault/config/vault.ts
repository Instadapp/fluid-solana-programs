import { PublicKey } from "@solana/web3.js";

import { REBALANCER, LIQUIDITY_PROGRAM, ORACLE_PROGRAM } from "../../address";
import { mint as MintInfo, MintKeys } from "../../mint";

export type InitVaultConfigParams = {
  supplyRateMagnifier: number;
  borrowRateMagnifier: number;
  collateralFactor: number;
  liquidationThreshold: number;
  liquidationMaxLimit: number;
  withdrawGap: number;
  liquidationPenalty: number;
  borrowFee: number;
  oracle: PublicKey;
  rebalancer: PublicKey;
  liquidityProgram: PublicKey;
  supplyToken: PublicKey;
  oracleProgram: PublicKey;
  borrowToken: PublicKey;
};

// @dev for testing purpose we will be having two vaults only.
// WSOL/USDC - vault1
// WSOL/USDT - vault2

export const getVaultConfig = (vaultId: number): InitVaultConfigParams => {
  if (vaultId === 1) {
    // WSOL / USDC vault
    return {
      supplyRateMagnifier: 0,
      borrowRateMagnifier: 0,
      collateralFactor: 8700, // 87%
      liquidationThreshold: 9200, // 92%
      liquidationMaxLimit: 9500, // 95%
      withdrawGap: 500, // 5%
      liquidationPenalty: 100, // 1%
      borrowFee: 0, // 0%
      oracle: new PublicKey("6QBKbRU6bgjDxLeP8XwZmrikkRR5v913b7xwLPVoeNQ5"),
      rebalancer: new PublicKey(REBALANCER),
      liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
      supplyToken: MintInfo.getMint(MintKeys.WSOL),
      borrowToken: MintInfo.getMint(MintKeys.USDC),
      oracleProgram: new PublicKey(ORACLE_PROGRAM),
    };
  } else if (vaultId === 2) {
    // WSOL / USDT vault
    return {
      supplyRateMagnifier: 0,
      borrowRateMagnifier: 0,
      collateralFactor: 8700, // 87%
      liquidationThreshold: 9200, // 92%
      liquidationMaxLimit: 9500, // 95%
      withdrawGap: 500, // 5%
      liquidationPenalty: 100, // 1%
      borrowFee: 0, // 0%
      oracle: new PublicKey("6QBKbRU6bgjDxLeP8XwZmrikkRR5v913b7xwLPVoeNQ5"),
      rebalancer: new PublicKey(REBALANCER),
      liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
      supplyToken: MintInfo.getMint(MintKeys.WSOL),
      borrowToken: MintInfo.getMint(MintKeys.USDT),
      oracleProgram: new PublicKey(ORACLE_PROGRAM),
    };
  } else if (vaultId === 3) {
    // WSOL / EURC vault
    return {
      supplyRateMagnifier: 0,
      borrowRateMagnifier: 0,
      collateralFactor: 8000, // 80%
      liquidationThreshold: 8500, // 85%
      liquidationMaxLimit: 8700, // 87%
      withdrawGap: 500, // 5%
      liquidationPenalty: 100, // 1%
      borrowFee: 0, // 0%
      oracle: new PublicKey("HfvGSbCaW8yrWAB6VN27uKEoRSXb64yin7aaWWHz9t3D"),
      rebalancer: new PublicKey(REBALANCER),
      liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
      supplyToken: MintInfo.getMint(MintKeys.WSOL),
      borrowToken: MintInfo.getMint(MintKeys.EURC),
      oracleProgram: new PublicKey(ORACLE_PROGRAM),
    };
  } else if (vaultId === 4) {
    // JUPSOL / SOL vault
    return {
      supplyRateMagnifier: 0,
      borrowRateMagnifier: 0,
      collateralFactor: 9000, // 90%
      liquidationThreshold: 9500, // 95%
      liquidationMaxLimit: 9700, // 97%
      withdrawGap: 500, // 5%
      liquidationPenalty: 200, // 1%
      borrowFee: 0, // 0%
      oracle: new PublicKey("6uiicrzTUUA89U3hXXxawjokwycmcFQyHWgqKP17Up3k"),
      rebalancer: new PublicKey(REBALANCER),
      liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
      supplyToken: MintInfo.getMint(MintKeys.JUPSOL),
      borrowToken: MintInfo.getMint(MintKeys.WSOL),
      oracleProgram: new PublicKey(ORACLE_PROGRAM),
    };
  } else if (vaultId === 5) {
    // JITOSOL / SOL vault
    return {
      supplyRateMagnifier: 0,
      borrowRateMagnifier: 0,
      collateralFactor: 9000, // 90%
      liquidationThreshold: 9500, // 95%
      liquidationMaxLimit: 9700, // 97%
      withdrawGap: 500, // 5%
      liquidationPenalty: 200, // 1%
      borrowFee: 0, // 0%
      oracle: new PublicKey("8aGZEMmXTmLvUhccjyaVDaFfqs8feeD3HEcUbztj4tqg"),
      rebalancer: new PublicKey(REBALANCER),
      liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
      supplyToken: MintInfo.getMint(MintKeys.JITOSOL),
      borrowToken: MintInfo.getMint(MintKeys.WSOL),
      oracleProgram: new PublicKey(ORACLE_PROGRAM),
    };
  } else if (vaultId === 6) {
    // WSOL / USDG vault
    return {
      supplyRateMagnifier: 0,
      borrowRateMagnifier: 0,
      collateralFactor: 9000, // 90%
      liquidationThreshold: 9500, // 95%
      liquidationMaxLimit: 9700, // 97%
      withdrawGap: 500, // 5%
      liquidationPenalty: 200, // 1%
      borrowFee: 0, // 0%
      oracle: new PublicKey("6QBKbRU6bgjDxLeP8XwZmrikkRR5v913b7xwLPVoeNQ5"),
      rebalancer: new PublicKey(REBALANCER),
      liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
      supplyToken: MintInfo.getMint(MintKeys.WSOL),
      borrowToken: MintInfo.getMint(MintKeys.USDG),
      oracleProgram: new PublicKey(ORACLE_PROGRAM),
    };
  } else if (vaultId === 7) {
    // SyrupUSDC / USDC vault
    return {
      supplyRateMagnifier: 0,
      borrowRateMagnifier: 0,
      collateralFactor: 9000, // 90%
      liquidationThreshold: 9500, // 95%
      liquidationMaxLimit: 9700, // 97%
      withdrawGap: 500, // 5%
      liquidationPenalty: 200, // 1%
      borrowFee: 0, // 0%
      oracle: new PublicKey("9m4f98xcfrSJWu1RwQRVqbWHYta7uNY5m2CekoyFFtAA"),
      rebalancer: new PublicKey(REBALANCER),
      liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
      supplyToken: MintInfo.getMint(MintKeys.SYRUPUSDC),
      borrowToken: MintInfo.getMint(MintKeys.USDC),
      oracleProgram: new PublicKey(ORACLE_PROGRAM),
    };
  } else if (vaultId === 8) {
    // JLP / USDC vault
    return {
      supplyRateMagnifier: 0,
      borrowRateMagnifier: 0,
      collateralFactor: 9000, // 90%
      liquidationThreshold: 9500, // 95%
      liquidationMaxLimit: 9700, // 97%
      withdrawGap: 500, // 5%
      liquidationPenalty: 200, // 1%
      borrowFee: 0, // 0%
      oracle: new PublicKey("25UZhqEoQeMA2ovbM1PgwZbU3NGUA8eM2y5g1j58YmFV"),
      rebalancer: new PublicKey(REBALANCER),
      liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
      supplyToken: MintInfo.getMint(MintKeys.JLP),
      borrowToken: MintInfo.getMint(MintKeys.USDC),
      oracleProgram: new PublicKey(ORACLE_PROGRAM),
    };
  } else if (vaultId === 9) {
    // XBTC / USDC vault
    return {
      supplyRateMagnifier: 0,
      borrowRateMagnifier: 0,
      collateralFactor: 9000, // 90%
      liquidationThreshold: 9500, // 95%
      liquidationMaxLimit: 9700, // 97%
      withdrawGap: 500, // 5%
      liquidationPenalty: 200, // 1%
      borrowFee: 0, // 0%
      oracle: new PublicKey("BU4FbopNHBseTnrck5HyvocWN7PcS9SMhrKTNLagzx3z"),
      rebalancer: new PublicKey(REBALANCER),
      liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
      supplyToken: MintInfo.getMint(MintKeys.XBTC),
      borrowToken: MintInfo.getMint(MintKeys.USDC),
      oracleProgram: new PublicKey(ORACLE_PROGRAM),
    };
  } else if (vaultId === 10) {
    // JLP / USDG vault
    return {
      supplyRateMagnifier: 0,
      borrowRateMagnifier: 0,
      collateralFactor: 9000, // 90%
      liquidationThreshold: 9500, // 95%
      liquidationMaxLimit: 9700, // 97%
      withdrawGap: 500, // 5%
      liquidationPenalty: 200, // 1%
      borrowFee: 0, // 0%
      oracle: new PublicKey("25UZhqEoQeMA2ovbM1PgwZbU3NGUA8eM2y5g1j58YmFV"),
      rebalancer: new PublicKey(REBALANCER),
      liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
      supplyToken: MintInfo.getMint(MintKeys.JLP),
      borrowToken: MintInfo.getMint(MintKeys.USDG),
      oracleProgram: new PublicKey(ORACLE_PROGRAM),
    };
  } else if (vaultId === 11) {
    // CBBTC / USDC vault
    return {
      supplyRateMagnifier: 0,
      borrowRateMagnifier: 0,
      collateralFactor: 9000, // 90%
      liquidationThreshold: 9500, // 95%
      liquidationMaxLimit: 9700, // 97%
      withdrawGap: 500, // 5%
      liquidationPenalty: 200, // 1%
      borrowFee: 0, // 0%
      oracle: new PublicKey("BU4FbopNHBseTnrck5HyvocWN7PcS9SMhrKTNLagzx3z"),
      rebalancer: new PublicKey(REBALANCER),
      liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
      supplyToken: MintInfo.getMint(MintKeys.CBBTC),
      borrowToken: MintInfo.getMint(MintKeys.USDC),
      oracleProgram: new PublicKey(ORACLE_PROGRAM),
    };
  } else if (vaultId === 12) {
    // CBBTC / USDG vault
    return {
      supplyRateMagnifier: 0,
      borrowRateMagnifier: 0,
      collateralFactor: 9000, // 90%
      liquidationThreshold: 9500, // 95%
      liquidationMaxLimit: 9700, // 97%
      withdrawGap: 500, // 5%
      liquidationPenalty: 200, // 1%
      borrowFee: 0, // 0%
      oracle: new PublicKey("BU4FbopNHBseTnrck5HyvocWN7PcS9SMhrKTNLagzx3z"),
      rebalancer: new PublicKey(REBALANCER),
      liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
      supplyToken: MintInfo.getMint(MintKeys.CBBTC),
      borrowToken: MintInfo.getMint(MintKeys.USDG),
      oracleProgram: new PublicKey(ORACLE_PROGRAM),
    };
  } else if (vaultId === 13) {
    // JUPSOL / USDC vault
    return {
      supplyRateMagnifier: 0,
      borrowRateMagnifier: 0,
      collateralFactor: 9000, // 90%
      liquidationThreshold: 9500, // 95%
      liquidationMaxLimit: 9700, // 97%
      withdrawGap: 500, // 5%
      liquidationPenalty: 200, // 1%
      borrowFee: 0, // 0%
      oracle: new PublicKey("GfDupR4oYC59mkrEYzcdEHdS1sRD492pG2855sovhdY5"),
      rebalancer: new PublicKey(REBALANCER),
      liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
      supplyToken: MintInfo.getMint(MintKeys.JUPSOL),
      borrowToken: MintInfo.getMint(MintKeys.USDC),
      oracleProgram: new PublicKey(ORACLE_PROGRAM),
    };
  } else if (vaultId === 14) {
    // JUPSOL / USDG vault
    return {
      supplyRateMagnifier: 0,
      borrowRateMagnifier: 0,
      collateralFactor: 9000, // 90%
      liquidationThreshold: 9500, // 95%
      liquidationMaxLimit: 9700, // 97%
      withdrawGap: 500, // 5%
      liquidationPenalty: 200, // 1%
      borrowFee: 0, // 0%
      oracle: new PublicKey("GfDupR4oYC59mkrEYzcdEHdS1sRD492pG2855sovhdY5"),
      rebalancer: new PublicKey(REBALANCER),
      liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
      supplyToken: MintInfo.getMint(MintKeys.JUPSOL),
      borrowToken: MintInfo.getMint(MintKeys.USDG),
      oracleProgram: new PublicKey(ORACLE_PROGRAM),
    };
  } else if (vaultId === 15) {
    // JITOSOL / USDC vault
    return {
      supplyRateMagnifier: 0,
      borrowRateMagnifier: 0,
      collateralFactor: 9000, // 90%
      liquidationThreshold: 9500, // 95%
      liquidationMaxLimit: 9700, // 97%
      withdrawGap: 500, // 5%
      liquidationPenalty: 200, // 1%
      borrowFee: 0, // 0%
      oracle: new PublicKey("HZoqoVb3EPyxbHua9jAFgdjxkvt4gdbeVY2esUUFD8Go"),
      rebalancer: new PublicKey(REBALANCER),
      liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
      supplyToken: MintInfo.getMint(MintKeys.JITOSOL),
      borrowToken: MintInfo.getMint(MintKeys.USDC),
      oracleProgram: new PublicKey(ORACLE_PROGRAM),
    };
  } else if (vaultId === 16) {
    // JITOSOL / USDG vault
    return {
      supplyRateMagnifier: 0,
      borrowRateMagnifier: 0,
      collateralFactor: 9000, // 90%
      liquidationThreshold: 9500, // 95%
      liquidationMaxLimit: 9700, // 97%
      withdrawGap: 500, // 5%
      liquidationPenalty: 200, // 1%
      borrowFee: 0, // 0%
      oracle: new PublicKey("HZoqoVb3EPyxbHua9jAFgdjxkvt4gdbeVY2esUUFD8Go"),
      rebalancer: new PublicKey(REBALANCER),
      liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
      supplyToken: MintInfo.getMint(MintKeys.JITOSOL),
      borrowToken: MintInfo.getMint(MintKeys.USDG),
      oracleProgram: new PublicKey(ORACLE_PROGRAM),
    };
  } else {
    throw new Error("Invalid vault id");
  }
};
