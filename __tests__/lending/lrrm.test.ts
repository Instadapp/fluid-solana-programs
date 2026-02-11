import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { LendingBaseSetup } from "../../test-utils/typescript/lending/setup";
import { LendingResolver } from "../../test-utils/typescript/lending/resolver";
import { FluidLiquidityResolver } from "../../test-utils/typescript/liquidity/resolver";

const DEFAULT_UNIT = new BN(1e6);
const DEFAULT_AMOUNT = new BN(1000).mul(DEFAULT_UNIT);
const PASS_1YEAR_TIME = 365 * 24 * 60 * 60;
const PASS_1DAY_TIME = 24 * 60 * 60;
const PASS_1HOUR_TIME = 60 * 60;

describe("LendingRewardRateModelBaseTests", () => {
  let setup: LendingBaseSetup;
  let resolver: FluidLiquidityResolver;
  let lendingResolver: LendingResolver;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";
    setup = new LendingBaseSetup();
    await setup.setup();

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

  it("Should handle zero reward amount initialization", async () => {
    // Test that initializing with zero reward amount fails
    expect(
      await setup.expectRevert(
        "InvalidParams",
        setup.setRewardsRateWithAmount.bind(setup),
        setup.underlying,
        new BN(0), // zero reward amount
        new BN(PASS_1YEAR_TIME),
        new BN(parseInt(setup.timestamp()) + PASS_1DAY_TIME),
        new BN(1)
      )
    ).to.be.true;
  });

  it("Should handle zero duration initialization", async () => {
    // Test that initializing with zero duration fails
    expect(
      await setup.expectRevert(
        "InvalidParams",
        setup.setRewardsRateWithAmount.bind(setup),
        setup.underlying,
        new BN(LAMPORTS_PER_SOL),
        new BN(0), // zero duration
        new BN(parseInt(setup.timestamp()) + PASS_1DAY_TIME),
        new BN(1)
      )
    ).to.be.true;
  });

  it("Should handle past start time initialization", async () => {
    // Test that initializing with past start time fails
    expect(
      await setup.expectRevert(
        "InvalidParams",
        setup.setRewardsRateWithAmount.bind(setup),
        setup.underlying,
        new BN(LAMPORTS_PER_SOL),
        new BN(PASS_1YEAR_TIME),
        new BN(parseInt(setup.timestamp()) - PASS_1DAY_TIME), // past time
        new BN(1)
      )
    ).to.be.true;
  });

  it("Should handle rewards rate exceeding maximum allowed", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    // Set extremely high reward rate (>25% which should be capped)
    const excessiveRate = new BN(30 * 1e12); // 30%
    await setup.setRewardsRate(
      setup.underlying,
      excessiveRate,
      DEFAULT_AMOUNT,
      new BN(PASS_1YEAR_TIME),
      new BN(1)
    );
    // Advance time and check that rewards are capped
    setup.warp(PASS_1YEAR_TIME);
    await setup.updateRate(setup.underlying);

    const totalAssets = await lendingResolver.totalAssets(setup.underlying);
    const expectedMaxIncrease = DEFAULT_AMOUNT.mul(new BN(130)).div(
      new BN(100)
    ); // 30% max

    expect(totalAssets.lte(expectedMaxIncrease)).to.be.true;
  });

  it("Should handle reward calculation with very small durations", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    // Set rewards for very short duration (1 second)
    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(1), // minimal reward amount
      new BN(1), // 1 second duration
      new BN(parseInt(setup.timestamp()) + 1),
      new BN(1)
    );

    setup.warp(2); // advance past the 1 second duration
    await setup.updateRate(setup.underlying);

    // Should not cause any overflow or unexpected behavior
    const totalAssets = await lendingResolver.totalAssets(setup.underlying);
    expect(totalAssets.gte(DEFAULT_AMOUNT)).to.be.true;
  });

  it("Should handle reward calculation with very large durations", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    // Set rewards for very long duration (10 years)
    const tenYears = new BN(10 * PASS_1YEAR_TIME);
    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      tenYears,
      new BN(parseInt(setup.timestamp()) + PASS_1DAY_TIME),
      new BN(1)
    );

    setup.warp(PASS_1YEAR_TIME); // advance 1 year
    await setup.updateRate(setup.underlying);

    // Should handle large time calculations without overflow
    const totalAssets = await lendingResolver.totalAssets(setup.underlying);
    expect(totalAssets.gt(DEFAULT_AMOUNT)).to.be.true;
  });

  it("Should handle overlapping reward periods correctly", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    // Start first reward period
    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(PASS_1YEAR_TIME),
      new BN(parseInt(setup.timestamp()) + PASS_1DAY_TIME),
      new BN(1)
    );

    // Advance halfway through first period
    setup.warp(PASS_1DAY_TIME + PASS_1YEAR_TIME / 2);

    // Try to start new rewards while current ones are active
    expect(
      await setup.expectRevert(
        "NotEnded",
        setup.setRewardsRateWithAmount.bind(setup),
        setup.underlying,
        new BN(LAMPORTS_PER_SOL),
        new BN(PASS_1YEAR_TIME),
        new BN(parseInt(setup.timestamp()) + PASS_1DAY_TIME),
        new BN(1),
        false
      )
    ).to.be.true;
  });

  it("Should handle rewards ending exactly at boundary", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const startTime = parseInt(setup.timestamp()) + PASS_1DAY_TIME;
    const duration = PASS_1YEAR_TIME;

    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(duration),
      new BN(startTime),
      new BN(1)
    );

    // Advance to exactly the end time
    setup.warp(duration + PASS_1DAY_TIME);
    await setup.updateRate(setup.underlying);

    const totalAssetsBoundary = await lendingResolver.totalAssets(
      setup.underlying
    );

    // Advance past the end time
    setup.warp(1);
    await setup.updateRate(setup.underlying);

    const totalAssetsAfter = await lendingResolver.totalAssets(
      setup.underlying
    );

    // Total assets should not increase after rewards end
    expect(totalAssetsAfter.toString()).to.equal(
      totalAssetsBoundary.toString()
    );
  });

  it("Should handle multiple consecutive reward periods", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    // First reward period
    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(PASS_1YEAR_TIME),
      new BN(parseInt(setup.timestamp()) + PASS_1DAY_TIME),
      new BN(1)
    );

    // Wait for first period to end
    setup.warp(PASS_1YEAR_TIME + PASS_1DAY_TIME);
    await setup.updateRate(setup.underlying);

    const totalAssetsAfterFirst = await lendingResolver.totalAssets(
      setup.underlying
    );

    // Start second reward period
    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(PASS_1YEAR_TIME),
      new BN(parseInt(setup.timestamp()) + PASS_1DAY_TIME),
      new BN(1)
    );

    // Wait for second period to end
    setup.warp(PASS_1YEAR_TIME + PASS_1DAY_TIME);
    await setup.updateRate(setup.underlying);

    const totalAssetsAfterSecond = await lendingResolver.totalAssets(
      setup.underlying
    );

    // Should accumulate rewards from both periods
    expect(totalAssetsAfterSecond.gt(totalAssetsAfterFirst)).to.be.true;
  });

  it("Should handle queued rewards correctly", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    // Start first reward period
    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(PASS_1YEAR_TIME),
      new BN(parseInt(setup.timestamp()) + PASS_1DAY_TIME),
      new BN(1)
    );

    // Queue next rewards while current is active
    const lrrmPda = setup.getLrrmPda(setup.underlying);

    await setup.queueNextRewards(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(PASS_1YEAR_TIME)
    );

    // Advance past first period end
    setup.warp(PASS_1YEAR_TIME + PASS_1DAY_TIME + 1);

    // Transition to next rewards
    await setup.transitionToNextRewards(setup.underlying);

    // Verify next rewards are active
    const rateModel = await setup.lrrm.account.lendingRewardsRateModel.fetch(
      lrrmPda
    );
    expect(rateModel.nextRewardAmount.toString()).to.equal("0");
    expect(rateModel.yearlyReward.gt(new BN(0))).to.be.true;
  });

  it("Should handle canceling queued rewards", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    // Start first reward period
    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(PASS_1YEAR_TIME),
      new BN(parseInt(setup.timestamp()) + PASS_1DAY_TIME),
      new BN(1)
    );

    // Queue next rewards
    await setup.queueNextRewards(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(PASS_1YEAR_TIME)
    );

    await setup.cancelQueuedRewards(setup.underlying);

    // Verify queued rewards are cleared
    const rateModel = await setup.lrrm.account.lendingRewardsRateModel.fetch(
      setup.getLrrmPda(setup.underlying)
    );
    expect(rateModel.nextRewardAmount.toString()).to.equal("0");
    expect(rateModel.nextDuration.toString()).to.equal("0");
  });

  it("Should handle stopping rewards mid-period", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const startTime = parseInt(setup.timestamp()) + PASS_1DAY_TIME;

    // Start reward period
    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(PASS_1YEAR_TIME),
      new BN(startTime),
      new BN(1)
    );

    // Advance halfway through period
    setup.warp(PASS_1YEAR_TIME / 2);

    // Stop rewards
    await setup.stopRewards(setup.underlying);
    const lrrmPda = setup.getLrrmPda(setup.underlying);

    // Verify duration was updated to current time
    const rateModel = await setup.lrrm.account.lendingRewardsRateModel.fetch(
      lrrmPda
    );
    const expectedDuration = parseInt(setup.timestamp()) - startTime - 1;
    expect(rateModel.duration.toNumber()).to.be.closeTo(expectedDuration, 1);
  });

  it("Should handle precision edge cases in reward calculations", async () => {
    // Test with minimal amounts to check precision
    const minAmount = new BN(1e5);

    await setup.depositToLending(setup.underlying, minAmount, setup.alice);

    // Set minimal rewards
    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(1e5), // minimal reward
      new BN(PASS_1YEAR_TIME),
      new BN(parseInt(setup.timestamp()) + PASS_1DAY_TIME),
      new BN(1)
    );

    setup.warp(PASS_1YEAR_TIME);
    await setup.updateRate(setup.underlying);

    // Should handle minimal calculations without underflow
    const totalAssets = await lendingResolver.totalAssets(setup.underlying);
    expect(totalAssets.gte(minAmount)).to.be.true;
  });

  it("Should handle reward calculations with no deposits", async () => {
    // Set rewards without any deposits
    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(PASS_1YEAR_TIME),
      new BN(parseInt(setup.timestamp()) + PASS_1DAY_TIME),
      new BN(1)
    );

    setup.warp(PASS_1YEAR_TIME);
    await setup.updateRate(setup.underlying);

    // Should handle zero total supply gracefully
    const totalAssets = await lendingResolver.totalAssets(setup.underlying);
    expect(totalAssets.toString()).to.equal("0");
  });

  it("Should handle timestamp edge cases", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    // Set rewards starting exactly now
    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(PASS_1YEAR_TIME),
      new BN(0), // start time = 0 means start now
      new BN(1)
    );

    // Should start immediately
    setup.warp(1);
    await setup.updateRate(setup.underlying);

    const totalAssets = await lendingResolver.totalAssets(setup.underlying);
    expect(totalAssets.gt(DEFAULT_AMOUNT)).to.be.true;
  });

  it("Should handle multiple rate updates in same block", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(PASS_1YEAR_TIME),
      new BN(parseInt(setup.timestamp()) + PASS_1DAY_TIME),
      new BN(1)
    );

    setup.warp(PASS_1DAY_TIME);

    // Multiple updates in same timestamp
    await setup.updateRate(setup.underlying);
    const totalAssets1 = await lendingResolver.totalAssets(setup.underlying);

    await setup.updateRate(setup.underlying);
    const totalAssets2 = await lendingResolver.totalAssets(setup.underlying);

    // Should not double-count rewards
    expect(totalAssets1.toString()).to.equal(totalAssets2.toString());
  });
});

