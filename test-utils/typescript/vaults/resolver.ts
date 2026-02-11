import { Program, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { LiteSVM } from "litesvm";

import { PDA } from "../../../ts-sdk/vault/context/pda";
import { MintKeys, mint as MintInfo } from "../../../ts-sdk/mint";
import { FluidLiquidityResolver } from "../liquidity/resolver";
import { Vaults } from "../../../target/types/vaults";

import {
  VaultEntireData,
  ConstantViews,
  Configs,
  ExchangePricesAndRates,
  TotalSupplyAndBorrow,
  LimitsAndAvailability,
  VaultState,
  UserPosition,
} from "./types";
import {
  UserBorrowData,
  UserSupplyData,
} from "../../../ts-sdk/liquidity/resolver/types";
import { State } from "../../../ts-sdk/vault/context/state";

export class VaultResolver {
  private program: Program<Vaults>;
  private cache: Map<string, any>;
  private SVM: LiteSVM;
  private liquidity: FluidLiquidityResolver;

  state: State;

  pda: PDA;
  log = false;
  u64MAX = new BN("18446744073709551615");
  INIT_TICK = -2147483648;
  MIN_TICK = -16383;
  MAX_TICK = 16383;
  ZERO_TICK_SCALED_RATIO = new BN(2).pow(new BN(48));
  TICK_SPACING = new BN(10015);
  DEFAULT_EXPONENT_MASK = 0xff;
  X30 = new BN(0x3fffffff);

  private static readonly EXCHANGE_PRICES_PRECISION = new BN(10).pow(
    new BN(12)
  );

  constructor(
    authority: Keypair,
    program: Program<Vaults>,
    liquidity: FluidLiquidityResolver,
    svm: LiteSVM
  ) {
    this.SVM = svm;
    this.program = program;
    this.cache = new Map();
    this.pda = new PDA(authority, this.program);
    this.liquidity = liquidity;
    this.state = new State(authority, this.program);
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

  timestamp() {
    return this.liquidity.timestamp();
  }

  private async _getLiquidityExchangePrice(mintKey: MintKeys) {
    const exchangePricesAndConfig =
      await this.liquidity.getExchangePricesAndConfig(mintKey);
    return await this.liquidity.calculateExchangePrice(exchangePricesAndConfig);
  }

  async _getVaultsConstants(vaultId: number): Promise<ConstantViews> {
    const vaultConfig = await this.program.account.vaultConfig.fetch(
      this.pda.get_vault_config({ vaultId })
    );

    return {
      liquidity: this.pda.get_liquidity(),
      supply: this.pda.get_liquidity(),
      borrow: this.pda.get_liquidity(),
      supplyToken: vaultConfig.supplyToken,
      borrowToken: vaultConfig.borrowToken,
      vaultId,
      vaultType: 1,
    };
  }

  async _getVaultsConfigs(vaultId: number): Promise<Configs> {
    const vaultConfig = await this.program.account.vaultConfig.fetch(
      this.pda.get_vault_config({ vaultId })
    );

    const vaultState = await this.program.account.vaultState.fetch(
      this.pda.get_vault_state({ vaultId })
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
      this.pda.get_vault_state({ vaultId })
    );

    const res = {
      totalSupplyVault: new BN(0),
      totalBorrowVault: new BN(0),
      totalSupplyLiquidityOrDex: new BN(0),
      totalBorrowLiquidityOrDex: new BN(0),
      absorbedSupply: new BN(0),
      absorbedBorrow: new BN(0),
    };

    const EXCHANGE_PRICES_PRECISION = new BN(10).pow(new BN(12));

    res.totalSupplyVault = vaultState.totalSupply
      .mul(exchangePricesAndRates.vaultSupplyExchangePrice)
      .div(EXCHANGE_PRICES_PRECISION);

    res.totalBorrowVault = vaultState.totalBorrow
      .mul(exchangePricesAndRates.vaultBorrowExchangePrice)
      .div(EXCHANGE_PRICES_PRECISION);

    res.absorbedSupply = vaultState.absorbedColAmount
      .mul(exchangePricesAndRates.vaultSupplyExchangePrice)
      .div(EXCHANGE_PRICES_PRECISION);
    res.absorbedBorrow = vaultState.absorbedDebtAmount
      .mul(exchangePricesAndRates.vaultBorrowExchangePrice)
      .div(EXCHANGE_PRICES_PRECISION);

    res.totalSupplyLiquidityOrDex = liquiditySupply
      .mul(exchangePricesAndRates.liquiditySupplyExchangePrice)
      .div(EXCHANGE_PRICES_PRECISION);
    res.totalBorrowLiquidityOrDex = liquidityBorrow
      .mul(exchangePricesAndRates.liquidityBorrowExchangePrice)
      .div(EXCHANGE_PRICES_PRECISION);

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
      .mul(VaultResolver.EXCHANGE_PRICES_PRECISION)
      .div(oldLiquiditySupplyExchangePrice);

    let updatedVaultSupplyExPrice = vaultSupplyExchangePrice
      .mul(liqSupplyIncreaseInPercent)
      .div(VaultResolver.EXCHANGE_PRICES_PRECISION);

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
      .mul(VaultResolver.EXCHANGE_PRICES_PRECISION)
      .div(oldLiquidityBorrowExchangePrice);

    let updatedVaultBorrowExPrice = vaultBorrowExchangePrice
      .mul(liqBorrowIncreaseInPercent)
      .div(VaultResolver.EXCHANGE_PRICES_PRECISION);

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
      this.pda.get_vault_state({ vaultId })
    );

    const vaultConfig = await this.program.account.vaultConfig.fetch(
      this.pda.get_vault_config({ vaultId })
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

  async _getLimitsAndAvailability(
    exchangePricesAndRates: ExchangePricesAndRates,
    withdrawalGapConfig: BN,
    borrowLimit: BN,
    borrowLimitUtilization: BN,
    borrowableUntilLimit: BN,
    liquidityUserSupplyData: UserSupplyData,
    liquidityUserBorrowData: UserBorrowData
  ): Promise<LimitsAndAvailability> {
    const EXCHANGE_PRICES_PRECISION = new BN(10).pow(new BN(12));

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
        .div(new BN(10000));

      limitsAndAvailability.withdrawableUntilLimit =
        limitsAndAvailability.withdrawableUntilLimit.gt(withdrawalGap)
          ? limitsAndAvailability.withdrawableUntilLimit
              .sub(withdrawalGap)
              .mul(new BN(999999))
              .div(new BN(1000000))
          : new BN(0);

      limitsAndAvailability.withdrawable =
        limitsAndAvailability.withdrawableUntilLimit;
    }

    if (liquidityUserBorrowData.borrow.gt(new BN(0))) {
      limitsAndAvailability.borrowLimit = borrowLimit;
      limitsAndAvailability.borrowLimitUtilization = borrowLimitUtilization;
      limitsAndAvailability.borrowableUntilLimit = borrowableUntilLimit
        .mul(new BN(999999))
        .div(new BN(1000000));
      limitsAndAvailability.borrowable =
        limitsAndAvailability.borrowableUntilLimit;
    }

    limitsAndAvailability.minimumBorrowing = new BN(10001)
      .mul(exchangePricesAndRates.vaultBorrowExchangePrice)
      .div(EXCHANGE_PRICES_PRECISION);

    return limitsAndAvailability;
  }

  async getVaultState(vaultId: number): Promise<VaultState> {
    const vaultState = await this.program.account.vaultState.fetch(
      this.pda.get_vault_state({ vaultId })
    );

    const tickHelper = (tickValue: number): number => {
      if (tickValue === 0) return this.INIT_TICK;
      else return tickValue;
    };

    let currentBranchId = vaultState.currentBranchId;
    let currentBranch = await this.program.account.branch.fetch(
      this.pda.get_branch({ vaultId, branchId: currentBranchId })
    );

    return {
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
    };
  }

  async getVaultEntireData(vaultId: number): Promise<VaultEntireData> {
    const constantViews = await this._getVaultsConstants(vaultId);

    const { userSupplyData, overallTokenData } =
      await this.liquidity.getUserSupplyData(
        this.pda.get_vault_config({ vaultId }),
        MintInfo.getMintForToken(constantViews.supplyToken) as MintKeys
      );

    let liquiditySupplyRate = overallTokenData.supplyRate;
    let liquiditySupply = userSupplyData.supply;

    const { userBorrowData, overallTokenData: overallTokenDataBorrow } =
      await this.liquidity.getUserBorrowData(
        this.pda.get_vault_config({ vaultId }),
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
      new BN(10000),
      borrowLimit,
      borrowLimitUtilization,
      borrowableUntilLimit,
      userSupplyData,
      userBorrowData
    );

    let vaultEntireData: VaultEntireData = {
      vault: this.pda.get_vault_config({ vaultId }),
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

  getNftOwner(mint: PublicKey): PublicKey {
    const nft = this.SVM.getAccount(mint);
    if (!nft) {
      throw new Error("NFT account not found");
    }

    return nft.owner;
  }

  async getTickDataRaw(vaultId: number, tick: number) {
    const tickData = await this.program.account.tick.fetch(
      this.pda.get_tick({ vaultId, tick })
    );

    return tickData;
  }

  async positionByNftId(
    nftId: number,
    vaultId: number
  ): Promise<{ userPosition: UserPosition; vaultData: VaultEntireData }> {
    try {
      const position = await this.program.account.position.fetch(
        this.pda.get_position({ vaultId, positionId: nftId })
      );

      const vaultData = await this.getVaultEntireData(position.vaultId);
      const owner = this.getNftOwner(position.positionMint);

      const userPosition: UserPosition = {
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
        userPosition.borrow = this.getRatioAtTick(userPosition.tick)
          .mul(userPosition.supply)
          .shrn(48);

        userPosition.beforeBorrow = userPosition.borrow.sub(
          userPosition.dustBorrow
        );

        const tickData = await this.getTickDataRaw(vaultId, userPosition.tick);

        if (
          tickData.isLiquidated == 1 ||
          tickData.totalIds > userPosition.tickId
        ) {
          userPosition.isLiquidated = true;
          // Liquidation happened, so we need to calculate the final position
          const currentPosition = await this.state.getCurrentPositionState({
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
        .div(VaultResolver.EXCHANGE_PRICES_PRECISION);

      userPosition.beforeBorrow = userPosition.beforeBorrow
        .mul(vaultData.exchangePricesAndRates.vaultBorrowExchangePrice)
        .div(VaultResolver.EXCHANGE_PRICES_PRECISION);

      userPosition.beforeDustBorrow = userPosition.beforeDustBorrow
        .mul(vaultData.exchangePricesAndRates.vaultBorrowExchangePrice)
        .div(VaultResolver.EXCHANGE_PRICES_PRECISION);

      userPosition.supply = userPosition.supply
        .mul(vaultData.exchangePricesAndRates.vaultSupplyExchangePrice)
        .div(VaultResolver.EXCHANGE_PRICES_PRECISION);

      userPosition.borrow = userPosition.borrow
        .mul(vaultData.exchangePricesAndRates.vaultBorrowExchangePrice)
        .div(VaultResolver.EXCHANGE_PRICES_PRECISION);

      userPosition.dustBorrow = userPosition.dustBorrow
        .mul(vaultData.exchangePricesAndRates.vaultBorrowExchangePrice)
        .div(VaultResolver.EXCHANGE_PRICES_PRECISION);

      return { userPosition, vaultData };
    } catch (error) {
      console.log(error.stack);
      throw new Error(`Failed to fetch position ${nftId}: ${error}`);
    }
  }
}
