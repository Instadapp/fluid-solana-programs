import { expect } from "chai";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN, Program } from "@coral-xyz/anchor";

import { BaseSetup } from "../baseTests";
import { bnToBigInt } from "../bn";

import { MintKeys, mint as MintInfo } from "../../../ts-sdk/mint";
import { LIQUIDITY_PROGRAM } from "../../../ts-sdk/address";
import {
  InitProtocolParams,
  UpdateUserSupplyConfigParams,
  UpdateUserBorrowConfigParams,
  RateDataV2Params,
} from "../../../ts-sdk/liquidity/types";
import { UserModule } from "../../../ts-sdk/liquidity/module/user";
import { RateDataV1Params } from "../../../ts-sdk/config/rateDataV1";
import LiquidityJson from "../../../target/idl/liquidity.json";
import { Liquidity } from "../../../target/types/liquidity";
import { TokenConfig } from "../../../ts-sdk/config/token";
import { SupplyConfig, BorrowConfig } from "../../../ts-sdk/config";
import {
  MPL_TOKEN_METADATA_PROGRAM_ID,
  Metadata,
  deserializeMetadata,
} from "@metaplex-foundation/mpl-token-metadata";

export enum TransferType {
  skip = 0,
  direct = 1,
  claim = 2,
}

export class LiquidityBaseSetup extends BaseSetup {
  adminModule: UserModule;
  liquidity: Program<Liquidity>;

  alice: Keypair;
  bob: Keypair;
  admin: Keypair;
  admin2: Keypair;

  mockProtocol: Keypair;
  mockProtocolInterestFree: Keypair;
  mockProtocolWithInterest: Keypair;
  mockProtocolUnauthorized: Keypair;

  MAX_POSSIBLE_BORROW_RATE = 65535; // 16 bits

  DEFAULT_PERCENT_PRECISION = 1e2; // 100%
  DEFAULT_KINK = 80 * this.DEFAULT_PERCENT_PRECISION; // 80%
  DEFAULT_RATE_AT_ZERO = 4 * this.DEFAULT_PERCENT_PRECISION; // 4%
  DEFAULT_RATE_AT_KINK = 10 * this.DEFAULT_PERCENT_PRECISION; // 10%
  DEFAULT_RATE_AT_MAX = 150 * this.DEFAULT_PERCENT_PRECISION; // 150%

  DEFAULT_EXPAND_WITHDRAWAL_LIMIT_PERCENT = 20 * this.DEFAULT_PERCENT_PRECISION; // 20%
  DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION = 2 * 24 * 60 * 60; // 2 days
  DEFAULT_BASE_WITHDRAWAL_LIMIT = 1e4 * LAMPORTS_PER_SOL; // 10k SOL

  DEFAULT_EXPAND_DEBT_CEILING_PERCENT = 20 * this.DEFAULT_PERCENT_PRECISION; // 20%
  DEFAULT_EXPAND_DEBT_CEILING_DURATION = 2 * 24 * 60 * 60; // 2 days
  DEFAULT_BASE_DEBT_CEILING = 1e4 * LAMPORTS_PER_SOL; // 0.01M SOL
  DEFAULT_MAX_DEBT_CEILING = 1e6 * LAMPORTS_PER_SOL; // 1M SOL

  DEFAULT_TOKEN_FEE = 5 * this.DEFAULT_PERCENT_PRECISION; // 5%

  addProgram(programId: string, programPath: string, name: string) {
    this.client.addProgramFromFile(new PublicKey(programId), programPath);
    this.setProgramName(programId, name);
  }

  constructor() {
    super();

    this.admin = this.makeAddress();
    this.admin2 = this.makeAddress();
    this.alice = this.makeAddress();
    this.bob = this.makeAddress();

    this.mockProtocol = this.makeAddress();
    this.mockProtocolInterestFree = this.makeAddress();
    this.mockProtocolWithInterest = this.makeAddress();

    this.addProgram(
      LIQUIDITY_PROGRAM,
      "target/deploy/liquidity.so",
      "Liquidity"
    );

    // prettier-ignore
    this.addProgram(MPL_TOKEN_METADATA_PROGRAM_ID, "test-utils/typescript/binaries/mpl_token_metadata.so", "MPLTokenMetadata");

    this.liquidity = new Program(LiquidityJson, this.provider);
    this.adminModule = new UserModule(this.admin, this.liquidity);
  }

