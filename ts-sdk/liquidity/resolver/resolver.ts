import { BN } from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

import { Liquidity } from "../../../target/types/liquidity";
import LiquidityJson from "../../../target/idl/liquidity.json";

import {
  RateData,
  RateDataV1,
  RateDataV2,
  UserSupplyData,
  UserBorrowData,
  OverallTokenData,
  CONSTANTS,
  LiquidityCalcs,
} from "./types";

import { PDA } from "../context/pda";
import { MintKeys, mint as MintInfo } from "../../mint";
import { anchor as localProvider } from "../../connection";

interface SupportedTokenListAccount {
  tokens: PublicKey[];
}

interface TokenReserveAccount {
  mint: PublicKey;
  supplyExchangePrice: BN;
  borrowExchangePrice: BN;
  borrowRate: BN;
  fee: BN;
  lastStoredUtilization: BN;
  lastUpdateTimestamp: BN;
  maxUtilization: BN;
  supplyInterest: BN;
  supplyInterestFree: BN;
  borrowInterest: BN;
  borrowInterestFree: BN;
}

interface RateModelAccount {
  mint: PublicKey;
  version: number;
  rateAtUtilizationZero: BN;
  kink?: BN;
  rateAtUtilizationKink?: BN;
  kink1?: BN;
  rateAtUtilizationKink1?: BN;
  kink2?: BN;
  rateAtUtilizationKink2?: BN;
  rateAtUtilizationMax: BN;
}

interface UserSupplyPositionAccount {
  user: PublicKey;
  mint: PublicKey;
  amount: BN;
  withdrawalLimit: BN;
  baseWithdrawalLimit: BN;
  lastUpdateTimestamp: BN;
  expandPercent: BN;
  expandDuration: BN;
  modeWithInterest: boolean;
}

interface UserBorrowPositionAccount {
  user: PublicKey;
  mint: PublicKey;
  amount: BN;
  borrowLimit: BN;
  baseBorrowLimit: BN;
  maxBorrowLimit: BN;
  lastUpdateTimestamp: BN;
  expandPercent: BN;
  expandDuration: BN;
  modeWithInterest: boolean;
}

interface ExchangePricesAndConfig {
  supplyExchangePrice: BN;
  borrowExchangePrice: BN;
  borrowRate: BN;
  fee: BN;
  lastStoredUtilization: BN;
  lastUpdateTimestamp: BN;
  maxUtilization: BN;
  supplyRatio?: BN;
  supplyRatioInverse?: boolean;
  borrowRatio?: BN;
  borrowRatioInverse?: boolean;
}

interface TotalAmounts {
  supplyRawInterest: BN;
  supplyInterestFree: BN;
  borrowRawInterest: BN;
  borrowInterestFree: BN;
}

interface ExchangePriceResult {
  supplyExchangePrice: BN;
  borrowExchangePrice: BN;
}

/**
 * FluidLiquidityResolver class provides a convenient way to access data
 * from the Solana Liquidity program, similar to the FluidLiquidityResolver
 * smart contract in Solidity.
 */
export class FluidLiquidityResolver {
  private program: Program<Liquidity>;

  pda: PDA;

  SECONDS_PER_YEAR = new BN(31536000); // 365 * 24 * 60 * 60
  FOUR_DECIMALS = new BN(10000);
  EXCHANGE_PRICE_RATE_OUTPUT_DECIMALS = new BN(10).pow(new BN(18));
  EXCHANGE_PRICES_PRECISION = new BN(10).pow(new BN(12));

  private divCeil(numerator: BN, denominator: BN): BN {
    if (denominator.isZero()) {
      throw new Error("Division by zero");
    }
    const { div, mod } = numerator.divmod(denominator);
    return mod.isZero() ? div : div.addn(1);
  }

  /**
   * Create a new FluidLiquidityResolver instance
   * @param program The Liquidity program instance
   */
  constructor(authority: Keypair) {
    this.program = new Program(LiquidityJson, localProvider.getProvider());

    this.pda = new PDA(authority, this.program);
  }

  /*
   * --------------------------------------------------
   * ACCOUNT FETCHING METHODS
   * --------------------------------------------------
   */

  /**
   * Fetch the main liquidity account
   */
  public async getLiquidityAccount(): Promise<any> {
    const liquidityPDA = this.pda.get_liquidity();
    const authListPDA = this.pda.get_auth_list();

    try {
      const account = await this.program.account.liquidity.fetch(liquidityPDA);
      const authList = await this.program.account.authorizationList.fetch(
        authListPDA
      );

      // Adapt fields as needed based on program structure
      return {
        authority: account.authority,
        revenueCollector: account.revenueCollector || account.authority,
        status: account.status ? 1 : 0,
        auths: Array.isArray(authList.authUsers) ? authList.authUsers : [],
        guardians: Array.isArray(authList.guardians) ? authList.guardians : [],
        userClasses: Array.isArray(authList.userClasses)
          ? authList.userClasses
          : [],
      };
    } catch (error) {
      console.error(`Error fetching liquidity account:`, error);
      throw error;
    }
  }

  /**
   * Fetch the auth list account
   */
  private async getAuthListAccount(): Promise<any> {
    const authListPDA = this.pda.get_auth_list();

    try {
      // Try the standard account fetch first
      try {
        const account = await this.program.account.authorizationList.fetch(
          authListPDA
        );
        return {
          auths: account.authUsers || [],
        };
      } catch (e) {
        const account = await this.program.account.authorizationList.fetch(
          authListPDA
        );
        return {
          auths: account.authUsers || [],
        };
      }
    } catch (error) {
      console.error(`Error fetching auth list account:`, error);
      return null;
    }
  }

  /**
   * Fetch a token reserve account for a specific token
   */
  private async getTokenReserveAccount(
    token: MintKeys
  ): Promise<TokenReserveAccount> {
    const tokenReservePDA = this.pda.get_reserve(token);

    try {
      const account = await this.program.account.tokenReserve.fetch(
        tokenReservePDA
      );

      // Adapt field names based on program structure
      return {
        mint: account.mint,
        supplyExchangePrice: account.supplyExchangePrice || new BN(0),
        borrowExchangePrice: account.borrowExchangePrice || new BN(0),
        borrowRate: new BN(account.borrowRate || 0),
        fee: new BN(account.feeOnInterest || 0),
        lastStoredUtilization: new BN(account.lastUtilization || 0),
        lastUpdateTimestamp: account.lastUpdateTimestamp || new BN(0),
        maxUtilization: new BN(account.maxUtilization || 9500),
        supplyInterest: account.totalSupplyWithInterest || new BN(0),
        supplyInterestFree: account.totalSupplyInterestFree || new BN(0),
        borrowInterest: account.totalBorrowWithInterest || new BN(0),
        borrowInterestFree: account.totalBorrowInterestFree || new BN(0),
      };
    } catch (error) {
      console.error(
        `Error fetching token reserve account for ${token.toString()}:`,
        error
      );
      return null;
    }
  }

