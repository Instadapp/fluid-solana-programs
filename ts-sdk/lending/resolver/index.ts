import { Program, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
  FTokenDetails,
  FTokenDetailsUserPosition,
  FTokenInternalData,
  PreviewData,
  RewardsRateModelConfig,
  UserPosition,
  LENDING_CONSTANTS,
} from "./types";
import { signer } from "../../auth";
import { PDA } from "../context/pda";
import { MintKeys, mint as MintInfo } from "../../mint";
import { Lending } from "../../../target/types/lending";
import LendingJson from "../../../target/idl/lending.json";
import { anchor as localProvider } from "../../connection";
import { FluidLiquidityResolver } from "../../liquidity/resolver/resolver";
import { LendingRewardRateModelResolver } from "../../lendingRewardRateModel/resolver/resolver";
import { readableConsoleDump } from "../../util";

/**
 * LendingResolver class provides a convenient way to access data
 * from the Solana Lending program, similar to the FluidLendingResolver
 * smart contract in Solidity.
 */
export class LendingResolver {
  private pda: PDA;
  program: Program<Lending>;
  authority: Keypair;
  liquidity: FluidLiquidityResolver;
  rewardsRateModelResolver: LendingRewardRateModelResolver;

  constructor(authority: Keypair) {
    this.program = new Program(LendingJson, localProvider.getProvider());
    this.authority = authority;
    this.pda = new PDA(authority, this.program);
    this.liquidity = new FluidLiquidityResolver(authority);
    this.rewardsRateModelResolver = new LendingRewardRateModelResolver(
      authority
    );
  }

  public async getLendingAdminAuthority(): Promise<PublicKey> {
    const lendingAdmin = await this.program.account.lendingAdmin.fetch(
      this.pda.get_lending_admin()
    );

    return lendingAdmin.authority;
  }

  public async getLendingAdminRebalancer(): Promise<PublicKey> {
    const lendingAdmin = await this.program.account.lendingAdmin.fetch(
      this.pda.get_lending_admin()
    );

    return lendingAdmin.rebalancer;
  }

  public async getLendingAdminAuths(): Promise<PublicKey[]> {
    const lendingAdmin = await this.program.account.lendingAdmin.fetch(
      this.pda.get_lending_admin()
    );

    return lendingAdmin.auths;
  }

  /**
   * Check if an address is authorized by the Lending
   * @param auth The address to check
   * @returns True if the address is authorized
   */
  public async isLendingAuth(auth: PublicKey): Promise<boolean> {
    const lendingAdmin = await this.program.account.lendingAdmin.fetch(
      this.pda.get_lending_admin()
    );

    return lendingAdmin.auths.includes(auth);
  }

  /**
   * Get all available FToken types
   * @returns Array of fToken type strings
   */
  public getAllFTokenTypes(): string[] {
    // In Solana implementation, we don't have multiple fToken types like in Ethereum
    // But for compatibility, we can return a constant array
    return ["Standard"];
  }

  /**
   * Get all fToken addresses
   * @returns Array of fToken mint addresses
   */
  public async getAllFTokens(): Promise<PublicKey[]> {
    const lending = await this.program.account.lending.all();
    return lending.map((l) => l.account.fTokenMint);
  }

  /**
   * Compute the address of an fToken for a given asset
   * @param asset The underlying asset
   * @returns The computed fToken address
   */
  public computeFToken(asset: PublicKey): PublicKey {
    // Find the matching MintKey
    const mintKey = Object.values(MintKeys).find((key) =>
      MintInfo.getMint(key).equals(asset)
    );

    if (!mintKey) {
      throw new Error("Asset not found in mint keys");
    }

    // In Solana, we don't have different fToken types, so we ignore the fTokenType parameter
    return this.pda.get_f_token_mint(mintKey);
  }