  async setup() {
    const mintKeys = [
      MintKeys.USDC,
      MintKeys.USDT,
      MintKeys.WSOL,
      MintKeys.EURC,
      MintKeys.HELIUS_SINGLE_POOL,
    ];

    this.prank(this.admin);

    {
      await this.initLiquidity();

      let data = await this.liquidity.account.liquidity.fetch(
        this.adminModule.get_liquidity()
      );

      // False = unlocked
      expect(data.status).to.be.false;
      expect(data.authority.toString()).to.equal(
        this.admin.publicKey.toString()
      );
      expect(data.revenueCollector.toString()).to.equal(
        this.admin.publicKey.toString()
      );
    }

    {
      await this.updateAuths();
      const data = await this.liquidity.account.authorizationList.fetch(
        this.adminModule.get_auth_list()
      );

      // admin is already address as it is main authority
      // we just add admin2 to the auth list
      expect(data.authUsers.length).to.equal(2);
      expect(data.authUsers.map((x) => x.toString())).to.contain(
        this.admin.publicKey.toString()
      );
      expect(data.authUsers.map((x) => x.toString())).to.contain(
        this.admin2.publicKey.toString()
      );
    }

    {
      await this.updateGuardians();
      const data = await this.liquidity.account.authorizationList.fetch(
        this.adminModule.get_auth_list()
      );

      // admin is already address as it is main authority
      // we just add admin2 to the auth list
      expect(data.guardians.length).to.equal(2);
      expect(data.guardians.map((x) => x.toString())).to.contain(
        this.admin.publicKey.toString()
      );
      expect(data.guardians.map((x) => x.toString())).to.contain(
        this.admin2.publicKey.toString()
      );
    }

    {
      await this.updateRevenueCollector();

      const data = await this.liquidity.account.liquidity.fetch(
        this.adminModule.get_liquidity()
      );

      expect(data.revenueCollector.toString()).to.equal(
        this.admin.publicKey.toString()
      );
    }

    await this.setupSplTokenMints(mintKeys);

    {
      await this.initTokenReserve(mintKeys);

      for (const mint of mintKeys) {
        const data = await this.liquidity.account.tokenReserve.fetch(
          this.adminModule.get_reserve(mint)
        );

        const expectedPrice = new BN(1e12);
        expect(data.supplyExchangePrice.eq(expectedPrice)).to.be.true;
        expect(data.borrowExchangePrice.eq(expectedPrice)).to.be.true;
        const expectedTimestamp = new BN(this.client.getClock().unixTimestamp.toString());
        expect(data.lastUpdateTimestamp.eq(expectedTimestamp)).to.be.true;

        expect(data.totalSupplyWithInterest.isZero()).to.be.true;
        expect(data.totalSupplyInterestFree.isZero()).to.be.true;
        expect(data.totalBorrowWithInterest.isZero()).to.be.true;
        expect(data.totalBorrowInterestFree.isZero()).to.be.true;
      }
    }

    {
      await this.updateRateDataV1(
        mintKeys.map((mint) => this.getDefaultRateDataV1(mint)).slice(0, 2)
      );

      await this.updateRateDataV1(
        mintKeys.map((mint) => this.getDefaultRateDataV1(mint)).slice(2, 4)
      );

      if (mintKeys.length > 4) {
        await this.updateRateDataV1(
          mintKeys.map((mint) => this.getDefaultRateDataV1(mint)).slice(4)
        );
      }
    }

    {
      await this.updateTokenConfigs(
        mintKeys.map((mint) => this.getDefaultTokenConfig(mint))
      );

      for (const mint of mintKeys) {
        const data = await this.liquidity.account.tokenReserve.fetch(
          this.adminModule.get_reserve(mint)
        );

        expect(data.feeOnInterest.toString()).to.equal("0");
        expect(data.lastUtilization.toString()).to.equal("0");
        expect(data.lastUpdateTimestamp.toString()).to.equal(
          this.client.getClock().unixTimestamp.toString()
        );
      }
    }

    {
      // const tx = await setup.updateRateDataV2(rateDataV2);
    }

    // prettier-ignore
    {
      for (const mint of mintKeys) {
        await this.mint(MintInfo.getMint(mint), this.adminModule.get_liquidity(), 0);
        await this.mint(MintInfo.getMint(mint), this.mockProtocol.publicKey, 0);
        await this.mint(MintInfo.getMint(mint), this.mockProtocolInterestFree.publicKey, 0);
        await this.mint(MintInfo.getMint(mint), this.mockProtocolWithInterest.publicKey, 0);
      }
    }

    const u64MAX = BigInt("18446744073709551615");
    const u64ALess = BigInt("1844674407370955161");

    {
      for (const mint of mintKeys) {
        await this.mint(MintInfo.getMint(mint), this.alice.publicKey, u64MAX);
        await this.mint(MintInfo.getMint(mint), this.bob.publicKey, u64ALess);
        await this.mint(MintInfo.getMint(mint), this.admin.publicKey, u64MAX);
      }
    }

    {
      for (const mint of mintKeys) {
        await this.initNewProtocol([
          {
            supplyMint: mint,
            borrowMint: mint,
            protocol: this.mockProtocol.publicKey,
          },
          {
            supplyMint: mint,
            borrowMint: mint,
            protocol: this.mockProtocolInterestFree.publicKey,
          },
          {
            supplyMint: mint,
            borrowMint: mint,
            protocol: this.mockProtocolWithInterest.publicKey,
          },
        ]);
      }
    }

    // prettier-ignore
    {
      for (const mint of mintKeys) {
        await this.initClaimAccount(mint, this.mockProtocol.publicKey);
        await this.initClaimAccount(mint, this.mockProtocolInterestFree.publicKey);
        await this.initClaimAccount(mint, this.mockProtocolWithInterest.publicKey);
        await this.initClaimAccount(mint, this.alice.publicKey);
        await this.initClaimAccount(mint, this.bob.publicKey);
        await this.initClaimAccount(mint, this.admin.publicKey);
      }

      for (const mint of mintKeys) {
        await this._setUserAllowancesDefaultInterestFree(mint, this.mockProtocolInterestFree);
        await this._setUserAllowancesDefault(mint, this.mockProtocolWithInterest);
        // await this._setUserAllowancesDefault(mint, this.mockProtocol);
      }
    }

    {
      await this.updateUserClass([
        { addr: this.mockProtocol.publicKey, value: 0 }, // can be paused
        { addr: this.mockProtocolInterestFree.publicKey, value: 1 }, // can't be paused
        { addr: this.mockProtocolWithInterest.publicKey, value: 1 }, // can't be paused
      ]);
    }
  }

