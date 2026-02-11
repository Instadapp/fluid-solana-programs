import { Keypair, PublicKey } from "@solana/web3.js";

import { PDA } from "./pda";
import { BN, Program } from "@coral-xyz/anchor";
import { Vaults } from "../../../target/types/vaults";
import { mulDivNormal, mulBigNumber } from "../../bigNumberMinified";
import { MintKeys, mint as MintInfo } from "../../mint";
import { divCeil } from "../../util";
import { VaultResolver as TestVaultResolver } from "../../../tests-utils/vaults/resolver";

type UserPosition = {
  vaultId: number;
  nftId: number;
  positionMint: PublicKey;
  isSupplyOnlyPosition: number | boolean;
  tick: number;
  tickId: number;
  supplyAmount: BN;
  dustDebtAmount: BN;
  debtAmount?: BN;
};

type UserPositionWithDebt = {
  tick: number;
  tickId: number;
  colRaw: BN;
  debtRaw: BN;
  dustDebtRaw: BN;
  finalAmount: BN;
  isSupplyOnlyPosition: boolean;
};

export class State extends PDA {
  INIT_TICK = -2147483648;
  MIN_TICK = -16383;
  MAX_TICK = 16383;
  ZERO_TICK_SCALED_RATIO = new BN(0x1000000000000);
  EXCHANGE_PRICES_PRECISION = new BN(10).pow(new BN(12)); // 1e12
  TICK_SPACING = new BN(10015);
  DEFAULT_EXPONENT_MASK = 0xff;
  X30 = new BN(0x3fffffff);
  MIN_I128 = new BN("170141183460469231731687303715884105728").neg();

  constructor(authority: Keypair, program: Program<Vaults>) {
    super(authority, program);
  }

  async readVaultAdmin() {
    const vaultAdminPda = this.get_vault_admin();

    try {
      return await this.program.account.vaultAdmin.fetch(vaultAdminPda);
    } catch (error) {
      return null;
    }
  }

  async readVaultMetadata({ vaultId }: { vaultId: number }) {
    const vaultMetadataPda = this.get_vault_metadata({ vaultId });

    try {
      return await this.program.account.vaultMetadata.fetch(vaultMetadataPda);
    } catch (error) {
      return null;
    }
  }

  async readUserPosition({
    vaultId,
    positionId,
  }: {
    vaultId: number;
    positionId: number;
  }): Promise<UserPosition | null> {
    const positionPda = this.get_position({ vaultId, positionId });

    try {
      return await this.program.account.position.fetch(positionPda);
    } catch (error) {
      return null;
    }
  }

  async readVaultState({ vaultId }: { vaultId: number }) {
    const vaultStatePda = this.get_vault_state({ vaultId });

    try {
      return await this.program.account.vaultState.fetch(vaultStatePda);
    } catch (error) {
      return null;
    }
  }

  async readVaultConfig({ vaultId }: { vaultId: number }) {
    const vaultConfigPda = this.get_vault_config({ vaultId });

    try {
      return await this.program.account.vaultConfig.fetch(vaultConfigPda);
    } catch (error) {
      return null;
    }
  }

  async readTick({ vaultId, tick }: { vaultId: number; tick: number }) {
    const tickPda = this.get_tick({ vaultId, tick });

    try {
      return await this.program.account.tick.fetch(tickPda);
    } catch (error) {
      return null;
    }
  }

  async readMultipleTicks({
    vaultId,
    ticks,
  }: {
    vaultId: number;
    ticks: number[];
  }) {
    const tickPdas = ticks.map((tick) => this.get_tick({ vaultId, tick }));

    const data = [];

    for (const tick of tickPdas) {
      try {
        data.push(await this.program.account.tick.fetch(tick));
      } catch (error) {
        data.push(null);
      }
    }

    return data;
  }

  async readTickHasDebtArray({
    vaultId,
    index,
  }: {
    vaultId: number;
    index: number;
  }) {
    const tickPda = this.get_tick_has_debt({ vaultId, index });

    try {
      return await this.program.account.tickHasDebtArray.fetch(tickPda);
    } catch (error) {
      return null;
    }
  }

  async readBranch({
    vaultId,
    branchId,
    pda,
  }: {
    vaultId: number;
    branchId: number;
    pda?: PublicKey;
  }) {
    const branchPda = pda || this.get_branch({ vaultId, branchId });

    try {
      return await this.program.account.branch.fetch(branchPda);
    } catch (error) {
      return null;
    }
  }