  /**
   * Get detailed information about an fToken
   * @param mintKey The mint key for the token
   * @returns Detailed fToken information
   */
  public async getFTokenDetails(mintKey: MintKeys): Promise<FTokenDetails> {
    const fTokenMintPDA = this.pda.get_f_token_mint(mintKey);
    const lendingPDA = this.pda.get_lending(mintKey);

    // Fetch the Lending account
    const lending = await this.program.account.lending.fetch(lendingPDA);

    // Get user supply data from Liquidity
    const { userSupplyData, overallTokenData } =
      await this.liquidity.getUserSupplyData(
        lendingPDA, // The lending account is the "user" from Liquidity's perspective
        mintKey
      );

    // Get the fToken Mint details
    const mintInfo = await MintInfo.getMintInfo(
      localProvider.getProvider().connection,
      fTokenMintPDA
    );

    // Get rewards rate
    const [_, rewardsRate] = await this.getFTokenRewards(mintKey);

    // Calculate totalAssets
    const totalAssets = this.calculateTotalAssets(lending, mintInfo.supply);

    // Get liquidity balance
    const liquidityBalance = await this.getLiquidityBalance(
      lending,
      lendingPDA
    );

    // Convert BN values for conversionRates
    const conversionRateToShares = await this.convertToShares(
      mintKey,
      new BN(10).pow(new BN(lending.decimals))
    );

    const conversionRateToAssets = await this.convertToAssets(
      mintKey,
      new BN(10).pow(new BN(lending.decimals))
    );

    // Create the FTokenDetails object
    const details: FTokenDetails = {
      tokenAddress: fTokenMintPDA,
      name: `Fluid ${MintInfo.getSymbol(mintKey)}`,
      symbol: `f${MintInfo.getSymbol(mintKey)}`,
      decimals: lending.decimals,
      underlyingAddress: MintInfo.getMint(mintKey),
      totalAssets: new BN(totalAssets.toString()),
      totalSupply: new BN(mintInfo.supply.toString()),
      conversionRateToShares,
      conversionRateToAssets,
      rewardsRate: new BN(rewardsRate.toString()),
      supplyRate: overallTokenData.supplyRate,
      rebalanceDifference: new BN(liquidityBalance.toString()).sub(
        new BN(totalAssets.toString())
      ),
      userSupplyData,
    };

    return details;
  }

  /**
   * Get internal data from an fToken
   * @param mintKey The mint key for the token
   * @returns Internal fToken data
   */
  async getFTokenInternalData(mintKey: MintKeys): Promise<FTokenInternalData> {
    const lendingPDA = this.pda.get_lending(mintKey);
    const lending = await this.program.account.lending.fetch(lendingPDA);

    const lendingAdmin = await this.program.account.lendingAdmin.fetch(
      this.pda.get_lending_admin()
    );

    return {
      liquidity: new PublicKey(lendingAdmin.liquidityProgram),
      lendingFactory: this.pda.get_lending_admin(), // dummy return, since nothing like factory exists in solana
      lendingRewardsRateModel: lending.rewardsRateModel,
      rebalancer: lendingAdmin.rebalancer,
      liquidityBalance: new BN(
        await this.getLiquidityBalance(lending, lendingPDA)
      ),
      liquidityExchangePrice: await this._getLiquidityExchangePrice(mintKey),
      tokenExchangePrice: await this.getNewExchangePrice(mintKey),
    };
  }

  /**
   * Get detailed information about all fTokens
   * @returns Array of detailed fToken information
   */
  public async getFTokensEntireData(): Promise<FTokenDetails[]> {
    const mintKeys = Object.values(MintKeys);
    const results: FTokenDetails[] = [];

    for (const mintKey of mintKeys) {
      try {
        const details = await this.getFTokenDetails(mintKey);
        results.push(details);
      } catch (e) {
        console.error(`Error getting fToken details for ${mintKey}:`, e);
      }
    }

    return results;
  }