  async _setUserAllowancesDefaultInterestFree(
    mint: MintKeys,
    protocol: Keypair
  ) {
    await this._setUserAllowancesDefaultWithMode(
      mint,
      protocol.publicKey,
      false
    );
  }

  async _setUserAllowancesDefault(
    mint: MintKeys,
    protocol: Keypair | PublicKey
  ) {
    await this._setUserAllowancesDefaultWithMode(
      mint,
      protocol instanceof Keypair ? protocol.publicKey : protocol,
      true
    );
  }

  async _setUserAllowancesDefaultWithMode(
    mint: MintKeys,
    protocol: PublicKey,
    withInterest: boolean
  ) {
    this.prank(this.admin);

    // Add supply config
    {
      const userSupplyConfigs_ = this.getDefaultSupplyConfig(
        mint,
        withInterest
      );bnToBigInt

      let accounts = this.adminModule.getUpdateUserSupplyConfigContext({
        protocol,
        mint,
      });

      // for (const [k, v] of Object.entries(accounts)) {
      //   const aInfo = this.client.getAccount(v);
      //   if (!aInfo) console.log("Account not found", mint, k, v);
      // }

      await this.updateUserSupplyConfig([
        {
          newSupplyConfig: { ...userSupplyConfigs_, user: protocol },
          mint,
        },
      ]);
    }

    {
      const userBorrowConfigs_ = this.getDefaultBorrowConfig(
        mint,
        withInterest
      );

      const accounts = this.adminModule.getUpdateUserBorrowConfigContext({
        protocol,
        mint,
      });

      // for (const [k, v] of Object.entries(accounts)) {
      //   const aInfo = this.client.getAccount(v);
      //   if (!aInfo) console.log("Account not found", mint, k, v);
      // }

      // if (
      //   mint === MintKeys.USDC ||
      //   mint === MintKeys.USDT ||
      //   mint === MintKeys.EURC
      // ) {
      //   userBorrowConfigs_.baseDebtCeiling = new BN(1e12);
      //   userBorrowConfigs_.maxDebtCeiling = new BN(1e12);
      // }

      await this.updateUserBorrowConfig([
        {
          newBorrowConfig: { ...userBorrowConfigs_, user: protocol },
          mint,
        },
      ]);
    }
  }

