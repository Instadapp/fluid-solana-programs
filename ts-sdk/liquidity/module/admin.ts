import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";

import { Context } from "../context";
import { TransactionBuilder } from "../../builder";
import { MintKeys, mint as MintInfo } from "../../mint";
import { Liquidity } from "../../../target/types/liquidity";

import {
  RateDataV1Params,
  RateDataV2Params,
  TokenConfig,
  InitProtocolParams,
  UpdateUserSupplyConfigParams,
  UpdateUserBorrowConfigParams,
  PauseUserParams,
} from "../types";

export class AdminIx extends Context {
  constructor(authority: Keypair, program: Program<Liquidity>) {
    super(authority, program);
  }

  createTxBuilder(): TransactionBuilder {
    const txBuilder = new TransactionBuilder(
      this.program.provider.connection,
      this.authority
    );

    txBuilder.addSigner(this.authority);
    return txBuilder;
  }

  // prettier-ignore
  async getInitLiquidityIx({ authority, revenueCollector }: { authority: PublicKey; revenueCollector: PublicKey }): Promise<TransactionInstruction> {
    const ix = await this.program.methods
      .initLiquidity(authority, revenueCollector)
      .accounts(this.getInitLiquidityContext())
      .instruction();

    return ix;
  }

  // prettier-ignore
  async pauseUserIx(params: PauseUserParams): Promise<TransactionInstruction> {
    const context = this.getPauseUserContext({
      protocol: params.protocol,
      supplyMint: params.supplyMint,
      borrowMint: params.borrowMint,
    });

    return await this.program.methods
      .pauseUser(
        params.protocol,
        MintInfo.getMint(params.supplyMint),
        MintInfo.getMint(params.borrowMint),
        params.supplyStatus,
        params.borrowStatus,
      )
      .accounts(context)
      .instruction();
  }

  // prettier-ignore
  async unpauseUserIx(params: PauseUserParams): Promise<TransactionInstruction> {
    const context = this.getUnpauseUserContext({
      protocol: params.protocol,
      supplyMint: params.supplyMint,
      borrowMint: params.borrowMint,
    });

    return await this.program.methods
      .unpauseUser(
        params.protocol,
        MintInfo.getMint(params.supplyMint),
        MintInfo.getMint(params.borrowMint),
        params.supplyStatus,
        params.borrowStatus
      )
      .accounts(context)
      .instruction();
  }

  // prettier-ignore
  async updateAuthsIx(authStatus: { addr: PublicKey; value: boolean }[]): Promise<TransactionInstruction> {
    const context = this.getUpdateAuthContext();

    return await this.program.methods
      .updateAuths(authStatus)
      .accounts(context)
      .instruction();
  }

  // prettier-ignore
  async updateGuardiansIx(guardianStatus: { addr: PublicKey; value: boolean }[]): Promise<TransactionInstruction> {
    const context = this.getUpdateGuardianContext();

    return await this.program.methods
      .updateGuardians(guardianStatus)
      .accounts(context)
      .instruction();
  }

  // prettier-ignore
  async initTokenReserveIx(mintKey: MintKeys): Promise<TransactionInstruction> {
    const context = this.getInitTokenReserveContext({ mint: mintKey });

    return await this.program.methods
      .initTokenReserve()
      .accounts(context)
      .instruction();
  }

  // prettier-ignore
  async updateRateDataV1Ix(rateData: RateDataV1Params): Promise<TransactionInstruction> {
    const context = this.getUpdateRateDataV1Context({ mint: rateData.token as MintKeys });

    const payload = {
      kink: new BN(rateData.kink),
      rateAtUtilizationZero: new BN(rateData.rateAtUtilizationZero),
      rateAtUtilizationKink: new BN(rateData.rateAtUtilizationKink),
      rateAtUtilizationMax: new BN(rateData.rateAtUtilizationMax),
    };

    return await this.program.methods
      .updateRateDataV1(payload)
      .accounts(context)
      .instruction();
  }