  /**
   * Get user positions across all fTokens
   * @param user The user address
   * @returns User position data for all fTokens
   */
  public async getUserPositions(
    user: PublicKey
  ): Promise<FTokenDetailsUserPosition[]> {
    const fTokens = await this.getFTokensEntireData();
    const positions: FTokenDetailsUserPosition[] = [];

    for (const fTokenDetails of fTokens) {
      try {
        // Extract mintKey from fTokenDetails
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
        console.error(
          `Error getting user position for token ${fTokenDetails.symbol}:`,
          e
        );
      }
    }

    return positions;
  }

  /**
   * Get rewards information for an fToken
   * @param mintKey The mint key for the token
   * @returns Rewards rate model information and current rate
   */
  public async getFTokenRewards(mintKey: MintKeys): Promise<[PublicKey, BN]> {
    const lendingPDA = this.pda.get_lending(mintKey);
    const lending = await this.program.account.lending.fetch(lendingPDA);

    let rewardsRate = new BN(0);

    if (!lending.rewardsRateModel.equals(PublicKey.default)) {
      try {
        // Fetch the fToken Mint info
        const fTokenMintInfo = await MintInfo.getMintInfo(
          localProvider.getProvider().connection,
          this.pda.get_f_token_mint(mintKey)
        );

        const totalAssets = this.calculateTotalAssets(
          lending,
          fTokenMintInfo.supply
        );

        // Fetch the rewards rate model
        const currentRateModel = await this.fetchRewardsRateModel(
          lending.rewardsRateModel
        );
        let previousRateModel = null;

        // Calculate rewards rate
        const result = await this.calculateRewardsRate(
          currentRateModel,
          totalAssets
        );

        rewardsRate = result.rewardsRate;
      } catch (e) {
        console.error(`Error calculating rewards rate for ${mintKey}:`, e);
      }
    }

    return [lending.rewardsRateModel, rewardsRate];
  }

  /**
   * Get configuration for an fToken rewards rate model
   * @param mintKey The mint key for the token
   * @returns Rewards rate model configuration
   */
  public async getFTokenRewardsRateModelConfig(
    mintKey: MintKeys
  ): Promise<RewardsRateModelConfig> {
    const lendingPDA = this.pda.get_lending(mintKey);
    const lending = await this.program.account.lending.fetch(lendingPDA);

    // Default return value
    const defaultConfig: RewardsRateModelConfig = {
      duration: new BN(0),
      startTime: new BN(0),
      endTime: new BN(0),
      startTvl: new BN(0),
      maxRate: new BN(0),
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

      return {
        duration: new BN(rateModel.duration.toString()),
        startTime: new BN(rateModel.startTime.toString()),
        endTime: new BN(rateModel.endTime.toString()),
        startTvl: new BN(rateModel.startTvl.toString()),
        maxRate: LENDING_CONSTANTS.MAX_REWARDS_RATE, // Use the constant max rate
        rewardAmount: new BN(rateModel.rewardAmount.toString()),
        initiator: rateModel.initiator,
      };
    } catch (e) {
      console.error(
        `Error fetching rewards rate model config for ${mintKey}:`,
        e
      );
      return defaultConfig;
    }
  }

  /**
   * Get a user's position for a specific fToken
   * @param mintKey The mint key for the token
   * @param user The user address
   * @returns User position information
   */
  public async getUserPosition(
    mintKey: MintKeys,
    user: PublicKey
  ): Promise<UserPosition> {
    const fTokenMintPDA = this.pda.get_f_token_mint(mintKey);
    const underlying = MintInfo.getMint(mintKey);

    // Get fToken balance
    const fTokenBalance = await MintInfo.getTokenBalance(
      localProvider.getProvider().connection,
      fTokenMintPDA,
      user
    );

    // Get underlying token balance
    const underlyingBalance = await MintInfo.getTokenBalance(
      localProvider.getProvider().connection,
      underlying,
      user
    );

    // Calculate equivalent assets
    const assets = await this.convertToAssets(
      mintKey,
      new BN(fTokenBalance.toString())
    );

    // For allowance, in Solana there's no direct equivalent to ERC20 allowance
    // We can use 0 as a placeholder or implement a custom allowance tracking mechanism
    const allowance = new BN(0);

    return {
      fTokenShares: new BN(fTokenBalance.toString()),
      underlyingAssets: assets,
      underlyingBalance: new BN(underlyingBalance.toString()),
      allowance,
    };
  }

