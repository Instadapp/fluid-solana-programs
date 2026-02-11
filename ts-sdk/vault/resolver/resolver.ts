import { BN, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import { PDA } from "../context/pda";
import { tickMath } from "../math/tickMath";
import { Vaults } from "../../../target/types/vaults";
import { Oracle } from "../../../target/types/oracle";
import oracleJson from "../../../target/idl/oracle.json";
import { mulDivNormal, mulBigNumber } from "../../bigNumberMinified";
import { divCeil } from "../../util";
import {
  UserPosition,
  UserPositionWithDebt,
  NftPosition,
  VaultConfig,
} from "./types";
import { MintKeys, mint as MintInfo } from "../../mint";
import { connection } from "../../connection";

import {
  VaultEntireData,
  ConstantViews,
  Configs,
  ExchangePricesAndRates,
  TotalSupplyAndBorrow,
  LimitsAndAvailability,
  VaultState,
} from "./types";
import { UserSupplyData, UserBorrowData } from "../../liquidity/resolver/types";
import { FluidLiquidityResolver } from "../../liquidity/resolver/resolver";
import {
  unpackAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { readableConsoleDump } from "../../util";

export class State extends PDA {
  EXCHANGE_PRICES_PRECISION = new BN(10).pow(new BN(12)); // 1e12
  X30 = new BN(0x3fffffff);
  MIN_I128 = new BN("170141183460469231731687303715884105728").neg();
  // Check if user is ~100% liquidated
  MAX_MASK_DEBT_FACTOR = new BN("1125899906842623");

  oracle: Program<Oracle>;

  constructor(authority: Keypair, program: Program<Vaults>) {
    super(authority, program);

    this.oracle = new Program<Oracle>(oracleJson, program.provider);
  }

  async readVaultAdmin() {
    const vaultAdminPda = this.get_vault_admin();

    try {
      return await this.program.account.vaultAdmin.fetch(vaultAdminPda);
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

  async readVaultMetadata({ vaultId }: { vaultId: number }) {
    const vaultMetadataPda = this.get_vault_metadata({ vaultId });

    try {
      return await this.program.account.vaultMetadata.fetch(vaultMetadataPda);
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

  async readOraclePrice(oracle: PublicKey) {
    const oracleData = await this.oracle.account.oracle.fetch(oracle);

    let remaining_accounts: any[] = [];

    for (const source of oracleData.sources) {
      remaining_accounts.push({
        pubkey: source.source,
        isWritable: false,
        isSigner: false,
      });
    }

    const [operatePrice, liquidatePrice] = await Promise.all([
      this.oracle.methods
        .getExchangeRateOperate(oracleData.nonce)
        .accounts({ oracle })
        .remainingAccounts(remaining_accounts)
        .view(),
      this.oracle.methods
        .getExchangeRateLiquidate(oracleData.nonce)
        .accounts({ oracle })
        .remainingAccounts(remaining_accounts)
        .view(),
    ]);

    return {
      operatePrice: operatePrice.toString(),
      liquidatePrice: liquidatePrice.toString(),
    };
  }
}

export class Resolver extends State {
  liquidityResolver: FluidLiquidityResolver;

  constructor(
    authority: Keypair,
    program: Program<Vaults>,
    liquidityResolver: FluidLiquidityResolver
  ) {
    super(authority, program);
    this.liquidityResolver = liquidityResolver;
  }

  async getFinalPosition({
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
    const position = await this.readUserPosition({ vaultId, positionId });

    if (!position) {
      throw new Error("Position not found");
    }

    let currentPosition = await this.getCurrentPositionState({
      vaultId,
      position,
    });

    if (!newColAmount.eq(new BN(0)) || !newDebtAmount.eq(new BN(0))) {
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
    let positionTick = position.tick;
    if (positionTick === tickMath.INIT_TICK) {
      positionTick = tickMath.MIN_TICK;
    }

    if (position.isSupplyOnlyPosition) {
      return {
        tick: tickMath.MIN_TICK,
        tickId: 0,
        colRaw: position.supplyAmount.clone(),
        finalAmount: position.supplyAmount.clone(),
        debtRaw: new BN(0),
        dustDebtRaw: new BN(0),
        isSupplyOnlyPosition: true,
        postLiquidationBranchId: 0,
      };
    }

    let postLiquidationBranchId = 0;

    let debtRaw: BN;
    let colRaw = position.supplyAmount.clone();
    let dustDebtRaw = position.dustDebtAmount.clone();

    if (positionTick > tickMath.MIN_TICK) {
      const collateralForDebtCalc = colRaw.add(new BN(1));

      const ratio = tickMath.getRatioAtTick(positionTick);
      debtRaw = ratio.mul(collateralForDebtCalc).shrn(48).add(new BN(1));
    } else {
      debtRaw = new BN(0);
    }

    let userLiquidationStatus = false;

    if (positionTick > tickMath.MIN_TICK) {
      const tickData = await this.readTick({ vaultId, tick: positionTick });

      if (!tickData) {
        throw new Error("Tick data not found");
      }

      if (tickData.isLiquidated || tickData.totalIds > position.tickId) {
        userLiquidationStatus = true;

        try {
          const tickIdData = await this.readTickIdLiquidation({
            vaultId,
            tick: positionTick,
            totalIds: position.tickId,
          });

          const branches = await this.getAllBranches({ vaultId });

          const { isFullyLiquidated, branchId, connectionFactor } =
            this.getLiquidationStatus(position.tickId, tickData, tickIdData);

          postLiquidationBranchId = branchId;

          if (isFullyLiquidated) {
            return {
              tick: tickMath.MIN_TICK,
              tickId: 0,
              colRaw: new BN(0),
              debtRaw: new BN(0),
              dustDebtRaw: new BN(0),
              finalAmount: new BN(0),
              isSupplyOnlyPosition: true,
              postLiquidationBranchId: postLiquidationBranchId,
            };
          }

          // Process branches to get final position
          const { finalTick, finalColRaw, finalDebtRaw } =
            await this.processLiquidatedPosition({
              branches,
              branchId: postLiquidationBranchId,
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
            isSupplyOnlyPosition: finalTick === tickMath.MIN_TICK,
            postLiquidationBranchId,
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
      isSupplyOnlyPosition: positionTick === tickMath.MIN_TICK,
      userLiquidationStatus,
      postLiquidationBranchId,
    };
  }

  async calculateFinalPosition({
    vaultId,
    currentPosition,
    newColAmount,
    newDebtAmount,
  }: {
    vaultId: number;
    currentPosition: UserPositionWithDebt;
    newColAmount: BN;
    newDebtAmount: BN;
  }): Promise<UserPositionWithDebt> {
    const vaultConfig = await this.readVaultConfig({ vaultId });
    const vaultState = await this.readVaultState({ vaultId });

    if (!vaultConfig || !vaultState) {
      throw new Error("Vault config or state not found");
    }

    const {
      vaultSupplyExchangePrice: supplyExPrice,
      vaultBorrowExchangePrice: borrowExPrice,
    } = await this.updateExchangePrices(
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

    // Apply borrow/payback operations
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

    const netDebtRaw = debtRaw.gt(dustDebtRaw)
      ? debtRaw.sub(dustDebtRaw)
      : new BN(0);

    let finalTick: number;
    let isSupplyOnlyPosition: boolean;

    if (netDebtRaw.eq(new BN(0)) || colRaw.eq(new BN(0))) {
      finalTick = tickMath.MIN_TICK;
      isSupplyOnlyPosition = true;
    } else {
      const marginAdjustedDebt = netDebtRaw
        .mul(new BN(1000000001))
        .div(new BN(1000000000))
        .add(new BN(1));

      const ratio = marginAdjustedDebt
        .mul(tickMath.ZERO_TICK_SCALED_RATIO)
        .div(colRaw);

      const baseTickAtRatio = tickMath.getTickAtRatio(ratio);
      const ratioAtTick = tickMath.getRatioAtTick(baseTickAtRatio);

      finalTick = baseTickAtRatio + 1;

      const ratioNew = ratioAtTick
        .mul(tickMath.TICK_SPACING)
        .div(tickMath.FOUR_DECIMALS);

      const userRawDebt = ratioNew.mul(colRaw).shrn(48);

      if (finalTick < tickMath.MIN_TICK) {
        finalTick = tickMath.MIN_TICK;
      } else if (finalTick > tickMath.MAX_TICK) {
        finalTick = tickMath.MAX_TICK;
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

  private getLiquidationStatus(
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

    if (tickData.totalIds === positionTickId) {
      isFullyLiquidated = tickData.isFullyLiquidated === 1;
      branchId = tickData.liquidationBranchId;
      connectionFactor = tickData.debtFactor;
    } else {
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

    while (currentBranch.status === 2) {
      currentConnectionFactor = this.mulBigNumber(
        currentConnectionFactor,
        currentBranch.debtFactor.clone()
      );

      if (currentConnectionFactor.eq(this.MAX_MASK_DEBT_FACTOR)) {
        break;
      }

      currentBranchId = currentBranch.connectedBranchId;
      currentBranch = branchMap.get(currentBranchId);

      if (!currentBranch) {
        throw new Error(`Connected branch ${currentBranchId} not found`);
      }
    }

    let positionDebtRaw: BN = new BN(0);

    if (
      currentBranch.status === 3 ||
      currentConnectionFactor.eq(this.MAX_MASK_DEBT_FACTOR)
    ) {
      positionDebtRaw = new BN(0);
      finalTick = tickMath.MIN_TICK;
    } else {
      positionDebtRaw = this.mulDivNormal(
        initialDebtRaw,
        currentBranch.debtFactor,
        currentConnectionFactor
      );

      if (positionDebtRaw.gt(initialDebtRaw.div(new BN(100)))) {
        positionDebtRaw = positionDebtRaw.mul(new BN(9999)).div(new BN(10000));
      } else {
        positionDebtRaw = new BN(0);
      }

      if (positionDebtRaw.gt(new BN(0))) {
        finalTick = currentBranch.minimaTick;
        const ratioAtTick = tickMath.getRatioAtTick(finalTick);

        const ratioOneLess = ratioAtTick
          .mul(tickMath.FOUR_DECIMALS)
          .div(tickMath.TICK_SPACING);

        const ratioLength = ratioAtTick.sub(ratioOneLess);
        const finalRatio = ratioOneLess.add(
          ratioLength
            .mul(new BN(currentBranch.minimaTickPartials))
            .div(this.X30)
        );

        finalColRaw = positionDebtRaw
          .mul(tickMath.ZERO_TICK_SCALED_RATIO)
          .div(finalRatio);
      } else finalTick = tickMath.MIN_TICK;
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
        if (branch) branches.push(branch);
      } catch (error) {
        console.warn(`Branch ${i} not found or error:`, error);
      }
    }

    return branches;
  }

  private async _getLiquidityExchangePrice(mintKey: MintKeys) {
    const exchangePricesAndConfig =
      await this.liquidityResolver.getExchangePricesAndConfig(mintKey);
    return await this.liquidityResolver.calculateExchangePrice(
      exchangePricesAndConfig
    );
  }

  async _getVaultsConstants(vaultId: number): Promise<ConstantViews> {
    const vaultState = await this.program.account.vaultState.fetch(
      this.get_vault_state({ vaultId })
    );

    const vaultConfig = await this.program.account.vaultConfig.fetch(
      this.get_vault_config({ vaultId })
    );

    return {
      liquidity: this.get_liquidity(),
      supply: this.get_liquidity(),
      borrow: this.get_liquidity(),
      supplyToken: vaultConfig.supplyToken,
      borrowToken: vaultConfig.borrowToken,
      vaultId,
      vaultType: 1,
    };
  }

  async _getVaultsConfigs(vaultId: number): Promise<Configs> {
    const vaultConfig = await this.program.account.vaultConfig.fetch(
      this.get_vault_config({ vaultId })
    );

    return {
      supplyRateMagnifier: new BN(vaultConfig.supplyRateMagnifier),
      borrowRateMagnifier: new BN(vaultConfig.borrowRateMagnifier),
      collateralFactor: new BN(vaultConfig.collateralFactor),
      liquidationThreshold: new BN(vaultConfig.liquidationThreshold),
      liquidationMaxLimit: new BN(vaultConfig.liquidationMaxLimit),
      withdrawalGap: new BN(vaultConfig.withdrawGap),
      liquidationPenalty: new BN(vaultConfig.liquidationPenalty),
      borrowFee: new BN(vaultConfig.borrowFee),
      oracle: vaultConfig.oracle,
      rebalancer: vaultConfig.rebalancer,
    };
  }

  async _getTotalSupplyAndBorrow(
    vaultId: number,
    exchangePricesAndRates: ExchangePricesAndRates,
    liquiditySupply: BN,
    liquidityBorrow: BN
  ): Promise<TotalSupplyAndBorrow> {
    const vaultState = await this.program.account.vaultState.fetch(
      this.get_vault_state({ vaultId })
    );

    const res = {
      totalSupplyVault: new BN(0),
      totalBorrowVault: new BN(0),
      totalSupplyLiquidityOrDex: new BN(0),
      totalBorrowLiquidityOrDex: new BN(0),
      absorbedSupply: new BN(0),
      absorbedBorrow: new BN(0),
    };

    res.totalSupplyVault = vaultState.totalSupply
      .mul(exchangePricesAndRates.vaultSupplyExchangePrice)
      .div(this.EXCHANGE_PRICES_PRECISION);

    res.totalBorrowVault = vaultState.totalBorrow
      .mul(exchangePricesAndRates.vaultBorrowExchangePrice)
      .div(this.EXCHANGE_PRICES_PRECISION);

    res.absorbedSupply = vaultState.absorbedColAmount
      .mul(exchangePricesAndRates.vaultSupplyExchangePrice)
      .div(this.EXCHANGE_PRICES_PRECISION);
    res.absorbedBorrow = vaultState.absorbedDebtAmount
      .mul(exchangePricesAndRates.vaultBorrowExchangePrice)
      .div(this.EXCHANGE_PRICES_PRECISION);

    res.totalSupplyLiquidityOrDex = liquiditySupply;
    res.totalBorrowLiquidityOrDex = liquidityBorrow;

    return res;
  }

  async updateExchangePrices(
    supplyMint: MintKeys,
    borrowMint: MintKeys,
    oldLiquiditySupplyExchangePrice: BN,
    oldLiquidityBorrowExchangePrice: BN,
    vaultSupplyExchangePrice: BN,
    vaultBorrowExchangePrice: BN,
    supplyRateMagnifier: BN,
    borrowRateMagnifier: BN,
    lastUpdateTimestamp: BN
  ) {
    const liquiditySupplyExchangePrice = (
      await this._getLiquidityExchangePrice(supplyMint)
    ).supplyExchangePrice;

    const liquidityBorrowExchangePrice = (
      await this._getLiquidityExchangePrice(borrowMint)
    ).borrowExchangePrice;

    if (
      liquiditySupplyExchangePrice.lt(oldLiquiditySupplyExchangePrice) ||
      liquidityBorrowExchangePrice.lt(oldLiquidityBorrowExchangePrice)
    ) {
      // new liquidity exchange price is < than the old one. liquidity exchange price should only ever increase.
      // If not, something went wrong and avoid proceeding with unknown outcome.
      throw new Error("Vault liquidity exchange price unexpected");
    }

    const vaultSupplyExPriceOld = vaultSupplyExchangePrice;

    const liqSupplyIncreaseInPercent = liquiditySupplyExchangePrice
      .mul(this.EXCHANGE_PRICES_PRECISION)
      .div(oldLiquiditySupplyExchangePrice);

    let updatedVaultSupplyExPrice = vaultSupplyExchangePrice
      .mul(liqSupplyIncreaseInPercent)
      .div(this.EXCHANGE_PRICES_PRECISION);

    const currentTimestamp = new BN(Math.floor(Date.now() / 1000));
    const timeDiff = currentTimestamp.sub(lastUpdateTimestamp);

    if (!supplyRateMagnifier.isZero()) {
      const FOUR_DECIMALS = new BN(10000);
      const SECONDS_PER_YEAR = new BN(31536000); // 365 * 24 * 60 * 60

      const supplyRateChange = vaultSupplyExPriceOld
        .mul(timeDiff)
        .mul(supplyRateMagnifier.abs())
        .div(FOUR_DECIMALS)
        .div(SECONDS_PER_YEAR);

      if (supplyRateMagnifier.gt(new BN(0))) {
        updatedVaultSupplyExPrice =
          updatedVaultSupplyExPrice.add(supplyRateChange);
      } else {
        updatedVaultSupplyExPrice =
          updatedVaultSupplyExPrice.sub(supplyRateChange);
      }
    }

    const vaultBorrowExPriceOld = vaultBorrowExchangePrice;

    const liqBorrowIncreaseInPercent = liquidityBorrowExchangePrice
      .mul(this.EXCHANGE_PRICES_PRECISION)
      .div(oldLiquidityBorrowExchangePrice);

    // M-03 Liquidity and Vaults borrow_exchange_price calculation rounds down
    let updatedVaultBorrowExPrice = divCeil(
      vaultBorrowExchangePrice.mul(liqBorrowIncreaseInPercent),
      this.EXCHANGE_PRICES_PRECISION
    );

    if (!borrowRateMagnifier.isZero()) {
      const FOUR_DECIMALS = new BN(10000);
      const SECONDS_PER_YEAR = new BN(31536000); // 365 * 24 * 60 * 60

      const borrowRateChange = vaultBorrowExPriceOld
        .mul(timeDiff)
        .mul(borrowRateMagnifier.abs())
        .div(FOUR_DECIMALS)
        .div(SECONDS_PER_YEAR);

      if (borrowRateMagnifier.gt(new BN(0))) {
        updatedVaultBorrowExPrice =
          updatedVaultBorrowExPrice.add(borrowRateChange);
      } else {
        updatedVaultBorrowExPrice =
          updatedVaultBorrowExPrice.sub(borrowRateChange);
      }
    }

    return {
      liquiditySupplyExchangePrice,
      liquidityBorrowExchangePrice,
      vaultSupplyExchangePrice: updatedVaultSupplyExPrice,
      vaultBorrowExchangePrice: updatedVaultBorrowExPrice,
    };
  }

  async _getVaultsExchangePricesAndRates(
    vaultId: number,
    liquiditySupplyRate: BN,
    liquidityBorrowRate: BN
  ): Promise<ExchangePricesAndRates> {
    const vaultState = await this.program.account.vaultState.fetch(
      this.get_vault_state({ vaultId })
    );

    const vaultConfig = await this.program.account.vaultConfig.fetch(
      this.get_vault_config({ vaultId })
    );

    // prettier-ignore
    const Res: ExchangePricesAndRates = {
      lastStoredLiquiditySupplyExchangePrice: new BN(vaultState.liquiditySupplyExchangePrice),
      lastStoredLiquidityBorrowExchangePrice: new BN(vaultState.liquidityBorrowExchangePrice),
      lastStoredVaultSupplyExchangePrice: new BN(vaultState.vaultSupplyExchangePrice),
      lastStoredVaultBorrowExchangePrice: new BN(vaultState.vaultBorrowExchangePrice),
      liquiditySupplyExchangePrice: new BN(0),
      liquidityBorrowExchangePrice: new BN(0),
      vaultSupplyExchangePrice: new BN(0),
      vaultBorrowExchangePrice: new BN(0),
      supplyRateLiquidity: liquiditySupplyRate,
      borrowRateLiquidity: liquidityBorrowRate,
      supplyRateVault: new BN(0),
      borrowRateVault: new BN(0),
      rewardsOrFeeRateSupply: new BN(0),
      rewardsOrFeeRateBorrow: new BN(0),
    };

    const {
      liquiditySupplyExchangePrice,
      liquidityBorrowExchangePrice,
      vaultSupplyExchangePrice,
      vaultBorrowExchangePrice,
    } = await this.updateExchangePrices(
      MintInfo.getMintForToken(vaultConfig.supplyToken) as MintKeys,
      MintInfo.getMintForToken(vaultConfig.borrowToken) as MintKeys,
      Res.lastStoredLiquiditySupplyExchangePrice,
      Res.lastStoredLiquidityBorrowExchangePrice,
      Res.lastStoredVaultSupplyExchangePrice,
      Res.lastStoredVaultBorrowExchangePrice,
      new BN(vaultConfig.supplyRateMagnifier),
      new BN(vaultConfig.borrowRateMagnifier),
      new BN(vaultState.lastUpdateTimestamp)
    );

    Res.liquiditySupplyExchangePrice = liquiditySupplyExchangePrice;
    Res.liquidityBorrowExchangePrice = liquidityBorrowExchangePrice;
    Res.vaultSupplyExchangePrice = vaultSupplyExchangePrice;
    Res.vaultBorrowExchangePrice = vaultBorrowExchangePrice;

    if (vaultConfig.supplyRateMagnifier !== 0) {
      // Liquidity rate is in 1e4 scale, 1e4 = 100%, similarly magnifier is in 1e4 scale
      const magnifierEffect = new BN(vaultConfig.supplyRateMagnifier);

      if (vaultConfig.supplyRateMagnifier > 0) {
        Res.supplyRateVault = liquiditySupplyRate.add(magnifierEffect);
      } else {
        Res.supplyRateVault = liquiditySupplyRate.sub(magnifierEffect.abs());
      }
    } else {
      Res.supplyRateVault = liquiditySupplyRate;
    }

    Res.rewardsOrFeeRateSupply = new BN(vaultConfig.supplyRateMagnifier);

    if (vaultConfig.borrowRateMagnifier !== 0) {
      // Liquidity rate is in 1e4 scale, 1e4 = 100%, similarly magnifier is in 1e4 scale
      const magnifierEffect = new BN(vaultConfig.borrowRateMagnifier);

      if (vaultConfig.borrowRateMagnifier > 0) {
        Res.borrowRateVault = liquidityBorrowRate.add(magnifierEffect);
      } else {
        Res.borrowRateVault = liquidityBorrowRate.sub(magnifierEffect.abs());
      }
    } else {
      Res.borrowRateVault = liquidityBorrowRate;
    }

    Res.rewardsOrFeeRateBorrow = new BN(vaultConfig.borrowRateMagnifier);

    return Res;
  }

  /**
   * Find token account for an owner and token mint
   */
  private async findTokenAccountForOwner(
    owner: PublicKey,
    mint: PublicKey,
    connection: Connection
  ): Promise<PublicKey | null> {
    try {
      const token_program = (await connection.getAccountInfo(mint)).owner;

      // First try the standard token account address
      const tokenAccount = getAssociatedTokenAddressSync(
        mint,
        owner,
        true,
        token_program
      );

      try {
        const accountInfo = await connection.getAccountInfo(tokenAccount);
        if (accountInfo) {
          return tokenAccount;
        }
      } catch (e) {
        // If not found, try to fetch all token accounts
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
          owner,
          {
            mint,
          }
        );

        if (tokenAccounts.value.length > 0) {
          return tokenAccounts.value[0].pubkey;
        }
      }

      return null;
    } catch (error) {
      console.error(`Error finding token account:`, error);
      return null;
    }
  }

  /**
   * Get the token balance in the liquidity program
   */
  private async getLLTokenBalance(token: MintKeys): Promise<BN> {
    try {
      const liquidityPDA = this.get_liquidity();
      const connection = this.program.provider.connection;

      // For Sol/Native token, get the account balance
      if (token.toString() === "11111111111111111111111111111111") {
        const balance = await connection.getBalance(liquidityPDA);
        return new BN(balance);
      }

      // For SPL tokens, get the associated token account balance
      const tokenAccount = await this.findTokenAccountForOwner(
        liquidityPDA,
        MintInfo.getMint(token),
        connection
      );

      if (!tokenAccount) {
        return new BN(0);
      }

      const tokenAccountInfo = await connection.getTokenAccountBalance(
        tokenAccount
      );
      return new BN(tokenAccountInfo.value.amount);
    } catch (error) {
      console.error(
        `Error fetching token balance for ${token.toString()}:`,
        error
      );
      return new BN(0);
    }
  }

  async _getLimitsAndAvailability(
    exchangePricesAndRates: ExchangePricesAndRates,
    withdrawalGapConfig: BN,
    borrowLimit: BN,
    borrowLimitUtilization: BN,
    borrowableUntilLimit: BN,
    liquidityUserSupplyData: UserSupplyData,
    liquidityUserBorrowData: UserBorrowData,
    supplyToken: MintKeys,
    borrowToken: MintKeys
  ): Promise<LimitsAndAvailability> {
    const limitsAndAvailability: LimitsAndAvailability = {
      withdrawLimit: new BN(0),
      withdrawableUntilLimit: new BN(0),
      withdrawable: new BN(0),
      borrowLimit: new BN(0),
      borrowLimitUtilization: new BN(0),
      borrowableUntilLimit: new BN(0),
      borrowable: new BN(0),
      minimumBorrowing: new BN(0),
    };

    if (liquidityUserSupplyData.supply.gt(new BN(0))) {
      limitsAndAvailability.withdrawLimit =
        liquidityUserSupplyData.withdrawalLimit;
      limitsAndAvailability.withdrawableUntilLimit =
        liquidityUserSupplyData.withdrawableUntilLimit;

      const withdrawalGap = liquidityUserSupplyData.supply
        .mul(withdrawalGapConfig)
        .div(new BN(1000));

      limitsAndAvailability.withdrawableUntilLimit =
        limitsAndAvailability.withdrawableUntilLimit.gt(withdrawalGap)
          ? limitsAndAvailability.withdrawableUntilLimit
              .sub(withdrawalGap)
              .mul(new BN(999999))
              .div(new BN(1000000))
          : new BN(0);

      limitsAndAvailability.withdrawable =
        limitsAndAvailability.withdrawableUntilLimit;

      const balanceOf = await this.getLLTokenBalance(supplyToken);

      if (balanceOf < limitsAndAvailability.withdrawableUntilLimit) {
        limitsAndAvailability.withdrawable = balanceOf;
      }
    }

    if (liquidityUserBorrowData.borrow.gt(new BN(0))) {
      limitsAndAvailability.borrowLimit = borrowLimit;
      limitsAndAvailability.borrowLimitUtilization = borrowLimitUtilization;
      limitsAndAvailability.borrowableUntilLimit = borrowableUntilLimit
        .mul(new BN(999999))
        .div(new BN(1000000));
      limitsAndAvailability.borrowable =
        limitsAndAvailability.borrowableUntilLimit;

      const balanceOf = await this.getLLTokenBalance(borrowToken);

      if (balanceOf < limitsAndAvailability.borrowableUntilLimit) {
        limitsAndAvailability.borrowable = balanceOf;
      }
    }

    limitsAndAvailability.minimumBorrowing = new BN(10001)
      .mul(exchangePricesAndRates.vaultBorrowExchangePrice)
      .div(this.EXCHANGE_PRICES_PRECISION);

    return limitsAndAvailability;
  }

  async getVaultConfig(vaultId: number): Promise<VaultConfig> {
    const vaultConfig = await this.program.account.vaultConfig.fetch(
      this.get_vault_config({ vaultId })
    );

    return vaultConfig;
  }

  async getVaultState(vaultId: number): Promise<VaultState> {
    const vaultState = await this.program.account.vaultState.fetch(
      this.get_vault_state({ vaultId })
    );

    const tickHelper = (tickValue: number): number => {
      if (tickValue === 0) return tickMath.INIT_TICK;
      else return tickValue;
    };

    let currentBranchId = vaultState.currentBranchId;
    let currentBranch = await this.program.account.branch.fetch(
      this.get_branch({ vaultId, branchId: currentBranchId })
    );

    // prettier-ignore
    return {
      branchLiquidated: vaultState.branchLiquidated == 1,
      topTick: tickHelper(vaultState.topmostTick),
      currentBranch: vaultState.currentBranchId,
      totalBranch: vaultState.totalBranchId,
      totalSupply: new BN(vaultState.totalSupply),
      totalBorrow: new BN(vaultState.totalBorrow),
      totalPositions: vaultState.totalPositions,
      currentBranchState: {
        status: currentBranch.status,
        minimaTick: currentBranch.minimaTick,
        debtFactor: new BN(currentBranch.debtFactor),
        partials: new BN(currentBranch.minimaTickPartials),
        debtLiquidity: new BN(currentBranch.debtLiquidity),
        baseBranchId: currentBranch.connectedBranchId,
        baseBranchMinima: currentBranch.connectedMinimaTick,
      },
      absorbedDebtAmount: new BN(vaultState.absorbedDebtAmount),
      absorbedColAmount: new BN(vaultState.absorbedColAmount),
      absorbedDustDebt: new BN(vaultState.absorbedDustDebt),
      liquiditySupplyExchangePrice: new BN(vaultState.liquiditySupplyExchangePrice),
      liquidityBorrowExchangePrice: new BN(vaultState.liquidityBorrowExchangePrice),
      vaultSupplyExchangePrice: new BN(vaultState.vaultSupplyExchangePrice),
      vaultBorrowExchangePrice: new BN(vaultState.vaultBorrowExchangePrice),
      nextPositionId: vaultState.nextPositionId,
    };
  }

  /**
   * Fetches the total number of vaults from the VaultAdmin account.
   * Returns the value of next_vault_id, which is the next available vault ID,
   * so the total number of vaults is next_vault_id (assuming vault IDs are 0-based and contiguous).
   */
  async getTotalVaults(): Promise<number> {
    const vaultAdminPda = this.get_vault_admin();
    try {
      const vaultAdmin = await this.program.account.vaultAdmin.fetch(
        vaultAdminPda
      );
      // next_vault_id is the next available vault id, so total vaults = next_vault_id
      return vaultAdmin.nextVaultId;
    } catch (e) {
      throw new Error(
        "Unable to fetch VaultAdmin or total vaults: " + (e as Error).message
      );
    }
  }

  async getAllVaultsEntireData(): Promise<VaultEntireData[]> {
    // Use getTotalVaults() to fetch the total number of vaults
    const totalVaults = await this.getTotalVaults();

    const vaultsData: VaultEntireData[] = [];
    for (let vaultId = 1; vaultId < totalVaults; vaultId++) {
      const data = await this.getVaultEntireData(vaultId);
      vaultsData.push(data);
    }
    return vaultsData;
  }

  async getVaultEntireData(vaultId: number): Promise<VaultEntireData> {
    const constantViews = await this._getVaultsConstants(vaultId);

    const vaultConfig = this.get_vault_config({ vaultId });

    const { userSupplyData, overallTokenData } =
      await this.liquidityResolver.getUserSupplyData(
        vaultConfig,
        MintInfo.getMintForToken(constantViews.supplyToken) as MintKeys
      );

    let liquiditySupplyRate = overallTokenData.supplyRate;
    let liquiditySupply = userSupplyData.supply;

    const { userBorrowData, overallTokenData: overallTokenDataBorrow } =
      await this.liquidityResolver.getUserBorrowData(
        vaultConfig,
        MintInfo.getMintForToken(constantViews.borrowToken) as MintKeys
      );

    let liquidityBorrowRate = overallTokenDataBorrow.borrowRate;
    let liquidityBorrow = userBorrowData.borrow;
    let borrowLimit = userBorrowData.borrowLimit;
    let borrowLimitUtilization = userBorrowData.borrowLimitUtilization;
    let borrowableUntilLimit = userBorrowData.borrowableUntilLimit;

    const exchangePricesAndRates = await this._getVaultsExchangePricesAndRates(
      vaultId,
      liquiditySupplyRate,
      liquidityBorrowRate
    );

    const limitsAndAvailability = await this._getLimitsAndAvailability(
      exchangePricesAndRates,
      new BN((await this.readVaultConfig({ vaultId })).withdrawGap),
      borrowLimit,
      borrowLimitUtilization,
      borrowableUntilLimit,
      userSupplyData,
      userBorrowData,
      MintInfo.getMintForToken(constantViews.supplyToken) as MintKeys,
      MintInfo.getMintForToken(constantViews.borrowToken) as MintKeys
    );

    let vaultEntireData: VaultEntireData = {
      vault: this.get_vault_config({ vaultId }),
      isSmartCol: false,
      isSmartDebt: false,
      constantViews,
      configs: await this._getVaultsConfigs(vaultId),
      exchangePricesAndRates,
      limitsAndAvailability,
      liquidityUserSupplyData: userSupplyData,
      liquidityUserBorrowData: userBorrowData,
      vaultState: await this.getVaultState(vaultId),

      totalSupplyAndBorrow: await this._getTotalSupplyAndBorrow(
        vaultId,
        exchangePricesAndRates,
        liquiditySupply,
        liquidityBorrow
      ),
    };

    return vaultEntireData;
  }

  async getNftOwner(mint: PublicKey): Promise<PublicKey> {
    let accountInfo = await connection.getTokenLargestAccounts(mint);
    let nftAccount = accountInfo.value.find((account) => account.amount == "1");

    if (!nftAccount) {
      return null;
    }

    const account = await connection.getAccountInfo(nftAccount.address);
    const { owner } = unpackAccount(mint, account);

    return owner;
  }

  /**
   * Fetches all positions for a given vaultId, and adds a "riskRatio" param to each position.
   * The riskRatio is calculated as borrow / supply, using the current oracle price of the vault.
   */
  async getAllPositionsWithRiskRatio(
    vaultId: number
  ): Promise<Array<NftPosition & { riskRatio: number }>> {
    // Fetch all position IDs for the vault
    const positionIds = await this.getAllPositionIdsForVault(vaultId);

    // Fetch the oracle price for the vault only once
    const vaultConfig = await this.readVaultConfig({ vaultId });

    const oraclePrice = new BN(
      (await this.readOraclePrice(vaultConfig.oracle)).liquidatePrice
    );

    // Prepare to fetch all positions in parallel using Promise.all
    const positionsWithRiskRatio: any[] = await Promise.all(
      positionIds.map(async (nftId) => {
        const position = await this.positionByNftId(nftId, vaultId);

        if (!position) {
          console.log("POSITION IS NULL: ", nftId);
          return null;
        }

        if (position.userPosition.supply.isZero()) {
          console.log(
            "POSITION with zero supply: ",
            position.userPosition.nftId
          );
          return {
            riskRatio: 0,
            ...position.userPosition,
          } as any;
        }

        if (!position.userPosition.owner) {
          console.log("POSITION with NO owner: ", position.userPosition.nftId);
          readableConsoleDump(position.userPosition);
        }

        // Calculate supply and borrow in BN, already scaled to 9 decimals
        const supply = new BN(position.userPosition.supply.toNumber());
        const borrow = new BN(position.userPosition.borrow.toNumber());

        // Calculate riskRatio: (borrow * oraclePrice) / (supply * oraclePrice) = borrow / supply
        // If supply is zero, riskRatio is 0 to avoid division by zero
        let riskRatio = 0;
        if (!supply.isZero() && !borrow.isZero()) {
          riskRatio =
            borrow.toNumber() /
            supply.mul(oraclePrice).div(new BN(1e15)).toNumber();
        }

        return {
          riskRatio,
          ...position.userPosition,
        } as any;
      })
    );

    // Filter out any nulls (positions not found)
    return positionsWithRiskRatio.filter((p) => p !== null);
  }

  async getAllPositionIdsForVault(vaultId: number): Promise<number[]> {
    const vaultState = await this.readVaultState({ vaultId });
    const ids: number[] = [];
    for (let i = 1; i <= vaultState.totalPositions; i++) {
      ids.push(i);
    }
    return ids;
  }

  async positionByNftId(
    nftId: number,
    vaultId: number
  ): Promise<{ userPosition: NftPosition; vaultData: VaultEntireData }> {
    try {
      const position = await this.readUserPosition({
        vaultId,
        positionId: nftId,
      });

      if (!position) {
        throw new Error(`Position ${nftId} not found`);
      }

      const vaultData = await this.getVaultEntireData(position.vaultId);
      const owner = await this.getNftOwner(position.positionMint);

      const userPosition: NftPosition = {
        nftId,
        owner,
        isSupplyPosition: position.isSupplyOnlyPosition == 1,
        supply: new BN(position.supplyAmount),
        beforeSupply: new BN(position.supplyAmount),
        dustBorrow: new BN(position.dustDebtAmount),
        beforeDustBorrow: new BN(position.dustDebtAmount),
        tick: position.tick,
        tickId: position.tickId,
        borrow: new BN(0),
        beforeBorrow: new BN(0),
        isLiquidated: false,
      };

      if (!userPosition.isSupplyPosition) {
        userPosition.borrow = tickMath
          .getRatioAtTick(userPosition.tick)
          .mul(userPosition.supply)
          .shrn(48);

        userPosition.beforeBorrow = userPosition.borrow.sub(
          userPosition.dustBorrow
        );

        const tickData = await this.readTick({
          vaultId,
          tick: userPosition.tick,
        });

        if (
          tickData.isLiquidated == 1 ||
          tickData.totalIds > userPosition.tickId
        ) {
          userPosition.isLiquidated = true;
          const currentPosition = await this.getCurrentPositionState({
            vaultId,
            position,
          });

          userPosition.tick = currentPosition.tick;
          userPosition.supply = currentPosition.colRaw;
          userPosition.borrow = currentPosition.debtRaw;
          userPosition.dustBorrow = currentPosition.dustDebtRaw;
        }

        if (userPosition.borrow.gt(userPosition.dustBorrow)) {
          userPosition.borrow = userPosition.borrow.sub(
            userPosition.dustBorrow
          );
        } else {
          userPosition.borrow = new BN(0);
          userPosition.dustBorrow = new BN(0);
        }
      }

      userPosition.beforeSupply = userPosition.beforeSupply
        .mul(vaultData.exchangePricesAndRates.vaultSupplyExchangePrice)
        .div(this.EXCHANGE_PRICES_PRECISION);

      userPosition.beforeBorrow = userPosition.beforeBorrow
        .mul(vaultData.exchangePricesAndRates.vaultBorrowExchangePrice)
        .div(this.EXCHANGE_PRICES_PRECISION);

      userPosition.beforeDustBorrow = userPosition.beforeDustBorrow
        .mul(vaultData.exchangePricesAndRates.vaultBorrowExchangePrice)
        .div(this.EXCHANGE_PRICES_PRECISION);

      userPosition.supply = userPosition.supply
        .mul(vaultData.exchangePricesAndRates.vaultSupplyExchangePrice)
        .div(this.EXCHANGE_PRICES_PRECISION);

      userPosition.borrow = userPosition.borrow
        .mul(vaultData.exchangePricesAndRates.vaultBorrowExchangePrice)
        .div(this.EXCHANGE_PRICES_PRECISION);

      userPosition.dustBorrow = userPosition.dustBorrow
        .mul(vaultData.exchangePricesAndRates.vaultBorrowExchangePrice)
        .div(this.EXCHANGE_PRICES_PRECISION);

      return { userPosition, vaultData };
    } catch (error) {
      console.log(error.stack);
      throw new Error(`Failed to fetch position ${nftId}: ${error}`);
    }
  }
}