  // prettier-ignore
  async updateRateDataV2Ix(rateData: RateDataV2Params): Promise<TransactionInstruction> {
    const context = this.getUpdateRateDataV2Context({ mint: rateData.token as MintKeys });

    const payload = {
      kink1: new BN(rateData.kink1),
      kink2: new BN(rateData.kink2),
      rateAtUtilizationZero: new BN(rateData.rateAtUtilizationZero),
      rateAtUtilizationKink1: new BN(rateData.rateAtUtilizationKink1),
      rateAtUtilizationKink2: new BN(rateData.rateAtUtilizationKink2),
      rateAtUtilizationMax: new BN(rateData.rateAtUtilizationMax),
    };

    return await this.program.methods
      .updateRateDataV2(payload)
      .accounts(context)
      .instruction();
  }

  // prettier-ignore
  async updateTokenConfigIx(tokenConfig: TokenConfig): Promise<TransactionInstruction> {
    const context = this.getUpdateTokenConfigContext({ mint: tokenConfig.token as MintKeys });

    const payload = {
      token: MintInfo.getMint(tokenConfig.token),
      fee: tokenConfig.fee,
      maxUtilization: tokenConfig.maxUtilization,
    };

    return await this.program.methods
      .updateTokenConfig(payload)
      .accounts(context)
      .instruction();
  }

  // prettier-ignore
  async updateRevenueCollectorIx(revenueCollector: PublicKey): Promise<TransactionInstruction> {
    const context = this.getUpdateRevenueCollectorContext();

    return await this.program.methods
      .updateRevenueCollector(revenueCollector)
      .accounts(context)
      .instruction();
  }

  // prettier-ignore
  async initNewProtocolIx(config: InitProtocolParams): Promise<TransactionInstruction> {
    const { protocol, supplyMint, borrowMint } = config;

    const context = this.getInitNewProtocolContext({
      protocol,
      supplyMint,
      borrowMint,
    });

    return await this.program.methods
      .initNewProtocol(
        MintInfo.getMint(supplyMint),
        MintInfo.getMint(borrowMint),
        protocol
      )
      .accounts(context)
      .instruction();
  }

  // prettier-ignore
  async updateUserClassIx(userClass: { addr: PublicKey; value: number }[]): Promise<TransactionInstruction> {
    const context = this.getUpdateUserClassContext();

    return await this.program.methods
      .updateUserClass(userClass)
      .accounts(context)
      .instruction();
  }

  // prettier-ignore
  async updateUserWithdrawalLimitIx(
    { protocol, newWithdrawalLimit, mint }: { protocol: PublicKey; newWithdrawalLimit: number; mint: MintKeys }
  ): Promise<TransactionInstruction> {
    const context = this.getUpdateUserWithdrawalLimitContext({ protocol, mint });

    return await this.program.methods
      .updateUserWithdrawalLimit(
        new BN(newWithdrawalLimit),
        protocol,
        MintInfo.getMint(mint)
      )
      .accounts(context)
      .instruction();
  }

  // prettier-ignore
  async updateUserSupplyConfigIx(config: UpdateUserSupplyConfigParams): Promise<TransactionInstruction> {
    const context = this.getUpdateUserSupplyConfigContext({
      protocol: config.newSupplyConfig.user,
      mint: config.mint,
    });

    return await this.program.methods
      .updateUserSupplyConfig(config.newSupplyConfig)
      .accounts(context)
      .instruction();
  }

  // prettier-ignore
  async updateUserBorrowConfigIx(config: UpdateUserBorrowConfigParams): Promise<TransactionInstruction> {
    const context = this.getUpdateUserBorrowConfigContext({
      protocol: config.newBorrowConfig.user,
      mint: config.mint,
    });

    return await this.program.methods
      .updateUserBorrowConfig(config.newBorrowConfig)
      .accounts(context)
      .instruction();
  }

  // prettier-ignore
  async updateExchangePriceIx(mint: MintKeys): Promise<TransactionInstruction> {
    const context = this.getUpdateExchangePriceContext({ mint });

    return await this.program.methods
      .updateExchangePrice(MintInfo.getMint(mint))
      .accounts(context)
      .instruction();
  }