  async readTickIdLiquidation({
    vaultId,
    tick,
    totalIds,
  }: {
    vaultId: number;
    tick: number;
    totalIds: number;
  }) {
    const tickIdLiquidationPda = this.get_tick_id_liquidation({
      vaultId,
      tick,
      totalIds,
    });

    try {
      return await this.program.account.tickIdLiquidation.fetch(
        tickIdLiquidationPda
      );
    } catch (error) {
      return null;
    }
  }

  async readMultipleTickIdLiquidation({
    vaultId,
    data,
  }: {
    vaultId: number;
    data: {
      tick: number;
      totalIds: number;
    }[];
  }) {
    const tickIdLiquidationPdas = data.map(({ tick, totalIds }) =>
      this.get_tick_id_liquidation({ vaultId, tick, totalIds })
    );

    const datas = [];

    for (const tickIdLiquidationPda of tickIdLiquidationPdas) {
      try {
        datas.push(
          await this.program.account.tickIdLiquidation.fetch(
            tickIdLiquidationPda
          )
        );
      } catch (error) {
        datas.push(null);
      }
    }

    return datas;
  }

  async readUserFinalPosition({
    vaultId,
    positionId,
    newColAmount = new BN(0),
    newDebtAmount = new BN(0),
  }: {
    vaultId: number;
    positionId: number;
    newColAmount: BN;
    newDebtAmount: BN;
  }): Promise<{
    tick: number;
    tickId: number;
    colRaw: BN;
    debtRaw: BN;
    dustDebtRaw: BN;
    finalAmount: BN;
    isSupplyOnlyPosition: boolean;
  }> {
    // First, get the current position before any operations
    const position = await this.readUserPosition({ vaultId, positionId });

    if (!position) {
      throw new Error("Position not found");
    }

    // Get the current position state
    let currentPosition = await this.getCurrentPositionState({
      vaultId,
      position,
    });

    // If operation amounts are provided, apply them to get the final position
    if (!newColAmount.eq(new BN(0)) || !newDebtAmount.eq(new BN(0))) {
      // Calculate the final position after applying operation amounts
      return await this.calculateFinalPosition({
        vaultId,
        currentPosition,
        newColAmount,
        newDebtAmount,
      });
    }

    return currentPosition;
  }