  /**
   * Get previews for deposit/mint/withdraw/redeem operations
   * @param mintKey The mint key for the token
   * @param assets Asset amount to preview
   * @param shares Share amount to preview
   * @returns Preview data for various operations
   */
  public async getPreviews(
    mintKey: MintKeys,
    assets: BN,
    shares: BN
  ): Promise<PreviewData> {
    return {
      previewDeposit: await this.previewDeposit(mintKey, assets),
      previewMint: await this.previewMint(mintKey, shares),
      previewWithdraw: await this.previewWithdraw(mintKey, assets),
      previewRedeem: await this.previewRedeem(mintKey, shares),
    };
  }

  private async _getLiquidityExchangePrice(mintKey: MintKeys): Promise<BN> {
    return (await this.liquidity.getExchangePricesAndConfig(mintKey))
      .supplyExchangePrice;
  }

  private async getNewExchangePrice(mintKey: MintKeys): Promise<any> {
    const liquidityExchangePrice = await this._getLiquidityExchangePrice(
      mintKey
    );

    const lendingPDA = this.pda.get_lending(mintKey);
    const lending = await this.program.account.lending.fetch(lendingPDA);

    const oldTokenExchangePrice = new BN(lending.tokenExchangePrice.toString());
    const oldLiquidityExchangePrice = new BN(
      lending.liquidityExchangePrice.toString()
    );

    let totalReturnPercent = new BN(0);

    const totalSupply = await MintInfo.getMintInfo(
      localProvider.getProvider().connection,
      this.pda.get_f_token_mint(mintKey)
    );

    const totalAssets = oldTokenExchangePrice
      .mul(new BN(totalSupply.supply))
      .div(LENDING_CONSTANTS.EXCHANGE_PRICES_PRECISION);

    let rewardsRate = await this.rewardsRateModelResolver.getRate(
      mintKey,
      totalAssets
    );

    if (rewardsRate.rate.gt(LENDING_CONSTANTS.MAX_REWARDS_RATE)) {
      rewardsRate.rate = new BN(0);
    }

    let lastUpdateTime = new BN(lending.lastUpdateTimestamp.toString());

    if (lastUpdateTime < rewardsRate.rewardsStartTime) {
      lastUpdateTime = rewardsRate.rewardsStartTime;
    }

    totalReturnPercent = rewardsRate.rate
      .mul(new BN(Date.now() / 1000).sub(lastUpdateTime))
      .div(LENDING_CONSTANTS.SECONDS_PER_YEAR);

    const delta = new BN(liquidityExchangePrice).sub(oldLiquidityExchangePrice);
    totalReturnPercent = totalReturnPercent.add(
      delta.mul(new BN(1e14)).div(oldLiquidityExchangePrice)
    );

    return oldTokenExchangePrice.add(
      oldTokenExchangePrice.mul(totalReturnPercent).div(new BN(1e14))
    );
  }

  /**
   * Convert assets to shares
   * @param mintKey The mint key for the token
   * @param assets Asset amount to convert
   * @returns Equivalent share amount
   */
  private async convertToShares(mintKey: MintKeys, assets: BN): Promise<BN> {
    const exchangePrice = await this.getNewExchangePrice(mintKey);

    return assets
      .mul(LENDING_CONSTANTS.EXCHANGE_PRICES_PRECISION)
      .divRound(exchangePrice);
  }