  async warpWithExchangePrice(mint: MintKeys, warpSeconds: number) {
    const warpPerCycle = 30 * 24 * 60 * 60; // 30 days
    let warpedSeconds = 0;

    while (warpedSeconds < warpSeconds) {
      if (warpedSeconds + warpPerCycle > warpSeconds)
        // last warp -> only warp difference
        this.warp(warpSeconds - warpedSeconds);
      else this.warp(warpPerCycle);

      await this.updateExchangePrice(mint);
      warpedSeconds += warpPerCycle;
    }
  }

  async updateExchangePrice(mint: MintKeys) {
    const tx = this.getTx();
    const ix = await this.adminModule.updateExchangePriceIx(mint);
    tx.add(ix);
    return this.execute(tx, this.admin);
  }

  getTimestamp() {
    return this.client.getClock().unixTimestamp;
  }

  async initClaimAccount(mint: MintKeys, user: PublicKey) {
    const tx = this.getTx();
    const ix = await this.adminModule.initClaimAccountIx(mint, user);
    tx.add(ix);
    this.prank(this.admin);
    return this.execute(tx);
  }

  getDefaultRateDataV1(token: MintKeys): RateDataV1Params {
    const rateDataV1: RateDataV1Params = {
      token: token,
      kink: this.DEFAULT_KINK,
      rateAtUtilizationZero: this.DEFAULT_RATE_AT_ZERO,
      rateAtUtilizationKink: this.DEFAULT_RATE_AT_KINK,
      rateAtUtilizationMax: this.DEFAULT_RATE_AT_MAX,
    };

    return rateDataV1;
  }

  getDefaultTokenConfig(token: MintKeys): TokenConfig {
    return {
      token: token,
      fee: new BN(0),
      maxUtilization: new BN(1e4),
    };
  }

  getDefaultSupplyConfig(token: MintKeys, withInterest: boolean): SupplyConfig {
    return {
      token: MintInfo.getMint(token),
      mode: withInterest ? 1 : 0,
      expandPercent: new BN(this.DEFAULT_EXPAND_WITHDRAWAL_LIMIT_PERCENT),
      expandDuration: new BN(this.DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION),
      baseWithdrawalLimit: new BN(this.DEFAULT_BASE_WITHDRAWAL_LIMIT),
    };
  }

  getDefaultBorrowConfig(token: MintKeys, withInterest: boolean): BorrowConfig {
    return {
      token: MintInfo.getMint(token),
      mode: withInterest ? 1 : 0,
      expandPercent: new BN(this.DEFAULT_EXPAND_DEBT_CEILING_PERCENT),
      expandDuration: new BN(this.DEFAULT_EXPAND_DEBT_CEILING_DURATION),
      baseDebtCeiling: new BN(this.DEFAULT_BASE_DEBT_CEILING),
      maxDebtCeiling: new BN(this.DEFAULT_MAX_DEBT_CEILING),
    };
  }

  async updateUserClass(userClass: { addr: PublicKey; value: number }[]) {
    const tx = this.getTx();
    const ix = await this.adminModule.updateUserClassIx(userClass);

    tx.add(ix);
    this.prank(this.admin);
    return this.execute(tx);
  }