  async getCurrentPositionState({
    vaultId,
    position,
  }: {
    vaultId: number;
    position: UserPosition;
  }): Promise<UserPositionWithDebt> {
    // Handle initial tick conversion
    let positionTick = position.tick;
    if (positionTick === this.INIT_TICK) {
      positionTick = this.MIN_TICK;
    }

    // If it's a supply position (position type = true), return simple supply position
    if (position.isSupplyOnlyPosition) {
      return {
        tick: this.MIN_TICK,
        tickId: 0,
        colRaw: position.supplyAmount.clone(),
        finalAmount: position.supplyAmount.clone(),
        debtRaw: new BN(0),
        dustDebtRaw: new BN(0),
        isSupplyOnlyPosition: true,
      };
    }

    let colRaw = position.supplyAmount.clone();
    let dustDebtRaw = position.dustDebtAmount.clone();
    let debtRaw: BN;

    // Calculate debt based on position's tick and collateral (FIXED to match Rust exactly)
    if (positionTick > this.MIN_TICK) {
      const collateralForDebtCalc = colRaw.add(new BN(1));

      // Fetch debt based on tick ratio and collateral
      // This matches: ratio.safe_mul(collateral_for_debt_calc >> TickMath::SHIFT)?
      // Which means: ratio * (collateral >> 48)
      const ratio = this.getRatioAtTick(positionTick);
      debtRaw = ratio
        .mul(collateralForDebtCalc)
        .shrn(48) // Then multiply ratio by shifted collateral
        .add(new BN(1)); // Round up
    } else {
      debtRaw = new BN(0);
    }

    // Check if position might be liquidated
    if (positionTick > this.MIN_TICK) {
      const tickData = await this.readTick({ vaultId, tick: positionTick });

      if (!tickData) {
        throw new Error("Tick data not found");
      }

      // Check if position was liquidated
      if (tickData.isLiquidated || tickData.totalIds > position.tickId) {
        try {
          let tickIdData = await this.readTickIdLiquidation({
            vaultId,
            tick: positionTick,
            totalIds: position.tickId,
          });

          if (!tickIdData) {
            tickIdData = {
              vaultId: vaultId,
              tick: positionTick,
              tickMap: position.tickId,
              isFullyLiquidated1: 0,
              liquidationBranchId1: 0,
              debtFactor1: new BN(0),
              isFullyLiquidated2: 0,
              liquidationBranchId2: 0,
              debtFactor2: new BN(0),
              isFullyLiquidated3: 0,
              liquidationBranchId3: 0,
              debtFactor3: new BN(0),
            };
          }

          const branches = await this.getAllBranches({ vaultId });

          const { isFullyLiquidated, branchId, connectionFactor } =
            this.getLiquidationStatus(position.tickId, tickData, tickIdData);

          if (isFullyLiquidated) {
            return {
              tick: this.MIN_TICK,
              tickId: 0,
              colRaw: new BN(0),
              debtRaw: new BN(0),
              dustDebtRaw: new BN(0),
              finalAmount: new BN(0),
              isSupplyOnlyPosition: true,
            };
          }

          // Process branches to get final position
          const { finalTick, finalColRaw, finalDebtRaw } =
            await this.processLiquidatedPosition({
              branches,
              branchId,
              initialConnectionFactor: connectionFactor,
              initialDebtRaw: debtRaw,
            });

          const netDebtRaw = finalDebtRaw.gt(dustDebtRaw)
            ? finalDebtRaw.sub(dustDebtRaw)
            : new BN(0);

          return {
            tick: finalTick,
            tickId: position.tickId,
            colRaw: finalColRaw,
            debtRaw: finalDebtRaw,
            dustDebtRaw: dustDebtRaw,
            finalAmount: netDebtRaw.gt(new BN(0)) ? finalColRaw : new BN(0),
            isSupplyOnlyPosition: finalTick === this.MIN_TICK,
          };
        } catch (error) {
          throw new Error(
            `Error processing liquidated position: ${error.message}`
          );
        }
      }
    }

    // Position is not liquidated, return current state
    const netDebtRaw = debtRaw.gt(dustDebtRaw)
      ? debtRaw.sub(dustDebtRaw)
      : new BN(0);

    return {
      tick: positionTick,
      tickId: position.tickId,
      colRaw,
      debtRaw,
      dustDebtRaw,
      finalAmount: netDebtRaw.gt(new BN(0)) ? colRaw : new BN(0),
      isSupplyOnlyPosition: positionTick === this.MIN_TICK,
    };
  }

  async getExchangePrices({
    vaultId,
    vaultConfig,
  }: {
    vaultId: number;
    vaultConfig: any;
  }) {
    const { raw } = await this.program.methods
      .getExchangePrices()
      .accounts({
        vaultState: this.get_vault_state({ vaultId }),
        vaultConfig: this.get_vault_config({ vaultId }),
        supplyTokenReserves: this.get_reserve({
          mint: MintInfo.getMintForToken(vaultConfig.supplyToken) as MintKeys,
        }),
        borrowTokenReserves: this.get_reserve({
          mint: MintInfo.getMintForToken(vaultConfig.borrowToken) as MintKeys,
        }),
      })
      .simulate();

    const returnLog = raw?.find((log) => log.startsWith("Program return:"));
    if (!returnLog) {
      throw new Error("No return data found in logs");
    }

    const base64Data = returnLog.split(" ")[3];

    const buffer = Buffer.from(base64Data, "base64");

    const liquiditySupplyExchangePrice = new BN(buffer.subarray(0, 16), "le"); // little-endian
    const liquidityBorrowExchangePrice = new BN(buffer.subarray(16, 32), "le");
    const vaultSupplyExchangePrice = new BN(buffer.subarray(32, 48), "le");
    const vaultBorrowExchangePrice = new BN(buffer.subarray(48, 64), "le");

    return {
      liquiditySupplyExchangePrice,
      liquidityBorrowExchangePrice,
      vaultSupplyExchangePrice,
      vaultBorrowExchangePrice,
    };
  }