  /**
   * Fetch a rate model account for a specific token
   */
  private async getRateModelAccount(token: MintKeys): Promise<any> {
    const rateModelPDA = this.pda.get_rate_model(token);

    try {
      const account = await this.program.account.rateModel.fetch(rateModelPDA);

      // Handle V1 vs V2 rate models
      const version = account.version || 1;

      if (version === 1) {
        return {
          mint: account.mint,
          version: version,
          rateAtUtilizationZero: account.rateAtZero || new BN(0),
          kink: account.kink1Utilization || new BN(0),
          rateAtUtilizationKink: account.rateAtKink1 || new BN(0),
          rateAtUtilizationMax: account.rateAtMax || new BN(0),
        };
      } else if (version === 2) {
        return {
          mint: account.mint,
          version: version,
          rateAtUtilizationZero: account.rateAtZero || new BN(0),
          kink1: account.kink1Utilization || new BN(0),
          rateAtUtilizationKink1: account.rateAtKink1 || new BN(0),
          kink2: account.kink2Utilization || new BN(0),
          rateAtUtilizationKink2: account.rateAtKink2 || new BN(0),
          rateAtUtilizationMax: account.rateAtMax || new BN(0),
        };
      }
    } catch (error) {
      console.error(
        `Error fetching rate model account for ${token.toString()}:`,
        error
      );
      return null;
    }
  }

  /**
   * Fetch a user supply position account
   */
  private async getUserSupplyPositionAccount(
    user: PublicKey,
    token: MintKeys
  ): Promise<any> {
    const userSupplyPositionPDA = this.pda.get_user_supply_position(
      token,
      user
    );

    try {
      const account = await this.program.account.userSupplyPosition.fetch(
        userSupplyPositionPDA
      );
      return {
        user: account.protocol,
        mint: account.mint,
        amount: account.amount || new BN(0),
        withdrawalLimit: account.withdrawalLimit || new BN(0),
        baseWithdrawalLimit: account.baseWithdrawalLimit || new BN(0),
        lastUpdateTimestamp: account.lastUpdate || new BN(0),
        expandPercent: account.expandPct || new BN(0),
        expandDuration: account.expandDuration || new BN(0),
        modeWithInterest: account.withInterest || false,
      };
    } catch (error) {
      console.error(
        `Error fetching user supply position for ${user.toString()} and token ${token.toString()}:`,
        error
      );
      return null;
    }
  }

  /**
   * Fetch a user borrow position account
   */
  private async getUserBorrowPositionAccount(
    user: PublicKey,
    token: MintKeys
  ): Promise<any> {
    const userBorrowPositionPDA = this.pda.get_user_borrow_position(
      token,
      user
    );

    try {
      const account = await this.program.account.userBorrowPosition.fetch(
        userBorrowPositionPDA
      );
      return {
        user: account.protocol,
        mint: account.mint,
        amount: account.amount || new BN(0),
        borrowLimit: account.debtCeiling || new BN(0),
        baseBorrowLimit: account.baseDebtCeiling || new BN(0),
        maxBorrowLimit: account.maxDebtCeiling || new BN(0),
        lastUpdateTimestamp: account.lastUpdate || new BN(0),
        expandPercent: account.expandPct || new BN(0),
        expandDuration: account.expandDuration || new BN(0),
        modeWithInterest: account.withInterest || false,
      };
    } catch (error) {
      console.error(
        `Error fetching user borrow position for ${user.toString()} and token ${token.toString()}:`,
        error
      );
      return null;
    }
  }