  async pauseUser(
    supplyMint: MintKeys,
    borrowMint: MintKeys,
    protocol: PublicKey,
    supplyStatus: number,
    borrowStatus: number
  ) {
    const tx = this.getTx();
    const ix = await this.adminModule.pauseUserIx({
      protocol,
      supplyMint,
      borrowMint,
      supplyStatus,
      borrowStatus,
    });
    tx.add(ix);
    this.prank(this.admin);
    return this.execute(tx);
  }

  async unpauseUser(
    supplyMint: MintKeys,
    borrowMint: MintKeys,
    protocol: PublicKey,
    supplyStatus: number,
    borrowStatus: number
  ) {
    const tx = this.getTx();
    const ix = await this.adminModule.unpauseUserIx({
      protocol,
      supplyMint,
      borrowMint,
      supplyStatus,
      borrowStatus,
    });
    tx.add(ix);
    this.prank(this.admin);
    return this.execute(tx);
  }

  async initLiquidity(): Promise<string> {
    const tx = this.getTx();
    const ix = await this.adminModule.getInitLiquidityIx({
      authority: this.admin.publicKey,
      revenueCollector: this.admin.publicKey,
    });

    this.prank(this.admin);
    tx.add(ix);
    return this.execute(tx);
  }

  async updateAuths(): Promise<string> {
    const authStatus = [{ addr: this.admin2.publicKey, value: true }];
    const tx = this.getTx();

    this.prank(this.admin);
    const ix = await this.adminModule.updateAuthsIx(authStatus);
    tx.add(ix);
    tx.sign(this.signer);
    return this.execute(tx);
  }

  async updateGuardians(): Promise<string> {
    const guardianStatus = [{ addr: this.admin2.publicKey, value: true }];
    const tx = this.getTx();

    this.prank(this.admin);
    const ix = await this.adminModule.updateGuardiansIx(guardianStatus);
    tx.add(ix);
    return this.execute(tx);
  }

  async updateRevenueCollector(): Promise<string> {
    const tx = this.getTx();

    this.prank(this.admin);
    const ix = await this.adminModule.updateRevenueCollectorIx(
      this.admin.publicKey
    );
    tx.add(ix);
    return this.execute(tx);
  }

  async initTokenReserve(mints: MintKeys[]): Promise<string> {
    const tx = this.getTx();

    this.prank(this.admin);
    for (const key of mints) {
      const ix = await this.adminModule.initTokenReserveIx(key);
      tx.add(ix);
    }

    return this.execute(tx);
  }

  async updateTokenConfigs(tokenConfigs: TokenConfig[]): Promise<string> {
    const tx = this.getTx();

    this.prank(this.admin);
    for (const config of tokenConfigs) {
      const ix = await this.adminModule.updateTokenConfigIx(config);
      tx.add(ix);
    }
    return this.execute(tx);
  }

  async updateRateDataV1(rateDataV1: RateDataV1Params[]): Promise<string> {
    const tx = this.getTx();

    this.prank(this.admin);
    for (const data of rateDataV1) {
      const ix = await this.adminModule.updateRateDataV1Ix(data);
      tx.add(ix);
    }
    return this.execute(tx);
  }

  async updateRateDataV2(rateDataV2: RateDataV2Params[]): Promise<string> {
    const tx = this.getTx();

    this.prank(this.admin);
    for (const data of rateDataV2) {
      const ix = await this.adminModule.updateRateDataV2Ix(data);
      tx.add(ix);
    }
    return this.execute(tx);
  }

  async updateUserSupplyConfig(
    configs: UpdateUserSupplyConfigParams[]
  ): Promise<string> {
    const tx = this.getTx();

    this.prank(this.admin);
    for (const config of configs) {
      const ix = await this.adminModule.updateUserSupplyConfigIx(config);
      tx.add(ix);
    }
    return this.execute(tx);
  }

  async updateUserBorrowConfig(
    configs: UpdateUserBorrowConfigParams[]
  ): Promise<string> {
    const tx = this.getTx();
    this.prank(this.admin);
    for (const config of configs) {
      const ix = await this.adminModule.updateUserBorrowConfigIx(config);
      tx.add(ix);
    }
    return this.execute(tx);
  }