  // Helper method to calculate the final position after applying operation amounts
  async calculateFinalPosition({
    vaultId,
    currentPosition,
    newColAmount,
    newDebtAmount,
    vaultResolver,
  }: {
    vaultId: number;
    currentPosition: UserPositionWithDebt;
    newColAmount: BN;
    newDebtAmount: BN;
    vaultResolver?: TestVaultResolver;
  }): Promise<UserPositionWithDebt> {
    const vaultConfig = await this.readVaultConfig({ vaultId });
    const vaultState = await this.readVaultState({ vaultId });

    if (!vaultConfig || !vaultState) {
      throw new Error("Vault config or state not found");
    }

    let supplyExPrice = new BN(0);
    let borrowExPrice = new BN(0);

    if (process.env.TEST_MODE_JEST === "true") {
      const { vaultSupplyExchangePrice, vaultBorrowExchangePrice } =
        await vaultResolver.updateExchangePrices(
          MintInfo.getMintForToken(vaultConfig.supplyToken) as MintKeys,
          MintInfo.getMintForToken(vaultConfig.borrowToken) as MintKeys,
          vaultState.liquiditySupplyExchangePrice.clone(),
          vaultState.liquidityBorrowExchangePrice.clone(),
          vaultState.vaultSupplyExchangePrice.clone(),
          vaultState.vaultBorrowExchangePrice.clone(),
          new BN(vaultConfig.supplyRateMagnifier),
          new BN(vaultConfig.borrowRateMagnifier),
          vaultState.lastUpdateTimestamp.clone()
        );

      supplyExPrice = vaultSupplyExchangePrice.clone();
      borrowExPrice = vaultBorrowExchangePrice.clone();
    } else {
      const { vaultSupplyExchangePrice, vaultBorrowExchangePrice } =
        await this.getExchangePrices({ vaultId, vaultConfig });

      supplyExPrice = vaultSupplyExchangePrice.clone();
      borrowExPrice = vaultBorrowExchangePrice.clone();
    }

    const borrowFee = vaultConfig.borrowFee;

    let { colRaw, debtRaw, dustDebtRaw } = currentPosition;

    // Apply supply/withdraw operations
    if (newColAmount.gt(new BN(0))) {
      // Supply - add collateral (rounding down for supply)
      const supplyRaw = newColAmount
        .mul(this.EXCHANGE_PRICES_PRECISION)
        .div(supplyExPrice);

      colRaw = colRaw.add(supplyRaw);
    } else if (newColAmount.lt(new BN(0))) {
      let withdrawRaw = new BN(0);
      if (newColAmount.gt(this.MIN_I128)) {
        // Partial withdraw: round up to remove extra wei from collateral
        withdrawRaw = divCeil(
          newColAmount.abs().mul(this.EXCHANGE_PRICES_PRECISION),
          supplyExPrice
        );

        colRaw = colRaw.sub(withdrawRaw);
      } else if (newColAmount.eq(this.MIN_I128)) {
        withdrawRaw = colRaw
          .mul(supplyExPrice)
          .div(this.EXCHANGE_PRICES_PRECISION)
          .mul(new BN(-1))
          .add(new BN(1));

        colRaw = new BN(0);
      } else {
        throw new Error("Invalid newColAmount");
      }
    }

    // Apply borrow/payback operations (FIXED to match Rust exactly)
    if (newDebtAmount.gt(new BN(0))) {
      // Borrow - add debt (rounding up for borrow to be conservative)
      const borrowRaw = divCeil(
        newDebtAmount.mul(this.EXCHANGE_PRICES_PRECISION),
        borrowExPrice
      );

      // M-04 Borrow fee rounds down in vaults
      const feeAmount = divCeil(
        borrowRaw.mul(new BN(borrowFee)),
        new BN(10000)
      );
      const borrowAmountWithFee = borrowRaw.add(feeAmount);

      debtRaw = debtRaw.add(borrowAmountWithFee);
    } else if (newDebtAmount.lt(new BN(0))) {
      if (newDebtAmount.gt(this.MIN_I128)) {
        // Partial payback: round down then subtract 1 to reduce payback slightly
        let payback_amount = newDebtAmount
          .abs()
          .mul(this.EXCHANGE_PRICES_PRECISION)
          .div(borrowExPrice)
          .sub(new BN(1));

        debtRaw = debtRaw.sub(payback_amount);
      } else if (newDebtAmount.eq(this.MIN_I128)) {
        // max payback, rounding up amount that will be transferred in to pay back full debt:
        // subtracting -1 of negative debtAmount newDebt_ for safe rounding (increasing payback)
        let payback_amount = divCeil(
          debtRaw.mul(borrowExPrice),
          this.EXCHANGE_PRICES_PRECISION
        ).mul(new BN(-1));

        debtRaw = new BN(0);
      } else {
        throw new Error("Invalid newDebtAmount");
      }
    }

    // Calculate net debt (debt minus dust debt)
    const netDebtRaw = debtRaw.gt(dustDebtRaw)
      ? debtRaw.sub(dustDebtRaw)
      : new BN(0);

    // Determine final tick based on debt and collateral
    let finalTick: number;
    let isSupplyOnlyPosition: boolean;

    if (netDebtRaw.eq(new BN(0)) || colRaw.eq(new BN(0))) {
      // No net debt or no collateral - position is a supply position
      finalTick = this.MIN_TICK;
      isSupplyOnlyPosition = true;
    } else {
      const marginAdjustedDebt = netDebtRaw
        .mul(new BN(1000000001))
        .div(new BN(1000000000))
        .add(new BN(1));

      const ratio = marginAdjustedDebt
        .mul(this.ZERO_TICK_SCALED_RATIO)
        .div(colRaw);

      const baseTickAtRatio = this.getTickAtRatio(ratio);
      const ratioAtTick = this.getRatioAtTick(baseTickAtRatio);

      finalTick = baseTickAtRatio + 1;

      const ratioNew = ratioAtTick.mul(this.TICK_SPACING).div(new BN(10000));

      // Ensure final tick is within bounds
      if (finalTick < this.MIN_TICK) {
        finalTick = this.MIN_TICK;
      } else if (finalTick > this.MAX_TICK) {
        finalTick = this.MAX_TICK;
      }

      isSupplyOnlyPosition = false;
    }

    return {
      tick: finalTick,
      tickId: currentPosition.tickId,
      colRaw,
      debtRaw,
      dustDebtRaw,
      finalAmount: netDebtRaw.gt(new BN(0)) ? colRaw : new BN(0),
      isSupplyOnlyPosition,
    };
  }

