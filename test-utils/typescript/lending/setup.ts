import { BN, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import {
  MPL_TOKEN_METADATA_PROGRAM_ID,
  deserializeMetadata,
} from "@metaplex-foundation/mpl-token-metadata";

import { Lending } from "../../../target/types/lending";
import lendingJson from "../../../target/idl/lending.json";

import { LendingRewardRateModel } from "../../../target/types/lending_reward_rate_model";
import lendingRewardsRateModelJson from "../../../target/idl/lending_reward_rate_model.json";

import { LENDING_PROGRAM, LRRM_PROGRAM } from "../../../ts-sdk/address";
import { LiquidityBaseSetup } from "../liquidity/setup";

import { UserModule } from "../../../ts-sdk/lending/module/user";
import { MintKeys, mint as MintInfo } from "../../../ts-sdk/mint";

import { Context as LendingRewardRateModelContext } from "../../../ts-sdk/lendingRewardRateModel/context/context";

const DEFAULT_UNIT = new BN(1e6);
const DEFAULT_AMOUNT = new BN(1000).mul(DEFAULT_UNIT);

export class LendingBaseSetup extends LiquidityBaseSetup {
  lending: Program<Lending>;
  lendingModule: UserModule;
  lrrm: Program<LendingRewardRateModel>;
  lrrmContext: LendingRewardRateModelContext;

  underlying: MintKeys;
  underlyingLending: PublicKey;
  underlyingFToken: PublicKey;

  constructor() {
    super();

    this.addProgram(LENDING_PROGRAM, "target/deploy/lending.so", "Lending");
    // prettier-ignore
    this.addProgram(LRRM_PROGRAM, "target/deploy/lending_reward_rate_model.so", "LendingRewardsRateModel");

    this.lending = new Program<Lending>(lendingJson, this.provider);
    // prettier-ignore
    this.lrrm = new Program<LendingRewardRateModel>(lendingRewardsRateModelJson, this.provider);

    this.lrrmContext = new LendingRewardRateModelContext(this.admin);
    this.lendingModule = new UserModule(this.admin, this.lending);
    this.underlying = MintKeys.USDC;
  }

  async setup() {
    await super.setup();

    // set 20% a year rewards rate (max accepted at fToken is 25%)
    await this.initLrrm();

    // Initialize lending for underlying
    this.underlyingLending = await this.initLending(this.underlying);
    this.underlyingFToken = this.lendingModule.get_f_token_mint(
      this.underlying
    );

    // prettier-ignore
    {
      // create ATAs for alice, bob, admin
      await this.mint(this.underlyingFToken, this.alice.publicKey, 0);
      await this.mint(this.underlyingFToken, this.bob.publicKey, 0);
      await this.mint(this.underlyingFToken, this.admin.publicKey, 0);
    }

    // set default allowances for underlying
    // prettier-ignore
    {
      await this.initNewProtocol([{ supplyMint: this.underlying, borrowMint: this.underlying, protocol: this.underlyingLending }]);
      await this._setUserAllowancesDefault(this.underlying, this.underlyingLending);
      await this._setUserAllowancesDefault(this.underlying, this.mockProtocol);
    }

    // prettier-ignore
    {
      // default claim account for lending operations
      await this.initClaimAccount(this.underlying, this.lendingModule.get_lending_admin());
    }

    await this.deposit(
      this.mockProtocol,
      DEFAULT_AMOUNT,
      this.underlying,
      this.alice
    );
  }

  async rebalance(mint: MintKeys, rebalancer: Keypair) {
    this.prank(rebalancer);
    const tx = this.getTx();
    tx.add(await this.lendingModule.rebalanceIx(mint, rebalancer.publicKey));
    this.execute(tx);
  }

  async updateRate(mint: MintKeys) {
    this.prank(this.admin);
    const tx = this.getTx();
    tx.add(await this.lendingModule.updateRateIx(mint));
    this.execute(tx);
  }

  async updateRebalancer(newRebalancer: string) {
    this.prank(this.admin);
    const tx = this.getTx();
    tx.add(await this.lendingModule.updateRebalancerIx(newRebalancer));
    this.execute(tx);
  }

  // prettier-ignore
  async withdrawFromLending(mint: MintKeys, amount: BN, user: Keypair, maxShares: BN = new BN(0)) {
    this.prank(user);
    const tx = this.getTx();

    if (maxShares.gt(new BN(0))) tx.add(await this.lendingModule.withdrawWithMaxSharesBurnIx(mint, amount, maxShares, user));
    else tx.add(await this.lendingModule.withdrawIx(mint, amount, user));

    this.execute(tx);
  }

  // prettier-ignore
  async redeemFromLending(mint: MintKeys, shares: BN, user: Keypair, minAmountOut: BN = new BN(0)) {
    this.prank(user);
    const tx = this.getTx();

    if (minAmountOut.gt(new BN(0))) tx.add(await this.lendingModule.redeemWithMinAmountOutIx(mint, shares, minAmountOut, user));
     else tx.add(await this.lendingModule.redeemIx(mint, shares, user));

    this.execute(tx);
  }

  // prettier-ignore
  async mintToLending(mint: MintKeys, shares: BN, user: Keypair, maxAssets: BN = new BN(0)) {
    this.prank(user);
    const tx = this.getTx();

    if (maxAssets.gt(new BN(0))) tx.add(await this.lendingModule.mintWithMaxAssetsIx(mint, shares, maxAssets, user));
    else tx.add(await this.lendingModule.mintIx(mint, shares, user));

    this.execute(tx);
  }

  // prettier-ignore
  async depositToLending(mint: MintKeys, amount: BN, user: Keypair, minSharesAmountOut: BN = new BN(0)) {
    this.prank(user);
    const tx = this.getTx();

    const context = this.lendingModule.getDepositContext(mint, user);
    for(const [key, value] of Object.entries(context)) {
      if (value.toString() === SYSVAR_INSTRUCTIONS_PUBKEY.toString()) continue;
      const aInfo = this.client.getAccount(value);
      if(!aInfo) {
        console.log("Account not exists", key, value.toString());
      }
    }

    if (minSharesAmountOut.gt(new BN(0))) tx.add(await this.lendingModule.depositWithMinSharesAmountOutIx(mint, amount, minSharesAmountOut, user));
    else tx.add(await this.lendingModule.depositIx(mint, amount, user));
    
    this.execute(tx);
  }

  async fetchTokenMetadata(mint: MintKeys) {
    const [metadataAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID).toBuffer(),
        this.lendingModule.get_f_token_mint(mint).toBuffer(),
      ],
      new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)
    );

    const accountInfo = this.client.getAccount(metadataAccount);

    if (accountInfo) {
      const metadata = deserializeMetadata({
        ...accountInfo,
        publicKey: metadataAccount.toBase58(),
      } as any);
      console.log("Metadata:", metadata);
      return metadata;
    }
  }

  async initLending(underlying: MintKeys) {
    this.prank(this.admin);

    // prettier-ignore
    {
      let tx = this.getTx();
      tx.add(await this.lendingModule.initLendingAdminIx(this.admin.publicKey, this.admin.publicKey));
      this.execute(tx);
    }

    // prettier-ignore
    {
      let tx = this.getTx();
      tx.add(await this.lendingModule.initLendingIx(underlying));
      this.execute(tx);
    }

    {
      // prettier-ignore
      let tx = this.getTx();
      tx.add(
        await this.lendingModule.SetRewardsRateModelIx(
          underlying,
          this.getLrrmPda(underlying)
        )
      );
      this.execute(tx);
    }

    return this.lendingModule.get_lending(underlying);
  }

  getLrrmPda(mint: MintKeys) {
    const [lrrmPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("lending_rewards_rate_model"),
        MintInfo.getMint(mint).toBuffer(),
      ],
      new PublicKey(LRRM_PROGRAM)
    );

    return lrrmPda;
  }

  async transitionToNextRewards(mint: MintKeys) {
    this.prank(this.admin);
    const tx = this.getTx();

    const context = this.lrrmContext.getLendingRewardsContext(
      mint,
      this.admin.publicKey
    );

    tx.add(
      await this.lrrm.methods
        .transitionToNextRewards()
        .accounts(context)
        .instruction()
    );
    this.execute(tx);
  }

  async cancelQueuedRewards(mint: MintKeys) {
    this.prank(this.admin);
    const tx = this.getTx();

    const context = this.lrrmContext.getLendingRewardsContext(
      mint,
      this.admin.publicKey
    );

    tx.add(
      await this.lrrm.methods
        .cancelQueuedRewards()
        .accounts(context)
        .instruction()
    );
    this.execute(tx);
  }

  async queueNextRewards(mint: MintKeys, rewardAmount: BN, duration: BN) {
    this.prank(this.admin);
    const tx = this.getTx();

    const context = this.lrrmContext.getLendingRewardsContext(
      mint,
      this.admin.publicKey
    );

    tx.add(
      await this.lrrm.methods
        .queueNextRewards(rewardAmount, duration)
        .accounts(context)
        .instruction()
    );
    this.execute(tx);
  }

  async stopRewards(mint: MintKeys) {
    this.prank(this.admin);
    const tx = this.getTx();

    tx.add(
      await this.lrrm.methods
        .stopRewards()
        .accounts(
          this.lrrmContext.getLendingRewardsContext(mint, this.admin.publicKey)
        )
        .instruction()
    );

    this.execute(tx);
  }

  async initLrrm() {
    this.prank(this.admin);

    const mintKeys = [
      MintKeys.USDC,
      MintKeys.USDT,
      MintKeys.WSOL,
      MintKeys.EURC,
    ];

    const tx = this.getTx();

    tx.add(
      await this.lrrm.methods
        .initLendingRewardsAdmin(
          this.admin.publicKey,
          new PublicKey(LENDING_PROGRAM)
        )
        .accounts({
          systemProgram: SystemProgram.programId,
          lendingRewardsAdmin: this.getLendingRewardsAdminPda(),
          signer: this.admin.publicKey,
        } as any)
        .instruction()
    );

    this.execute(tx);

    for (const mintKey of mintKeys) {
      const context = this.lrrmContext.getInitLendingRewardRateModelContext(
        mintKey,
        this.admin.publicKey
      );

      const ix = await this.lrrm.methods
        .initLendingRewardsRateModel()
        .accounts(context)
        .instruction();

      const tx = this.getTx();
      tx.add(ix);
      this.execute(tx);
    }
  }

  getLendingRewardsAdminPda() {
    const [lrrmAdminPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("lending_rewards_admin")],
      new PublicKey(LRRM_PROGRAM)
    );
    return lrrmAdminPda;
  }

  async setRewardsRateWithAmount(
    mint: MintKeys,
    amount: BN,
    duration: BN,
    startTime: BN,
    startTvl: BN,
    shouldStop: boolean = true
  ) {
    this.prank(this.admin);

    const context = this.lrrmContext.getLendingRewardsContext(
      mint,
      this.admin.publicKey
    );

    if (shouldStop) {
      this.warp(1);

      try {
        const tx = this.getTx();
        tx.add(
          await this.lrrm.methods.stopRewards().accounts(context).instruction()
        );

        this.execute(tx);
      } catch (error) {}
    }

    const tx = this.getTx();

    tx.add(
      await this.lrrm.methods
        .startRewards(amount, duration, startTime, startTvl)
        .accounts(context)
        .instruction()
    );
    this.execute(tx);
  }

  async setRewardsRate(
    mint: MintKeys,
    rate: BN,
    totalAssets: BN,
    duration_: BN,
    startTvl: BN,
    shouldStop: boolean = true
  ) {
    this.prank(this.admin);

    this.warp(1);

    let { rewardAmount, duration, startTime } = this.calculateRewardsParams({
      totalAssets,
      desiredRate: rate,
      duration: duration_,
      startTime: new BN(this.timestamp()),
    });

    if (rewardAmount.toString() === "0") rewardAmount = new BN(1);

    const context = this.lrrmContext.getLendingRewardsContext(
      mint,
      this.admin.publicKey
    );

    if (shouldStop) {
      try {
        const tx = this.getTx();
        tx.add(
          await this.lrrm.methods.stopRewards().accounts(context).instruction()
        );

        this.execute(tx);
      } catch (error) {}
    }

    const tx = this.getTx();

    tx.add(
      await this.lrrm.methods
        .startRewards(rewardAmount, duration, startTime, startTvl)
        .accounts(context)
        .instruction()
    );

    this.execute(tx);
  }

  calculateRewardsParams(input: RewardsInput): RewardsParams {
    const { totalAssets, desiredRate, duration, startTime } = input;

    const yearlyReward = desiredRate.mul(totalAssets).div(RATE_PRECISION);
    const rewardAmount = yearlyReward
      .mul(duration)
      .div(new BN(SECONDS_PER_YEAR));

    const actualStartTime = startTime || new BN(this.timestamp());

    return {
      rewardAmount,
      duration,
      startTime: actualStartTime,
    };
  }
}

const SECONDS_PER_YEAR = 31536000; // 365 * 24 * 60 * 60
const RATE_PRECISION = new BN("100000000000000"); // 1e14

export interface RewardsParams {
  rewardAmount: BN;
  duration: BN;
  startTime: BN;
}

export interface RewardsInput {
  totalAssets: BN;
  desiredRate: BN;
  duration: BN;
  startTime?: BN;
}