  async initNewProtocol(configs: InitProtocolParams[]): Promise<string> {
    const tx = this.getTx();

    this.prank(this.admin);
    for (const config of configs) {
      const ix = await this.adminModule.initNewProtocolIx(config);
      tx.add(ix);
    }
    return this.execute(tx);
  }

  async operate(
    protocol: Keypair,
    collateralAmount: BN,
    debtAmount: BN,
    mint: MintKeys,
    user: Keypair
  ): Promise<void> {
    if (collateralAmount.gt(new BN(0))) {
      await this.deposit(protocol, collateralAmount, mint, user);
    } else if (collateralAmount.lt(new BN(0))) {
      await this.withdraw(protocol, collateralAmount.neg(), mint, user);
    }

    if (debtAmount.gt(new BN(0))) {
      await this.borrow(protocol, debtAmount, mint, user);
    } else if (debtAmount.lt(new BN(0))) {
      await this.payback(protocol, debtAmount.neg(), mint, user);
    }

    if (collateralAmount.eq(new BN(0)) && debtAmount.eq(new BN(0))) {
      // test operate amounts zero
      await this.deposit(protocol, collateralAmount, mint, user);
    }
  }

  async depositNative(
    protocol: Keypair,
    amount: BN,
    mint: MintKeys,
    user: Keypair
  ): Promise<string> {
    // await this.wrapSol(user, amount);

    return await this.deposit(protocol, amount, mint, user);
  }

  async deposit(
    protocol: Keypair,
    amount: BN,
    mint: MintKeys,
    user: Keypair,
    preOperate: boolean = true
  ): Promise<string> {
    const accounts = this.adminModule.getOperateContext(
      mint,
      protocol.publicKey
    );

    if (preOperate) {
      const tx = this.getTx();
      tx.add(await this.adminModule.preOperateIx(mint, protocol.publicKey));
      this.execute(tx, protocol);
    }

    {
      // transfer token from user to mock protocol ATA
      const tx = this.getTx();
      tx.add(
        await this.transferSplTokenIx(
          MintInfo.getUserTokenAccount(mint, user.publicKey), // from token accounts
          MintInfo.getUserTokenAccount(mint, protocol.publicKey), // to token accounts
          user.publicKey, // authority
          bnToBigInt(amount) // amount
        )
      );
      this.execute(tx, user);
    }

    // prettier-ignore
    {
      const tx = this.getTx();
      tx.add(
        await this.transferSplTokenIx(
          MintInfo.getUserTokenAccount(mint, protocol.publicKey), // from token accounts
          accounts.vault, // to token accounts, liquidity vault
          protocol.publicKey, // authority
          bnToBigInt(amount) // amount
        )
      );

      tx.add(await this.adminModule.depositIx(amount, mint, protocol.publicKey));
      return this.execute(tx, protocol);
    }
  }

  async borrow(
    protocol: Keypair,
    amount: BN,
    mint: MintKeys,
    user: Keypair,
    transferType: TransferType = TransferType.direct
  ): Promise<string> {
    const tx = this.getTx();
    // prettier-ignore
    tx.add(await this.adminModule.borrowIx(amount, mint, protocol.publicKey, user.publicKey, user.publicKey, transferType));
    return this.execute(tx, protocol);
  }

  async payback(
    protocol: Keypair,
    amount: BN,
    mint: MintKeys,
    user: Keypair
  ): Promise<string> {
    const accounts = this.adminModule.getOperateContext(
      mint,
      protocol.publicKey
    );

    {
      const tx = this.getTx();
      tx.add(await this.adminModule.preOperateIx(mint, protocol.publicKey));
      this.execute(tx, protocol);
    }

    // transfer token from user to mock protocol ATA
    {
      const tx = this.getTx();
      tx.add(
        await this.transferSplTokenIx(
          MintInfo.getUserTokenAccount(mint, user.publicKey), // from token accounts
          MintInfo.getUserTokenAccount(mint, protocol.publicKey), // to token accounts
          user.publicKey, // authority
          bnToBigInt(amount) // amount
        )
      );
      this.execute(tx, user);
    }

    const tx = this.getTx();
    // transfer token from mock protocol ATA to liquidity vault
    tx.add(
      await this.transferSplTokenIx(
        MintInfo.getUserTokenAccount(mint, protocol.publicKey), // from token accounts
        accounts.vault, // to token accounts, liquidity vault
        protocol.publicKey, // authority
        bnToBigInt(amount) // amount
      )
    );
    tx.add(
      await this.adminModule.paybackIx(amount.neg(), mint, protocol.publicKey)
    );
    return this.execute(tx, protocol);
  }