describe("RewardPeriodOverlapAndTimestampEdgeCases", () => {
  let setup: LendingBaseSetup;
  let resolver: FluidLiquidityResolver;
  let lendingResolver: LendingResolver;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";
    setup = new LendingBaseSetup();
    await setup.setup();

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

  afterEach(() => {
    setup.logComputeBudget();
  });

  it("Should handle last_update before current_end, next rewards started with exact calculation", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const baseTime = parseInt(setup.timestamp());

    // Setup: Current rewards period
    const currentStart = baseTime + PASS_1DAY_TIME;
    const currentDuration = PASS_1YEAR_TIME;
    const rewardAmount = new BN(LAMPORTS_PER_SOL);

    await setup.setRewardsRateWithAmount(
      setup.underlying,
      rewardAmount,
      new BN(currentDuration),
      new BN(currentStart),
      new BN(1)
    );

    // Advance to middle of current rewards period
    const midCurrentPeriod = currentStart + Math.floor(currentDuration / 2);
    setup.warp(midCurrentPeriod - baseTime);

    // prettier-ignore
    expect((await lendingResolver.totalAssets(setup.underlying)).toString()).to.equal("1000000000");
    await setup.updateRate(setup.underlying);
    // prettier-ignore
    // 25% of rewards should be added, max capped at 50% APY
    expect((await lendingResolver.totalAssets(setup.underlying)).toString()).to.equal("1250000015");

    // Queue next rewards
    const nextDuration = PASS_1YEAR_TIME;
    const nextRewardAmount = new BN(LAMPORTS_PER_SOL);

    await setup.queueNextRewards(
      setup.underlying,
      nextRewardAmount,
      new BN(nextDuration)
    );

    // End current reward period and transition to next
    setup.warp(Math.floor(currentDuration / 2)); // Go past current end

    await setup.updateRate(setup.underlying);
    const totalAssetsAfter = await lendingResolver.totalAssets(
      setup.underlying
    );

    // old_token_exchange_price: 1250000015854',
    // old_liquidity_exchange_price: 1000000000000',
    // new_liquidity_exchange_price: 1000000000000',
    // current_rewards_return: 24999998414510',
    // next_rewards_return: 1585489',
    // liquidity_return_percent: 0',
    // total_return_in_percent: 24999999999999',
    // new_token_exchange_price: 1562500019817',
    expect(totalAssetsAfter.toString()).to.equal("1562500019");
  });

  it("Should handle last_update = current_start, next rewards active", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const baseTime = parseInt(setup.timestamp());
    const currentStart = baseTime + PASS_1DAY_TIME;
    const currentDuration = PASS_1HOUR_TIME; // Short period

    // Set very short current rewards period
    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(currentDuration),
      new BN(currentStart),
      new BN(1)
    );

    // Don't update during current period, so last_update stays at start time
    // Advance past current period end
    setup.warp(PASS_1DAY_TIME + currentDuration + 1);

    // Start next rewards period
    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(PASS_1YEAR_TIME),
      new BN(setup.timestamp()),
      new BN(1),
      false
    );

    // Advance into next period
    setup.warp(PASS_1HOUR_TIME);

    const totalAssetsBefore = await lendingResolver.totalAssets(
      setup.underlying
    );
    await setup.updateRate(setup.underlying);
    const totalAssetsAfter = await lendingResolver.totalAssets(
      setup.underlying
    );

    // Should process full current period + partial next period
    expect(totalAssetsAfter.gt(totalAssetsBefore)).to.be.true;
  });

  it("Should handle last_update > current_start but < current_end, next active", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const baseTime = parseInt(setup.timestamp());
    const currentStart = baseTime + PASS_1DAY_TIME;
    const currentDuration = PASS_1DAY_TIME * 2; // 2 days

    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(currentDuration),
      new BN(currentStart),
      new BN(1)
    );

    // Update partway through current period
    setup.warp(PASS_1DAY_TIME + PASS_1HOUR_TIME); // 1 hour into current period
    await setup.updateRate(setup.underlying);

    const lending = await setup.lending.account.lending.fetch(
      setup.underlyingLending
    );
    const lastUpdateAfterPartial = lending.lastUpdateTimestamp.toNumber();

    // Let current period end and start next
    setup.warp(PASS_1DAY_TIME); // Total: 2 days after current start (current ended)

    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(PASS_1YEAR_TIME),
      new BN(setup.timestamp()).add(new BN(1)),
      new BN(1)
    );

    // Advance into next period
    setup.warp(PASS_1HOUR_TIME);

    const totalAssetsBefore = await lendingResolver.totalAssets(
      setup.underlying
    );
    await setup.updateRate(setup.underlying);
    const totalAssetsAfter = await lendingResolver.totalAssets(
      setup.underlying
    );

    // Should process remaining current period time + next period time
    expect(totalAssetsAfter.gt(totalAssetsBefore)).to.be.true;

    // Verify that last_update was between start and end of current period
    expect(lastUpdateAfterPartial).to.be.greaterThan(currentStart);
    expect(lastUpdateAfterPartial).to.be.lessThan(
      currentStart + currentDuration
    );
  });

  it("Should handle last_update exactly at current_end_time, next rewards active", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const baseTime = parseInt(setup.timestamp());
    const currentStart = baseTime + PASS_1DAY_TIME;
    const currentDuration = PASS_1HOUR_TIME;

    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(currentDuration),
      new BN(currentStart),
      new BN(1)
    );

    // Update exactly at current period end
    setup.warp(PASS_1DAY_TIME + currentDuration);
    await setup.updateRate(setup.underlying);

    // Start next rewards immediately
    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(PASS_1YEAR_TIME),
      new BN(setup.timestamp()).add(new BN(1)),
      new BN(1)
    );

    // Advance into next period
    setup.warp(PASS_1HOUR_TIME);

    const totalAssetsBefore = await lendingResolver.totalAssets(
      setup.underlying
    );
    await setup.updateRate(setup.underlying);
    const totalAssetsAfter = await lendingResolver.totalAssets(
      setup.underlying
    );

    // Should only process next period (no overlap)
    expect(totalAssetsAfter.gt(totalAssetsBefore)).to.be.true;
  });

  it("Should handle gap between current_end and next_start", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const baseTime = parseInt(setup.timestamp());
    const currentStart = baseTime + PASS_1DAY_TIME;
    const currentDuration = PASS_1HOUR_TIME;
    const gap = PASS_1HOUR_TIME; // 1 hour gap between periods

    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(currentDuration),
      new BN(currentStart),
      new BN(1)
    );

    // Update partway through current period
    setup.warp(PASS_1DAY_TIME + currentDuration / 2);
    await setup.updateRate(setup.underlying);

    // Let current period end and wait through gap
    setup.warp(currentDuration / 2 + gap);

    // Start next rewards after gap
    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(PASS_1YEAR_TIME),
      new BN(setup.timestamp()),
      new BN(1),
      false
    );

    // Advance into next period
    setup.warp(PASS_1HOUR_TIME);

    const totalAssetsBefore = await lendingResolver.totalAssets(
      setup.underlying
    );
    await setup.updateRate(setup.underlying);
    const totalAssetsAfter = await lendingResolver.totalAssets(
      setup.underlying
    );

    // Should process remaining current time + next time (gap should have no rewards)
    expect(totalAssetsAfter.gt(totalAssetsBefore)).to.be.true;
  });

  it("Should handle next_start < last_update < next_end scenario", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const baseTime = parseInt(setup.timestamp());

    // Short current period that will end quickly
    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(PASS_1HOUR_TIME),
      new BN(baseTime + PASS_1DAY_TIME),
      new BN(1)
    );

    // Advance past current period
    setup.warp(PASS_1DAY_TIME + PASS_1HOUR_TIME + 1);

    // Start next rewards
    const nextStart = parseInt(setup.timestamp());
    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(PASS_1YEAR_TIME),
      new BN(nextStart),
      new BN(1),
      false
    );

    // Update partway through next period
    setup.warp(PASS_1HOUR_TIME);
    await setup.updateRate(setup.underlying);

    const lending = await setup.lending.account.lending.fetch(
      setup.underlyingLending
    );
    const lastUpdate = lending.lastUpdateTimestamp.toNumber();

    // Advance more in next period
    setup.warp(PASS_1HOUR_TIME);

    const totalAssetsBefore = await lendingResolver.totalAssets(
      setup.underlying
    );
    await setup.updateRate(setup.underlying);
    const totalAssetsAfter = await lendingResolver.totalAssets(
      setup.underlying
    );

    // Should process only the time since last update in next period
    expect(totalAssetsAfter.gt(totalAssetsBefore)).to.be.true;
    expect(lastUpdate).to.be.greaterThan(nextStart);
  });

  it("Should handle both periods ended, last_update in middle", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const baseTime = parseInt(setup.timestamp());
    const currentStart = baseTime + PASS_1DAY_TIME;
    const currentDuration = PASS_1HOUR_TIME;

    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(currentDuration),
      new BN(currentStart),
      new BN(1)
    );

    // Update partway through current
    setup.warp(PASS_1DAY_TIME + currentDuration / 2);
    await setup.updateRate(setup.underlying);

    // Let current end, start and end next period without updates
    setup.warp(currentDuration / 2 + 1);

    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(LAMPORTS_PER_SOL),
      new BN(PASS_1HOUR_TIME), // Short next period
      new BN(setup.timestamp()),
      new BN(1),
      false
    );

    // Advance past next period end without updating
    setup.warp(PASS_1HOUR_TIME + 1);

    const totalAssetsBefore = await lendingResolver.totalAssets(
      setup.underlying
    );
    await setup.updateRate(setup.underlying);
    const totalAssetsAfter = await lendingResolver.totalAssets(
      setup.underlying
    );

    // Should process remaining current + full next period
    expect(totalAssetsAfter.gt(totalAssetsBefore)).to.be.true;
  });

  it("Should handle rate capping in overlapping periods", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const baseTime = parseInt(setup.timestamp());
    const excessiveRate = new BN(60).mul(new BN(10).pow(new BN(12))); // 60 * 1e12 (excessive)

    // Set current period with excessive rate
    await setup.setRewardsRateWithAmount(
      setup.underlying,
      excessiveRate,
      new BN(PASS_1HOUR_TIME),
      new BN(baseTime + PASS_1DAY_TIME),
      new BN(1)
    );

    // Update partway through
    setup.warp(PASS_1DAY_TIME + PASS_1HOUR_TIME / 2);
    await setup.updateRate(setup.underlying);

    // Start next period with excessive rate too
    setup.warp(PASS_1HOUR_TIME / 2 + 1);

    await setup.setRewardsRateWithAmount(
      setup.underlying,
      excessiveRate,
      new BN(PASS_1YEAR_TIME),
      new BN(setup.timestamp()),
      new BN(1),
      false
    );

    setup.warp(PASS_1HOUR_TIME);

    const totalAssetsBefore = await lendingResolver.totalAssets(
      setup.underlying
    );
    await setup.updateRate(setup.underlying);
    const totalAssetsAfter = await lendingResolver.totalAssets(
      setup.underlying
    );

    // Should cap both rates and not cause overflow
    expect(totalAssetsAfter.gt(totalAssetsBefore)).to.be.true;

    // Should not exceed reasonable bounds (excessive rates should be capped to 0)
    const maxReasonableIncrease = DEFAULT_AMOUNT.mul(new BN(2)); // 100% increase max
    expect(totalAssetsAfter.lt(maxReasonableIncrease)).to.be.true;
  });

  it("Should handle precision edge case with overlapping micro-periods", async () => {
    const microAmount = new BN(1e5); // Minimal amount
    await setup.depositToLending(setup.underlying, microAmount, setup.alice);

    const baseTime = parseInt(setup.timestamp());

    // Very short current period
    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(1), // Minimal reward
      new BN(1), // 1 second
      new BN(baseTime + 1),
      new BN(1)
    );

    // Update at end of micro period
    setup.warp(2);
    await setup.updateRate(setup.underlying);

    // Start next micro period
    await setup.setRewardsRateWithAmount(
      setup.underlying,
      new BN(1),
      new BN(1),
      new BN(setup.timestamp()),
      new BN(1),
      false
    );

    setup.warp(1);

    await setup.updateRate(setup.underlying);
    const totalAssetsAfter = await lendingResolver.totalAssets(
      setup.underlying
    );

    // Should handle micro calculations without underflow/overflow
    expect(totalAssetsAfter.gte(microAmount)).to.be.true;
  });
});