  // Helper to get ratio at a specific tick (matches Rust TickMath exactly)
  getRatioAtTick(tick: number): BN {
    if (tick < this.MIN_TICK || tick > this.MAX_TICK) {
      throw new Error(
        `Tick ${tick} out of range [${this.MIN_TICK}, ${this.MAX_TICK}]`
      );
    }

    // Rust TickMath constants (using string representation for large numbers)
    const FACTOR00 = new BN("18446744073709551616"); // 2^64
    const FACTOR01 = new BN("18419115400608638658"); // 2^64/1.0015**1
    const FACTOR02 = new BN("18391528108445969703"); // 2^64/1.0015**2
    const FACTOR03 = new BN("18336477419114433396"); // 2^64/1.0015**4
    const FACTOR04 = new BN("18226869890870665593"); // 2^64/1.0015**8
    const FACTOR05 = new BN("18009616477100071088"); // 2^64/1.0015**16
    const FACTOR06 = new BN("17582847377087825313"); // 2^64/1.0015**32
    const FACTOR07 = new BN("16759408633341240198"); // 2^64/1.0015**64
    const FACTOR08 = new BN("15226414841393184936"); // 2^64/1.0015**128
    const FACTOR09 = new BN("12568272644527235157"); // 2^64/1.0015**256
    const FACTOR10 = new BN("8563108841104354677"); // 2^64/1.0015**512
    const FACTOR11 = new BN("3975055583337633975"); // 2^64/1.0015**1024
    const FACTOR12 = new BN("856577552520149366"); // 2^64/1.0015**2048
    const FACTOR13 = new BN("39775317560084773"); // 2^64/1.0015**4096
    const FACTOR14 = new BN("85764505686420"); // 2^64/1.0015**8192
    const FACTOR15 = new BN("398745188"); // 2^64/1.0015**16384

    const absTick = Math.abs(tick);
    let factor = FACTOR00;

    // Binary calculation exactly like Rust
    if (absTick & 0x1) factor = FACTOR01;
    if (absTick & 0x2) factor = this.mulShift64(factor, FACTOR02);
    if (absTick & 0x4) factor = this.mulShift64(factor, FACTOR03);
    if (absTick & 0x8) factor = this.mulShift64(factor, FACTOR04);
    if (absTick & 0x10) factor = this.mulShift64(factor, FACTOR05);
    if (absTick & 0x20) factor = this.mulShift64(factor, FACTOR06);
    if (absTick & 0x40) factor = this.mulShift64(factor, FACTOR07);
    if (absTick & 0x80) factor = this.mulShift64(factor, FACTOR08);
    if (absTick & 0x100) factor = this.mulShift64(factor, FACTOR09);
    if (absTick & 0x200) factor = this.mulShift64(factor, FACTOR10);
    if (absTick & 0x400) factor = this.mulShift64(factor, FACTOR11);
    if (absTick & 0x800) factor = this.mulShift64(factor, FACTOR12);
    if (absTick & 0x1000) factor = this.mulShift64(factor, FACTOR13);
    if (absTick & 0x2000) factor = this.mulShift64(factor, FACTOR14);
    if (absTick & 0x4000) factor = this.mulShift64(factor, FACTOR15);

    let precision = new BN(0);

    if (tick > 0) {
      const maxU128 = new BN(2).pow(new BN(128)).sub(new BN(1));
      factor = maxU128.div(factor);

      if (!factor.mod(new BN(0x10000)).isZero()) {
        precision = new BN(1);
      }
    }

    const ratioX48 = factor.shrn(16).add(precision);
    return ratioX48;
  }