  async withdraw(
    protocol: Keypair,
    amount: BN,
    mint: MintKeys,
    user: Keypair,
    transferType: TransferType = TransferType.direct
  ): Promise<string> {
    const tx = this.getTx();
    tx.add(
      await this.adminModule.withdrawIx(
        amount.neg(),
        mint,
        protocol.publicKey,
        user.publicKey, // withdraw_to
        user.publicKey, // borrow_to
        transferType
      )
    );
    return this.execute(tx, protocol);
  }

  async closeClaimAccount(mint: MintKeys, user: Keypair) {
    const tx = this.getTx();
    tx.add(await this.adminModule.closeClaimAccountIx(mint, user.publicKey));
    return this.execute(tx, user);
  }

  async claim(
    mint: MintKeys,
    user: Keypair,
    recipient: PublicKey = user.publicKey
  ) {
    const tx = this.getTx();
    tx.add(await this.adminModule.claimIx(mint, user.publicKey, recipient));
    return this.execute(tx, user);
  }

  async exposeLiquidityExchangePrice(mint: MintKeys, newExchangePrice: BN) {
    const reservePda = this.adminModule.get_reserve(mint);

    const tokenReserve = await this.liquidity.account.tokenReserve.fetch(
      reservePda
    );

    tokenReserve.supplyExchangePrice = newExchangePrice;

    const accountInfo = this.client.getAccount(reservePda);

    // Serialize the updated tokenReserve object
    const updatedAccountData = await this.liquidity.coder.accounts.encode(
      "tokenReserve",
      tokenReserve
    );

    this.client.setAccount(reservePda, {
      ...accountInfo,
      data: updatedAccountData,
    });
  }

  async exposeTotalAmount(
    mint: MintKeys,
    totalSupplyWithInterest: BN,
    totalSupplyInterestFree: BN,
    totalBorrowWithInterest: BN,
    totalBorrowInterestFree: BN
  ) {
    const reservePda = this.adminModule.get_reserve(mint);
    const tokenReserve = await this.liquidity.account.tokenReserve.fetch(
      reservePda
    );

    tokenReserve.totalSupplyWithInterest = totalSupplyWithInterest;
    tokenReserve.totalSupplyInterestFree = totalSupplyInterestFree;
    tokenReserve.totalBorrowWithInterest = totalBorrowWithInterest;
    tokenReserve.totalBorrowInterestFree = totalBorrowInterestFree;

    const accountInfo = this.client.getAccount(reservePda);

    // Serialize the updated tokenReserve object
    const updatedAccountData = await this.liquidity.coder.accounts.encode(
      "tokenReserve",
      tokenReserve
    );

    this.client.setAccount(reservePda, {
      ...accountInfo,
      data: updatedAccountData,
    });
  }

  async exposeExchangePriceWithRates(
    mint: MintKeys,
    supplyExchangePrice: BN,
    borrowExchangePrice: BN,
    utilization: BN,
    borrowRate: BN,
    timestamp: BN
  ) {
    const reservePda = this.adminModule.get_reserve(mint);

    const tokenReserve = await this.liquidity.account.tokenReserve.fetch(
      reservePda
    );

    tokenReserve.supplyExchangePrice = supplyExchangePrice;
    tokenReserve.borrowExchangePrice = borrowExchangePrice;
    tokenReserve.lastUtilization = utilization.toNumber();
    tokenReserve.borrowRate = borrowRate.toNumber();
    tokenReserve.lastUpdateTimestamp = timestamp;

    const accountInfo = this.client.getAccount(reservePda);

    // Serialize the updated tokenReserve object
    const updatedAccountData = await this.liquidity.coder.accounts.encode(
      "tokenReserve",
      tokenReserve
    );

    this.client.setAccount(reservePda, {
      ...accountInfo,
      data: updatedAccountData,
    });
  }
}