  // prettier-ignore
  async initClaimAccountIx(mint: MintKeys, user: PublicKey): Promise<TransactionInstruction> {
    const context = this.getInitClaimAccountContext({ mint, user });

    return await this.program.methods
      .initClaimAccount(MintInfo.getMint(mint), user)
      .accounts(context)
      .instruction();
  }
}

export class AdminModule extends AdminIx {
  constructor(authority: Keypair, program: Program<Liquidity>) {
    super(authority, program);
  }

  listPDAs() {
    this.get_liquidity().toString();
    this.get_auth_list().toString();
    this.get_supported_token_list().toString();

    for (const mintKey of [MintKeys.WSOL]) {
      this.get_reserve(mintKey).toString();
      this.get_rate_model(mintKey).toString();
    }
  }

  async initLiquidity(
    authority: PublicKey,
    revenueCollector: PublicKey
  ): Promise<string> {
    try {
      // check if the liquidity account already exists
      await this.program.account.liquidity.fetch(this.get_liquidity());
    } catch {
      try {
        const txBuilder = this.createTxBuilder();
        const ix = await this.getInitLiquidityIx({
          authority,
          revenueCollector,
        });

        const tx = await txBuilder.addInstruction(ix).execute();
        return tx;
      } catch (error) {
        console.error("Error initializing liquidity:", error);
      }
    }
  }

  async updateAuths(
    authStatus: { addr: PublicKey; value: boolean }[]
  ): Promise<string> {
    try {
      const existingAuths = (
        await this.program.account.authorizationList.fetch(this.get_auth_list())
      ).authUsers;

      const authStatusForProgram = authStatus
        .filter((status) => {
          return (
            status.value &&
            !existingAuths.some(
              (existingAuth) =>
                existingAuth.toString() === status.addr.toString()
            )
          );
        })
        .map((status) => ({
          addr: status.addr,
          value: status.value,
        }));

      if (authStatusForProgram.length === 0) {
        return;
      }

      const ix = await this.updateAuthsIx(authStatusForProgram);

      const txBuilder = this.createTxBuilder();
      const tx = await txBuilder.addInstruction(ix).execute();
      return tx;
    } catch (error) {
      console.error("Error updating auth list:", error);
    }
  }

  async updateGuardians(
    guardianStatus: { addr: PublicKey; value: boolean }[]
  ): Promise<string> {
    try {
      const existingGuardians = (
        await this.program.account.authorizationList.fetch(this.get_auth_list())
      ).guardians;

      const guardianStatusForProgram = guardianStatus
        .filter((status) => {
          return (
            status.value &&
            !existingGuardians.some(
              (existingGuardian) =>
                existingGuardian.toString() === status.addr.toString()
            )
          );
        })
        .map((status) => ({
          addr: status.addr,
          value: status.value,
        }));

      if (guardianStatusForProgram.length === 0) {
        return;
      }

      const ix = await this.updateGuardiansIx(guardianStatusForProgram);
      const txBuilder = this.createTxBuilder();
      const tx = await txBuilder.addInstruction(ix).execute();

      console.log("Guardian list updated. Transaction signature:", tx);
      return tx;
    } catch (error) {
      console.error("Error updating guardian list:", error);
      if (error instanceof Error) {
        console.error(`Error details: ${error.message}`);
      }
      throw error;
    }
  }

  async initTokenReserve(mintKeys: MintKeys[]): Promise<string> {
    const txBuilder = this.createTxBuilder();

    for (const mintKey of mintKeys) {
      try {
        await this.program.account.tokenReserve.fetch(
          this.get_reserve(mintKey)
        );
      } catch (error) {
        const ix = await this.initTokenReserveIx(mintKey);
        txBuilder.addInstruction(ix);
      }
    }

    const tx = await txBuilder.execute();
    return tx;
  }