  // Helper function for mul_shift_64 operation (more robust implementation)
  private mulShift64(n0: BN, n1: BN): BN {
    try {
      return n0.mul(n1).shrn(64);
    } catch (error) {
      // Fallback for very large numbers
      const product = n0.mul(n1);
      return product.div(new BN(2).pow(new BN(64)));
    }
  }

  // Helper to get tick from ratio (matches Rust TickMath exactly)
  getTickAtRatio(ratioX48: BN): number {
    const MIN_RATIOX48 = new BN(6093);
    const MAX_RATIOX48 = new BN("13002088133096036565414295");
    const _1E13 = new BN("10000000000000");

    if (ratioX48.lt(MIN_RATIOX48) || ratioX48.gt(MAX_RATIOX48)) {
      throw new Error(`Ratio ${ratioX48.toString()} out of bounds`);
    }

    const isNegative = ratioX48.lt(this.ZERO_TICK_SCALED_RATIO);
    let factor: BN;

    if (isNegative) {
      // For ratios < 1 (negative ticks)
      factor = this.ZERO_TICK_SCALED_RATIO.mul(_1E13).div(ratioX48);
    } else {
      // For ratios >= 1 (positive ticks)
      factor = ratioX48.mul(_1E13).div(this.ZERO_TICK_SCALED_RATIO);
    }

    let tick = 0;

    // Binary search through powers of 2 - exactly like Rust
    if (factor.gte(new BN("2150859953785115391"))) {
      tick |= 0x2000;
      factor = factor.mul(_1E13).div(new BN("2150859953785115391"));
    }
    if (factor.gte(new BN("4637736467054931"))) {
      tick |= 0x1000;
      factor = factor.mul(_1E13).div(new BN("4637736467054931"));
    }
    if (factor.gte(new BN("215354044936586"))) {
      tick |= 0x800;
      factor = factor.mul(_1E13).div(new BN("215354044936586"));
    }
    if (factor.gte(new BN("46406254420777"))) {
      tick |= 0x400;
      factor = factor.mul(_1E13).div(new BN("46406254420777"));
    }
    if (factor.gte(new BN("21542110950596"))) {
      tick |= 0x200;
      factor = factor.mul(_1E13).div(new BN("21542110950596"));
    }
    if (factor.gte(new BN("14677230989051"))) {
      tick |= 0x100;
      factor = factor.mul(_1E13).div(new BN("14677230989051"));
    }
    if (factor.gte(new BN("12114962232319"))) {
      tick |= 0x80;
      factor = factor.mul(_1E13).div(new BN("12114962232319"));
    }
    if (factor.gte(new BN("11006798913544"))) {
      tick |= 0x40;
      factor = factor.mul(_1E13).div(new BN("11006798913544"));
    }
    if (factor.gte(new BN("10491329235871"))) {
      tick |= 0x20;
      factor = factor.mul(_1E13).div(new BN("10491329235871"));
    }
    if (factor.gte(new BN("10242718992470"))) {
      tick |= 0x10;
      factor = factor.mul(_1E13).div(new BN("10242718992470"));
    }
    if (factor.gte(new BN("10120631893548"))) {
      tick |= 0x8;
      factor = factor.mul(_1E13).div(new BN("10120631893548"));
    }
    if (factor.gte(new BN("10060135135051"))) {
      tick |= 0x4;
      factor = factor.mul(_1E13).div(new BN("10060135135051"));
    }
    if (factor.gte(new BN("10030022500000"))) {
      tick |= 0x2;
      factor = factor.mul(_1E13).div(new BN("10030022500000"));
    }
    if (factor.gte(new BN("10015000000000"))) {
      tick |= 0x1;
    }

    if (isNegative) {
      tick = ~tick;
    }

    return tick;
  }