  /**
   * Convert shares to assets
   * @param mintKey The mint key for the token
   * @param shares Share amount to convert
   * @returns Equivalent asset amount
   */
  private async convertToAssets(mintKey: MintKeys, shares: BN): Promise<BN> {
    const exchangePrice = await this.getNewExchangePrice(mintKey);

    return shares
      .mul(exchangePrice)
      .divRound(LENDING_CONSTANTS.EXCHANGE_PRICES_PRECISION);
  }

  /**
   * Preview deposit operation
   * @param mintKey The mint key for the token
   * @param assets Asset amount to preview
   * @returns Resulting share amount
   */
  private async previewDeposit(mintKey: MintKeys, assets: BN): Promise<BN> {
    return this.convertToShares(mintKey, assets);
  }

  /**
   * Preview mint operation
   * @param mintKey The mint key for the token
   * @param shares Share amount to preview
   * @returns Required asset amount
   */
  private async previewMint(mintKey: MintKeys, shares: BN): Promise<BN> {
    return this.convertToAssets(mintKey, shares);
  }

  /**
   * Preview withdraw operation
   * @param mintKey The mint key for the token
   * @param assets Asset amount to preview
   * @returns Required share amount
   */
  private async previewWithdraw(mintKey: MintKeys, assets: BN): Promise<BN> {
    return this.convertToShares(mintKey, assets);
  }

  /**
   * Preview redeem operation
   * @param mintKey The mint key for the token
   * @param shares Share amount to preview
   * @returns Resulting asset amount
   */
  private async previewRedeem(mintKey: MintKeys, shares: BN): Promise<BN> {
    return this.convertToAssets(mintKey, shares);
  }

  /**
   * Calculate total assets for an fToken
   * @param lending The lending account
   * @param totalSupply Total supply of the fToken
   * @returns Total asset amount
   */
  private calculateTotalAssets(lending: any, totalSupply: number | BN): number {
    const tokenExchangePrice = new BN(lending.tokenExchangePrice.toString());
    const totalSupplyBN =
      typeof totalSupply === "number"
        ? new BN(totalSupply.toString())
        : totalSupply;

    // totalAssets = (tokenExchangePrice * totalSupply) / EXCHANGE_PRICES_PRECISION
    return parseInt(
      tokenExchangePrice
        .mul(totalSupplyBN)
        .div(LENDING_CONSTANTS.EXCHANGE_PRICES_PRECISION)
        .toString()
    );
  }

