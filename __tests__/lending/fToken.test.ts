import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

import { mint as MintInfo } from "../../ts-sdk/mint";
import { LendingBaseSetup } from "../../test-utils/typescript/lending/setup";
import { FluidLiquidityResolver } from "../../test-utils/typescript/liquidity/resolver";
import { LendingResolver } from "../../test-utils/typescript/lending/resolver";
import { UpdateUserSupplyConfigParams } from "../../ts-sdk/liquidity/types";

const DEFAULT_UNIT = new BN(1e6);
const DEFAULT_AMOUNT = new BN(1000).mul(DEFAULT_UNIT);
const u60MAX = new BN(2).pow(new BN(60)).sub(new BN(1));
const u64MAX = new BN(2).pow(new BN(64)).sub(new BN(1));
const PASS_1YEAR_TIME = 365 * 24 * 60 * 60;

describe("FTokenBasicActionsTests", () => {
  let setup: LendingBaseSetup;
  let underlyingMint: PublicKey;
  let resolver: FluidLiquidityResolver;
  let lendingResolver: LendingResolver;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";

    setup = new LendingBaseSetup();
    await setup.setup();
    underlyingMint = MintInfo.getMint(setup.underlying);

    resolver = new FluidLiquidityResolver(
      setup.admin,
      setup.liquidity,
      setup.client
    );

    lendingResolver = new LendingResolver(
      setup.admin,
      setup.lending,
      resolver,
      setup.client,
      setup.lrrm
    );
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  it("Should deposit", async () => {
    const underlyingBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      underlyingMint
    );

    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const fTokenBalance = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    const underlyingBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    // prettier-ignore
    {
      expect(setup.decimals(setup.underlyingFToken)).to.be.eq(setup.decimals(underlyingMint));
      expect(fTokenBalance.toString()).to.be.eq(DEFAULT_AMOUNT.toString());
      expect(underlyingBalanceBefore.sub(underlyingBalanceAfter).toString()).to.be.eq(DEFAULT_AMOUNT.toString());
    }
  });

  it("Should deposit_DepositWithMinSharesAmountOut", async () => {
    const underlyingBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      underlyingMint
    );

    // prettier-ignore
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice, DEFAULT_AMOUNT);

    const fTokenBalance = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    const underlyingBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    // prettier-ignore
    {
        expect(setup.decimals(setup.underlyingFToken)).to.be.eq(setup.decimals(underlyingMint));
        expect(fTokenBalance.toString()).to.be.eq(DEFAULT_AMOUNT.toString());
        expect(underlyingBalanceBefore.sub(underlyingBalanceAfter).toString()).to.be.eq(DEFAULT_AMOUNT.toString());
    }
  });

  it("Should deposit_RevertIfLessThanMinSharesAmountOut", async () => {
    expect(
      await setup.expectRevert(
        "F_TOKEN_MIN_AMOUNT_OUT",
        setup.depositToLending.bind(setup),
        setup.underlying,
        DEFAULT_AMOUNT,
        setup.alice,
        DEFAULT_AMOUNT.add(new BN(1))
      )
    ).to.be.true;
  });

  it("Should deposit_WithMaxAssetAmount", async () => {
    // Should fail at LL as we are reaching the maximum amount that can be deposited to LL
    expect(
      await setup.expectRevert(
        "USER_MODULE_VALUE_OVERFLOW_TOTAL_SUPPLY",
        setup.depositToLending.bind(setup),
        setup.underlying,
        u60MAX,
        setup.alice
      )
    ).to.be.true;

    const underlyingBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    // prettier-ignore
    // Since DEFAULT_AMOUNT is already deposit in setup to LL
    await setup.depositToLending(setup.underlying, u60MAX.sub(DEFAULT_AMOUNT).sub(new BN(1)), setup.alice);

    const fTokenBalance = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    const underlyingBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    // prettier-ignore
    {
        expect(setup.decimals(setup.underlyingFToken)).to.be.eq(setup.decimals(underlyingMint));
        expect(fTokenBalance.toString()).to.be.eq(u60MAX.sub(DEFAULT_AMOUNT).sub(new BN(1)).toString());
        expect(underlyingBalanceBefore.sub(underlyingBalanceAfter).toString()).to.be.eq(u60MAX.sub(DEFAULT_AMOUNT).sub(new BN(1)).toString());
    }
  });

  // deprecated
  it("Should deposit_RevertIfDepositInsignificant", async () => {
    // await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);
    // setup.warp(PASS_1YEAR_TIME);
    // expect(
    //   await setup.expectRevert(
    //     "F_TOKEN_DEPOSIT_INSIGNIFICANT",
    //     setup.depositToLending.bind(setup),
    //     setup.underlying,
    //     new BN(1),
    //     setup.alice
    //   )
    // ).to.be.true;
  });

  it("Should mint", async () => {
    const underlyingBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    await setup.mintToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const fTokenBalance = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    const underlyingBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    // prettier-ignore
    {
        expect(setup.decimals(setup.underlyingFToken)).to.be.eq(setup.decimals(underlyingMint));
        expect(fTokenBalance.toString()).to.be.eq(DEFAULT_AMOUNT.toString());
        expect(underlyingBalanceBefore.sub(underlyingBalanceAfter).toString()).to.be.eq(DEFAULT_AMOUNT.toString());
    }
  });

  it("Should mint_WithMaxAssetAmount", async () => {
    // Should fail at LL as we are reaching the maximum amount that can be deposited to LL
    expect(
      await setup.expectRevert(
        "USER_MODULE_VALUE_OVERFLOW_TOTAL_SUPPLY",
        setup.depositToLending.bind(setup),
        setup.underlying,
        u60MAX,
        setup.alice
      )
    ).to.be.true;

    const underlyingBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    // prettier-ignore
    // Since DEFAULT_AMOUNT is already deposit in setup to LL
    await setup.mintToLending(setup.underlying, u60MAX.sub(DEFAULT_AMOUNT).sub(new BN(1)), setup.alice);

    const fTokenBalance = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    const underlyingBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    // prettier-ignore
    {
        expect(setup.decimals(setup.underlyingFToken)).to.be.eq(setup.decimals(underlyingMint));
        expect(fTokenBalance.toString()).to.be.eq(u60MAX.sub(DEFAULT_AMOUNT).sub(new BN(1)).toString());
        expect(underlyingBalanceBefore.sub(underlyingBalanceAfter).toString()).to.be.eq(u60MAX.sub(DEFAULT_AMOUNT).sub(new BN(1)).toString());
    }
  });

  it("Should withdraw", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const underlyingBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    const fTokenBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    await setup.withdrawFromLending(
      setup.underlying,
      DEFAULT_AMOUNT,
      setup.alice
    );

    const underlyingBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    const fTokenBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    // prettier-ignore
    {
      expect(underlyingBalanceAfter.sub(underlyingBalanceBefore).toString()).to.be.eq(DEFAULT_AMOUNT.toString());
      expect(fTokenBalanceBefore.sub(fTokenBalanceAfter).toString()).to.be.eq(DEFAULT_AMOUNT.toString());
      expect(fTokenBalanceAfter.toString()).to.be.eq("0");
    }
  });

  it("Should withdraw_WithMaxAssetAmount", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const fTokenBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    const underlyingBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    // Withdraw with maximum uint64 value (should withdraw all available)
    await setup.withdrawFromLending(
      setup.underlying,
      u64MAX, // Use max value
      setup.alice
    );

    const fTokenBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    const underlyingBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    // prettier-ignore
    {
      expect(underlyingBalanceAfter.sub(underlyingBalanceBefore).toString()).to.be.eq(DEFAULT_AMOUNT.toString());
      expect(fTokenBalanceBefore.toString()).to.be.eq(DEFAULT_AMOUNT.toString());
      expect(fTokenBalanceAfter.toString()).to.be.eq("0");
    }
  });

  it("Should withdraw_WithWithdrawableResolver", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    let { userSupplyData } = await resolver.getUserSupplyData(
      setup.underlyingLending,
      setup.underlying
    );

    await setup.withdrawFromLending(
      setup.underlying,
      userSupplyData.withdrawable,
      setup.alice
    );

    ({ userSupplyData } = await resolver.getUserSupplyData(
      setup.underlyingLending,
      setup.underlying
    ));

    expect(userSupplyData.withdrawable.toString()).to.be.eq("0");
  });

  it("Should withdraw_WithMaxSharesBurn", async () => {
    const aliceBalanceBeforeDeposit = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const aliceBalanceAfterDeposit = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    expect(aliceBalanceBeforeDeposit.toString()).to.be.eq(
      aliceBalanceAfterDeposit.sub(DEFAULT_AMOUNT).toString()
    );

    await setup.withdrawFromLending(
      setup.underlying,
      u64MAX,
      setup.alice,
      DEFAULT_AMOUNT // maxShares
    );

    const aliceBalanceAfterWithdraw = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    expect(aliceBalanceBeforeDeposit.toString()).to.be.eq(
      aliceBalanceAfterWithdraw.toString()
    );
  });

  it("Should withdraw_RevertIfMaxSharesBurnIsSurpassed", async () => {
    // First deposit tokens
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    // Try to withdraw DEFAULT_AMOUNT but set maxShares to DEFAULT_AMOUNT - 1
    // This should revert because the withdrawal would require burning DEFAULT_AMOUNT shares
    // but maxShares is set to only allow DEFAULT_AMOUNT - 1 shares to be burned
    expect(
      await setup.expectRevert(
        "F_TOKEN_MAX_AMOUNT",
        setup.withdrawFromLending.bind(setup),
        setup.underlying,
        DEFAULT_AMOUNT,
        setup.alice,
        DEFAULT_AMOUNT.sub(new BN(1)) // maxShares = DEFAULT_AMOUNT - 1
      )
    ).to.be.true;
  });

  it("Should redeem", async () => {
    await setup.mintToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const underlyingBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    const fTokenBalance = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    await setup.redeemFromLending(
      setup.underlying,
      fTokenBalance, // redeem all fTokens alice has
      setup.alice
    );

    const underlyingBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    const fTokenBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    // prettier-ignore
    {
      expect(fTokenBalanceAfter.toString()).to.be.eq("0");
      expect(fTokenBalance.toString()).to.be.eq(DEFAULT_AMOUNT.toString());
      expect(underlyingBalanceAfter.sub(underlyingBalanceBefore).toString()).to.be.eq(DEFAULT_AMOUNT.toString());
    }
  });

  it("Should redeem_WithMaxAssetAmount", async () => {
    await setup.mintToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const underlyingBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    await setup.redeemFromLending(
      setup.underlying,
      u64MAX, // equivalent to UINT256_MAX
      setup.alice
    );

    const underlyingBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    const fTokenBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    // prettier-ignore
    {
      expect(fTokenBalanceAfter.toString()).to.be.eq("0");
      expect(underlyingBalanceAfter.sub(underlyingBalanceBefore).toString()).to.be.eq(DEFAULT_AMOUNT.toString());
    }
  });

  it("Should redeem_WithMinAmountOut", async () => {
    const aliceBalanceBeforeDeposit = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    await setup.mintToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const aliceBalanceAfterDeposit = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    expect(aliceBalanceBeforeDeposit.toString()).to.be.eq(
      aliceBalanceAfterDeposit.sub(DEFAULT_AMOUNT).toString()
    );

    await setup.redeemFromLending(
      setup.underlying,
      u64MAX, // redeem max possible shares
      setup.alice,
      DEFAULT_AMOUNT // minAmountOut parameter
    );

    const aliceBalanceAfterRedeem = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    expect(aliceBalanceAfterRedeem.toString()).to.be.eq(
      aliceBalanceBeforeDeposit.toString()
    );
  });

  it("Should redeem_RevertIfLessThanMinAmountOut", async () => {
    await setup.mintToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    expect(
      await setup.expectRevert(
        "F_TOKEN_MIN_AMOUNT_OUT",
        setup.redeemFromLending.bind(setup),
        setup.underlying,
        u64MAX,
        setup.alice,
        DEFAULT_AMOUNT.add(new BN(1))
      )
    ).to.be.true;
  });

  it("Should rebalance", async () => {
    // Make alice the rebalancer
    await setup.updateRebalancer(setup.alice.publicKey.toString());

    // Supply as alice to have some initial deposit
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    // Get balance of alice before rebalance
    const balanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      underlyingMint
    );

    await setup.setRewardsRate(
      setup.underlying,
      new BN(20 * 1e12),
      DEFAULT_AMOUNT,
      new BN(PASS_1YEAR_TIME),
      new BN(1)
    );

    // Create a difference between Liquidity supply and totalAssets() by warping time so rewards accrue
    // Rewards rate is 20% per year
    setup.warp(PASS_1YEAR_TIME);

    await setup.updateRate(setup.underlying);

    const totalAssetsBefore = await lendingResolver.totalAssets(
      setup.underlying
    );

    // - Total assets to be 1.2x DEFAULT_AMOUNT now (120% due to 20% rewards)
    // - Liquidity balance still to be only DEFAULT_AMOUNT
    const expectedTotalAssets = DEFAULT_AMOUNT.mul(new BN(12)).div(new BN(10)); // 1.2x

    expect(totalAssetsBefore.toString()).to.be.eq(
      expectedTotalAssets.toString()
    );

    const lendingDataBefore = await lendingResolver.getData(setup.underlying);
    expect(lendingDataBefore.liquidityBalance.toString()).to.be.eq(
      DEFAULT_AMOUNT.toString()
    );

    // Execute rebalance
    await setup.rebalance(setup.underlying, setup.alice);

    // Get balance of alice after rebalance
    const balanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    // prettier-ignore
    {
      // Balance should be before - 20% of DEFAULT_AMOUNT as 20% of DEFAULT_AMOUNT got used to fund rewards
      const expectedBalanceReduction = DEFAULT_AMOUNT.div(new BN(5)); // 20% of DEFAULT_AMOUNT
      expect(balanceAfter.toString()).to.be.eq(balanceBefore.sub(expectedBalanceReduction).toString());

      // Total assets should still be 1.2x DEFAULT_AMOUNT now
      expect(lendingDataBefore.liquidityBalance.toString()).to.be.eq(DEFAULT_AMOUNT.toString());
    }

    // Get lending data after rebalance
    const lendingDataAfter = await lendingResolver.getData(setup.underlying);
    expect(lendingDataAfter.liquidityBalance.toString()).to.be.eq(
      DEFAULT_AMOUNT.mul(new BN(12)).div(new BN(10)).toString()
    );
  });

  it("Should updateRates_CaseWhenRewardsEnded", async () => {
    let timestamp = setup.timestamp();
    let startTime = parseInt(timestamp) + 24 * 60 * 60 * 10; // day 10

    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL), // 1 SOL
      new BN(24 * 60 * 60 * 365),
      new BN(startTime),
      new BN(1)
    );

    let lendingPDA = setup.underlyingLending;
    let lending = await setup.lending.account.lending.fetch(lendingPDA);

    // prettier-ignore
    {
      expect(lending.tokenExchangePrice.toString()).to.be.eq(new BN(1e12).toString());
      expect(lending.liquidityExchangePrice.toString()).to.be.eq(new BN(1e12).toString());
      expect(lending.lastUpdateTimestamp.toString()).to.be.eq(new BN(timestamp).toString());
    }

    setup.warp(24 * 60 * 60 * 365 - 2);
    await setup.exposeLiquidityExchangePrice(setup.underlying, new BN(2e12));
    await setup.updateRate(setup.underlying);

    lending = await setup.lending.account.lending.fetch(lendingPDA);

    // prettier-ignore
    {
      expect(lending.tokenExchangePrice.toString()).to.be.eq(new BN(2e12).toString());
      expect(lending.liquidityExchangePrice.toString()).to.be.eq(new BN(2e12).toString());
      expect(lending.lastUpdateTimestamp.toString()).to.be.eq(new BN(setup.timestamp()).toString()); // we warp by 1 in updateRate
    }

    setup.warp(24 * 60 * 60 * 365);
    await setup.exposeLiquidityExchangePrice(setup.underlying, new BN(2e12));
    await setup.updateRate(setup.underlying);

    lending = await setup.lending.account.lending.fetch(lendingPDA);
    // prettier-ignore
    {
      expect(lending.tokenExchangePrice.toString()).to.be.eq(new BN(2e12).toString());
      expect(lending.liquidityExchangePrice.toString()).to.be.eq(new BN(2e12).toString());
      expect(lending.lastUpdateTimestamp.toString()).to.be.eq(new BN(setup.timestamp()).toString()); // we warp by 1 in updateRate
    }
  });

  it("Should maxDeposit_NoDeposits", async () => {
    // withdraw seed deposit from mockProtocol as alice down to 0
    await setup.withdraw(
      setup.mockProtocol,
      DEFAULT_AMOUNT,
      setup.underlying,
      setup.alice
    );

    const lendingData = await lendingResolver.getData(setup.underlying);
    expect(lendingData.liquidityBalance.toString()).to.be.eq("0");

    const maxDeposit = await lendingResolver.maxDeposit(
      setup.underlying,
      setup.alice.publicKey
    );

    expect(maxDeposit.toString()).to.be.eq(u60MAX.toString());
  });

  it("Should maxMint_NoDeposits", async () => {
    // withdraw seed deposit from mockProtocol as alice down to 0
    await setup.withdraw(
      setup.mockProtocol,
      DEFAULT_AMOUNT,
      setup.underlying,
      setup.alice
    );

    const lendingData = await lendingResolver.getData(setup.underlying);
    expect(lendingData.liquidityBalance.toString()).to.be.eq("0");

    const maxMint = await lendingResolver.maxMint(
      setup.underlying,
      setup.alice.publicKey
    );

    expect(maxMint.toString()).to.be.eq(u60MAX.toString());
  });

  it("Should maxDeposit_WithDeposits", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const maxDeposit = await lendingResolver.maxDeposit(
      setup.underlying,
      setup.alice.publicKey
    );

    expect(maxDeposit.toString()).to.be.eq(
      u60MAX.sub(DEFAULT_AMOUNT.mul(new BN(2))).toString()
    );

    const maxDepositAmount = await lendingResolver.maxDeposit(
      setup.underlying,
      setup.alice.publicKey
    );

    await setup.depositToLending(
      setup.underlying,
      maxDepositAmount.sub(new BN(1)), // since max deposit at LL is 1 less than u64 max
      setup.alice
    );

    const maxDepositAfter = await lendingResolver.maxDeposit(
      setup.underlying,
      setup.alice.publicKey
    );

    expect(maxDepositAfter.toString()).to.be.eq("1");
  });

  it("Should maxMint_WithDeposits", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const maxMint = await lendingResolver.maxMint(
      setup.underlying,
      setup.alice.publicKey
    );

    const expectedMaxMint = u60MAX.sub(DEFAULT_AMOUNT.mul(new BN(2)));
    expect(maxMint.toString()).to.be.eq(expectedMaxMint.toString());

    const maxMintAmount = await lendingResolver.maxMint(
      setup.underlying,
      setup.alice.publicKey
    );

    await setup.mintToLending(
      setup.underlying,
      maxMintAmount.sub(new BN(1)), // since max mint at LL is 1 less than u64 max
      setup.alice
    );

    setup.warp(10); // equivalent to vm.warp(block.timestamp + 10)

    const maxMintAfter = await lendingResolver.maxMint(
      setup.underlying,
      setup.alice.publicKey
    );

    expect(maxMintAfter.toString()).to.be.eq("1");
  });

  it("Should maxWithdraw_NoWithdrawalLimit", async () => {
    const maxWithdrawBefore = await lendingResolver.maxWithdraw(
      setup.underlying,
      setup.alice.publicKey
    );

    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const maxWithdrawAfter = await lendingResolver.maxWithdraw(
      setup.underlying,
      setup.alice.publicKey
    );

    expect(maxWithdrawAfter.toString()).to.be.eq(
      maxWithdrawBefore.add(DEFAULT_AMOUNT).toString()
    );
  });

  it("Should maxRedeem_NoWithdrawalLimit", async () => {
    const maxRedeemBefore = await lendingResolver.maxRedeem(
      setup.underlying,
      setup.alice.publicKey
    );

    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const maxRedeemAfter = await lendingResolver.maxRedeem(
      setup.underlying,
      setup.alice.publicKey
    );

    expect(maxRedeemAfter.toString()).to.be.eq(
      maxRedeemBefore.add(DEFAULT_AMOUNT).toString()
    );
  });

  it("Should maxWithdraw_WithWithdrawalLimit", async () => {
    // Set withdrawal limit of 10% at liquidity
    const supplyConfig: UpdateUserSupplyConfigParams = {
      mint: setup.underlying,
      newSupplyConfig: {
        user: setup.underlyingLending, // fToken address
        token: MintInfo.getMint(setup.underlying),
        mode: 1, // with interest
        expandPercent: new BN(10 * 1e2), // 10%
        expandDuration: new BN(1),
        baseWithdrawalLimit: new BN(1e5), // low base withdrawal limit
      },
    };
    await setup.updateUserSupplyConfig([supplyConfig]);

    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    setup.warp(10); // get to full expansion

    const maxWithdraw = await lendingResolver.maxWithdraw(
      setup.underlying,
      setup.alice.publicKey
    );

    expect(maxWithdraw.toString()).to.be.eq(
      DEFAULT_AMOUNT.div(new BN(10)).toString()
    );

    const maxWithdrawAmount = await lendingResolver.maxWithdraw(
      setup.underlying,
      setup.alice.publicKey
    );

    await setup.withdrawFromLending(
      setup.underlying,
      maxWithdrawAmount,
      setup.alice
    );

    const maxWithdrawAfter = await lendingResolver.maxWithdraw(
      setup.underlying,
      setup.alice.publicKey
    );

    expect(maxWithdrawAfter.toString()).to.be.eq("0");
  });

  it("Should maxRedeem_WithWithdrawalLimit", async () => {
    await setup.setRewardsRate(
      setup.underlying,
      new BN(0),
      DEFAULT_AMOUNT,
      new BN(1),
      new BN(1)
    );

    // Set withdrawal limit of 10% at liquidity
    const supplyConfig: UpdateUserSupplyConfigParams = {
      mint: setup.underlying,
      newSupplyConfig: {
        user: setup.underlyingLending, // fToken address
        token: MintInfo.getMint(setup.underlying),
        mode: 1, // with interest
        expandPercent: new BN(10 * 1e2), // 10% (assuming 1e4 precision)
        expandDuration: new BN(1),
        baseWithdrawalLimit: new BN(1e5), // low base withdrawal limit
      },
    };
    await setup.updateUserSupplyConfig([supplyConfig]);

    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    setup.warp(10); // get to full expansion

    const maxRedeem = await lendingResolver.maxRedeem(
      setup.underlying,
      setup.alice.publicKey
    );

    expect(maxRedeem.toNumber()).to.closeTo(
      DEFAULT_AMOUNT.div(new BN(10)).toNumber(),
      10
    );

    const maxRedeemAmount = await lendingResolver.maxRedeem(
      setup.underlying,
      setup.alice.publicKey
    );

    await setup.redeemFromLending(
      setup.underlying,
      maxRedeemAmount,
      setup.alice
    );

    const maxRedeemAfter = await lendingResolver.maxRedeem(
      setup.underlying,
      setup.alice.publicKey
    );

    expect(maxRedeemAfter.toNumber()).to.be.closeTo(0, 1);
  });
});