  getLiquidationStatus(
    positionTickId: number,
    tickData: any,
    tickIdData: any
  ): {
    isFullyLiquidated: boolean;
    branchId: number;
    connectionFactor: BN;
  } {
    let isFullyLiquidated: boolean;
    let branchId: number;
    let connectionFactor: BN;

    // Check if tick's total ID = user's tick ID
    if (tickData.totalIds === positionTickId) {
      // Get from tick data
      isFullyLiquidated = tickData.isFullyLiquidated === 1;
      branchId = tickData.liquidationBranchId;
      connectionFactor = tickData.debtFactor;
    } else {
      // Get from tick ID liquidation data
      // Find which set of liquidation data to use based on positionTickId
      const setIndex = (positionTickId + 2) % 3;

      switch (setIndex) {
        case 0:
          isFullyLiquidated = tickIdData.isFullyLiquidated1;
          branchId = tickIdData.liquidationBranchId1;
          connectionFactor = tickIdData.debtFactor1;
          break;
        case 1:
          isFullyLiquidated = tickIdData.isFullyLiquidated2;
          branchId = tickIdData.liquidationBranchId2;
          connectionFactor = tickIdData.debtFactor2;
          break;
        default:
          isFullyLiquidated = tickIdData.isFullyLiquidated3;
          branchId = tickIdData.liquidationBranchId3;
          connectionFactor = tickIdData.debtFactor3;
      }
    }

    return { isFullyLiquidated, branchId, connectionFactor };
  }

  // Check if user is ~100% liquidated
  MAX_MASK_DEBT_FACTOR = new BN("1125899906842623");

  async processLiquidatedPosition({
    branches,
    branchId,
    initialConnectionFactor,
    initialDebtRaw,
  }: {
    branches: any[];
    branchId: number;
    initialConnectionFactor: BN;
    initialDebtRaw: BN;
  }): Promise<{ finalTick: number; finalColRaw: BN; finalDebtRaw: BN }> {
    let finalColRaw: BN = new BN(0);
    let finalTick: number;

    const branchMap = new Map(
      branches.map((branch) => [branch.branchId, branch])
    );

    let currentBranchId = branchId;
    let currentConnectionFactor = initialConnectionFactor;

    let currentBranch = branchMap.get(currentBranchId);
    if (!currentBranch) {
      throw new Error(`Branch ${currentBranchId} not found`);
    }

    // Follow branch connections until we reach a non-merged branch
    while (currentBranch.status === 2) {
      // Merged branch - multiply connection factors
      currentConnectionFactor = this.mulBigNumber(
        currentConnectionFactor,
        currentBranch.debtFactor.clone()
      );

      if (currentConnectionFactor.eq(this.MAX_MASK_DEBT_FACTOR)) {
        break;
      }

      // Get next branch
      currentBranchId = currentBranch.connectedBranchId;
      currentBranch = branchMap.get(currentBranchId);

      if (!currentBranch) {
        throw new Error(`Connected branch ${currentBranchId} not found`);
      }
    }

    let positionDebtRaw: BN = new BN(0);

    // Check if branch is closed or user is ~100% liquidated
    if (
      currentBranch.status === 3 ||
      currentConnectionFactor.eq(this.MAX_MASK_DEBT_FACTOR)
    ) {
      // Branch is closed or user is fully liquidated
      positionDebtRaw = new BN(0);
      finalTick = this.MIN_TICK;
    } else {
      positionDebtRaw = this.mulDivNormal(
        initialDebtRaw,
        currentBranch.debtFactor,
        currentConnectionFactor
      );

      // Apply liquidation reduction (positions lose some debt when liquidated)
      if (positionDebtRaw.gt(initialDebtRaw.div(new BN(100)))) {
        positionDebtRaw = positionDebtRaw.mul(new BN(9999)).div(new BN(10000));
      } else {
        positionDebtRaw = new BN(0);
      }

      if (positionDebtRaw.gt(new BN(0))) {
        // Calculate position at branch's minima tick with partials
        finalTick = currentBranch.minimaTick;
        const ratioAtTick = this.getRatioAtTick(finalTick);
        const ratioOneLess = ratioAtTick
          .mul(new BN(10000))
          .div(this.TICK_SPACING);

        const ratioLength = ratioAtTick.sub(ratioOneLess);
        const finalRatio = ratioOneLess.add(
          ratioLength
            .mul(new BN(currentBranch.minimaTickPartials))
            .div(this.X30)
        );

        finalColRaw = positionDebtRaw
          .mul(this.ZERO_TICK_SCALED_RATIO)
          .div(finalRatio);
      } else finalTick = this.MIN_TICK;
    }

    return {
      finalTick,
      finalColRaw,
      finalDebtRaw: positionDebtRaw,
    };
  }