  async updateRateDataV1(rateData: RateDataV1Params[]): Promise<string> {
    const txBuilder = this.createTxBuilder();

    const addPayload = async (data: RateDataV1Params) => {
      const ix = await this.updateRateDataV1Ix(data);
      txBuilder.addInstruction(ix);
    };

    for (let i = 0; i < rateData.length; i++) {
      const data = rateData[i];

      try {
        const existingRateData = await this.program.account.rateModel.fetch(
          this.get_rate_model(data.token as MintKeys)
        );

        if (
          existingRateData &&
          existingRateData.version === 1 &&
          existingRateData.rateAtZero === data.rateAtUtilizationZero &&
          existingRateData.kink1Utilization === data.kink &&
          existingRateData.rateAtKink1 === data.rateAtUtilizationKink &&
          existingRateData.rateAtMax === data.rateAtUtilizationMax
        ) {
          continue;
        } else await addPayload(data);
      } catch (error) {
        await addPayload(data);
      }
    }

    const tx = await txBuilder.execute();
    return tx;
  }

  async updateRateDataV2(rateData: RateDataV2Params[]): Promise<string> {
    const txBuilder = this.createTxBuilder();

    const addPayload = async (data: RateDataV2Params) => {
      const ix = await this.updateRateDataV2Ix(data);
      txBuilder.addInstruction(ix);
    };

    for (let i = 0; i < rateData.length; i++) {
      const data = rateData[i];

      try {
        const existingRateData = await this.program.account.rateModel.fetch(
          this.get_rate_model(data.token as MintKeys)
        );

        if (
          existingRateData &&
          existingRateData.version === 2 &&
          existingRateData.rateAtZero === data.rateAtUtilizationZero &&
          existingRateData.kink1Utilization === data.kink1 &&
          existingRateData.rateAtKink1 === data.rateAtUtilizationKink1 &&
          existingRateData.kink2Utilization === data.kink2 &&
          existingRateData.rateAtKink2 === data.rateAtUtilizationKink2 &&
          existingRateData.rateAtMax === data.rateAtUtilizationMax
        ) {
          continue;
        } else await addPayload(data);
      } catch (error) {
        await addPayload(data);
      }
    }

    const tx = await txBuilder.execute();
    return tx;
  }

  async updateTokenConfigs(tokenConfig: TokenConfig[]): Promise<string> {
    const txBuilder = this.createTxBuilder();

    const addPayload = async (config: TokenConfig) => {
      const ix = await this.updateTokenConfigIx(config);
      txBuilder.addInstruction(ix);
    };

    for (let i = 0; i < tokenConfig.length; i++) {
      const config = tokenConfig[i];

      try {
        const existingTokenConfig =
          await this.program.account.tokenReserve.fetch(
            this.get_reserve(config.token as MintKeys)
          );

        if (
          existingTokenConfig &&
          existingTokenConfig.feeOnInterest === config.fee.toNumber() &&
          existingTokenConfig.maxUtilization ===
            config.maxUtilization.toNumber()
        ) {
          continue;
        } else await addPayload(config);
      } catch (error) {
        await addPayload(config);
      }
    }

    const tx = await txBuilder.execute();

    return tx;
  }

  async updateRevenueCollector(revenueCollector: PublicKey): Promise<string> {
    try {
      const existingRevenueCollector = (
        await this.program.account.liquidity.fetch(this.get_liquidity())
      ).revenueCollector;

      if (existingRevenueCollector.toString() === revenueCollector.toString()) {
        return;
      }
    } catch (error) {
      const ix = await this.updateRevenueCollectorIx(revenueCollector);
      const txBuilder = this.createTxBuilder();
      const tx = await txBuilder.addInstruction(ix).execute();

      console.log("Revenue collector updated. Transaction signature:", tx);
      return tx;
    }
  }

  // async transferAuthority(newAuthority: PublicKey): Promise<string> {
  //   const txBuilder = this.createTxBuilder();
  //   const ix = await this.program.methods
  //     .transferAuthority(newAuthority)
  //     .accounts({
  //       signer: this.authority.publicKey,
  //       liquidity: this.get_liquidity(),
  //     })
  //     .instruction();

  //   const tx = await txBuilder.addInstruction(ix).execute();
  //   return tx;
  // }