  /**
   * Get liquidity balance for a lending account
   * @param lending The lending account
   * @returns Liquidity balance
   */
  private async getLiquidityBalance(
    lending: any,
    lendingPDA: PublicKey
  ): Promise<number> {
    try {
      // Get the liquidity mint key
      const mintKey = this.getMintKeyFromAddress(new PublicKey(lending.mint));

      if (!mintKey) {
        console.error(`Could not find mint key for address: ${lending.mint}`);
        return 0;
      }

      // Get the user supply data from the Liquidity program
      const userSupplyData = await this.liquidity.getUserSupply(
        lendingPDA,
        mintKey
      );

      // Check if userSupplyData is a BigNumber (BN) or an object with .amount
      if (!userSupplyData) {
        return 0;
      }

      if (BN.isBN(userSupplyData) && (userSupplyData as BN).isZero()) {
        return 0;
      }

      // Calculate liquidity balance using exchange price
      return parseInt(
        // @ts-ignore
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

  /**
   * Fetch a rewards rate model account
   * @param address The rewards rate model address
   * @returns The rewards rate model data
   */
  private async fetchRewardsRateModel(address: PublicKey): Promise<any> {
    try {
      const provider = localProvider.getProvider();
      const fetchedAccount = await provider.connection.getAccountInfo(address);

      if (!fetchedAccount) {
        throw new Error(
          `Rewards rate model account not found: ${address.toString()}`
        );
      }

      return await this.program.account.lendingRewardsRateModel.fetch(address);
    } catch (e) {
      console.error(
        `Error fetching rewards rate model ${address.toString()}:`,
        e
      );
      throw e;
    }
  }

  /**
   * Calculate rewards rate based on rate models and total assets
   * @param currentModel Current rewards rate model
   * @param previousModel Previous rewards rate model
   * @param totalAssets Total assets amount
   * @returns Calculated rewards rate information
   */
  private async calculateRewardsRate(
    currentModel: any,
    totalAssets: number
  ): Promise<{ rewardsRate: BN; rewardsEnded: boolean; rewardsStartTime: BN }> {
    const currentTimestamp = Math.floor(Date.now() / 1000);

    // Default return values
    const defaultResult = {
      rewardsRate: new BN(0),
      rewardsEnded: false,
      rewardsStartTime: new BN(currentModel.startTime.toString()),
    };

    // Check if rewards model is initialized
    if (currentModel.startTime === 0 || currentModel.endTime === 0) {
      return defaultResult;
    }

    // Check if rewards period has ended
    if (currentTimestamp > currentModel.endTime) {
      return {
        ...defaultResult,
        rewardsEnded: true,
      };
    }

    // Check if total assets are below the start threshold
    if (totalAssets < currentModel.startTvl) {
      return defaultResult;
    }

    // Calculate rewards rate
    let rewardsRate = new BN(currentModel.yearlyReward.toString())
      .mul(new BN(100_000_000_000_000)) // Scale factor
      .div(new BN(totalAssets.toString()));

    // Cap at max rewards rate
    if (rewardsRate.gt(LENDING_CONSTANTS.MAX_REWARDS_RATE)) {
      rewardsRate = LENDING_CONSTANTS.MAX_REWARDS_RATE;
    }

    return {
      rewardsRate,
      rewardsEnded: false,
      rewardsStartTime: new BN(currentModel.startTime.toString()),
    };
  }

  /**
   * Get MintKey from a token address
   * @param address Token address
   * @returns The corresponding MintKey
   */
  private getMintKeyFromAddress(address: PublicKey): MintKeys | null {
    for (const key of Object.values(MintKeys)) {
      if (MintInfo.getMint(key).equals(address)) {
        return key;
      }
    }
    return null;
  }
}

async function main() {
  const lendingResolver = new LendingResolver(signer.payer);

  console.log(
    "admin authority:",
    readableConsoleDump(await lendingResolver.getLendingAdminAuthority())
  );

  console.log(
    "admin rebalancer:",
    readableConsoleDump(await lendingResolver.getLendingAdminRebalancer())
  );

  console.log(
    "all auths:",
    readableConsoleDump(await lendingResolver.getLendingAdminAuths())
  );

  console.log(
    "all Tokens:",
    (await lendingResolver.getAllFTokens()).map((t) => t.toString())
  );

  const tokens = await lendingResolver.getFTokensEntireData();

  tokens.forEach((tokenData, idx) => {
    console.log(`\nToken #${idx + 1}:`);
    console.dir(readableConsoleDump(tokenData), {
      depth: null,
      colors: true,
    });
  });

  // const user = "HYbxGkNvEwvZ14RzJHPB9h3dWfXjxwAEhkyzJRHx1hBf";
  // const keys = [MintKeys.EURC, MintKeys.WSOL, MintKeys.USDC];

  // for (const key of keys) {
  //   const { fTokenShares, underlyingAssets, underlyingBalance, allowance } =
  //     await lendingResolver.getUserPosition(key, new PublicKey(user));

  //   console.log(key);
  //   console.log(fTokenShares.toString());
  //   console.log(underlyingAssets.toString());
  //   console.log(underlyingBalance.toString());
  //   console.log(allowance.toString());
  //   console.log("--------------------------------");
  // }
}

// main();