  mulBigNumber(a: BN, b: BN): BN {
    return mulBigNumber(a, b);
  }

  mulDivNormal(normal: BN, bigNumber1: BN, bigNumber2: BN): BN {
    return mulDivNormal(normal, bigNumber1, bigNumber2);
  }

  async getAllBranches({ vaultId }: { vaultId: number }) {
    const vaultState = await this.readVaultState({ vaultId });

    if (!vaultState) {
      throw new Error("Vault state not found");
    }

    const branches = [];
    for (let i = 0; i <= vaultState.totalBranchId; i++) {
      try {
        const branch = await this.readBranch({ vaultId, branchId: i });
        if (branch) {
          branches.push(branch);
        }
      } catch (error) {
        // Ignore errors for branches that don't exist
        console.warn(`Branch ${i} not found or error:`, error);
      }
    }

    return branches;
  }

  // helper function for testing
  // Given a tick, calculate the ratio of netDebtRaw to colRaw
  getRatioFromTick(tick: number): {
    // Returns the ratio such that: netDebtRaw / colRaw = ratio
    getDebtToCollateralRatio: () => BN;
    // Given colRaw, calculate what netDebtRaw should be
    calculateNetDebtFromCollateral: (colRaw: BN) => BN;
    // Given netDebtRaw, calculate what colRaw should be
    calculateCollateralFromNetDebt: (netDebtRaw: BN) => BN;
  } {
    // Get the ratio at the given tick
    const ratioAtTick = this.getRatioAtTick(tick);

    // Apply the tick spacing adjustment (this matches the forward calculation)
    const adjustedRatio = ratioAtTick.mul(this.TICK_SPACING).div(new BN(10000));

    // The relationship is: adjustedRatio = marginAdjustedDebt * ZERO_TICK_SCALED_RATIO / colRaw
    // Where: marginAdjustedDebt = netDebtRaw * 1000000001 / 1000000000 + 1

    return {
      getDebtToCollateralRatio: (): BN => {
        // This gives you the raw ratio from the tick calculation
        return adjustedRatio
          .mul(new BN(1000000000))
          .div(this.ZERO_TICK_SCALED_RATIO.mul(new BN(1000000001)));
      },

      calculateNetDebtFromCollateral: (colRaw: BN): BN => {
        // Given collateral, calculate the net debt
        // adjustedRatio = marginAdjustedDebt * ZERO_TICK_SCALED_RATIO / colRaw
        // marginAdjustedDebt = adjustedRatio * colRaw / ZERO_TICK_SCALED_RATIO
        const marginAdjustedDebt = adjustedRatio
          .mul(colRaw)
          .div(this.ZERO_TICK_SCALED_RATIO);

        // Reverse the margin adjustment: marginAdjustedDebt = netDebtRaw * 1000000001 / 1000000000 + 1
        // netDebtRaw = (marginAdjustedDebt - 1) * 1000000000 / 1000000001
        if (marginAdjustedDebt.lte(new BN(1))) {
          return new BN(0);
        }

        const netDebtRaw = marginAdjustedDebt
          .sub(new BN(1))
          .mul(new BN(1000000000))
          .div(new BN(1000000001));

        return netDebtRaw;
      },

      calculateCollateralFromNetDebt: (netDebtRaw: BN): BN => {
        // Given net debt, calculate the required collateral
        // First apply margin adjustment
        const marginAdjustedDebt = netDebtRaw
          .mul(new BN(1000000001))
          .div(new BN(1000000000))
          .add(new BN(1));

        // adjustedRatio = marginAdjustedDebt * ZERO_TICK_SCALED_RATIO / colRaw
        // colRaw = marginAdjustedDebt * ZERO_TICK_SCALED_RATIO / adjustedRatio
        const colRaw = marginAdjustedDebt
          .mul(this.ZERO_TICK_SCALED_RATIO)
          .div(adjustedRatio);

        return colRaw;
      },
    };
  }
}