  async initNewProtocol(configs: InitProtocolParams[]): Promise<string> {
    const txBuilder = this.createTxBuilder();

    for (const config of configs) {
      try {
        const { protocol, supplyMint } = config;
        await this.program.account.userSupplyPosition.fetch(
          this.get_user_supply_position(supplyMint, protocol)
        );
      } catch (error) {
        const ix = await this.initNewProtocolIx(config);
        txBuilder.addInstruction(ix);
      }
    }

    const tx = await txBuilder.execute();
    return tx;
  }

  async updateUserClass(
    userClass: { addr: PublicKey; value: number }[]
  ): Promise<string> {
    const userClassForProgram = userClass.map((status) => ({
      addr: status.addr,
      value: status.value,
    }));

    const ix = await this.updateUserClassIx(userClassForProgram);
    const txBuilder = this.createTxBuilder();
    const tx = await txBuilder.addInstruction(ix).execute();

    return tx;
  }

  async initClaimAccount(mint: MintKeys, user: PublicKey): Promise<string> {
    const ix = await this.initClaimAccountIx(mint, user);

    const txBuilder = this.createTxBuilder();
    const tx = await txBuilder.addInstruction(ix).execute();

    return tx;
  }

  async updateUserWithdrawalLimit(
    protocol: PublicKey,
    newWithdrawalLimit: number,
    mint: MintKeys
  ): Promise<string> {
    try {
      const ix = await this.updateUserWithdrawalLimitIx({
        protocol,
        newWithdrawalLimit,
        mint,
      });

      const txBuilder = this.createTxBuilder();
      const tx = await txBuilder.addInstruction(ix).execute();

      return tx;
    } catch (error) {
      throw error;
    }
  }

  async updateUserSupplyConfig(
    configs: UpdateUserSupplyConfigParams[]
  ): Promise<string> {
    const txBuilder = this.createTxBuilder();

    const addPayload = async (config: UpdateUserSupplyConfigParams) => {
      const ix = await this.updateUserSupplyConfigIx(config);
      txBuilder.addInstruction(ix);
    };

    for (const config of configs) {
      const { mint, newSupplyConfig } = config;

      try {
        const existingUserSupplyConfig =
          await this.program.account.userSupplyPosition.fetch(
            this.get_user_supply_position(mint, newSupplyConfig.user)
          );

        if (
          existingUserSupplyConfig &&
          existingUserSupplyConfig.withInterest === newSupplyConfig.mode &&
          existingUserSupplyConfig.expandPct ===
            newSupplyConfig.expandPercent.toNumber() &&
          existingUserSupplyConfig.expandDuration ===
            newSupplyConfig.expandDuration &&
          existingUserSupplyConfig.baseWithdrawalLimit ===
            newSupplyConfig.baseWithdrawalLimit
        ) {
          continue;
        } else await addPayload(config);
      } catch (error) {
        await addPayload(config);
      }
    }

    const tx = await txBuilder.execute();
    return tx;
  }

  async updateUserBorrowConfig(
    configs: UpdateUserBorrowConfigParams[]
  ): Promise<string> {
    const txBuilder = this.createTxBuilder();

    const addPayload = async (config: UpdateUserBorrowConfigParams) => {
      const ix = await this.updateUserBorrowConfigIx(config);
      txBuilder.addInstruction(ix);
    };

    for (const config of configs) {
      const { mint, newBorrowConfig } = config;

      try {
        const existingUserBorrowConfig =
          await this.program.account.userBorrowPosition.fetch(
            this.get_user_borrow_position(mint, newBorrowConfig.user)
          );

        if (
          existingUserBorrowConfig &&
          existingUserBorrowConfig.withInterest === newBorrowConfig.mode &&
          existingUserBorrowConfig.expandPct ===
            newBorrowConfig.expandPercent.toNumber() &&
          existingUserBorrowConfig.expandDuration ===
            newBorrowConfig.expandDuration.toNumber() &&
          existingUserBorrowConfig.baseDebtCeiling ===
            newBorrowConfig.baseDebtCeiling
        ) {
          continue;
        } else await addPayload(config);
      } catch (error) {
        await addPayload(config);
      }
    }

    const tx = await txBuilder.execute();
    return tx;
  }
}