  /**
   * Get the token balance in the liquidity program
   */
  private async getTokenBalance(token: MintKeys): Promise<BN> {
    try {
      const liquidityPDA = this.pda.get_liquidity();
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

  /*
   * --------------------------------------------------
   * PUBLIC API METHODS
   * --------------------------------------------------
   */

  /**
   * Get the revenue collector address
   * @returns The revenue collector address
   */
  async getRevenueCollector(): Promise<PublicKey> {
    const liquidityAccount = await this.getLiquidityAccount();
    return liquidityAccount.revenueCollector;
  }

  /**
   * Get the total revenue for a token
   * @param token The token address to check
   * @returns The revenue amount
   */
  async getRevenue(token: MintKeys): Promise<BN> {
    const tokenReserve = await this.getTokenReserveAccount(token);
    const exchangePricesAndConfig = await this.getExchangePricesAndConfig(
      token
    );

    if (!tokenReserve || !exchangePricesAndConfig) {
      return new BN(0);
    }

    const liquidityTokenBalance = await this.getTokenBalance(token);
    const totalAmounts = await this.getTotalAmounts(token);

    return LiquidityCalcs.calcRevenue(
      totalAmounts,
      exchangePricesAndConfig,
      liquidityTokenBalance
    );
  }

  /**
   * Get the current liquidity status
   * @returns The status value
   */
  async getStatus(): Promise<number> {
    const liquidityAccount = await this.getLiquidityAccount();
    return liquidityAccount.status;
  }

  /**
   * Check if an address is authorized
   * @param auth The address to check
   * @returns 1 if authorized, 0 otherwise
   */
  async isAuth(auth: PublicKey): Promise<number> {
    const authList = await this.getAuthListAccount();
    if (!authList) return 0;

    return authList.auths.find((a: any) => a.addr.equals(auth) && a.value)
      ? 1
      : 0;
  }

  /**
   * Check if an address is a guardian
   * @param guardian The address to check
   * @returns 1 if guardian, 0 otherwise
   */
  async isGuardian(guardian: PublicKey): Promise<number> {
    const liquidityAccount = await this.getLiquidityAccount();

    return liquidityAccount.guardians.find(
      (g: any) => g.addr.equals(guardian) && g.value
    )
      ? 1
      : 0;
  }

  /**
   * Get the user class for a given address
   * @param user The user address to check
   * @returns The user class (0 = new, 1 = established)
   */
  async getUserClass(user: PublicKey): Promise<number> {
    const liquidityAccount = await this.getLiquidityAccount();

    const userClass = liquidityAccount.userClasses.find((uc: any) =>
      uc.addr.equals(user)
    );
    return userClass ? userClass.value : 0;
  }

  /**
   * Get overall data for all listed tokens
   * @returns Array of overall token data objects
   */
  async getAllOverallTokensData(): Promise<OverallTokenData[]> {
    const tokens = await this.listedTokens();

    const mintKeys = tokens
      .map((pubkey) => {
        if (pubkey.toString() === MintInfo.getMint(MintKeys.WSOL).toString()) {
          return MintKeys.WSOL;
        } else if (
          pubkey.toString() === MintInfo.getMint(MintKeys.USDC).toString()
        ) {
          return MintKeys.USDC;
        } else if (
          pubkey.toString() === MintInfo.getMint(MintKeys.EURC).toString()
        ) {
          return MintKeys.EURC;
        } else if (
          pubkey.toString() === MintInfo.getMint(MintKeys.USDT).toString()
        ) {
          return MintKeys.USDT;
        } else if (
          pubkey.toString() === MintInfo.getMint(MintKeys.WBTC).toString()
        ) {
          return MintKeys.WBTC;
        } else if (
          pubkey.toString() === MintInfo.getMint(MintKeys.JUPSOL).toString()
        ) {
          return MintKeys.JUPSOL;
        } else if (
          pubkey.toString() === MintInfo.getMint(MintKeys.JITOSOL).toString()
        ) {
          return MintKeys.JITOSOL;
        } else if (
          pubkey.toString() === MintInfo.getMint(MintKeys.USDG).toString()
        ) {
          return MintKeys.USDG;
        } else if (
          pubkey.toString() === MintInfo.getMint(MintKeys.SYRUPUSDC).toString()
        ) {
          return MintKeys.SYRUPUSDC;
        } else if (
          pubkey.toString() === MintInfo.getMint(MintKeys.DUMMY).toString()
        ) {
          return MintKeys.DUMMY;
        } else if (
          pubkey.toString() === MintInfo.getMint(MintKeys.XBTC).toString()
        ) {
          return MintKeys.XBTC;
        } else if (
          pubkey.toString() === MintInfo.getMint(MintKeys.CBBTC).toString()
        ) {
          return MintKeys.CBBTC;
        } else if (
          pubkey.toString() === MintInfo.getMint(MintKeys.JLP).toString()
        ) {
          return MintKeys.JLP;
        } else if (
          pubkey.toString() === MintInfo.getMint(MintKeys.USDS).toString()
        ) {
          return MintKeys.USDS;
        }
        return null;
      })
      .filter((token) => token !== null) as MintKeys[];
    return this.getOverallTokensData(mintKeys);
  }

  getSupplyRatio(
    total_supply_with_interest: BN,
    total_supply_interest_free: BN
  ): BN {
    let supply_ratio: BN;
    if (total_supply_with_interest.gt(total_supply_interest_free)) {
      // supply ratio with interest supply being larger
      supply_ratio = total_supply_interest_free
        .mul(new BN(1e4))
        .div(total_supply_with_interest);
    } else if (total_supply_with_interest.lt(total_supply_interest_free)) {
      // supply ratio with interest free being larger
      supply_ratio = total_supply_with_interest
        .mul(new BN(1e4))
        .div(total_supply_interest_free);
    } else {
      // supplies match exactly
      if (total_supply_with_interest.gt(new BN(0))) {
        // supplies are not 0 -> set ratio to 1
        supply_ratio = new BN(1e4);
      } else {
        // if total supply = 0
        supply_ratio = new BN(0);
      }
    }

    return supply_ratio;
  }

  getBorrowRatio(
    total_borrow_with_interest: BN,
    total_borrow_interest_free: BN
  ): BN {
    let borrow_ratio: BN;

    if (total_borrow_with_interest.gt(total_borrow_interest_free)) {
      // borrow ratio with interest borrow being larger
      borrow_ratio = total_borrow_interest_free
        .mul(new BN(1e4))
        .div(total_borrow_with_interest);
    } else if (total_borrow_with_interest.lt(total_borrow_interest_free)) {
      // borrow ratio with interest free being larger
      borrow_ratio = total_borrow_with_interest
        .mul(new BN(1e4))
        .div(total_borrow_interest_free);
    } else {
      // borrows match exactly
      if (total_borrow_with_interest.gt(new BN(0))) {
        borrow_ratio = new BN(1e4);
      } else {
        // if total borrows = 0
        borrow_ratio = new BN(0);
      }
    }

    return borrow_ratio;
  }

  /**
   * Get the exchange prices and configuration for a token
   * @param token The token address
   * @returns The exchange prices and config data
   */
  async getExchangePricesAndConfig(
    token: MintKeys
  ): Promise<ExchangePricesAndConfig | null> {
    const tokenReserve = await this.getTokenReserveAccount(token);
    if (!tokenReserve) return null;

    const totalSupplyWithInterest = tokenReserve.supplyInterest;
    const totalSupplyInterestFree = tokenReserve.supplyInterestFree;
    const totalBorrowWithInterest = tokenReserve.borrowInterest;
    const totalBorrowInterestFree = tokenReserve.borrowInterestFree;

    const supplyRatio = this.getSupplyRatio(
      totalSupplyWithInterest,
      totalSupplyInterestFree
    );

    const borrowRatio = this.getBorrowRatio(
      totalBorrowWithInterest,
      totalBorrowInterestFree
    );

    // Format in a structure compatible with the Solidity interface
    return {
      supplyExchangePrice: tokenReserve.supplyExchangePrice,
      borrowExchangePrice: tokenReserve.borrowExchangePrice,
      borrowRate: tokenReserve.borrowRate,
      fee: tokenReserve.fee,
      lastStoredUtilization: tokenReserve.lastStoredUtilization,
      lastUpdateTimestamp: tokenReserve.lastUpdateTimestamp,
      maxUtilization:
        tokenReserve.maxUtilization || CONSTANTS.DEFAULT_MAX_UTILIZATION,
      supplyRatio: supplyRatio,
      supplyRatioInverse: totalSupplyWithInterest.lt(totalSupplyInterestFree),
      borrowRatio: borrowRatio,
      borrowRatioInverse: totalBorrowWithInterest.lt(totalBorrowInterestFree),
    };
  }

  /**
   * Get the rate configuration for a token
   * @param token The token address
   * @returns The rate data
   */
  async getRateConfig(token: MintKeys): Promise<RateModelAccount | null> {
    const rateModel = await this.getRateModelAccount(token);
    if (!rateModel) return null;

    return rateModel;
  }

  getTotalSupply(totalSupply: BN, totalSupplyRaw: BN, supplyExchangePrice: BN) {
    return totalSupply
      .add(totalSupplyRaw)
      .mul(supplyExchangePrice)
      .div(CONSTANTS.EXCHANGE_PRICES_PRECISION);
  }

  getTotalBorrow(totalBorrow: BN, totalBorrowRaw: BN, borrowExchangePrice: BN) {
    return totalBorrow
      .add(totalBorrowRaw)
      .mul(borrowExchangePrice)
      .div(CONSTANTS.EXCHANGE_PRICES_PRECISION);
  }

  /**
   * Get the total amounts for a token
   * @param token The token address
   * @returns The total amounts data
   */
  async getTotalAmounts(token: MintKeys): Promise<TotalAmounts | null> {
    const tokenReserve = await this.getTokenReserveAccount(token);
    if (!tokenReserve) return null;

    // Format in a structure compatible with the Solidity interface
    return {
      supplyRawInterest: tokenReserve.supplyInterest,
      supplyInterestFree: tokenReserve.supplyInterestFree,
      borrowRawInterest: tokenReserve.borrowInterest,
      borrowInterestFree: tokenReserve.borrowInterestFree,
    };
  }

  /**
   * Get additional configuration for a token (maxUtilization etc.)
   * @param token The token address
   * @returns The configs2 data
   */
  async getConfigs2(token: MintKeys): Promise<{ maxUtilization: BN } | null> {
    const tokenReserve = await this.getTokenReserveAccount(token);
    if (!tokenReserve) return null;

    return {
      maxUtilization:
        tokenReserve.maxUtilization || CONSTANTS.DEFAULT_MAX_UTILIZATION,
    };
  }

  /**
   * Get user supply information for a token
   * @param user The user address
   * @param token The token address
   * @returns The user supply data
   */
  async getUserSupply(
    user: PublicKey,
    token: MintKeys
  ): Promise<UserSupplyPositionAccount | BN> {
    const userSupplyPosition = await this.getUserSupplyPositionAccount(
      user,
      token
    );

    if (!userSupplyPosition) return new BN(0);

    return {
      amount: userSupplyPosition.amount,
      mint: userSupplyPosition.mint,
      user: userSupplyPosition.user,
      withdrawalLimit: userSupplyPosition.withdrawalLimit,
      baseWithdrawalLimit: userSupplyPosition.baseWithdrawalLimit,
      lastUpdateTimestamp: userSupplyPosition.lastUpdateTimestamp,
      expandPercent: userSupplyPosition.expandPercent,
      expandDuration: userSupplyPosition.expandDuration,
      modeWithInterest: userSupplyPosition.modeWithInterest,
    };
  }

  /**
   * Get user borrow information for a token
   * @param user The user address
   * @param token The token address
   * @returns The user borrow data
   */
  async getUserBorrow(
    user: PublicKey,
    token: MintKeys
  ): Promise<UserBorrowPositionAccount | BN> {
    const userBorrowPosition = await this.getUserBorrowPositionAccount(
      user,
      token
    );
    if (!userBorrowPosition) return new BN(0);

    return {
      amount: userBorrowPosition.amount,
      mint: userBorrowPosition.mint,
      user: userBorrowPosition.user,
      borrowLimit: userBorrowPosition.borrowLimit,
      baseBorrowLimit: userBorrowPosition.baseBorrowLimit,
      maxBorrowLimit: userBorrowPosition.maxBorrowLimit,
      lastUpdateTimestamp: userBorrowPosition.lastUpdateTimestamp,
      expandPercent: userBorrowPosition.expandPercent,
      expandDuration: userBorrowPosition.expandDuration,
      modeWithInterest: userBorrowPosition.modeWithInterest,
    };
  }

  /**
   * Fetch the supported token list account
   */
  private async getSupportedTokenListAccount(): Promise<SupportedTokenListAccount | null> {
    const supportedTokenListPDA = this.pda.get_supported_token_list();

    try {
      const account = await this.program.account.tokenReserve.all();

      return {
        tokens: account.map((t) => t.account.mint),
      };
    } catch (error) {
      console.error(`Error fetching supported token list account:`, error);
      return null;
    }
  }

  /**
   * Get all listed tokens
   * @returns Array of token addresses
   */
  async listedTokens(): Promise<PublicKey[]> {
    const account = await this.program.account.tokenReserve.all();

    return account.map((t) => t.account.mint);
  }

  /**
   * Get rate data for a specific token
   * @param token The token address
   * @returns The rate data
   */
  async getTokenRateData(token: MintKeys): Promise<RateData> {
    const rateModel = await this.getRateModelAccount(token);
    if (!rateModel) {
      return {
        token: MintInfo.getMint(token),
        version: 0,
        rateDataV1: {} as RateDataV1,
        rateDataV2: {} as RateDataV2,
      };
    }

    const rateData: RateData = {
      token: MintInfo.getMint(token),
      version: rateModel.version,
      rateDataV1: {} as RateDataV1,
      rateDataV2: {} as RateDataV2,
    };

    if (rateModel.version === 1) {
      rateData.rateDataV1 = {
        token: MintInfo.getMint(token),
        rateAtUtilizationZero: rateModel.rateAtUtilizationZero,
        kink: rateModel.kink || new BN(0),
        rateAtUtilizationKink: rateModel.rateAtUtilizationKink || new BN(0),
        rateAtUtilizationMax: rateModel.rateAtUtilizationMax,
      };
    } else if (rateModel.version === 2) {
      rateData.rateDataV2 = {
        token: MintInfo.getMint(token),
        rateAtUtilizationZero: rateModel.rateAtUtilizationZero,
        kink1: rateModel.kink1 || new BN(0),
        rateAtUtilizationKink1: rateModel.rateAtUtilizationKink1 || new BN(0),
        kink2: rateModel.kink2 || new BN(0),
        rateAtUtilizationKink2: rateModel.rateAtUtilizationKink2 || new BN(0),
        rateAtUtilizationMax: rateModel.rateAtUtilizationMax,
      };
    }

    return rateData;
  }

  /**
   * Get rate data for multiple tokens
   * @param tokens Array of token addresses
   * @returns Array of rate data objects
   */
  async getTokensRateData(tokens: MintKeys[]): Promise<RateData[]> {
    const promises = tokens.map((token) => this.getTokenRateData(token));
    return Promise.all(promises);
  }

  getBlockTimestamp(): BN {
    return new BN(Math.floor(Date.now() / 1000));
  }

  /**
   * Calculate exchange prices based on current configuration
   * This implements the same logic as the Rust calculate_exchange_prices function
   * @param config Exchange prices and configuration data
   * @returns Updated exchange prices
   */
  async calculateExchangePrice(
    config: ExchangePricesAndConfig
  ): Promise<ExchangePriceResult> {
    let supplyExchangePrice = new BN(config.supplyExchangePrice.toString());
    let borrowExchangePrice = new BN(config.borrowExchangePrice.toString());

    // Check for zero exchange prices
    if (supplyExchangePrice.isZero() || borrowExchangePrice.isZero()) {
      throw new Error("Exchange price is zero");
    }

    const borrowRate = new BN(config.borrowRate.toString());

    // Calculate seconds since last update
    const currentTimestamp = this.getBlockTimestamp();
    const lastUpdateTimestamp = new BN(config.lastUpdateTimestamp.toString());

    const secondsSinceLastUpdate: BN =
      currentTimestamp.sub(lastUpdateTimestamp);

    // Early return conditions
    if (secondsSinceLastUpdate.isZero() || borrowRate.isZero()) {
      return { supplyExchangePrice, borrowExchangePrice };
    }

    // Calculate new borrow exchange price
    // Formula: borrowExchangePrice += (borrowExchangePrice * borrowRate * secondsSinceLastUpdate) / (SECONDS_PER_YEAR * FOUR_DECIMALS)
    const borrowRateIncrease = this.divCeil(
      borrowExchangePrice.mul(borrowRate).mul(secondsSinceLastUpdate),
      this.SECONDS_PER_YEAR.mul(this.FOUR_DECIMALS)
    );

    borrowExchangePrice = borrowExchangePrice.add(borrowRateIncrease);

    // Get borrow and supply ratios
    let borrowRatio = config.borrowRatio
      ? new BN(config.borrowRatio.toString())
      : new BN(0);
    let supplyRatio = config.supplyRatio
      ? new BN(config.supplyRatio.toString())
      : new BN(0);

    // Check if borrowRatio == 1
    if (borrowRatio.eq(new BN(1))) {
      // if no raw supply: no exchange price update needed
      // (if supplyRatio_ == 1 means there is only supplyInterestFree, as first bit is 1 and rest is 0)
      return { supplyExchangePrice, borrowExchangePrice };
    }

    // Calculate supply exchange price
    // Early return if no raw supply
    if (config.supplyRatioInverse && supplyRatio.isZero()) {
      return { supplyExchangePrice, borrowExchangePrice };
    }

    // Calculate ratio supply yield
    let ratioSupplyYield: BN;

    if (config.supplyRatioInverse) {
      // ratio is supplyWithInterest / supplyInterestFree (supplyInterestFree is bigger)
      const supplyRatioCalc = this.EXCHANGE_PRICE_RATE_OUTPUT_DECIMALS.mul(
        this.FOUR_DECIMALS
      ).div(supplyRatio);

      const utilization = new BN(config.lastStoredUtilization.toString());
      ratioSupplyYield = utilization
        .mul(this.EXCHANGE_PRICE_RATE_OUTPUT_DECIMALS.add(supplyRatioCalc))
        .div(this.FOUR_DECIMALS);
    } else {
      const utilization = new BN(config.lastStoredUtilization.toString());
      ratioSupplyYield = utilization
        .mul(this.EXCHANGE_PRICE_RATE_OUTPUT_DECIMALS)
        .mul(this.FOUR_DECIMALS.add(supplyRatio))
        .div(this.FOUR_DECIMALS.mul(this.FOUR_DECIMALS));
    }

    // Calculate adjusted borrow ratio
    let adjustedBorrowRatio: BN;

    if (config.borrowRatioInverse) {
      // ratio is borrowWithInterest / borrowInterestFree (borrowInterestFree is bigger)
      adjustedBorrowRatio = borrowRatio
        .mul(this.EXCHANGE_PRICE_RATE_OUTPUT_DECIMALS)
        .div(this.FOUR_DECIMALS.add(borrowRatio));
    } else {
      // ratio is borrowInterestFree / borrowWithInterest (borrowWithInterest is bigger)
      adjustedBorrowRatio = this.EXCHANGE_PRICE_RATE_OUTPUT_DECIMALS.sub(
        borrowRatio
          .mul(this.EXCHANGE_PRICE_RATE_OUTPUT_DECIMALS)
          .div(this.FOUR_DECIMALS.add(borrowRatio))
      );
    }

    // Final ratio supply yield calculation
    ratioSupplyYield = ratioSupplyYield
      .mul(adjustedBorrowRatio)
      .mul(this.FOUR_DECIMALS)
      .div(this.EXCHANGE_PRICE_RATE_OUTPUT_DECIMALS)
      .div(this.EXCHANGE_PRICE_RATE_OUTPUT_DECIMALS);

    // Calculate supply rate
    // supply rate = (borrow rate - revenueFee%) * ratioSupplyYield
    const fee = new BN(config.fee.toString());
    const supplyRate = borrowRate
      .mul(ratioSupplyYield)
      .mul(this.FOUR_DECIMALS.sub(fee));

    // Calculate increase in supply exchange price
    const supplyRateIncrease = supplyExchangePrice
      .mul(supplyRate)
      .mul(secondsSinceLastUpdate)
      .div(this.SECONDS_PER_YEAR.mul(this.FOUR_DECIMALS))
      .div(this.FOUR_DECIMALS.mul(this.FOUR_DECIMALS));

    supplyExchangePrice = supplyExchangePrice.add(supplyRateIncrease);

    return { supplyExchangePrice, borrowExchangePrice };
  }

  async getOverallTokenData(token: MintKeys): Promise<OverallTokenData> {
    const rateData = await this.getTokenRateData(token);
    const exchangePricesAndConfig = await this.getExchangePricesAndConfig(
      token
    );
    const totalAmounts = await this.getTotalAmounts(token);

    const overallTokenData: OverallTokenData = {
      rateData,
      supplyExchangePrice: new BN(0),
      borrowExchangePrice: new BN(0),
      borrowRate: new BN(0),
      fee: new BN(0),
      lastStoredUtilization: new BN(0),
      lastUpdateTimestamp: new BN(0),
      maxUtilization: CONSTANTS.DEFAULT_MAX_UTILIZATION,
      supplyRawInterest: new BN(0),
      supplyInterestFree: new BN(0),
      borrowRawInterest: new BN(0),
      borrowInterestFree: new BN(0),
      totalSupply: new BN(0),
      totalBorrow: new BN(0),
      revenue: new BN(0),
      supplyRate: new BN(0),
    };

    let { supplyExchangePrice, borrowExchangePrice } =
      await this.calculateExchangePrice(exchangePricesAndConfig);

    if (exchangePricesAndConfig && totalAmounts) {
      // Set exchange prices and configs
      overallTokenData.supplyExchangePrice = supplyExchangePrice;
      overallTokenData.borrowExchangePrice = borrowExchangePrice;
      overallTokenData.borrowRate = exchangePricesAndConfig.borrowRate;
      overallTokenData.fee = exchangePricesAndConfig.fee;
      overallTokenData.lastStoredUtilization =
        exchangePricesAndConfig.lastStoredUtilization;
      overallTokenData.lastUpdateTimestamp =
        exchangePricesAndConfig.lastUpdateTimestamp;
      overallTokenData.maxUtilization = exchangePricesAndConfig.maxUtilization;

      // Set total amounts
      overallTokenData.supplyRawInterest = totalAmounts.supplyRawInterest;
      overallTokenData.supplyInterestFree = totalAmounts.supplyInterestFree;
      overallTokenData.borrowRawInterest = totalAmounts.borrowRawInterest;
      overallTokenData.borrowInterestFree = totalAmounts.borrowInterestFree;

      // Calculate normalized values
      let supplyWithInterest = totalAmounts.supplyRawInterest
        .mul(overallTokenData.supplyExchangePrice)
        .div(CONSTANTS.EXCHANGE_PRICES_PRECISION);

      let borrowWithInterest = totalAmounts.borrowRawInterest
        .mul(overallTokenData.borrowExchangePrice)
        .div(CONSTANTS.EXCHANGE_PRICES_PRECISION);
      overallTokenData.totalSupply = supplyWithInterest.add(
        totalAmounts.supplyInterestFree
      );
      overallTokenData.totalBorrow = borrowWithInterest.add(
        totalAmounts.borrowInterestFree
      );

      // Calculate supply rate
      if (!totalAmounts.supplyRawInterest.isZero()) {
        const borrowWithInterestForRate = totalAmounts.borrowRawInterest
          .mul(exchangePricesAndConfig.borrowExchangePrice)
          .div(CONSTANTS.EXCHANGE_PRICES_PRECISION);

        const supplyWithInterestForRate = totalAmounts.supplyRawInterest
          .mul(exchangePricesAndConfig.supplyExchangePrice)
          .div(CONSTANTS.EXCHANGE_PRICES_PRECISION);

        if (!supplyWithInterestForRate.isZero()) {
          overallTokenData.supplyRate = overallTokenData.borrowRate
            .mul(CONSTANTS.FOUR_DECIMALS.sub(overallTokenData.fee))
            .mul(borrowWithInterestForRate)
            .div(supplyWithInterestForRate.mul(CONSTANTS.FOUR_DECIMALS));
        }
      }

      // Calculate revenue
      overallTokenData.revenue = await this.getRevenue(token);
    }

    return overallTokenData;
  }

  /**
   * Get overall token data for multiple tokens
   * @param tokens Array of token addresses
   * @returns Array of overall token data objects
   */
  async getOverallTokensData(tokens: MintKeys[]): Promise<OverallTokenData[]> {
    const promises = tokens.map((token) => this.getOverallTokenData(token));
    return Promise.all(promises);
  }

  /**
   * Calculate withdrawal limit before an operate execution
   * @param userSupplyAccount User supply position account data
   * @param userSupply Current user supply amount
   * @returns Current withdrawal limit updated for expansion since last interaction
   */
  private calcWithdrawalLimitBeforeOperate(
    userSupplyAccount: UserSupplyPositionAccount,
    userSupply: BN
  ): BN {
    // Extract last set withdrawal limit (already decompiled in your account fetch)
    let lastWithdrawalLimit = userSupplyAccount.withdrawalLimit;

    if (lastWithdrawalLimit.isZero()) {
      // withdrawal limit is not activated. Max withdrawal allowed
      return new BN(0);
    }

    // Extract max withdrawable percent of user supply and
    // calculate maximum withdrawable amount expandPercentage of user supply at full expansion duration elapsed
    // e.g.: if 10% expandPercentage, meaning 10% is withdrawable after full expandDuration has elapsed.
    const maxWithdrawableLimit = userSupply
      .mul(new BN(userSupplyAccount.expandPercent))
      .div(CONSTANTS.FOUR_DECIMALS);

    // Calculate time elapsed since last withdrawal limit was set (in seconds)
    const currentTimestamp = this.getBlockTimestamp();
    const secondsSinceLastUpdate = currentTimestamp.sub(
      userSupplyAccount.lastUpdateTimestamp
    );

    // Calculate withdrawable amount of expandPercent that is elapsed of expandDuration.
    // e.g. if 60% of expandDuration has elapsed, then user should be able to withdraw 6% of user supply, down to 94%.
    const withdrawableAmount = maxWithdrawableLimit
      .mul(secondsSinceLastUpdate)
      .div(new BN(userSupplyAccount.expandDuration)); // expand duration can never be 0

    // Calculate expanded withdrawal limit: last withdrawal limit - withdrawable amount.
    // Handle underflow explicitly
    let currentWithdrawalLimit = lastWithdrawalLimit.gt(withdrawableAmount)
      ? lastWithdrawalLimit.sub(withdrawableAmount)
      : new BN(0);

    // Calculate minimum withdrawal limit: minimum amount of user supply that must stay supplied at full expansion.
    const minimumWithdrawalLimit = userSupply.sub(maxWithdrawableLimit);

    // If withdrawal limit is decreased below minimum then set minimum
    // (e.g. when more than expandDuration time has elapsed)
    if (minimumWithdrawalLimit.gt(currentWithdrawalLimit)) {
      currentWithdrawalLimit = minimumWithdrawalLimit;
    }

    return currentWithdrawalLimit;
  }

  /**
   * Get user supply data with overall token data
   * @param user The user address
   * @param token The token address
   * @returns User supply data and overall token data
   */
  async getUserSupplyData(
    user: PublicKey,
    token: MintKeys
  ): Promise<{
    userSupplyData: UserSupplyData;
    overallTokenData: OverallTokenData;
  }> {
    const overallTokenData = await this.getOverallTokenData(token);
    const userSupply = await this.getUserSupply(user, token);

    let userSupplyData: UserSupplyData = {
      modeWithInterest: false,
      supply: new BN(0),
      withdrawalLimit: new BN(0),
      lastUpdateTimestamp: new BN(0),
      expandPercent: new BN(0),
      expandDuration: new BN(0),
      baseWithdrawalLimit: new BN(0),
      withdrawableUntilLimit: new BN(0),
      withdrawable: new BN(0),
    };

    if (userSupply instanceof BN && userSupply.eq(new BN(0))) {
      // userSupply is BN(0) when user not configured yet
      return { userSupplyData, overallTokenData };
    }

    const userSupplyAccount = userSupply as UserSupplyPositionAccount;

    userSupplyData.modeWithInterest = userSupplyAccount.modeWithInterest;
    userSupplyData.supply = userSupplyAccount.amount;
    userSupplyData.withdrawalLimit = this.calcWithdrawalLimitBeforeOperate(
      userSupplyAccount,
      userSupplyAccount.amount
    );

    userSupplyData.lastUpdateTimestamp = userSupplyAccount.lastUpdateTimestamp;
    userSupplyData.expandPercent = userSupplyAccount.expandPercent;
    userSupplyData.expandDuration = userSupplyAccount.expandDuration;
    userSupplyData.baseWithdrawalLimit = userSupplyAccount.baseWithdrawalLimit;

    if (userSupplyData.modeWithInterest) {
      // Convert raw amounts to normal for withInterest mode
      userSupplyData.supply = userSupplyData.supply
        .mul(overallTokenData.supplyExchangePrice)
        .div(CONSTANTS.EXCHANGE_PRICES_PRECISION);
      userSupplyData.withdrawalLimit = userSupplyData.withdrawalLimit
        .mul(overallTokenData.supplyExchangePrice)
        .div(CONSTANTS.EXCHANGE_PRICES_PRECISION);
      userSupplyData.baseWithdrawalLimit = userSupplyData.baseWithdrawalLimit
        .mul(overallTokenData.supplyExchangePrice)
        .div(CONSTANTS.EXCHANGE_PRICES_PRECISION);
    }

    userSupplyData.withdrawableUntilLimit = userSupplyData.supply.gt(
      userSupplyData.withdrawalLimit
    )
      ? userSupplyData.supply.sub(userSupplyData.withdrawalLimit)
      : new BN(0);

    if (userSupplyData.withdrawalLimit.isZero()) {
      userSupplyData.withdrawalLimit = userSupplyData.supply;
    }

    const balanceOf = await this.getTokenBalance(token);
    userSupplyData.withdrawable = balanceOf.gt(
      userSupplyData.withdrawableUntilLimit
    )
      ? userSupplyData.withdrawableUntilLimit
      : balanceOf;

    return { userSupplyData, overallTokenData };
  }

  /**
   * Get user supply data for multiple tokens
   * @param user The user address
   * @param tokens Array of token addresses
   * @returns Arrays of user supply data and overall token data
   */
  async getUserMultipleSupplyData(
    user: PublicKey,
    tokens: MintKeys[]
  ): Promise<{
    userSuppliesData: UserSupplyData[];
    overallTokensData: OverallTokenData[];
  }> {
    const promises = tokens.map((token) => this.getUserSupplyData(user, token));
    const results = await Promise.all(promises);

    const userSuppliesData = results.map((r) => r.userSupplyData);
    const overallTokensData = results.map((r) => r.overallTokenData);

    return { userSuppliesData, overallTokensData };
  }

  /**
   * Calculate borrow limit before an operate execution
   * @param userBorrowAccount User borrow position account data
   * @param userBorrow Current user borrow amount
   * @returns Current borrow limit updated for expansion since last interaction
   */
  private calcBorrowLimitBeforeOperate(
    userBorrowAccount: UserBorrowPositionAccount,
    userBorrow: BN
  ): BN {
    // Extract borrow expand percent
    const expandPercent = new BN(userBorrowAccount.expandPercent.toString());
    const fourDecimals = new BN(CONSTANTS.FOUR_DECIMALS.toString());
    const userBorrowBN = new BN(userBorrow.toString());

    // Calculate max expansion limit: Max amount limit can expand to since last interaction
    const maxExpansionLimit = userBorrowBN.mul(expandPercent).div(fourDecimals);

    // Calculate max borrow limit: Max point limit can increase to since last interaction
    const maxExpandedBorrowLimit = userBorrowBN.add(maxExpansionLimit);

    // Extract base borrow limit
    const baseBorrowLimit = new BN(
      userBorrowAccount.baseBorrowLimit.toString()
    );
    // Calculate time elapsed since last borrow limit was set (in seconds)
    const currentTimestamp = this.getBlockTimestamp();
    const lastUpdateTimestamp = new BN(
      userBorrowAccount.lastUpdateTimestamp.toString()
    );
    const expandDuration = new BN(userBorrowAccount.expandDuration.toString());

    // Ensure timestamps are valid
    if (currentTimestamp.lt(lastUpdateTimestamp)) {
      return baseBorrowLimit;
    }

    const timeElapsed = currentTimestamp.sub(lastUpdateTimestamp);

    if (expandDuration.isZero()) {
      return baseBorrowLimit;
    }

    // Extract last set borrow limit (already decompiled in your account fetch)
    const lastBorrowLimit = new BN(userBorrowAccount.borrowLimit.toString());

    // Calculate borrow limit expansion since last interaction for `expandPercent` that is elapsed of `expandDuration`.
    const expandedBorrowableAmount = maxExpansionLimit
      .mul(timeElapsed)
      .div(expandDuration);

    let currentBorrowLimit = expandedBorrowableAmount.add(lastBorrowLimit);

    if (currentBorrowLimit.lt(baseBorrowLimit)) {
      return baseBorrowLimit;
    }

    // If timeElapsed is bigger than expandDuration, new borrow limit would be > max expansion,
    // so set to `maxExpandedBorrowLimit` in that case.
    // Also covers the case where last process timestamp = 0 (timeElapsed would simply be very big)
    if (currentBorrowLimit.gt(maxExpandedBorrowLimit)) {
      currentBorrowLimit = maxExpandedBorrowLimit;
    }

    // Extract hard max borrow limit. Above this user can never borrow (not expandable above)
    const maxBorrowLimit = new BN(userBorrowAccount.maxBorrowLimit.toString());

    if (currentBorrowLimit.gt(maxBorrowLimit)) {
      currentBorrowLimit = maxBorrowLimit;
    }

    return currentBorrowLimit;
  }

  /**
   * Get user borrow data with overall token data
   * @param user The user address
   * @param token The token address
   * @returns User borrow data and overall token data
   */
  async getUserBorrowData(
    user: PublicKey,
    token: MintKeys
  ): Promise<{
    userBorrowData: UserBorrowData;
    overallTokenData: OverallTokenData;
  }> {
    const overallTokenData = await this.getOverallTokenData(token);
    const userBorrow = await this.getUserBorrow(user, token);

    let userBorrowData: UserBorrowData = {
      modeWithInterest: false,
      borrow: new BN(0),
      borrowLimit: new BN(0),
      lastUpdateTimestamp: new BN(0),
      expandPercent: new BN(0),
      expandDuration: new BN(0),
      baseBorrowLimit: new BN(0),
      maxBorrowLimit: new BN(0),
      borrowLimitUtilization: new BN(0),
      borrowableUntilLimit: new BN(0),
      borrowable: new BN(0),
    };

    if (userBorrow instanceof BN && userBorrow.gt(new BN(0))) {
      // userBorrow is BN(0) when user not configured yet
      return { userBorrowData, overallTokenData };
    }

    const userBorrowAccount = userBorrow as UserBorrowPositionAccount;

    userBorrowData.modeWithInterest = userBorrowAccount.modeWithInterest;
    userBorrowData.borrow = userBorrowAccount.amount;
    userBorrowData.borrowLimit = this.calcBorrowLimitBeforeOperate(
      userBorrowAccount,
      userBorrowAccount.amount
    );

    userBorrowData.lastUpdateTimestamp = userBorrowAccount.lastUpdateTimestamp;
    userBorrowData.expandPercent = userBorrowAccount.expandPercent;
    userBorrowData.expandDuration = userBorrowAccount.expandDuration;
    userBorrowData.baseBorrowLimit = userBorrowAccount.baseBorrowLimit;
    userBorrowData.maxBorrowLimit = userBorrowAccount.maxBorrowLimit;

    if (userBorrowData.modeWithInterest) {
      // Convert raw amounts to normal for withInterest mode
      userBorrowData.borrow = userBorrowData.borrow
        .mul(overallTokenData.borrowExchangePrice)
        .div(CONSTANTS.EXCHANGE_PRICES_PRECISION);
      userBorrowData.borrowLimit = userBorrowData.borrowLimit
        .mul(overallTokenData.borrowExchangePrice)
        .div(CONSTANTS.EXCHANGE_PRICES_PRECISION);
      userBorrowData.baseBorrowLimit = userBorrowData.baseBorrowLimit
        .mul(overallTokenData.borrowExchangePrice)
        .div(CONSTANTS.EXCHANGE_PRICES_PRECISION);
      userBorrowData.maxBorrowLimit = userBorrowData.maxBorrowLimit
        .mul(overallTokenData.borrowExchangePrice)
        .div(CONSTANTS.EXCHANGE_PRICES_PRECISION);
    }

    userBorrowData.borrowLimitUtilization = overallTokenData.maxUtilization
      .mul(overallTokenData.totalSupply)
      .div(new BN(10000)); // 1e4

    // Calculate borrowable amounts
    const borrowableUntilUtilizationLimit =
      userBorrowData.borrowLimitUtilization.gt(overallTokenData.totalBorrow)
        ? userBorrowData.borrowLimitUtilization.sub(
            overallTokenData.totalBorrow
          )
        : new BN(0);

    const borrowableUntilBorrowLimit = userBorrowData.borrowLimit.gt(
      userBorrowData.borrow
    )
      ? userBorrowData.borrowLimit.sub(userBorrowData.borrow)
      : new BN(0);

    userBorrowData.borrowableUntilLimit = borrowableUntilBorrowLimit.gt(
      borrowableUntilUtilizationLimit
    )
      ? borrowableUntilUtilizationLimit
      : borrowableUntilBorrowLimit;

    const balanceOf = await this.getTokenBalance(token);
    userBorrowData.borrowable = balanceOf.gt(
      userBorrowData.borrowableUntilLimit
    )
      ? userBorrowData.borrowableUntilLimit
      : balanceOf;

    return { userBorrowData, overallTokenData };
  }

  /**
   * Get user borrow data for multiple tokens
   * @param user The user address
   * @param tokens Array of token addresses
   * @returns Arrays of user borrow data and overall token data
   */
  async getUserMultipleBorrowData(
    user: PublicKey,
    tokens: MintKeys[]
  ): Promise<{
    userBorrowingsData: UserBorrowData[];
    overallTokensData: OverallTokenData[];
  }> {
    const promises = tokens.map((token) => this.getUserBorrowData(user, token));
    const results = await Promise.all(promises);

    const userBorrowingsData = results.map((r) => r.userBorrowData);
    const overallTokensData = results.map((r) => r.overallTokenData);

    return { userBorrowingsData, overallTokensData };
  }

  /**
   * Get user borrow and supply data for multiple tokens
   * @param user The user address
   * @param supplyTokens Array of supply token addresses
   * @param borrowTokens Array of borrow token addresses
   * @returns User supply data, overall supply token data, user borrow data, and overall borrow token data
   */
  async getUserMultipleBorrowSupplyData(
    user: PublicKey,
    supplyTokens: MintKeys[],
    borrowTokens: MintKeys[]
  ): Promise<{
    userSuppliesData: UserSupplyData[];
    overallSupplyTokensData: OverallTokenData[];
    userBorrowingsData: UserBorrowData[];
    overallBorrowTokensData: OverallTokenData[];
  }> {
    const [supplyResults, borrowResults] = await Promise.all([
      this.getUserMultipleSupplyData(user, supplyTokens),
      this.getUserMultipleBorrowData(user, borrowTokens),
    ]);

    return {
      userSuppliesData: supplyResults.userSuppliesData,
      overallSupplyTokensData: supplyResults.overallTokensData,
      userBorrowingsData: borrowResults.userBorrowingsData,
      overallBorrowTokensData: borrowResults.overallTokensData,
    };
  }

  async getAllUserPositions(): Promise<
    Array<{
      user: PublicKey;
      supply: { [mint: string]: UserSupplyPositionAccount };
      borrow: { [mint: string]: UserBorrowPositionAccount };
    }>
  > {
    const [supplyAccounts, borrowAccounts] = await Promise.all([
      this.program.account.userSupplyPosition.all(),
      this.program.account.userBorrowPosition.all(),
    ]);

    const byUser: Map<
      string,
      {
        user: PublicKey;
        supply: { [mint: string]: UserSupplyPositionAccount };
        borrow: { [mint: string]: UserBorrowPositionAccount };
      }
    > = new Map();

    for (const { account } of supplyAccounts) {
      const userKey = account.protocol.toString();
      const mintKey = account.mint.toString();
      if (!byUser.has(userKey)) {
        byUser.set(userKey, { user: account.protocol, supply: {}, borrow: {} });
      }
      const entry = byUser.get(userKey)!;
      entry.supply[mintKey] = {
        user: account.protocol,
        mint: account.mint,
        amount: new BN(account.amount ?? 0),
        withdrawalLimit: new BN(account.withdrawalLimit ?? 0),
        baseWithdrawalLimit: new BN(account.baseWithdrawalLimit ?? 0),
        lastUpdateTimestamp: new BN(account.lastUpdate ?? 0),
        expandPercent: new BN(account.expandPct ?? 0),
        expandDuration: new BN(account.expandDuration ?? 0),
        modeWithInterest: !!account.withInterest,
      };
    }

    for (const { account } of borrowAccounts) {
      const userKey = account.protocol.toString();
      const mintKey = account.mint.toString();
      if (!byUser.has(userKey)) {
        byUser.set(userKey, { user: account.protocol, supply: {}, borrow: {} });
      }
      const entry = byUser.get(userKey)!;
      entry.borrow[mintKey] = {
        user: account.protocol,
        mint: account.mint,
        amount: new BN(account.amount ?? 0),
        borrowLimit: new BN(account.debtCeiling ?? 0),
        baseBorrowLimit: new BN(account.baseDebtCeiling ?? 0),
        maxBorrowLimit: new BN(account.maxDebtCeiling ?? 0),
        lastUpdateTimestamp: new BN(account.lastUpdate ?? 0),
        expandPercent: new BN(account.expandPct ?? 0),
        expandDuration: new BN(account.expandDuration ?? 0),
        modeWithInterest: !!account.withInterest,
      };
    }

    return Array.from(byUser.values());
  }
}
