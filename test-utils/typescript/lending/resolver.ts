import { Program, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { LiteSVM } from "litesvm";
import {
  getAssociatedTokenAddressSync,
  unpackAccount,
  unpackMint,
} from "@solana/spl-token";

import {
  FTokenDetails,
  FTokenDetailsUserPosition,
  FTokenInternalData,
  PreviewData,
  RewardsRateModelConfig,
  UserPosition,
  LENDING_CONSTANTS,
} from "../../../ts-sdk/lending/resolver/types";
import { PDA } from "../../../ts-sdk/lending/context/pda";
import { MintKeys, mint as MintInfo } from "../../../ts-sdk/mint";
import { Lending } from "../../../target/types/lending";
import { FluidLiquidityResolver } from "../liquidity/resolver";
import { LendingRewardRateModel } from "../../../target/types/lending_reward_rate_model";

export class LendingResolver {
  private program: Program<Lending>;
  private cache: Map<string, any>;
  private SVM: LiteSVM;
  private liquidity: FluidLiquidityResolver;
  private lrrm: Program<LendingRewardRateModel>;

  pda: PDA;
  log = false;
  u64MAX = new BN("18446744073709551615");
  u60MAX = new BN("1152921504606846975");
  // Constants that should match your Rust contract
  EXCHANGE_PRICES_PRECISION = new BN("1000000000000"); // 1e12
  RETURN_PERCENT_PRECISION = new BN("1000000000000000000"); // 1e18
  MAX_REWARDS_RATE = new BN("250000000000000000"); // 25% = 0.25 * 1e18
  SECONDS_PER_YEAR = 31536000; // 365 * 24 * 60 * 60

  constructor(
    authority: Keypair,
    program: Program<Lending>,
    liquidity: FluidLiquidityResolver,
    svm: LiteSVM,
    lrrm: Program<LendingRewardRateModel>
  ) {
    this.SVM = svm;
    this.program = program;
    this.cache = new Map();
    this.pda = new PDA(authority, this.program);
    this.liquidity = liquidity;
    this.lrrm = lrrm;
  }

  timestamp() {
    return this.SVM.getClock().unixTimestamp.toString();
  }

  // ============== FACTORY/AUTH METHODS ==============

  /**
   * Check if an address is authorized in the lending admin
   * @param auth The address to check
   * @returns True if authorized
   */
  public async isLendingFactoryAuth(auth: PublicKey): Promise<boolean> {
    try {
      const lendingAdmin = await this.program.account.lendingAdmin.fetch(
        this.pda.get_lending_admin()
      );

      // Check if auth is the main authority
      if (lendingAdmin.authority.equals(auth)) {
        return true;
      }

      // Check if auth is in the auths array
      return lendingAdmin.auths.some((authAddr: PublicKey) =>
        authAddr.equals(auth)
      );
    } catch (e) {
      console.error("Error checking lending factory auth:", e);
      return false;
    }
  }

  /**
   * Check if an address is authorized as a deployer
   * @param deployer The address to check
   * @returns True if authorized as deployer
   */
  public async isLendingFactoryDeployer(deployer: PublicKey): Promise<boolean> {
    // In Solana implementation, we can consider the authority as the deployer
    return this.isLendingFactoryAuth(deployer);
  }

  /**
   * Get all available fToken types
   * @returns Array of fToken type names
   */
  public getAllFTokenTypes(): string[] {
    // In Solana implementation, we don't have multiple fToken types like in Ethereum
    return ["Standard"];
  }

  /**
   * Get all deployed fToken addresses
   * @returns Array of fToken mint addresses
   */
  public async getAllFTokens(): Promise<PublicKey[]> {
    try {
      const lending = await this.program.account.lending.all();
      return lending.map((l) => l.account.fTokenMint);
    } catch (e) {
      console.error("Error getting all fTokens:", e);
      return [];
    }
  }

  /**
   * Compute the fToken address for a given asset
   * @param asset The underlying asset address
   * @param fTokenType The fToken type (ignored in Solana implementation)
   * @returns The computed fToken address
   */
  public computeFToken(asset: PublicKey, fTokenType?: string): PublicKey {
    const mintKey = Object.values(MintKeys).find((key) =>
      MintInfo.getMint(key).equals(asset)
    );

    if (!mintKey) {
      throw new Error("Asset not found in mint keys");
    }

    return this.pda.get_f_token_mint(mintKey);
  }

  getMintInfo(mint: MintKeys) {
    const mintInfo = this.SVM.getAccount(MintInfo.getMint(mint));
    if (!mintInfo) {
      throw new Error("Mint account not found");
    }

    const accountInfoWithBuffer = {
      ...mintInfo,
      data: Buffer.from(mintInfo.data),
    };

    return unpackMint(MintInfo.getMint(mint), accountInfoWithBuffer);
  }

  // ============== FTOKEN DETAILS AND DATA ==============

  /**
   * Get detailed information about an fToken
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @returns Detailed fToken information
   */
  public async getFTokenDetails(
    fTokenOrMintKey: PublicKey | MintKeys
  ): Promise<FTokenDetails> {
    let mintKey: MintKeys;

    if (typeof fTokenOrMintKey === "string") {
      mintKey = fTokenOrMintKey as MintKeys;
    } else {
      // If it's a PublicKey, try to derive the mint key
      mintKey = this.getMintKeyFromAddress(fTokenOrMintKey);
      if (!mintKey) {
        throw new Error("Could not derive mint key from address");
      }
    }

    const fTokenMintPDA = this.pda.get_f_token_mint(mintKey);
    const lendingPDA = this.pda.get_lending(mintKey);
    const underlying = MintInfo.getMint(mintKey);

    try {
      const lending = await this.program.account.lending.fetch(lendingPDA);

      const { userSupplyData, overallTokenData } =
        await this.liquidity.getUserSupplyData(lendingPDA, mintKey);

      const mintInfo = this.getMintInfo(mintKey);
      const fTokenMintInfo = this.getFTokenMintInfo(mintKey);

      // Get rewards rate
      const [_, rewardsRate] = await this.getFTokenRewards(mintKey);

      const liquidityExchangePrice = await this._getLiquidityExchangePrice(
        mintKey
      );

      const [tokenExchangePrice, rewardsEnded] =
        await this._calculateNewTokenExchangePrice(
          liquidityExchangePrice,
          lending,
          rewardsRate,
          new BN(fTokenMintInfo.supply.toString())
        );

      // Calculate totalAssets using the new tokenExchangePrice
      const totalAssets = await this.calculateTotalAssets(
        tokenExchangePrice,
        new BN(fTokenMintInfo.supply.toString())
      );

      // Get liquidity balance
      const liquidityBalance = await this.getLiquidityBalance(lending);

      // Convert BN values for conversionRates (example for 10^decimals)
      const decimalsAmount = new BN(10).pow(new BN(lending.decimals));
      const conversionRateToShares = await this.convertToShares(
        mintKey,
        decimalsAmount
      );
      const conversionRateToAssets = await this.convertToAssets(
        mintKey,
        decimalsAmount
      );

      // Calculate rebalance difference - matching Solidity: int256(userSupplyData_.supply) - int256(totalAssets_)
      const rebalanceDifference = new BN(liquidityBalance.toString()).sub(
        totalAssets
      );

      const details: FTokenDetails = {
        tokenAddress: fTokenMintPDA,
        name: `Fluid ${MintInfo.getSymbol(mintKey)}`,
        symbol: `f${MintInfo.getSymbol(mintKey)}`,
        decimals: lending.decimals,
        underlyingAddress: underlying,
        totalAssets,
        totalSupply: new BN(fTokenMintInfo.supply.toString()),
        conversionRateToShares,
        conversionRateToAssets,
        rewardsRate,
        supplyRate: overallTokenData.supplyRate,
        rebalanceDifference,
        userSupplyData,
      };

      return details;
    } catch (e) {
      console.error(`Error getting fToken details for ${mintKey}:`, e);
      throw e;
    }
  }

  /**
   * Get internal data from an fToken (matches Solidity's getData())
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @returns Internal fToken data
   */
  public async getFTokenInternalData(
    fTokenOrMintKey: PublicKey | MintKeys
  ): Promise<FTokenInternalData> {
    let mintKey: MintKeys;

    if (typeof fTokenOrMintKey === "string") {
      mintKey = fTokenOrMintKey as MintKeys;
    } else {
      mintKey = this.getMintKeyFromAddress(fTokenOrMintKey);
      if (!mintKey) {
        throw new Error("Could not derive mint key from address");
      }
    }

    const lendingPDA = this.pda.get_lending(mintKey);
    const lending = await this.program.account.lending.fetch(lendingPDA);

    const lendingAdmin = await this.program.account.lendingAdmin.fetch(
      this.pda.get_lending_admin()
    );

    const liquidityExchangePrice = await this._getLiquidityExchangePrice(
      mintKey
    );
    const tokenExchangePrice = await this.getNewExchangePrice(mintKey);
    const liquidityBalance = await this.getLiquidityBalance(lending);

    const rewardsActive = await this.areRewardsActive(mintKey);

    return {
      liquidity: lendingAdmin.liquidityProgram,
      lendingFactory: this.pda.get_lending_admin(),
      lendingRewardsRateModel: lending.rewardsRateModel,
      rebalancer: lendingAdmin.rebalancer,
      liquidityBalance: new BN(liquidityBalance),
      liquidityExchangePrice,
      tokenExchangePrice,
    };
  }

  /**
   * Get detailed information about all fTokens
   * @returns Array of detailed fToken information
   */
  public async getFTokensEntireData(): Promise<FTokenDetails[]> {
    const allTokens = await this.getAllFTokens();
    const results: FTokenDetails[] = [];

    for (const fTokenAddress of allTokens) {
      try {
        const mintKey = this.getMintKeyFromAddress(fTokenAddress);
        if (mintKey) {
          const details = await this.getFTokenDetails(mintKey);
          results.push(details);
        }
      } catch (e) {
        if (this.log) {
          console.error(
            `Error getting fToken details for ${fTokenAddress}:`,
            e
          );
        }
      }
    }

    return results;
  }

  // ============== USER POSITION METHODS ==============

  /**
   * Get user positions across all fTokens
   * @param user The user address
   * @returns User position data for all fTokens
   */
  public async getUserPositions(
    user: PublicKey
  ): Promise<FTokenDetailsUserPosition[]> {
    const fTokensEntireData = await this.getFTokensEntireData();
    const positions: FTokenDetailsUserPosition[] = [];

    for (const fTokenDetails of fTokensEntireData) {
      try {
        const mintKey = this.getMintKeyFromAddress(
          fTokenDetails.underlyingAddress
        );
        if (mintKey) {
          const userPosition = await this.getUserPosition(mintKey, user);
          positions.push({
            fTokenDetails,
            userPosition,
          });
        }
      } catch (e) {
        if (this.log) {
          console.error(
            `Error getting user position for token ${fTokenDetails.symbol}:`,
            e
          );
        }
      }
    }

    return positions;
  }

  private async findTokenAccountForOwner(
    owner: PublicKey,
    mint: PublicKey
  ): Promise<PublicKey | null> {
    try {
      // First try the standard token account address
      const tokenAccount = getAssociatedTokenAddressSync(mint, owner, true);
      const accountInfo = this.SVM.getAccount(tokenAccount);
      if (accountInfo) return tokenAccount;
      return null;
    } catch (error) {
      console.error(`Error finding token account:`, error);
      return null;
    }
  }

  async balanceOf(owner: PublicKey, mint: PublicKey): Promise<BN> {
    const tokenAccount = await this.findTokenAccountForOwner(owner, mint);
    if (!tokenAccount) {
      return new BN(0); // Return 0 instead of throwing error, similar to ERC20 behavior
    }

    const tokenAccountInfo = this.SVM.getAccount(tokenAccount);
    if (!tokenAccountInfo) {
      return new BN(0);
    }

    const accountInfoWithBuffer = {
      ...tokenAccountInfo,
      data: Buffer.from(tokenAccountInfo.data),
    };

    const decoded = unpackAccount(tokenAccount, accountInfoWithBuffer);
    return new BN(decoded.amount.toString());
  }

  /**
   * Get user position for a specific fToken (matches Solidity getUserPosition)
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @param user The user address
   * @returns User position data
   */
  public async getUserPosition(
    fTokenOrMintKey: PublicKey | MintKeys,
    user: PublicKey
  ): Promise<UserPosition> {
    let mintKey: MintKeys;

    if (typeof fTokenOrMintKey === "string") {
      mintKey = fTokenOrMintKey as MintKeys;
    } else {
      mintKey = this.getMintKeyFromAddress(fTokenOrMintKey);
      if (!mintKey) {
        throw new Error("Could not derive mint key from address");
      }
    }

    const fTokenMintPDA = this.pda.get_f_token_mint(mintKey);
    const underlying = MintInfo.getMint(mintKey);

    try {
      const fTokenShares = await this.balanceOf(user, fTokenMintPDA);
      const underlyingBalance = await this.balanceOf(user, underlying);

      // Calculate equivalent assets using convertToAssets
      const underlyingAssets = await this.convertToAssets(
        mintKey,
        fTokenShares
      );

      // For allowance, in Solana there's no direct equivalent to ERC20 allowance
      // This would need to be implemented based on your specific token program
      const allowance = new BN(0);

      return {
        fTokenShares,
        underlyingAssets,
        underlyingBalance,
        allowance,
      };
    } catch (e) {
      console.error(`Error getting user position for ${mintKey}:`, e);
      return {
        fTokenShares: new BN(0),
        underlyingAssets: new BN(0),
        underlyingBalance: new BN(0),
        allowance: new BN(0),
      };
    }
  }

  // ============== REWARDS METHODS ==============

  /**
   * Get rewards information for an fToken (matches Solidity getFTokenRewards)
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @returns Rewards rate model address and current rewards rate
   */
  public async getFTokenRewards(
    fTokenOrMintKey: PublicKey | MintKeys
  ): Promise<[PublicKey, BN]> {
    let mintKey: MintKeys;

    if (typeof fTokenOrMintKey === "string") {
      mintKey = fTokenOrMintKey as MintKeys;
    } else {
      mintKey = this.getMintKeyFromAddress(fTokenOrMintKey);
      if (!mintKey) {
        throw new Error("Could not derive mint key from address");
      }
    }

    const lendingPDA = this.pda.get_lending(mintKey);
    const lending = await this.program.account.lending.fetch(lendingPDA);

    let rewardsRate = new BN(0);
    const rewardsActive = await this.areRewardsActive(mintKey);

    if (rewardsActive && !lending.rewardsRateModel.equals(PublicKey.default)) {
      try {
        const totalAssets = await this.totalAssets(mintKey);
        const currentRateModel = await this.fetchRewardsRateModel(
          lending.rewardsRateModel
        );
        const result = await this.calculateRewardsRate(
          currentRateModel,
          parseInt(totalAssets.toString())
        );

        rewardsRate = result.rewardsRate;
      } catch (e) {
        console.error(`Error calculating rewards rate for ${mintKey}:`, e);
      }
    }

    return [lending.rewardsRateModel, rewardsRate];
  }

  /**
   * Get rewards rate model configuration (matches Solidity getFTokenRewardsRateModelConfig)
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @returns Rewards rate model configuration
   */
  public async getFTokenRewardsRateModelConfig(
    fTokenOrMintKey: PublicKey | MintKeys
  ): Promise<RewardsRateModelConfig> {
    let mintKey: MintKeys;

    if (typeof fTokenOrMintKey === "string") {
      mintKey = fTokenOrMintKey as MintKeys;
    } else {
      mintKey = this.getMintKeyFromAddress(fTokenOrMintKey);
      if (!mintKey) {
        throw new Error("Could not derive mint key from address");
      }
    }

    const lendingPDA = this.pda.get_lending(mintKey);
    const lending = await this.program.account.lending.fetch(lendingPDA);

    const defaultConfig: RewardsRateModelConfig = {
      duration: new BN(0),
      startTime: new BN(0),
      endTime: new BN(0),
      startTvl: new BN(0),
      maxRate: LENDING_CONSTANTS.MAX_REWARDS_RATE,
      rewardAmount: new BN(0),
      initiator: PublicKey.default,
    };

    if (lending.rewardsRateModel.equals(PublicKey.default)) {
      return defaultConfig;
    }

    try {
      const rateModel = await this.fetchRewardsRateModel(
        lending.rewardsRateModel
      );

      const startTime = new BN(rateModel.startTime?.toString() || "0");
      const duration = new BN(rateModel.duration?.toString() || "0");
      const endTime = startTime.add(duration);

      return {
        duration,
        startTime,
        endTime,
        startTvl: new BN(rateModel.startTvl?.toString() || "0"),
        maxRate: LENDING_CONSTANTS.MAX_REWARDS_RATE,
        rewardAmount: new BN(rateModel.rewardAmount?.toString() || "0"),
        initiator: rateModel.configurator || PublicKey.default,
      };
    } catch (e) {
      console.error(
        `Error fetching rewards rate model config for ${mintKey}:`,
        e
      );
      return defaultConfig;
    }
  }

  // ============== PREVIEW METHODS ==============

  /**
   * Get preview data for various operations (matches Solidity getPreviews)
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @param assets Asset amount for preview
   * @param shares Share amount for preview
   * @returns Preview data for all operations
   */
  public async getPreviews(
    fTokenOrMintKey: PublicKey | MintKeys,
    assets: BN,
    shares: BN
  ): Promise<PreviewData> {
    let mintKey: MintKeys;

    if (typeof fTokenOrMintKey === "string") {
      mintKey = fTokenOrMintKey as MintKeys;
    } else {
      mintKey = this.getMintKeyFromAddress(fTokenOrMintKey);
      if (!mintKey) {
        throw new Error("Could not derive mint key from address");
      }
    }

    return {
      previewDeposit: await this.previewDeposit(mintKey, assets),
      previewMint: await this.previewMint(mintKey, shares),
      previewWithdraw: await this.previewWithdraw(mintKey, assets),
      previewRedeem: await this.previewRedeem(mintKey, shares),
    };
  }

  // ============== ERC4626 LIMIT METHODS ==============

  /**
   * Get maximum deposit amount (matches Solidity maxDeposit)
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @param to Address to deposit to (optional, not used in calculation)
   * @returns Maximum deposit amount
   */
  public async maxDeposit(
    fTokenOrMintKey: PublicKey | MintKeys,
    to?: PublicKey
  ): Promise<BN> {
    let mintKey: MintKeys;

    if (typeof fTokenOrMintKey === "string") {
      mintKey = fTokenOrMintKey as MintKeys;
    } else {
      mintKey = this.getMintKeyFromAddress(fTokenOrMintKey);
      if (!mintKey) {
        throw new Error("Could not derive mint key from address");
      }
    }

    try {
      const totalAmounts = await this.liquidity.getTotalAmounts(mintKey);

      const liquidityExchangePrice = await this._getLiquidityExchangePrice(
        mintKey
      );

      const supplyInterest = totalAmounts.supplyRawInterest
        .mul(liquidityExchangePrice)
        .div(LENDING_CONSTANTS.EXCHANGE_PRICES_PRECISION);

      if (supplyInterest.gt(this.u60MAX)) {
        return new BN(0);
      }

      return this.u60MAX.sub(supplyInterest);
    } catch (e) {
      console.error(`Error getting max deposit for ${mintKey}:`, e);
      return new BN(0);
    }
  }

  /**
   * Get maximum mint amount (matches Solidity maxMint)
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @param to Address to mint to (optional, not used in calculation)
   * @returns Maximum mint amount
   */
  public async maxMint(
    fTokenOrMintKey: PublicKey | MintKeys,
    to?: PublicKey
  ): Promise<BN> {
    const maxDepositAmount = await this.maxDeposit(fTokenOrMintKey, to);

    let mintKey: MintKeys;
    if (typeof fTokenOrMintKey === "string") {
      mintKey = fTokenOrMintKey as MintKeys;
    } else {
      mintKey = this.getMintKeyFromAddress(fTokenOrMintKey);
      if (!mintKey) {
        throw new Error("Could not derive mint key from address");
      }
    }

    return this.convertToShares(mintKey, maxDepositAmount);
  }

  /**
   * Get maximum withdraw amount for a user (matches Solidity maxWithdraw)
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @param owner The owner address
   * @returns Maximum withdraw amount
   */
  public async maxWithdraw(
    fTokenOrMintKey: PublicKey | MintKeys,
    owner: PublicKey
  ): Promise<BN> {
    let mintKey: MintKeys;

    if (typeof fTokenOrMintKey === "string") {
      mintKey = fTokenOrMintKey as MintKeys;
    } else {
      mintKey = this.getMintKeyFromAddress(fTokenOrMintKey);
      if (!mintKey) {
        throw new Error("Could not derive mint key from address");
      }
    }

    try {
      const maxWithdrawableAtLiquidity = await this.getLiquidityWithdrawable(
        mintKey
      );
      const userPosition = await this.getUserPosition(mintKey, owner);
      const ownerBalance = userPosition.underlyingAssets;

      return maxWithdrawableAtLiquidity.lt(ownerBalance)
        ? maxWithdrawableAtLiquidity
        : ownerBalance;
    } catch (e) {
      console.error(`Error getting max withdraw for ${mintKey}:`, e);
      return new BN(0);
    }
  }

  /**
   * Get maximum redeem amount for a user (matches Solidity maxRedeem)
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @param owner The owner address
   * @returns Maximum redeem amount
   */
  public async maxRedeem(
    fTokenOrMintKey: PublicKey | MintKeys,
    owner: PublicKey
  ): Promise<BN> {
    let mintKey: MintKeys;

    if (typeof fTokenOrMintKey === "string") {
      mintKey = fTokenOrMintKey as MintKeys;
    } else {
      mintKey = this.getMintKeyFromAddress(fTokenOrMintKey);
      if (!mintKey) {
        throw new Error("Could not derive mint key from address");
      }
    }

    try {
      const maxWithdrawableAtLiquidity = await this.getLiquidityWithdrawable(
        mintKey
      );
      const maxWithdrawableShares = await this.convertToShares(
        mintKey,
        maxWithdrawableAtLiquidity
      );
      const userPosition = await this.getUserPosition(mintKey, owner);
      const ownerBalance = userPosition.fTokenShares;

      return maxWithdrawableShares.lt(ownerBalance)
        ? maxWithdrawableShares
        : ownerBalance;
    } catch (e) {
      console.error(`Error getting max redeem for ${mintKey}:`, e);
      return new BN(0);
    }
  }

  /**
   * Get minimum deposit amount (matches Solidity minDeposit)
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @returns Minimum deposit amount
   */
  public async minDeposit(fTokenOrMintKey: MintKeys): Promise<BN> {
    const previewMint = await this.previewMint(fTokenOrMintKey, new BN(1));
    return previewMint.gt(new BN(1)) ? previewMint : new BN(1);
  }

  // ============== CONVERSION METHODS ==============

  /**
   * Convert assets to shares (matches Solidity convertToShares)
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @param assets Amount of assets to convert
   * @returns Equivalent shares amount
   */
  public async convertToShares(
    fTokenOrMintKey: PublicKey | MintKeys,
    assets: BN
  ): Promise<BN> {
    let mintKey: MintKeys;

    if (typeof fTokenOrMintKey === "string") {
      mintKey = fTokenOrMintKey as MintKeys;
    } else {
      mintKey = this.getMintKeyFromAddress(fTokenOrMintKey);
      if (!mintKey) {
        throw new Error("Could not derive mint key from address");
      }
    }

    const exchangePrice = await this.getNewExchangePrice(mintKey);
    // Use mulDivDown equivalent for rounding down
    return assets
      .mul(LENDING_CONSTANTS.EXCHANGE_PRICES_PRECISION)
      .div(exchangePrice);
  }

  /**
   * Convert shares to assets (matches Solidity convertToAssets)
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @param shares Amount of shares to convert
   * @returns Equivalent assets amount
   */
  public async convertToAssets(
    fTokenOrMintKey: PublicKey | MintKeys,
    shares: BN
  ): Promise<BN> {
    let mintKey: MintKeys;

    if (typeof fTokenOrMintKey === "string") {
      mintKey = fTokenOrMintKey as MintKeys;
    } else {
      mintKey = this.getMintKeyFromAddress(fTokenOrMintKey);
      if (!mintKey) {
        throw new Error("Could not derive mint key from address");
      }
    }

    const exchangePrice = await this.getNewExchangePrice(mintKey);
    // Use mulDivDown equivalent for rounding down
    return shares
      .mul(exchangePrice)
      .div(LENDING_CONSTANTS.EXCHANGE_PRICES_PRECISION);
  }

  /**
   * Get total assets for an fToken (matches Solidity totalAssets)
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @returns Total assets amount
   */
  public async totalAssets(fTokenOrMintKey: PublicKey | MintKeys): Promise<BN> {
    let mintKey: MintKeys;

    if (typeof fTokenOrMintKey === "string") {
      mintKey = fTokenOrMintKey as MintKeys;
    } else {
      mintKey = this.getMintKeyFromAddress(fTokenOrMintKey);
      if (!mintKey) {
        throw new Error("Could not derive mint key from address");
      }
    }

    const liquidityExchangePrice = await this._getLiquidityExchangePrice(
      mintKey
    );

    const lendingPDA = this.pda.get_lending(mintKey);
    const lending = await this.program.account.lending.fetch(lendingPDA);

    const fTokenMintInfo = this.getFTokenMintInfo(mintKey);

    const [tokenExchangePrice] = await this._calculateNewTokenExchangePrice(
      liquidityExchangePrice,
      lending,
      PublicKey.default,
      new BN(fTokenMintInfo.supply.toString())
    );

    return this.calculateTotalAssets(
      tokenExchangePrice,
      new BN(fTokenMintInfo.supply.toString())
    );
  }

  // ============== PRIVATE HELPER METHODS ==============

  private async _getLiquidityExchangePrice(mintKey: MintKeys): Promise<BN> {
    const exchangePricesAndConfig =
      await this.liquidity.getExchangePricesAndConfig(mintKey);
    return (
      await this.liquidity.calculateExchangePrice(exchangePricesAndConfig)
    ).supplyExchangePrice;
  }

  async getNewExchangePrice(mintKey: MintKeys): Promise<BN> {
    const liquidityExchangePrice = await this._getLiquidityExchangePrice(
      mintKey
    );
    const lendingPDA = this.pda.get_lending(mintKey);
    const lending = await this.program.account.lending.fetch(lendingPDA);

    const fTokenMintInfo = this.getFTokenMintInfo(mintKey);

    const [tokenExchangePrice] = await this._calculateNewTokenExchangePrice(
      liquidityExchangePrice,
      lending,
      PublicKey.default,
      new BN(fTokenMintInfo.supply.toString())
    );

    return tokenExchangePrice;
  }

  private async previewDeposit(mintKey: MintKeys, assets: BN): Promise<BN> {
    return this.convertToShares(mintKey, assets);
  }

  private async previewMint(mintKey: MintKeys, shares: BN): Promise<BN> {
    const exchangePrice = await this.getNewExchangePrice(mintKey);

    // Round up for mint (mulDivUp equivalent)
    return shares
      .mul(exchangePrice)
      .add(LENDING_CONSTANTS.EXCHANGE_PRICES_PRECISION.sub(new BN(1)))
      .div(LENDING_CONSTANTS.EXCHANGE_PRICES_PRECISION);
  }

  private async previewWithdraw(mintKey: MintKeys, assets: BN): Promise<BN> {
    const exchangePrice = await this.getNewExchangePrice(mintKey);

    // Round up for withdraw (mulDivUp equivalent)
    return assets
      .mul(LENDING_CONSTANTS.EXCHANGE_PRICES_PRECISION)
      .add(exchangePrice.sub(new BN(1)))
      .div(exchangePrice);
  }

  private async previewRedeem(mintKey: MintKeys, shares: BN): Promise<BN> {
    return this.convertToAssets(mintKey, shares);
  }

  private async calculateTotalAssets(
    tokenExchangePrice: BN,
    totalSupply: number | BN
  ): Promise<BN> {
    const totalSupplyBN =
      typeof totalSupply === "number"
        ? new BN(totalSupply.toString())
        : totalSupply;

    // totalAssets = (tokenExchangePrice * totalSupply) / EXCHANGE_PRICES_PRECISION
    return tokenExchangePrice
      .mul(totalSupplyBN)
      .div(LENDING_CONSTANTS.EXCHANGE_PRICES_PRECISION);
  }

  private async getLiquidityBalance(lending: any): Promise<number> {
    try {
      const mintKey = this.getMintKeyFromAddress(new PublicKey(lending.mint));

      if (!mintKey) {
        console.error(`Could not find mint key for address: ${lending.mint}`);
        return 0;
      }

      // Get the user supply data from the Liquidity program
      const userSupplyData = await this.liquidity.getUserSupply(
        this.pda.get_lending(mintKey),
        mintKey
      );

      if (userSupplyData instanceof BN) {
        return 0;
      }

      return parseInt(
        userSupplyData.amount
          .mul(new BN(lending.liquidityExchangePrice.toString()))
          .div(LENDING_CONSTANTS.EXCHANGE_PRICES_PRECISION)
          .toString()
      );
    } catch (e) {
      console.error("Error getting liquidity balance:", e);
      return 0;
    }
  }

  private async getLiquidityWithdrawable(mintKey: MintKeys): Promise<BN> {
    try {
      const lendingPDA = this.pda.get_lending(mintKey);
      const { userSupplyData } = await this.liquidity.getUserSupplyData(
        lendingPDA,
        mintKey
      );

      // Get withdrawable amount from liquidity - this should be implemented in your liquidity resolver
      return userSupplyData.withdrawable || new BN(0);
    } catch (e) {
      console.error(`Error getting liquidity withdrawable for ${mintKey}:`, e);
      return new BN(0);
    }
  }

  private async fetchRewardsRateModel(address: PublicKey): Promise<any> {
    try {
      const fetchedAccount = this.SVM.getAccount(address);

      if (!fetchedAccount) {
        throw new Error(
          `Rewards rate model account not found: ${address.toString()}`
        );
      }

      try {
        return await this.lrrm.account.lendingRewardsRateModel.fetch(address);
      } catch {
        throw new Error(
          "Could not fetch rewards rate model - external program support needed"
        );
      }
    } catch (e) {
      console.error(
        `Error fetching rewards rate model ${address.toString()}:`,
        e
      );
      throw e;
    }
  }

  private getMintKeyFromAddress(address: PublicKey): MintKeys | null {
    for (const key of Object.values(MintKeys)) {
      if (MintInfo.getMint(key).equals(address)) {
        return key;
      }
    }

    return null;
  }

  private getFTokenMintInfo(mintKey: MintKeys) {
    const fTokenMint = this.pda.get_f_token_mint(mintKey);
    const mintInfo = this.SVM.getAccount(fTokenMint);
    if (!mintInfo) {
      throw new Error("fToken mint account not found");
    }

    const accountInfoWithBuffer = {
      ...mintInfo,
      data: Buffer.from(mintInfo.data),
    };

    return unpackMint(fTokenMint, accountInfoWithBuffer);
  }

  private isNativeUnderlying(mintKey: MintKeys): boolean {
    // In Solana, this would depend on your specific implementation
    // For now, return false as most tokens won't be native
    return false;
  }

  private supportsEIP2612(mintKey: MintKeys): boolean {
    // In Solana, this would depend on the token program implementation
    // Return false for now as this is an Ethereum-specific feature
    return false;
  }

  private async areRewardsActive(mintKey: MintKeys): Promise<boolean> {
    try {
      const lendingPDA = this.pda.get_lending(mintKey);
      const lending = await this.program.account.lending.fetch(lendingPDA);

      if (lending.rewardsRateModel.equals(PublicKey.default)) {
        return false;
      }

      const currentRateModel = await this.fetchRewardsRateModel(
        lending.rewardsRateModel
      );

      // Use the same logic as get_rate to determine if rewards are active
      const totalAssets = await this.totalAssets(mintKey);
      const result = await this.calculateRewardsRate(
        currentRateModel,
        parseInt(totalAssets.toString())
      );

      // Rewards are active if rate > 0 and not ended
      return result.rewardsRate.gt(new BN(0)) && !result.rewardsEnded;
    } catch (e) {
      return false;
    }
  }

  // ============== ADDITIONAL SOLIDITY COMPATIBILITY METHODS ==============

  /**
   * Get the underlying asset address for an fToken (matches Solidity asset())
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @returns The underlying asset address
   */
  public async asset(
    fTokenOrMintKey: PublicKey | MintKeys
  ): Promise<PublicKey> {
    let mintKey: MintKeys;

    if (typeof fTokenOrMintKey === "string") {
      mintKey = fTokenOrMintKey as MintKeys;
    } else {
      mintKey = this.getMintKeyFromAddress(fTokenOrMintKey);
      if (!mintKey) {
        throw new Error("Could not derive mint key from address");
      }
    }

    return MintInfo.getMint(mintKey);
  }

  /**
   * Get the total supply of an fToken (matches Solidity totalSupply())
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @returns Total supply
   */
  public async totalSupply(fTokenOrMintKey: PublicKey | MintKeys): Promise<BN> {
    let mintKey: MintKeys;

    if (typeof fTokenOrMintKey === "string") {
      mintKey = fTokenOrMintKey as MintKeys;
    } else {
      mintKey = this.getMintKeyFromAddress(fTokenOrMintKey);
      if (!mintKey) {
        throw new Error("Could not derive mint key from address");
      }
    }

    const fTokenMintInfo = this.getFTokenMintInfo(mintKey);
    return new BN(fTokenMintInfo.supply.toString());
  }

  /**
   * Get decimals for an fToken (matches Solidity decimals())
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @returns Number of decimals
   */
  public async decimals(
    fTokenOrMintKey: PublicKey | MintKeys
  ): Promise<number> {
    let mintKey: MintKeys;

    if (typeof fTokenOrMintKey === "string") {
      mintKey = fTokenOrMintKey as MintKeys;
    } else {
      mintKey = this.getMintKeyFromAddress(fTokenOrMintKey);
      if (!mintKey) {
        throw new Error("Could not derive mint key from address");
      }
    }

    const lendingPDA = this.pda.get_lending(mintKey);
    const lending = await this.program.account.lending.fetch(lendingPDA);

    return lending.decimals;
  }

  /**
   * Get name for an fToken (matches Solidity name())
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @returns Token name
   */
  public async name(fTokenOrMintKey: PublicKey | MintKeys): Promise<string> {
    let mintKey: MintKeys;

    if (typeof fTokenOrMintKey === "string") {
      mintKey = fTokenOrMintKey as MintKeys;
    } else {
      mintKey = this.getMintKeyFromAddress(fTokenOrMintKey);
      if (!mintKey) {
        throw new Error("Could not derive mint key from address");
      }
    }

    return `Fluid ${MintInfo.getSymbol(mintKey)}`;
  }

  /**
   * Get symbol for an fToken (matches Solidity symbol())
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @returns Token symbol
   */
  public async symbol(fTokenOrMintKey: PublicKey | MintKeys): Promise<string> {
    let mintKey: MintKeys;

    if (typeof fTokenOrMintKey === "string") {
      mintKey = fTokenOrMintKey as MintKeys;
    } else {
      mintKey = this.getMintKeyFromAddress(fTokenOrMintKey);
      if (!mintKey) {
        throw new Error("Could not derive mint key from address");
      }
    }

    return `f${MintInfo.getSymbol(mintKey)}`;
  }

  // ============== UTILITY METHODS ==============

  /**
   * Enable or disable logging
   * @param enabled Whether to enable logging
   */
  public setLogging(enabled: boolean): void {
    this.log = enabled;
  }

  /**
   * Clear the internal cache
   */
  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   * @returns Cache size and keys
   */
  public getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }

  /**
   * Batch fetch multiple fToken details
   * @param fTokensOrMintKeys Array of fToken addresses or MintKeys
   * @returns Array of fToken details
   */
  public async batchGetFTokenDetails(
    fTokensOrMintKeys: (PublicKey | MintKeys)[]
  ): Promise<FTokenDetails[]> {
    const results: FTokenDetails[] = [];

    for (const fTokenOrMintKey of fTokensOrMintKeys) {
      try {
        const details = await this.getFTokenDetails(fTokenOrMintKey);
        results.push(details);
      } catch (e) {
        if (this.log) {
          console.error(`Error in batch fetch for ${fTokenOrMintKey}:`, e);
        }
      }
    }

    return results;
  }

  /**
   * Check if an fToken exists and is initialized
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @returns True if fToken exists
   */
  public async fTokenExists(
    fTokenOrMintKey: PublicKey | MintKeys
  ): Promise<boolean> {
    try {
      let mintKey: MintKeys;

      if (typeof fTokenOrMintKey === "string") {
        mintKey = fTokenOrMintKey as MintKeys;
      } else {
        mintKey = this.getMintKeyFromAddress(fTokenOrMintKey);
        if (!mintKey) {
          return false;
        }
      }

      const lendingPDA = this.pda.get_lending(mintKey);
      const lending = await this.program.account.lending.fetchNullable(
        lendingPDA
      );

      return lending !== null;
    } catch (e) {
      return false;
    }
  }

  /**
   * Get complete internal data for an fToken (equivalent to Solidity getData())
   * @param fTokenOrMintKey Either an fToken address or MintKey
   * @returns Complete internal fToken data matching Solidity interface
   */
  public async getData(mintKey: MintKeys): Promise<{
    liquidity: PublicKey;
    lendingFactory: PublicKey;
    lendingRewardsRateModel: PublicKey;
    permit2: PublicKey;
    rebalancer: PublicKey;
    rewardsActive: boolean;
    liquidityBalance: BN;
    liquidityExchangePrice: BN;
    tokenExchangePrice: BN;
  }> {
    const lendingPDA = this.pda.get_lending(mintKey);
    const lending = await this.program.account.lending.fetch(lendingPDA);

    const lendingAdmin = await this.program.account.lendingAdmin.fetch(
      this.pda.get_lending_admin()
    );

    // Get current liquidity exchange price
    const liquidityExchangePrice = await this._getLiquidityExchangePrice(
      mintKey
    );

    // Calculate new token exchange price (with rewards)
    const tokenExchangePrice = await this.getNewExchangePrice(mintKey);

    // Get liquidity balance
    const liquidityBalance = new BN(await this.getLiquidityBalance(lending));

    // Check if rewards are active and not ended
    const rewardsActive = await this.areRewardsActive(mintKey);

    return {
      liquidity: lendingAdmin.liquidityProgram,
      lendingFactory: this.pda.get_lending_admin(),
      lendingRewardsRateModel: lending.rewardsRateModel,
      permit2: PublicKey.default, // Solana doesn't have permit2
      rebalancer: lendingAdmin.rebalancer,
      rewardsActive,
      liquidityBalance,
      liquidityExchangePrice,
      tokenExchangePrice,
    };
  }

  /**
   * Calculate new token exchange price based on Rust contract logic
   * This matches the exact logic from calculate_new_token_exchange_price in Rust
   */
  private async _calculateNewTokenExchangePrice(
    newLiquidityExchangePrice: BN,
    lending: any,
    rewardsRateModel: any | null,
    totalSupply: BN
  ): Promise<[BN, boolean]> {
    const oldTokenExchangePrice = new BN(lending.tokenExchangePrice.toString());
    const oldLiquidityExchangePrice = new BN(
      lending.liquidityExchangePrice.toString()
    );

    // Liquidity exchange price should only ever increase
    if (newLiquidityExchangePrice.lt(oldLiquidityExchangePrice)) {
      throw new Error("FToken__LiquidityExchangePriceUnexpected");
    }

    const currentTimestamp = parseInt(this.timestamp());

    // Calculate total assets using old token exchange price
    const totalAssets = oldTokenExchangePrice
      .mul(totalSupply)
      .div(LENDING_CONSTANTS.EXCHANGE_PRICES_PRECISION);

    let totalRewardsReturn = new BN(0);
    let rewardsEnded = false;

    // Process rewards if rewards rate model exists
    if (!lending.rewardsRateModel.equals(PublicKey.default)) {
      try {
        const currentRateModel = await this.fetchRewardsRateModel(
          lending.rewardsRateModel
        );

        // Get rate information (matches get_rate() in Rust)
        const {
          currentRewardsRate,
          currentStartTime,
          currentEndTime,
          nextStartTime,
          nextEndTime,
          nextRewardsRate,
        } = this.getRateInfo(
          currentRateModel,
          parseInt(totalAssets.toString())
        );

        let lastUpdateTimestamp = lending.lastUpdateTimestamp;

        // Process current rewards period if applicable
        if (
          currentStartTime > 0 &&
          currentRewardsRate.gt(new BN(0)) &&
          lastUpdateTimestamp < currentEndTime
        ) {
          let effectiveCurrentRate = currentRewardsRate;

          // Cap rate if it exceeds maximum
          if (effectiveCurrentRate.gt(LENDING_CONSTANTS.MAX_REWARDS_RATE)) {
            effectiveCurrentRate = new BN(0);
          }

          // Ensure we don't start before the actual rewards start time
          if (lastUpdateTimestamp < currentStartTime) {
            lastUpdateTimestamp = currentStartTime;
          }

          const currentPeriodEnd = Math.min(currentTimestamp, currentEndTime);

          // Only process if there's actually time to account for
          if (currentPeriodEnd > lastUpdateTimestamp) {
            const timeDiff = currentPeriodEnd - lastUpdateTimestamp;
            const currentRewardsReturn = effectiveCurrentRate
              .mul(new BN(timeDiff))
              .div(new BN(31536000)); // SECONDS_PER_YEAR

            totalRewardsReturn = totalRewardsReturn.add(currentRewardsReturn);

            // Update the tracking timestamp
            lastUpdateTimestamp = currentPeriodEnd;
          }
        }

        // Process next rewards period if applicable
        if (
          nextStartTime > 0 &&
          nextEndTime > 0 &&
          nextRewardsRate.gt(new BN(0)) &&
          currentTimestamp > nextStartTime
        ) {
          let effectiveNextRate = nextRewardsRate;

          // Cap rate if it exceeds maximum
          if (effectiveNextRate.gt(LENDING_CONSTANTS.MAX_REWARDS_RATE)) {
            effectiveNextRate = new BN(0);
          }

          // Determine the start of the next period we need to process
          const nextPeriodStart = Math.max(lastUpdateTimestamp, nextStartTime);

          // Determine the end of the next period we need to process
          const nextPeriodEnd = Math.min(currentTimestamp, nextEndTime);

          // Only process if there's actually time to account for
          if (nextPeriodEnd > nextPeriodStart) {
            const timeDiff = nextPeriodEnd - nextPeriodStart;
            const nextRewardsReturn = effectiveNextRate
              .mul(new BN(timeDiff))
              .div(new BN(31536000)); // SECONDS_PER_YEAR

            totalRewardsReturn = totalRewardsReturn.add(nextRewardsReturn);
          }
        }

        // Determine if rewards have ended
        rewardsEnded =
          (currentStartTime === 0 || currentTimestamp > currentEndTime) &&
          (nextStartTime === 0 ||
            nextEndTime === 0 ||
            currentTimestamp > nextEndTime);
      } catch (e) {
        if (this.log) {
          console.error("Error calculating rewards in exchange price:", e);
        }
      }
    }

    // Calculate liquidity return percentage
    const liquidityReturnPercent = newLiquidityExchangePrice
      .sub(oldLiquidityExchangePrice)
      .mul(this.RETURN_PERCENT_PRECISION)
      .div(oldLiquidityExchangePrice);

    const totalReturnInPercent = totalRewardsReturn.add(liquidityReturnPercent);

    // Calculate new token exchange price
    const newTokenExchangePrice = oldTokenExchangePrice.add(
      oldTokenExchangePrice
        .mul(totalReturnInPercent)
        .div(this.RETURN_PERCENT_PRECISION)
    );

    return [newTokenExchangePrice, rewardsEnded];
  }

  /**
   * Get rate information matching the Rust get_rate() function
   */
  private getRateInfo(
    rateModel: any,
    totalAssets: number
  ): {
    currentRewardsRate: BN;
    currentStartTime: number;
    currentEndTime: number;
    nextStartTime: number;
    nextEndTime: number;
    nextRewardsRate: BN;
  } {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const startTime = rateModel.startTime || 0;
    const duration = rateModel.duration || 0;
    const endTime = startTime + duration;
    const startTvl = rateModel.startTvl || 0;
    const yearlyReward = new BN(rateModel.yearlyReward?.toString() || "0");
    const nextRewardAmount = rateModel.nextRewardAmount || 0;
    const nextDuration = rateModel.nextDuration || 0;

    // Calculate current rewards rate
    let currentRewardsRate = new BN(0);
    if (
      startTime > 0 &&
      currentTimestamp >= startTime &&
      currentTimestamp <= endTime &&
      totalAssets >= startTvl
    ) {
      currentRewardsRate = yearlyReward
        .mul(this.RETURN_PERCENT_PRECISION)
        .div(new BN(totalAssets));
    }

    // Calculate next rewards rate
    let nextRewardsRate = new BN(0);
    let nextStartTime = 0;
    let nextEndTime = 0;

    if (nextRewardAmount > 0 && nextDuration > 0) {
      nextStartTime = endTime; // Next starts when current ends
      nextEndTime = nextStartTime + nextDuration;

      if (totalAssets >= startTvl) {
        // Calculate yearly reward for next period
        const SECONDS_PER_YEAR = 31536000;
        const nextYearlyReward = new BN(nextRewardAmount)
          .mul(new BN(SECONDS_PER_YEAR))
          .div(new BN(nextDuration));

        nextRewardsRate = nextYearlyReward
          .mul(this.RETURN_PERCENT_PRECISION)
          .div(new BN(totalAssets));
      }
    }

    return {
      currentRewardsRate,
      currentStartTime: startTime,
      currentEndTime: endTime,
      nextStartTime,
      nextEndTime,
      nextRewardsRate,
    };
  }

  /**
   * Updated calculateRewardsRate to match the exact Rust logic
   * This is now just a wrapper around getRateInfo for backwards compatibility
   */
  private async calculateRewardsRate(
    currentModel: any,
    totalAssets: number
  ): Promise<{ rewardsRate: BN; rewardsEnded: boolean; rewardsStartTime: BN }> {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const rateInfo = this.getRateInfo(currentModel, totalAssets);

    // Determine which rate to use based on current time
    let activeRate = new BN(0);
    let activeStartTime = 0;
    let rewardsEnded = true;

    // Check if current period is active
    if (
      rateInfo.currentStartTime > 0 &&
      currentTimestamp >= rateInfo.currentStartTime &&
      currentTimestamp <= rateInfo.currentEndTime
    ) {
      activeRate = rateInfo.currentRewardsRate;
      activeStartTime = rateInfo.currentStartTime;
      rewardsEnded = false;
    }
    // Check if next period is active
    else if (
      rateInfo.nextStartTime > 0 &&
      currentTimestamp >= rateInfo.nextStartTime &&
      currentTimestamp <= rateInfo.nextEndTime
    ) {
      activeRate = rateInfo.nextRewardsRate;
      activeStartTime = rateInfo.nextStartTime;
      rewardsEnded = false;
    }
    // Check if rewards haven't started yet
    else if (
      rateInfo.currentStartTime > 0 &&
      currentTimestamp < rateInfo.currentStartTime
    ) {
      activeRate = new BN(0);
      activeStartTime = rateInfo.currentStartTime;
      rewardsEnded = false;
    }

    return {
      rewardsRate: activeRate,
      rewardsEnded,
      rewardsStartTime: new BN(activeStartTime),
    };
  }
}
