import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import {
  UpdateUserSupplyConfigParams,
  UpdateUserBorrowConfigParams,
} from "../../ts-sdk/liquidity/types";
import { MintKeys, mint as MintInfo } from "../../ts-sdk/mint";
import { LiquidityBaseSetup } from "../../test-utils/typescript/liquidity/setup";
import { FluidLiquidityResolver } from "../../test-utils/typescript/liquidity/resolver";

const DEFAULT_BORROW_AMOUNT = new BN(5 * 1e6);
const PASS_1YEAR_TIME = 365 * 24 * 60 * 60; // 1 year in seconds

function divCeil(numerator: BN, denominator: BN): BN {
  if (denominator.isZero()) {
    throw new Error("Division by zero");
  }

  const quotient = numerator.div(denominator);
  const remainder = numerator.mod(denominator);

  return remainder.isZero() ? quotient : quotient.addn(1);
}

function mulDivCeil(value: BN, multiplier: BN, divisor: BN): BN {
  return divCeil(value.mul(multiplier), divisor);
}

describe("LiquidityUserModuleYieldTests", () => {
  let resolver: FluidLiquidityResolver;
  let setup: LiquidityBaseSetup;

  afterEach(async () => {
    setup.logComputeBudget();
  });

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";

    setup = new LiquidityBaseSetup();
    await setup.setup();

    resolver = new FluidLiquidityResolver(
      setup.admin,
      setup.liquidity,
      setup.client
    );
  });

  async function _assertExchangePrices(
    expectedSupplyExchangePrice: BN,
    expectedBorrowExchangePrice: BN
  ) {
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT,
      MintKeys.USDC,
      setup.alice
    );

    let overallData = await resolver.getOverallTokenData(MintKeys.USDC);

    expect(overallData.supplyExchangePrice.toString()).to.equal(
      expectedSupplyExchangePrice.toString()
    );
    expect(overallData.borrowExchangePrice.toString()).to.equal(
      expectedBorrowExchangePrice.toString()
    );
  }

  it("Should test: operate_ExchangePriceSupplyWithInterestOnly", async () => {
    // alice supplies liquidity
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT.mul(new BN(100)),
      MintKeys.USDC,
      setup.alice
    );

    // total supply 100 * DEFAULT_BORROW_AMOUNT.

    // alice borrows liquidity
    await setup.borrow(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT,
      MintKeys.USDC,
      setup.alice
    );

    // cross-check resolver supply rate. see calc exchange price below
    let overallTokenData = await resolver.getOverallTokenData(MintKeys.USDC);
    expect(overallTokenData.supplyRate.toString()).to.equal("4"); // supply rate = 1% of borrow rate

    // simulate passing time 1 year for yield
    setup.warp(PASS_1YEAR_TIME);

    // at 1% utilization, for default values of 4% at 0% utilization and 10% at 80% utilization.
    // so over the range of 80%, the rate grows 6% linearly.
    // 80 = 6, 1 = x => x = 6 / 80 * 1 = 0,075
    // so 4% + 0.075% = 4.075%
    // but borrow rate precision in Liquidity is only 0.01% so it becomes 4.07%.
    // with supplyExchangePrice increasing 1% of that because only 1% of supply is borrowed out

    const expectedBorrowExchangePrice = new BN(1040700000000);
    const expectedSupplyExchangePrice = new BN(1000407000000);

    await _assertExchangePrices(
      expectedSupplyExchangePrice,
      expectedBorrowExchangePrice
    );
  });

  it("Should test: operate_ExchangePriceSupplyInterestFreeOnly", async () => {
    // alice supplies liquidity
    await setup.deposit(
      setup.mockProtocolInterestFree,
      DEFAULT_BORROW_AMOUNT.mul(new BN(100)),
      MintKeys.USDC,
      setup.alice
    );

    // total supply 100 * DEFAULT_BORROW_AMOUNT.

    // alice borrows liquidity
    await setup.borrow(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT,
      MintKeys.USDC,
      setup.alice
    );

    // cross-check resolver supply rate. see calc exchange price below
    let overallTokenData = await resolver.getOverallTokenData(MintKeys.USDC);
    expect(overallTokenData.supplyRate.toString()).to.equal("0"); // supply rate = 0 because no borrowers with interest

    // simulate passing time 1 year for yield
    setup.warp(PASS_1YEAR_TIME);

    // see test_operate_ExchangePriceSupplyWithInterestOnly for borrow exchange price calculation.
    // with supplyExchangePrice staying the same as no suppliers that earn any interest
    const expectedSupplyExchangePrice = new BN(1e12);
    const expectedBorrowExchangePrice = new BN(1040700000000);

    await _assertExchangePrices(
      expectedSupplyExchangePrice,
      expectedBorrowExchangePrice
    );
  });

  it("Should test: operate_ExchangePriceNumberUpOnlyWhenNoStorageUpdate", async () => {
    // alice supplies liquidity
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT.mul(new BN(100)),
      MintKeys.USDC,
      setup.alice
    );

    // alice borrows liquidity
    await setup.borrow(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT,
      MintKeys.USDC,
      setup.alice
    );

    // Note: Skipping storage update threshold configuration as mentioned it's not used in Anchor

    // simulate passing time 1 year for yield
    setup.warp(PASS_1YEAR_TIME / 1000);

    // see test_operate_ExchangePriceSupplyWithInterestOnly for borrow exchange price calculation.
    // just divided by 1000 to be below forced storage update if time diff > 1 day
    // 407000000 / 1000 = 407000
    const expectedSupplyExchangePrice = new BN(1000000407000); // increased 1% of borrow exchange price (because 1% of supply is borrowed out)
    const expectedBorrowExchangePrice = new BN(1000040700000);

    await _assertExchangePrices(
      expectedSupplyExchangePrice,
      expectedBorrowExchangePrice
    );
  });

  it("Should test: operate_ExchangePriceWhenSupplyWithInterestBigger", async () => {
    // alice supplies liquidity with interest
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT.mul(new BN(80)).div(new BN(100)),
      MintKeys.USDC,
      setup.alice
    );

    // alice supplies liquidity interest free
    await setup.deposit(
      setup.mockProtocolInterestFree,
      DEFAULT_BORROW_AMOUNT.mul(new BN(20)).div(new BN(100)),
      MintKeys.USDC,
      setup.alice
    );

    // total supply 1 * DEFAULT_BORROW_AMOUNT.

    // alice borrows liquidity
    await setup.borrow(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT,
      MintKeys.USDC,
      setup.alice
    );

    // cross-check resolver supply rate. see calc exchange price below
    let overallTokenData = await resolver.getOverallTokenData(MintKeys.USDC);
    expect(overallTokenData.supplyRate.toString()).to.equal("18750"); // 187.5%

    // simulate passing time 1 / 10 year for yield
    setup.warp(PASS_1YEAR_TIME / 10);

    // at 100% utilization, borrow rate is 150%.
    // just here we only warp 1/10 of the year so 15% increase.
    const expectedBorrowExchangePrice = new BN(1150000000000);
    // total earnings for suppliers are 100% of borrow increase. But only 80% of suppliers earn that.
    // so exchange price must grow 25% more to account for that: 150000000000 * 1.25 = 187500000000
    const expectedSupplyExchangePrice = new BN(1187500000000);

    await _assertExchangePrices(
      expectedSupplyExchangePrice,
      expectedBorrowExchangePrice
    );
  });

  it("Should test: operate_ExchangePriceWhenSupplyInterestFreeBigger", async () => {
    // alice supplies liquidity with interest
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT.mul(new BN(20)),
      MintKeys.USDC,
      setup.alice
    );

    // alice supplies liquidity interest free
    await setup.deposit(
      setup.mockProtocolInterestFree,
      DEFAULT_BORROW_AMOUNT.mul(new BN(80)),
      MintKeys.USDC,
      setup.alice
    );

    // total supply 100 * DEFAULT_BORROW_AMOUNT.

    // alice borrows liquidity
    await setup.borrow(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT,
      MintKeys.USDC,
      setup.alice
    );

    // cross-check resolver supply rate. see calc exchange price below
    let overallTokenData = await resolver.getOverallTokenData(MintKeys.USDC);
    expect(overallTokenData.supplyRate.toString()).to.equal("20");

    // simulate passing time 1 year for yield
    setup.warp(PASS_1YEAR_TIME);

    // see test_operate_ExchangePriceSupplyWithInterestOnly for borrow exchange price calculation.
    const expectedBorrowExchangePrice = new BN(1040700000000);
    // total earnings for suppliers are 1% of borrow increase (0,0407%). But only 20% of suppliers earn that.
    // so exchange price must grow 5x more to account for that: 407000000 * 5 = 2035000000
    const expectedSupplyExchangePrice = new BN(1002035000000);

    await _assertExchangePrices(
      expectedSupplyExchangePrice,
      expectedBorrowExchangePrice
    );
  });

  it("Should test: operate_ExchangePriceWhenSupplyWithInterestExactlySupplyInterestFree", async () => {
    // alice supplies liquidity with interest
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT.mul(new BN(50)),
      MintKeys.USDC,
      setup.alice
    );

    // alice supplies liquidity interest free
    await setup.deposit(
      setup.mockProtocolInterestFree,
      DEFAULT_BORROW_AMOUNT.mul(new BN(50)),
      MintKeys.USDC,
      setup.alice
    );

    // total supply 100 * DEFAULT_BORROW_AMOUNT.

    // alice borrows liquidity
    await setup.borrow(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT,
      MintKeys.USDC,
      setup.alice
    );

    // cross-check resolver supply rate. see calc exchange price below
    let overallTokenData = await resolver.getOverallTokenData(MintKeys.USDC);

    expect(overallTokenData.supplyRate.toString()).to.equal("8");

    // simulate passing time 1 year for yield
    setup.warp(PASS_1YEAR_TIME);

    // see test_operate_ExchangePriceSupplyWithInterestOnly for borrow exchange price calculation.
    const expectedBorrowExchangePrice = new BN(1040700000000);
    // total earnings for suppliers are 1% of borrow increase (0,0407%). But only 50% of suppliers earn that.
    // so exchange price must grow 2x more to account for that: 407000000 * 2 = 814000000
    const expectedSupplyExchangePrice = new BN(1000814000000);

    // cross-check resolver supply rate. see calc exchange price below
    await _assertExchangePrices(
      expectedSupplyExchangePrice,
      expectedBorrowExchangePrice
    );
  });

  it("Should test: operate_ExchangePriceWhenSupplyWithInterestBiggerWithRevenueFee", async () => {
    // set revenue fee to 10%
    setup.prank(setup.admin);
    await setup.updateTokenConfigs([
      {
        token: MintKeys.USDC,
        fee: new BN(10 * setup.DEFAULT_PERCENT_PRECISION),
        maxUtilization: new BN(1e4), // 100%
      },
    ]);

    // alice supplies liquidity with interest
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT.mul(new BN(80)),
      MintKeys.USDC,
      setup.alice
    );

    // alice supplies liquidity interest free
    await setup.deposit(
      setup.mockProtocolInterestFree,
      DEFAULT_BORROW_AMOUNT.mul(new BN(20)),
      MintKeys.USDC,
      setup.alice
    );

    // total supply 100 * DEFAULT_BORROW_AMOUNT.

    // alice borrows liquidity
    await setup.borrow(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT,
      MintKeys.USDC,
      setup.alice
    );

    // cross-check resolver supply rate. see calc exchange price below
    let overallTokenData = await resolver.getOverallTokenData(MintKeys.USDC);
    expect(overallTokenData.supplyRate.toString()).to.equal("4");

    // simulate passing time 1 year for yield
    setup.warp(PASS_1YEAR_TIME);

    // see test_operate_ExchangePriceSupplyWithInterestOnly for borrow exchange price calculation.
    const expectedBorrowExchangePrice = new BN(1040700000000);
    // total earnings for suppliers are 1% of borrow increase MINUS the revenue fee.
    // so 40700000000 * 1% - 10% = 366300000. But only 80% of suppliers earn that.
    // so exchange price must grow 25% more to account for that: 366300000 * 1.25 = 457875000
    const expectedSupplyExchangePrice = new BN(1000457875000);

    await _assertExchangePrices(
      expectedSupplyExchangePrice,
      expectedBorrowExchangePrice
    );
  });

  it("Should test: operate_ExchangePriceWhenSupplyInterestFreeBiggerWithRevenueFee", async () => {
    // set revenue fee to 10%
    setup.prank(setup.admin);
    await setup.updateTokenConfigs([
      {
        token: MintKeys.USDC,
        fee: new BN(10 * setup.DEFAULT_PERCENT_PRECISION),
        maxUtilization: new BN(1e4), // 100%
      },
    ]);

    // alice supplies liquidity with interest
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT.mul(new BN(20)),
      MintKeys.USDC,
      setup.alice
    );

    // alice supplies liquidity interest free
    await setup.deposit(
      setup.mockProtocolInterestFree,
      DEFAULT_BORROW_AMOUNT.mul(new BN(80)),
      MintKeys.USDC,
      setup.alice
    );

    // total supply 100 * DEFAULT_BORROW_AMOUNT.

    // alice borrows liquidity
    await setup.borrow(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT,
      MintKeys.USDC,
      setup.alice
    );

    // cross-check resolver supply rate. see calc exchange price below
    let overallTokenData = await resolver.getOverallTokenData(MintKeys.USDC);
    expect(overallTokenData.supplyRate.toString()).to.equal("18");

    // simulate passing time 1 year for yield
    setup.warp(PASS_1YEAR_TIME);

    // see test_operate_ExchangePriceSupplyWithInterestOnly for borrow exchange price calculation.
    const expectedBorrowExchangePrice = new BN(1040700000000);
    // total earnings for suppliers are 1% of borrow increase MINUS the revenue fee.
    // so 40700000000 * 1% - 10% = 366300000. But only 20% of suppliers earn that.
    // so exchange price must grow 5x more to account for that: 366300000 * 5 = 1831500000
    const expectedSupplyExchangePrice = new BN(1001831500000);

    await _assertExchangePrices(
      expectedSupplyExchangePrice,
      expectedBorrowExchangePrice
    );
  });

  it("Should test: operate_ExchangePriceSequences", async () => {
    // alice supplies liquidity
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT.mul(new BN(10)),
      MintKeys.USDC,
      setup.alice
    );

    // total supply 10 * DEFAULT_BORROW_AMOUNT.

    // alice borrows liquidity
    await setup.borrow(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT,
      MintKeys.USDC,
      setup.alice
    );

    // cross-check resolver supply rate. see calc exchange price below
    let overallTokenData = await resolver.getOverallTokenData(MintKeys.USDC);
    expect(overallTokenData.supplyRate.toString()).to.equal("47"); // 10% of borrow rate

    // simulate passing time 1 year for yield
    setup.warp(PASS_1YEAR_TIME);

    // see test_operate_ExchangePriceSupplyWithInterestOnly for exchange price calculation.
    // 10% utilization borrow rate => x = 6 / 80 * 10 = 0,75. 4 + 0.75 => 4.75%
    // with 10% of supply earning yield
    let expectedBorrowExchangePrice = new BN(1047500000000);
    let expectedSupplyExchangePrice = new BN(1004750000000);

    // deposits DEFAULT_BORROW_AMOUNT
    await _assertExchangePrices(
      expectedSupplyExchangePrice,
      expectedBorrowExchangePrice
    );

    // utilization here increased to:
    // total borrow = DEFAULT_BORROW_AMOUNT * 1047500000000 / 1e12 = 0,52375
    // total supply = 10 * DEFAULT_BORROW_AMOUNT * 1004750000000 / 1e12 + DEFAULT_BORROW_AMOUNT
    // = 5,02375 ether + 0,5 ether = 5,52375
    // utilization = 0,52375 / 5,52375 = 9,4817%; cut off precision to 0.01%-> 9,48%.
    // so borrow rate:
    // at 9,48% utilization x = 6 / 80 * 9,48% = 0.711
    // so 4% + 0.711% = 4.711% but cut off precision to 0.01%-> 4,71%.

    // cross-check resolver supply rate. see calc exchange price below
    overallTokenData = await resolver.getOverallTokenData(MintKeys.USDC);

    expect(overallTokenData.supplyRate.toString()).to.equal("44"); // 9,48% of borrow rate

    // simulate passing time 1 year for yield again
    setup.warp(PASS_1YEAR_TIME);

    expectedBorrowExchangePrice = mulDivCeil(
      expectedBorrowExchangePrice,
      new BN(1e4 + 471),
      new BN(1e4)
    );
    // same multiplicator here for supply exchange price as no revenue fee and only with interest suppliers.
    // only 9.48% of supply is borrowed out though so
    // increase in supplyExchangePrice = ((1004750000000 * 471 * 948) / 1e4 / 1e4) = 4486289130
    expectedSupplyExchangePrice = new BN(1004750000000).add(new BN(4486289130)); // = 1009236289130

    await _assertExchangePrices(
      expectedSupplyExchangePrice,
      expectedBorrowExchangePrice
    );
  });

  it("Should test: operate_ExchangePriceBorrowInterestFreeOnly", async () => {
    // alice supplies liquidity
    await setup.deposit(
      setup.mockProtocolInterestFree,
      DEFAULT_BORROW_AMOUNT.mul(new BN(100)),
      MintKeys.USDC,
      setup.alice
    );

    // total supply 100 * DEFAULT_BORROW_AMOUNT.

    // alice borrows liquidity
    await setup.borrow(
      setup.mockProtocolInterestFree,
      DEFAULT_BORROW_AMOUNT,
      MintKeys.USDC,
      setup.alice
    );

    // simulate passing time 1 year for yield
    setup.warp(PASS_1YEAR_TIME);

    // both exchange prices should be initial value as there is no yield.
    const expectedSupplyExchangePrice = new BN(1e12);
    const expectedBorrowExchangePrice = new BN(1e12);

    await _assertExchangePrices(
      expectedSupplyExchangePrice,
      expectedBorrowExchangePrice
    );
  });

  it("Should test: operate_ExchangePriceWhenBorrowWithInterestBigger", async () => {
    // alice supplies liquidity with interest
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT.mul(new BN(100)),
      MintKeys.USDC,
      setup.alice
    );

    // total supply 100 * DEFAULT_BORROW_AMOUNT.

    // alice borrows liquidity with interest
    await setup.borrow(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT.mul(new BN(8)).div(new BN(10)),
      MintKeys.USDC,
      setup.alice
    );

    // alice borrows liquidity interest free
    await setup.borrow(
      setup.mockProtocolInterestFree,
      DEFAULT_BORROW_AMOUNT.mul(new BN(2)).div(new BN(10)),
      MintKeys.USDC,
      setup.alice
    );

    // cross-check resolver supply rate. see calc exchange price below
    let overallTokenData = await resolver.getOverallTokenData(MintKeys.USDC);
    expect(overallTokenData.supplyRate.toString()).to.equal("3");

    // simulate passing time 1 year for yield
    setup.warp(PASS_1YEAR_TIME);

    // see test_operate_ExchangePriceSupplyWithInterestOnly for exchange price calculation.
    const expectedBorrowExchangePrice = new BN(1040700000000);
    // total earnings for suppliers are 1% of borrow increase (1% is lent out).
    // But only 80% of the borrowers pay the yield.
    // so exchange price must grow 20% less to account for that:
    // supplyRate = 4,07% * 0,8 = 3,256%. so supplyIncrease = 325600000
    const expectedSupplyExchangePrice = new BN(1000325600000);

    await _assertExchangePrices(
      expectedSupplyExchangePrice,
      expectedBorrowExchangePrice
    );
  });

  it("Should test: operate_ExchangePriceWhenBorrowInterestFreeBigger", async () => {
    // alice supplies liquidity with interest
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT.mul(new BN(100)),
      MintKeys.USDC,
      setup.alice
    );

    // total supply 100 * DEFAULT_BORROW_AMOUNT.

    // alice borrows liquidity with interest
    await setup.borrow(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT.mul(new BN(2)).div(new BN(10)),
      MintKeys.USDC,
      setup.alice
    );

    // alice borrows liquidity interest free
    await setup.borrow(
      setup.mockProtocolInterestFree,
      DEFAULT_BORROW_AMOUNT.mul(new BN(8)).div(new BN(10)),
      MintKeys.USDC,
      setup.alice
    );

    // cross-check resolver supply rate. see calc exchange price below
    let overallTokenData = await resolver.getOverallTokenData(MintKeys.USDC);
    expect(overallTokenData.supplyRate.toString()).to.equal("0"); // 0.008%

    // simulate passing time 1 year for yield
    setup.warp(PASS_1YEAR_TIME);

    // see test_operate_ExchangePriceSupplyWithInterestOnly for exchange price calculation.
    const expectedBorrowExchangePrice = new BN(1040700000000);
    // total earnings for suppliers are 1% of borrow increase (1% is lent out).
    // But only 20% of the borrowers pay the yield.
    // so exchange price must grow 80% less to account for that: 407000000 * 0.2 = 81400000
    const expectedSupplyExchangePrice = new BN(1000081400000);

    await _assertExchangePrices(
      expectedSupplyExchangePrice,
      expectedBorrowExchangePrice
    );
  });

  it("Should test: operate_ExchangePriceWhenBorrowWithInterestExactlyBorrowInterestFree", async () => {
    // alice supplies liquidity with interest
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT.mul(new BN(100)),
      MintKeys.USDC,
      setup.alice
    );

    // total supply 100 * DEFAULT_BORROW_AMOUNT.

    // alice borrows liquidity with interest
    await setup.borrow(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT.div(new BN(2)),
      MintKeys.USDC,
      setup.alice
    );

    // alice borrows liquidity interest free
    await setup.borrow(
      setup.mockProtocolInterestFree,
      DEFAULT_BORROW_AMOUNT.div(new BN(2)),
      MintKeys.USDC,
      setup.alice
    );

    // cross-check resolver supply rate. see calc exchange price below
    let overallTokenData = await resolver.getOverallTokenData(MintKeys.USDC);
    expect(overallTokenData.supplyRate.toString()).to.equal("2");

    // simulate passing time 1 year for yield
    setup.warp(PASS_1YEAR_TIME);

    // see test_operate_ExchangePriceSupplyWithInterestOnly for borrow exchange price calculation.
    const expectedBorrowExchangePrice = new BN(1040700000000);
    // total earnings for suppliers are 1% of borrow increase. But only 50% of borrowers pay that.
    // so exchange price must grow half to account for that: 407000000 / 2 = 203500000
    const expectedSupplyExchangePrice = new BN(1000203500000);

    await _assertExchangePrices(
      expectedSupplyExchangePrice,
      expectedBorrowExchangePrice
    );
  });

  it("Should test: operate_ExchangePriceWhenBorrowWithInterestBiggerWithRevenueFee", async () => {
    // set revenue fee to 10%
    setup.prank(setup.admin);
    await setup.updateTokenConfigs([
      {
        token: MintKeys.USDC,
        fee: new BN(10 * setup.DEFAULT_PERCENT_PRECISION),
        maxUtilization: new BN(1e4), // 100%
      },
    ]);

    // alice supplies liquidity with interest
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT.mul(new BN(100)),
      MintKeys.USDC,
      setup.alice
    );

    // total supply 100 * DEFAULT_BORROW_AMOUNT.

    // alice borrows liquidity with interest
    await setup.borrow(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT.mul(new BN(8)).div(new BN(10)),
      MintKeys.USDC,
      setup.alice
    );

    // alice borrows liquidity interest free
    await setup.borrow(
      setup.mockProtocolInterestFree,
      DEFAULT_BORROW_AMOUNT.mul(new BN(2)).div(new BN(10)),
      MintKeys.USDC,
      setup.alice
    );

    // cross-check resolver supply rate. see calc exchange price below
    let overallTokenData = await resolver.getOverallTokenData(MintKeys.USDC);
    expect(overallTokenData.supplyRate.toString()).to.equal("2");

    // simulate passing time 1 year for yield
    setup.warp(PASS_1YEAR_TIME);

    // see test_operate_ExchangePriceSupplyWithInterestOnly for exchange price calculation.
    const expectedBorrowExchangePrice = new BN(1040700000000);
    // 10% of total earnings go to revenue so 4,07% * 0,9 = 3,663%
    // and only 1% total is lent out so 3,663% *0,01 = 0,03663%
    // But only 80% of the borrowers pay the yield. so rate must grow 20% less: 0,03663% *0,8 = 0,029304%
    // so supplyRate 0,029304%. so supplyIncrease = 293040000
    const expectedSupplyExchangePrice = new BN(1000293040000);

    await _assertExchangePrices(
      expectedSupplyExchangePrice,
      expectedBorrowExchangePrice
    );
  });

  it("Should test: operate_ExchangePriceWhenBorrowInterestFreeBiggerWithRevenueFee", async () => {
    // set revenue fee to 10%
    setup.prank(setup.admin);
    await setup.updateTokenConfigs([
      {
        token: MintKeys.USDC,
        fee: new BN(10 * setup.DEFAULT_PERCENT_PRECISION),
        maxUtilization: new BN(1e4), // 100%
      },
    ]);

    // alice supplies liquidity with interest
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT.mul(new BN(100)),
      MintKeys.USDC,
      setup.alice
    );

    // total supply 100 * DEFAULT_BORROW_AMOUNT.

    // alice borrows liquidity with interest
    await setup.borrow(
      setup.mockProtocolWithInterest,
      DEFAULT_BORROW_AMOUNT.mul(new BN(2)).div(new BN(10)),
      MintKeys.USDC,
      setup.alice
    );

    // alice borrows liquidity interest free
    await setup.borrow(
      setup.mockProtocolInterestFree,
      DEFAULT_BORROW_AMOUNT.mul(new BN(8)).div(new BN(10)),
      MintKeys.USDC,
      setup.alice
    );

    // cross-check resolver supply rate. see calc exchange price below
    let overallTokenData = await resolver.getOverallTokenData(MintKeys.USDC);
    expect(overallTokenData.supplyRate.toString()).to.equal("0");

    // simulate passing time 1 year for yield
    setup.warp(PASS_1YEAR_TIME);

    // see test_operate_ExchangePriceSupplyWithInterestOnly for exchange price calculation.
    const expectedBorrowExchangePrice = new BN(1040700000000);
    // 10% of total earnings go to revenue so 40700000000 * 0.9 = 36630000000 = 3,663%
    // total earnings for suppliers are 1% of borrow increase (1% is lent out). so 366300000 = 0,03663%
    // But only 20% of the borrowers pay the yield.
    // so exchange price must grow 80% less to account for that: 366300000 * 0.2 = 73260000 = supplyRate: 0,07326%
    const expectedSupplyExchangePrice = new BN(1000073260000);

    await _assertExchangePrices(
      expectedSupplyExchangePrice,
      expectedBorrowExchangePrice
    );
  });
});

describe("LiquidityUserModuleYieldCombinationBaseTest", () => {
  let resolver: FluidLiquidityResolver;
  let setup: LiquidityBaseSetup;
  const BASE_LIMIT = 5 * LAMPORTS_PER_SOL;

  afterEach(async () => {
    setup.logComputeBudget();
  });

  async function _setup() {
    await setup.updateTokenConfigs([
      {
        token: MintKeys.USDC,
        fee: new BN(setup.DEFAULT_TOKEN_FEE),
        maxUtilization: new BN(1e4), // 100%
      },
    ]);

    const config: UpdateUserSupplyConfigParams = {
      mint: MintKeys.USDC,
      newSupplyConfig: {
        user: setup.mockProtocol.publicKey,
        token: MintInfo.getMint(MintKeys.USDC),
        mode: 1,
        expandPercent: new BN(setup.DEFAULT_EXPAND_WITHDRAWAL_LIMIT_PERCENT), // 20%
        expandDuration: new BN(setup.DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION), // 2 days
        baseWithdrawalLimit: new BN(BASE_LIMIT),
      },
    };

    await setup.updateUserSupplyConfig([config]);

    const borrowConfig: UpdateUserBorrowConfigParams = {
      mint: MintKeys.USDC,
      newBorrowConfig: {
        user: setup.mockProtocol.publicKey,
        token: MintInfo.getMint(MintKeys.USDC),
        mode: 1,
        expandPercent: new BN(setup.DEFAULT_EXPAND_DEBT_CEILING_PERCENT), // 20%
        expandDuration: new BN(setup.DEFAULT_EXPAND_DEBT_CEILING_DURATION), // 2 days
        baseDebtCeiling: new BN(BASE_LIMIT),
        maxDebtCeiling: new BN(20 * LAMPORTS_PER_SOL),
      },
    };

    await setup.updateUserBorrowConfig([borrowConfig]);
  }

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";

    setup = new LiquidityBaseSetup();
    await setup.setup();

    await _setup();

    resolver = new FluidLiquidityResolver(
      setup.admin,
      setup.liquidity,
      setup.client
    );
  });

  async function _assetState(
    borrowRate: BN,
    supplyRate: BN,
    supplyExchangePrice: BN,
    borrowExchangePrice: BN,
    revenue: BN,
    supplyRawInterest: BN,
    supplyInterestFree: BN,
    borrowRawInterest: BN,
    borrowInterestFree: BN,
    withdrawalLimit: BN,
    borrowLimit: BN
  ) {
    let { userSupplyData, overallTokenData } = await resolver.getUserSupplyData(
      setup.mockProtocol.publicKey,
      MintKeys.USDC
    );

    //prettier-ignore
    {
      expect(overallTokenData.borrowRate.toString()).to.equal(borrowRate.toString());
      expect(overallTokenData.supplyRate.toString()).to.equal(supplyRate.toString());
      expect(overallTokenData.supplyExchangePrice.toString()).to.equal(supplyExchangePrice.toString());
      expect(overallTokenData.borrowExchangePrice.toString()).to.equal(borrowExchangePrice.toString());
      // expect(overallTokenData.revenue.toNumber()).to.closeTo(revenue.toNumber(), 1);
      expect(overallTokenData.supplyRawInterest.toString()).to.equal(supplyRawInterest.toString());
      expect(overallTokenData.supplyInterestFree.toString()).to.equal(supplyInterestFree.toString());
      expect(overallTokenData.borrowRawInterest.toString()).to.equal(borrowRawInterest.toString());
      expect(overallTokenData.borrowInterestFree.toString()).to.equal(borrowInterestFree.toString());
      expect(overallTokenData.totalSupply.toString()).to.equal((supplyRawInterest.mul(supplyExchangePrice)).div(new BN(1e12)).add(supplyInterestFree).toString());
      expect(overallTokenData.totalBorrow.toString()).to.equal((borrowRawInterest.mul(borrowExchangePrice)).div(new BN(1e12)).add(borrowInterestFree).toString());
      expect(overallTokenData.totalBorrow.add(await setup.balanceOf(setup.adminModule.get_liquidity(), MintInfo.getMint(MintKeys.USDC))).toNumber()).to.be.greaterThanOrEqual(overallTokenData.totalSupply.add(overallTokenData.revenue).toNumber());
    }

    await setup.deposit(
      setup.mockProtocolInterestFree,
      new BN(30 * LAMPORTS_PER_SOL),
      MintKeys.USDC,
      setup.alice
    );

    ({ userSupplyData, overallTokenData } = await resolver.getUserSupplyData(
      setup.mockProtocol.publicKey,
      MintKeys.USDC
    ));

    // prettier-ignore
    {
      expect(userSupplyData.withdrawalLimit.toNumber()).to.closeTo(withdrawalLimit.toNumber(), 10);
      expect(userSupplyData.withdrawableUntilLimit.toNumber()).to.be.closeTo(userSupplyData.supply.sub(withdrawalLimit).toNumber(), 10);
      expect(userSupplyData.withdrawable.toNumber()).to.be.closeTo(userSupplyData.supply.sub(withdrawalLimit).toNumber(), 10);
    }

    // prettier-ignore
    if (userSupplyData.supply.gt(new BN(0)) && userSupplyData.withdrawable.lt(userSupplyData.supply)) {
      // assert reverts if withdrawing more
      expect(await setup.expectRevert(
          "USER_MODULE_WITHDRAWAL_LIMIT_REACHED",
          setup.withdraw.bind(setup),
          setup.mockProtocol,
          userSupplyData.withdrawable.add(new BN(5)),
          MintKeys.USDC,
          setup.alice,
      )).to.be.true;
    }

    // prettier-ignore
    if (userSupplyData.withdrawable.gt(new BN(0))) {
      // assert withdrawing exactly works
      await setup.withdraw(setup.mockProtocol, userSupplyData.withdrawable.sub(new BN(1)), MintKeys.USDC, setup.alice);
      
      // supply it back
      await setup.deposit(setup.mockProtocol, userSupplyData.withdrawable.sub(new BN(1)), MintKeys.USDC, setup.alice);
    }

    // assert borrowLimit
    let { userBorrowData } = await resolver.getUserBorrowData(
      setup.mockProtocol.publicKey,
      MintKeys.USDC
    );

    // prettier-ignore
    {
      expect(userBorrowData.borrowLimit.toString()).to.equal(borrowLimit.toString());
      expect(userBorrowData.borrowableUntilLimit.toString()).to.equal(borrowLimit.sub(userBorrowData.borrow).toString());
      expect(userBorrowData.borrowable.toString()).to.equal(borrowLimit.sub(userBorrowData.borrow).toString());
    }

    expect(
      await setup.expectRevert(
        "USER_MODULE_BORROW_LIMIT_REACHED",
        setup.borrow.bind(setup),
        setup.mockProtocol,
        userBorrowData.borrowable.add(new BN(5)),
        MintKeys.USDC,
        setup.alice
      )
    ).to.be.true;

    // prettier-ignore
    if (userBorrowData.borrowable.gt(new BN(1e3))) {
      const borrowedBefore = userBorrowData.borrow;
      // assert borrowing exactly works
      await setup.borrow(
        setup.mockProtocol,
        userBorrowData.borrowable.sub(new BN(1)),
        MintKeys.USDC,
        setup.alice
      );
      
      const { userBorrowData: userBorrowData2 } = await resolver.getUserBorrowData(
        setup.mockProtocol.publicKey,
        MintKeys.USDC
      );

      // payback
      await setup.payback(
        setup.mockProtocol,
        userBorrowData2.borrow.sub(borrowedBefore),
        MintKeys.USDC,
        setup.alice
      );
    }

    await setup.withdraw(
      setup.mockProtocolInterestFree,
      new BN(30 * LAMPORTS_PER_SOL),
      MintKeys.USDC,
      setup.alice
    );

    const {
      supplyExchangePrice: supplyExchangePrice2,
      borrowExchangePrice: borrowExchangePrice2,
    } = await resolver.getExchangePricesAndConfig(MintKeys.USDC);

    expect(supplyExchangePrice2.toString()).to.equal(
      supplyExchangePrice.toString()
    );
    expect(borrowExchangePrice2.toString()).to.equal(
      borrowExchangePrice.toString()
    );
  }

  it("Should test: test_operate_YieldCombinationTest", async () => {
    // supply liquidity with interest
    await setup.deposit(
      setup.mockProtocol,
      new BN(4 * LAMPORTS_PER_SOL),
      MintKeys.USDC,
      setup.alice
    );

    // 1. test yield at ~zero: borrow very little amount
    await setup.borrow(
      setup.mockProtocol,
      new BN(1e6),
      MintKeys.USDC,
      setup.alice
    );

    // console.log("FIRST ASSET STATE");

    await _assetState(
      new BN(400), // expected borrow rate
      new BN(0), // expected supply rate. only very tiny amount of borrowers are paying yield
      new BN(1e12), // expected supply exchange price.
      new BN(1e12), // expected borrow exchange price.
      new BN(0), // expected revenue
      new BN(4 * LAMPORTS_PER_SOL), // expected supply raw interest
      new BN(0), // expected supply interest free
      new BN(1e6), // expected borrow raw interest
      new BN(0), // expected borrow interest free
      new BN(0), // expected withdrawal limit
      new BN(BASE_LIMIT) // expected borrow limit
    );

    // warp & assert everything
    // 1e6 paying 4% for half a year -> 2% yield. 5% of that is revenue.
    // supply rate = 4% - 5% revenue fee -> 3.8%. only 0.025% utilization -> 0.095%.
    // only earned for half a year so 0.0475%.
    // BUT: precision for utilization is actually cut off at 0.02% so we get 0.076%. / 2 = 0.038%.
    // Revenue should be 1e12 but precision cut off in utilization leads to supply exchange price difference.
    // the precision loss is counted towards revenue. total supply ends up being 4 LAMPORTS_PER_SOL * 1000003800000 / 1e12 instead of
    // 4 LAMPORTS_PER_SOL * 10000047500000 / 1e12, leading to a total diff of 3.8e12

    setup.warp(PASS_1YEAR_TIME / 2); // earn half a year yield

    let expectedSupplyExchangePrice = new BN(1000003800000);
    let expectedBorrowExchangePrice = new BN(1020000000000); // increased by 2%
    let expectedRevenue = new BN(48e2); // 4.8e3

    // console.log("SECOND ASSET STATE");

    await _assetState(
      new BN(400), // expected borrow rate
      new BN(0), // expected supply rate. supply rate precision is cut off to 0
      expectedSupplyExchangePrice, // expected supply exchange price.
      expectedBorrowExchangePrice, // expected borrow exchange price.
      expectedRevenue, // expected revenue.
      new BN(4 * LAMPORTS_PER_SOL), // expected supply raw interest
      new BN(0), // expected supply interest free
      new BN(1e6), // expected borrow raw interest
      new BN(0), // expected borrow interest free
      new BN(0), // expected withdrawal limit
      new BN(BASE_LIMIT).mul(expectedBorrowExchangePrice).div(new BN(1e12)) // expected borrow limit
    );

    // console.log("2. Test yield at below kink 1");

    await setup.deposit(
      setup.mockProtocol,
      new BN(6 * LAMPORTS_PER_SOL).sub(new BN("4000015200")),
      MintKeys.USDC,
      setup.alice
    );

    await setup.borrow(
      setup.mockProtocol,
      new BN(1.2 * LAMPORTS_PER_SOL).sub(new BN("1020000")),
      MintKeys.USDC,
      setup.alice
    );

    // warp & assert everything
    // borrow rate = 4% + 1/4 of slope 6% (10% -4%) -> 5.5%.
    // 1.2 LAMPORTS_PER_SOL paying 5.5% for 10% of a year -> 0.55% yield. 5% of that is revenue.
    // supply rate = 5.5% - 5% revenue fee -> 5.225%. only 19.99% utilization -> 1.045%.
    // only earned for 10% of a year so 0.1045%.
    // 0.55% of 1.2 LAMPORTS_PER_SOL is 0.0066 LAMPORTS_PER_SOL in yield. 5% goes to revenue -> 0,00033 LAMPORTS_PER_SOL
    // @dev: difference in supply exchange price starts here

    setup.warp(PASS_1YEAR_TIME / 10); // earn 10% of a year yield

    expectedSupplyExchangePrice = expectedSupplyExchangePrice
      .mul(new BN(1001045))
      .div(new BN(1e6)); // increased by 0.1045%.
    expect(expectedSupplyExchangePrice.toString()).to.equal("1001048803971");

    expectedBorrowExchangePrice = mulDivCeil(
      expectedBorrowExchangePrice,
      new BN(1005500),
      new BN(1e6)
    ); // increased by 0.55%
    expect(expectedBorrowExchangePrice.toString()).to.equal("1025610000000");

    expectedRevenue = expectedRevenue.add(new BN(0.0003294 * LAMPORTS_PER_SOL));

    // expected withdrawal limit:
    // 20% of total supply expanded (5999977200 * 0.8 = 4799981760)
    let expectedWithdrawalLimit = new BN("4799981760")
      .mul(expectedSupplyExchangePrice)
      .div(new BN(1e12));

    await _assetState(
      new BN(550), // expected borrow rate
      new BN(104), // expected supply rate.
      expectedSupplyExchangePrice, // expected supply exchange price.
      expectedBorrowExchangePrice, // expected borrow exchange price.
      expectedRevenue, // expected revenue.
      new BN("5999977199"), // expected supply raw interest. total supply 6006269999999999817
      new BN(0), // expected supply interest free
      new BN("1176470589"), // expected borrow raw interest. total borrow 1206600000000000027
      new BN(0), // expected borrow interest free
      expectedWithdrawalLimit, // expected withdrawal limit. fully expanded 20%
      new BN(BASE_LIMIT).mul(expectedBorrowExchangePrice).div(new BN(1e12)) // expected borrow limit
    );

    // console.log("3. test yield at kink 1");

    await setup.deposit(
      setup.mockProtocol,
      new BN(6.2 * LAMPORTS_PER_SOL).sub(new BN("6006269999")), // bring total supply to 6.2 LAMPORTS_PER_SOL
      MintKeys.USDC,
      setup.alice
    );

    await setup.borrow(
      setup.mockProtocol,
      new BN(4.96 * LAMPORTS_PER_SOL).sub(new BN("1206600000")), // bring utilization to 80%
      MintKeys.USDC,
      setup.alice
    );

    // // warp & assert everything
    // // borrow rate at kink1 = 10%
    // // 4.96 LAMPORTS_PER_SOL paying 10% for a year -> 10% yield. 5% of that is revenue.
    // // supply rate = 10% - 5% revenue fee -> 9.5%. only 80% utilization -> 7.6%.
    // // 0.496 ether in yield. 5% goes to revenue -> 0,0248
    setup.warp(PASS_1YEAR_TIME); // earn a year yield

    expectedSupplyExchangePrice = expectedSupplyExchangePrice
      .mul(new BN(1076000))
      .div(new BN(1e6)); // increased by 7.6%.
    expectedBorrowExchangePrice = mulDivCeil(
      expectedBorrowExchangePrice,
      new BN(1100000),
      new BN(1e6)
    ); // increased by 10%

    expectedRevenue = expectedRevenue.add(new BN(0.0248 * LAMPORTS_PER_SOL)); // 0.0248 LAMPORTS_PER_SOL
    // expected withdrawal limit:
    expectedWithdrawalLimit = new BN("5336960000"); // user total supply 20% expanded

    await _assetState(
      new BN(1000), // expected borrow rate
      new BN(760), // expected supply rate.
      expectedSupplyExchangePrice, // expected supply exchange price.
      expectedBorrowExchangePrice, // expected borrow exchange price.
      expectedRevenue, // expected revenue.
      new BN("6193504227"), // expected supply raw interest.
      new BN(0), // expected supply interest free
      new BN("4836146295"), // expected borrow raw interest.
      new BN(0), // expected borrow interest free
      expectedWithdrawalLimit, // expected withdrawal limit. fully expanded 20%
      new BN("6547200002") // expected borrow limit
    );

    // console.log("4. test yield above kink 1");

    await setup.deposit(
      setup.mockProtocol,
      new BN(7.5 * LAMPORTS_PER_SOL).sub(new BN("6671200000")), // bring total supply to 7.5 LAMPORTS_PER_SOL
      MintKeys.USDC,
      setup.alice
    );

    await setup.borrow(
      setup.mockProtocol,
      new BN(6.375 * LAMPORTS_PER_SOL).sub(new BN("5456000000")), // bring utilization to 85%
      MintKeys.USDC,
      setup.alice
    );

    // warp & assert everything
    // borrow rate = 10% + 1/4 of slope 140% (150% -10%) -> 45%.
    // 6.375 LAMPORTS_PER_SOL paying 45% for a 1/3 year -> 15% yield. 5% of that is revenue.
    // supply rate = 45% - 5% revenue fee -> 42.75%. only 85% utilization -> 36.3375%.
    // 0.95625 LAMPORTS_PER_SOL in yield. 5% goes to revenue -> 0,0478125
    setup.warp(PASS_1YEAR_TIME / 3); // earn 1/3 year yield
    expectedSupplyExchangePrice = expectedSupplyExchangePrice
      .mul(new BN(1121125))
      .div(new BN(1e6)); // increased by 12,1125% (rate for 1/3 year)
    expect(expectedSupplyExchangePrice.toString()).to.equal("1207595704217");

    expectedBorrowExchangePrice = mulDivCeil(
      expectedBorrowExchangePrice,
      new BN(1150000),
      new BN(1e6)
    ); // increased by 15% (rate for 1/3 year)
    expect(expectedBorrowExchangePrice.toString()).to.equal("1297396650000");

    expectedRevenue = expectedRevenue.add(new BN(0.0478125 * LAMPORTS_PER_SOL)); // 0.0478125 LAMPORTS_PER_SOL
    expectedWithdrawalLimit = new BN("6726749999"); // user total supply 20% expanded

    await _assetState(
      new BN(4500), // expected borrow rate
      new BN(3633), // expected supply rate.
      expectedSupplyExchangePrice, // expected supply exchange price.
      expectedBorrowExchangePrice, // expected borrow exchange price.
      expectedRevenue, // expected revenue.
      new BN("6962957443"), // expected supply raw interest. total supply 8408437499994109082
      new BN(0), // expected supply interest free
      new BN("5650739119"), // expected borrow raw interest. total borrow 7331250000000000206
      new BN(0), // expected borrow interest free
      expectedWithdrawalLimit, // expected withdrawal limit. fully expanded 20%
      new BN("8797500002") // expected borrow limit. user total borrow fully expanded 20%
    );

    // prettier-ignore
    // console.log("5. test yield at kink 2 (same values without another kink for v1)");
    await setup.deposit(
      setup.mockProtocol,
      new BN(8.5 * LAMPORTS_PER_SOL).sub(new BN("8408437500")), // bring total supply to 8.5 LAMPORTS_PER_SOL
      MintKeys.USDC,
      setup.alice
    );

    await setup.borrow(
      setup.mockProtocol,
      new BN(7.65 * LAMPORTS_PER_SOL).sub(new BN("7331249990")), // bring utilization to 90%
      MintKeys.USDC,
      setup.alice
    );

    // warp & assert everything
    // borrow rate at kink2 = 80%
    // 7.65 ether paying 80% for 5% of a year -> 4% yield. 5% of that is revenue.
    // supply rate = 80% - 5% revenue fee -> 76%. only 90% utilization -> 68.4%.
    // 0.306 ether in yield. 5% goes to revenue -> 0,0153
    setup.warp(PASS_1YEAR_TIME / 20); // earn 5% of a year yield

    expectedSupplyExchangePrice = expectedSupplyExchangePrice
      .mul(new BN(1034200))
      .div(new BN(1e6)); // increased by 3.42%. (rate for 1/20 year)
    expect(expectedSupplyExchangePrice.toString()).to.equal("1248895477301");

    expectedBorrowExchangePrice = mulDivCeil(
      expectedBorrowExchangePrice,
      new BN(1040000),
      new BN(1e6)
    ); // increased by 4% (rate for 1/20 year)
    expect(expectedBorrowExchangePrice.toString()).to.equal("1349292516000");

    expectedRevenue = expectedRevenue.add(new BN(0.0153 * LAMPORTS_PER_SOL)); // 0.0153 LAMPORTS_PER_SOL
    expectedWithdrawalLimit = new BN("7032559999"); // user total supply 20% expanded

    await _assetState(
      new BN(8000), // expected borrow rate
      new BN(6840), // expected supply rate.
      expectedSupplyExchangePrice, // expected supply exchange price.
      expectedBorrowExchangePrice, // expected borrow exchange price.
      expectedRevenue, // expected revenue.
      new BN("7038779589"), // expected supply raw interest. total supply 8790699999998441369
      new BN(0), // expected supply interest free
      new BN("5896423438"), // expected borrow raw interest. total borrow 7956000000000000306
      new BN(0), // expected borrow interest free
      expectedWithdrawalLimit, // expected withdrawal limit. fully expanded 20%
      new BN("9547200018") // expected borrow limit. user total borrow fully expanded 20%
    );

    // prettier-ignore
    // console.log("6. test yield above kink 2 (same values without another kink for v1)");
    await setup.deposit(
      setup.mockProtocol,
      new BN(8.8 * LAMPORTS_PER_SOL).sub(new BN("8790699999")), // bring total supply to 8.8 LAMPORTS_PER_SOL
      MintKeys.USDC,
      setup.alice
    );

    await setup.borrow(
      setup.mockProtocol,
      new BN(8.096 * LAMPORTS_PER_SOL).sub(new BN("7956000000")), // bring utilization to 92%
      MintKeys.USDC,
      setup.alice
    );

    // warp & assert everything
    // borrow rate = 80% + 1/5 of slope 70% (150% -80%) -> 94%.
    // 8.096 ether paying 94% for a 1/365 year -> 0.25753424657534246% yield. 5% of that is revenue.
    // supply rate = 94% - 5% revenue fee -> 89.3%. only 92% utilization -> 82.156%.
    // 0.020849972602739726 ether in yield. 5% goes to revenue -> 0,001042498630136986
    setup.warp(PASS_1YEAR_TIME / 365); // earn 1/365 year yield

    expectedSupplyExchangePrice = expectedSupplyExchangePrice
      .mul(new BN("10022508493150684"))
      .div(new BN("10000000000000000")); // increased by 0.22508493150684931% (rate for 1/365 year)
    expect(expectedSupplyExchangePrice.toString()).to.equal("1251706552830");

    expectedBorrowExchangePrice = mulDivCeil(
      expectedBorrowExchangePrice,
      new BN("10025753424657534"),
      new BN("10000000000000000")
    ); // increased by 0.25753424657534246% (rate for 1/365 year)
    expect(expectedBorrowExchangePrice.toString()).to.equal("1352767406316");

    expectedRevenue = expectedRevenue.add(
      new BN(0.001042498630136986 * LAMPORTS_PER_SOL)
    ); // 0.001042498630136986 LAMPORTS_PER_SOL
    expectedWithdrawalLimit = new BN("7055845979"); // user total supply 20% expanded

    await _assetState(
      new BN(9400), // expected borrow rate
      new BN(8215), // expected supply rate.
      expectedSupplyExchangePrice, // expected supply exchange price.
      expectedBorrowExchangePrice, // expected borrow exchange price.
      expectedRevenue, // expected revenue.
      new BN("7046226168"), // expected supply raw interest. total supply 8819807473967845584
      new BN(0), // expected supply interest free
      new BN("6000181519"), // expected borrow raw interest. total borrow 8116849972601671502
      new BN(0), // expected borrow interest free
      expectedWithdrawalLimit, // expected withdrawal limit.
      new BN("9740219987") // expected borrow limit. user total borrow fully expanded 20% because start expand point was close
    );

    // console.log("7. test yield at max");

    // Supply to bring total supply to 9.6 SOL
    await setup.deposit(
      setup.mockProtocol,
      new BN(9.6 * LAMPORTS_PER_SOL).sub(new BN("8819807473")),
      MintKeys.USDC,
      setup.alice
    );

    // Borrow to bring utilization to 100%
    await setup.borrow(
      setup.mockProtocol,
      new BN(9.6 * LAMPORTS_PER_SOL).sub(new BN("8116849982")),
      MintKeys.USDC,
      setup.alice
    );

    // Warp & assert everything
    // borrow rate at max = 150%.
    // 9.6 SOL paying 150% for a 10% of a year -> 15% yield. 5% of that is revenue.
    // supply rate = 150% - 5% revenue fee -> 142.5%. 100% utilization.
    // 1.44 SOL in yield. 5% goes to revenue -> 0.072 SOL
    setup.warp(PASS_1YEAR_TIME / 10); // earn a 10% year yield

    expectedSupplyExchangePrice = expectedSupplyExchangePrice
      .mul(new BN(1142500))
      .div(new BN(1000000)); // increased by 14.25% (rate for 1/10 year)
    expect(expectedSupplyExchangePrice.toString()).to.equal("1430074736608");

    expectedBorrowExchangePrice = mulDivCeil(
      expectedBorrowExchangePrice,
      new BN(1150000),
      new BN(1000000)
    ); // increased by 15% (rate for 1/10 year)
    expect(expectedBorrowExchangePrice.toString()).to.equal("1555682517264");

    expectedRevenue = expectedRevenue.add(new BN(0.072 * LAMPORTS_PER_SOL)); // 0.072 LAMPORTS_PER_SOL

    // expected withdrawal limit:
    expectedWithdrawalLimit = new BN("8774399999"); // user total supply 20% fully expanded

    await _assetState(
      new BN(15000), // expected borrow rate
      new BN(14250), // expected supply rate.
      expectedSupplyExchangePrice, // expected supply exchange price.
      expectedBorrowExchangePrice, // expected borrow exchange price.
      expectedRevenue, // expected revenue.
      new BN("7669529228"), // expected supply raw interest. total supply 10967999999997890634
      new BN(0), // expected supply interest free
      new BN("7096563656"), // expected borrow raw interest. total borrow 11039999999998226085
      new BN(0), // expected borrow interest free
      expectedWithdrawalLimit, // expected withdrawal limit.
      new BN("13248000014") // expected borrow limit. user total borrow fully expanded
    );

    // console.log("8. test yield at utilization > 100%");

    // utilization is at 11039999999998226085 / 10967999999997890634 = 100.656455142235132184% precision cut off 100.65%

    // warp & assert everything
    // borrow rate at max = 150%. + continuing the slope of rate -> 6.5% of slope 70% (150% -80%)
    // -> 150% + 4,55% = 154,55%
    // 11039999999998226085 SOL paying 154,55% for 1 year yield. 5% of that is revenue.
    // supply rate = 154,55 - 5% revenue fee -> 146,8225%. 100.656455142235132184% utilization so 147,78624289%
    // Note: supply rate calculation in resolver uses utilization not from storage so result has higher precision)
    // supply exchange price calculation however uses 100.65% utilization so there it is 147,77684625.
    // 17.062319999997258414 SOL in yield. 5% goes to revenue -> 0,853115999999862920 SOL
    setup.warp(PASS_1YEAR_TIME); // earn a 1 year yield

    expectedSupplyExchangePrice = expectedSupplyExchangePrice
      .mul(new BN(24777684625))
      .div(new BN(10000000000)); // increased by 147,77684625%
    expect(expectedSupplyExchangePrice.toString()).to.equal("3543394081385");

    expectedBorrowExchangePrice = mulDivCeil(
      expectedBorrowExchangePrice,
      new BN(25455),
      new BN(10000)
    ); // increased by 154,55%
    expect(expectedBorrowExchangePrice.toString()).to.equal("3959989847696");

    expectedRevenue = expectedRevenue.add(
      new BN(0.85311599999986292 * LAMPORTS_PER_SOL)
    ); // 0.853115999999862920 LAMPORTS_PER_SOL

    // expected withdrawal limit:
    expectedWithdrawalLimit = new BN("21740931587"); // user total supply 20% fully expanded

    await _assetState(
      new BN(15455), // expected borrow rate
      new BN(14778), // expected supply rate.
      expectedSupplyExchangePrice, // expected supply exchange price.
      expectedBorrowExchangePrice, // expected borrow exchange price.
      expectedRevenue, // expected revenue.
      new BN("7669529227"), // expected supply raw interest. no changes only rounded down. total supply 27176164496692498051
      new BN(0), // expected supply interest free
      new BN("7096563657"), // expected borrow raw interest. no changes only rounded up. total borrow 28102319999992497353
      new BN(0), // expected borrow interest free
      expectedWithdrawalLimit, // expected withdrawal limit.
      new BN("33722784040") // expected borrow limit. user total borrow fully expanded
    );

    // console.log("9. test max limit");

    // Set borrow config with lower max limit
    const borrowConfig: UpdateUserBorrowConfigParams = {
      mint: MintKeys.USDC,
      newBorrowConfig: {
        user: setup.mockProtocol.publicKey,
        token: MintInfo.getMint(MintKeys.USDC),
        mode: 1,
        expandPercent: new BN(setup.DEFAULT_EXPAND_DEBT_CEILING_PERCENT), // 20%
        expandDuration: new BN(setup.DEFAULT_EXPAND_DEBT_CEILING_DURATION), // 2 days
        baseDebtCeiling: new BN(2 * LAMPORTS_PER_SOL), // raw, so at exchange price ~4, this is ~8 SOL
        maxDebtCeiling: new BN(5 * LAMPORTS_PER_SOL), // raw, so at exchange price ~4, this is ~20 SOL
      },
    };

    setup.prank(setup.admin);
    await setup.updateUserBorrowConfig([borrowConfig]);

    // assert borrowLimit
    let { userBorrowData } = await resolver.getUserBorrowData(
      setup.mockProtocol.publicKey,
      MintKeys.USDC
    );

    expect(userBorrowData.borrowLimit.toString()).to.equal(
      new BN(BASE_LIMIT)
        .mul(expectedBorrowExchangePrice)
        .div(new BN(1e12))
        .toString()
    );
    expect(userBorrowData.borrowableUntilLimit.toString()).to.equal("0");
    expect(userBorrowData.borrowable.toString()).to.equal("0");

    if (userBorrowData.borrowable.add(new BN(1)).gt(new BN(10)))
      // assert reverts if borrowing more
      expect(
        await setup.expectRevert(
          "USER_MODULE_BORROW_LIMIT_REACHED",
          setup.borrow.bind(setup),
          setup.mockProtocol,
          userBorrowData.borrowable.add(new BN(1)),
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;

    // console.log("10. payback down to 50% utilization");

    // payback down to 50% utilization
    const paybackAmount = userBorrowData.borrow.sub(new BN(13588082249));
    await setup.payback(
      setup.mockProtocol,
      paybackAmount,
      MintKeys.USDC,
      setup.alice
    );

    // borrow rate = 4% + 5/8 of slope 6% (10% -4%) -> 7.75%.
    // supply rate = 7.75% - 5% revenue fee -> 7.3625%. only 50% utilization -> 3.68125%.
    expectedRevenue = expectedRevenue.add(new BN(1538)); // no changes but tolerate some inaccuracy 1538, from total amounts rounding

    await _assetState(
      new BN(775), // expected borrow rate
      new BN(368), // expected supply rate.
      expectedSupplyExchangePrice, // expected supply exchange price.
      expectedBorrowExchangePrice, // expected borrow exchange price.
      expectedRevenue, // expected revenue.
      new BN("7669529226"), // expected supply raw interest. no changes only rounded down. total supply 27176164496692497597
      new BN(0), // expected supply interest free
      new BN("3431342699"), // expected borrow raw interest. total borrow 13588082248346249094
      new BN(0), // expected borrow interest free
      expectedWithdrawalLimit, // expected withdrawal limit.
      new BN("16305698699") // expected borrow limit. user total borrow fully expanded. allow minor precision diff of 253
    );
  });
});

interface AccountingSnapshot {
  supplyRawInterest: BN;
  supplyInterestFree: BN;
  borrowRawInterest: BN;
  borrowInterestFree: BN;
  supplyExchangePrice: BN;
  borrowExchangePrice: BN;
}

interface AccountingResult {
  interestPaidByBorrowers: BN;
  interestReceivedBySuppliers: BN;
  accountingError: BN;
  errorPercentage: BN;
}

describe("LiquidityYieldEdgeCases", () => {
  let resolver: FluidLiquidityResolver;
  let setup: LiquidityBaseSetup;

  afterEach(async () => {
    setup.logComputeBudget();
  });

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";

    setup = new LiquidityBaseSetup();
    await setup.setup();

    resolver = new FluidLiquidityResolver(
      setup.admin,
      setup.liquidity,
      setup.client
    );
  });

  /**
   * Helper function to track interest accounting over time
   */
  function trackInterestAccounting(
    before: AccountingSnapshot,
    after: AccountingSnapshot
  ): AccountingResult {
    // Calculate interest paid by borrowers (only with_interest borrowers pay)
    // borrowRawInterest is stored as: actualAmount / borrowExchangePrice
    // To get actualAmount: borrowRawInterest * borrowExchangePrice
    const borrowValueBefore = before.borrowRawInterest
      .mul(before.borrowExchangePrice)
      .div(new BN(1e12));
    const borrowValueAfter = before.borrowRawInterest
      .mul(after.borrowExchangePrice)
      .div(new BN(1e12));
    const interestPaidByBorrowers = borrowValueAfter.sub(borrowValueBefore);

    // Calculate interest received by suppliers (only with_interest suppliers receive)
    // supplyRawInterest is stored as: actualAmount / supplyExchangePrice
    // To get actualAmount: supplyRawInterest * supplyExchangePrice
    const supplyValueBefore = before.supplyRawInterest
      .mul(before.supplyExchangePrice)
      .div(new BN(1e12));
    const supplyValueAfter = before.supplyRawInterest
      .mul(after.supplyExchangePrice)
      .div(new BN(1e12));
    const interestReceivedBySuppliers = supplyValueAfter.sub(supplyValueBefore);

    // Calculate accounting error
    const accountingError = interestReceivedBySuppliers.sub(
      interestPaidByBorrowers
    );

    // Calculate error percentage (in basis points)
    const errorPercentage = interestPaidByBorrowers.isZero()
      ? new BN(0)
      : accountingError.mul(new BN(10000)).div(interestPaidByBorrowers);

    return {
      interestPaidByBorrowers,
      interestReceivedBySuppliers,
      accountingError,
      errorPercentage,
    };
  }

  it("Should track accounting at 60% utilization", async () => {
    // Setup: Supply 100 (80 interest + 20 free), Borrow 60 (50 interest + 10 free)
    await setup.deposit(
      setup.mockProtocolWithInterest,
      new BN(80 * 1e6),
      MintKeys.USDC,
      setup.alice
    );
    await setup.deposit(
      setup.mockProtocolInterestFree,
      new BN(20 * 1e6),
      MintKeys.USDC,
      setup.alice
    );
    await setup.borrow(
      setup.mockProtocolWithInterest,
      new BN(50 * 1e6),
      MintKeys.USDC,
      setup.alice
    );
    await setup.borrow(
      setup.mockProtocolInterestFree,
      new BN(10 * 1e6),
      MintKeys.USDC,
      setup.alice
    );

    const before = await resolver.getOverallTokenData(MintKeys.USDC);

    // Warp 1 year
    setup.warp(PASS_1YEAR_TIME);
    await setup.deposit(
      setup.mockProtocolInterestFree,
      new BN(1000),
      MintKeys.USDC,
      setup.alice
    );

    const after = await resolver.getOverallTokenData(MintKeys.USDC);

    const accounting = trackInterestAccounting(
      {
        supplyRawInterest: before.supplyRawInterest,
        supplyInterestFree: before.supplyInterestFree,
        borrowRawInterest: before.borrowRawInterest,
        borrowInterestFree: before.borrowInterestFree,
        supplyExchangePrice: before.supplyExchangePrice,
        borrowExchangePrice: before.borrowExchangePrice,
      },
      {
        supplyRawInterest: before.supplyRawInterest,
        supplyInterestFree: before.supplyInterestFree,
        borrowRawInterest: before.borrowRawInterest,
        borrowInterestFree: before.borrowInterestFree,
        supplyExchangePrice: after.supplyExchangePrice,
        borrowExchangePrice: after.borrowExchangePrice,
      }
    );

    // At default 5% fee, suppliers receive less than borrowers paid
    expect(
      accounting.interestReceivedBySuppliers.lte(
        accounting.interestPaidByBorrowers
      )
    ).to.be.true;
  });

  it("Should track accounting with ZERO fee at 60% utilization", async () => {
    // Set fee to 0%
    setup.prank(setup.admin);
    await setup.updateTokenConfigs([
      {
        token: MintKeys.USDC,
        fee: new BN(0),
        maxUtilization: new BN(1e4),
      },
    ]);

    // Setup: Supply 100 (80 interest + 20 free), Borrow 60 (50 interest + 10 free)
    await setup.deposit(
      setup.mockProtocolWithInterest,
      new BN(80 * 1e6),
      MintKeys.USDC,
      setup.alice
    );
    await setup.deposit(
      setup.mockProtocolInterestFree,
      new BN(20 * 1e6),
      MintKeys.USDC,
      setup.alice
    );
    await setup.borrow(
      setup.mockProtocolWithInterest,
      new BN(50 * 1e6),
      MintKeys.USDC,
      setup.alice
    );
    await setup.borrow(
      setup.mockProtocolInterestFree,
      new BN(10 * 1e6),
      MintKeys.USDC,
      setup.alice
    );

    const before = await resolver.getOverallTokenData(MintKeys.USDC);

    // Warp 1 year
    setup.warp(PASS_1YEAR_TIME);
    await setup.deposit(
      setup.mockProtocolInterestFree,
      new BN(1000),
      MintKeys.USDC,
      setup.alice
    );

    const after = await resolver.getOverallTokenData(MintKeys.USDC);

    const accounting = trackInterestAccounting(
      {
        supplyRawInterest: before.supplyRawInterest,
        supplyInterestFree: before.supplyInterestFree,
        borrowRawInterest: before.borrowRawInterest,
        borrowInterestFree: before.borrowInterestFree,
        supplyExchangePrice: before.supplyExchangePrice,
        borrowExchangePrice: before.borrowExchangePrice,
      },
      {
        supplyRawInterest: before.supplyRawInterest,
        supplyInterestFree: before.supplyInterestFree,
        borrowRawInterest: before.borrowRawInterest,
        borrowInterestFree: before.borrowInterestFree,
        supplyExchangePrice: after.supplyExchangePrice,
        borrowExchangePrice: after.borrowExchangePrice,
      }
    );

    // At 0% fee, accounting should balance perfectly
    expect(accounting.accountingError.abs().lte(new BN(10))).to.be.true; // Allow tiny rounding
  });

  it("Should track accounting with ZERO fee at 100% utilization", async () => {
    // Set fee to 0%
    setup.prank(setup.admin);
    await setup.updateTokenConfigs([
      {
        token: MintKeys.USDC,
        fee: new BN(0),
        maxUtilization: new BN(1e4),
      },
    ]);

    // Setup: Supply 100 (80 interest + 20 free), Borrow 100 (80 interest + 20 free)
    await setup.deposit(
      setup.mockProtocolWithInterest,
      new BN(80 * 1e6),
      MintKeys.USDC,
      setup.alice
    );
    await setup.deposit(
      setup.mockProtocolInterestFree,
      new BN(20 * 1e6),
      MintKeys.USDC,
      setup.alice
    );
    await setup.borrow(
      setup.mockProtocolWithInterest,
      new BN(80 * 1e6),
      MintKeys.USDC,
      setup.alice
    );
    await setup.borrow(
      setup.mockProtocolInterestFree,
      new BN(20 * 1e6),
      MintKeys.USDC,
      setup.alice
    );

    const before = await resolver.getOverallTokenData(MintKeys.USDC);

    // Warp 1 year
    setup.warp(PASS_1YEAR_TIME);
    await setup.deposit(
      setup.mockProtocolInterestFree,
      new BN(1000),
      MintKeys.USDC,
      setup.alice
    );

    const after = await resolver.getOverallTokenData(MintKeys.USDC);

    const accounting = trackInterestAccounting(
      {
        supplyRawInterest: before.supplyRawInterest,
        supplyInterestFree: before.supplyInterestFree,
        borrowRawInterest: before.borrowRawInterest,
        borrowInterestFree: before.borrowInterestFree,
        supplyExchangePrice: before.supplyExchangePrice,
        borrowExchangePrice: before.borrowExchangePrice,
      },
      {
        supplyRawInterest: before.supplyRawInterest,
        supplyInterestFree: before.supplyInterestFree,
        borrowRawInterest: before.borrowRawInterest,
        borrowInterestFree: before.borrowInterestFree,
        supplyExchangePrice: after.supplyExchangePrice,
        borrowExchangePrice: after.borrowExchangePrice,
      }
    );

    // At 100% utilization with symmetric ratios, accounting should balance
    expect(accounting.accountingError.abs().lte(new BN(10))).to.be.true;
  });

  it("Should handle ASYMMETRIC ratios correctly (supply 80/20, borrow 100/0)", async () => {
    // Set fee to 0%
    setup.prank(setup.admin);
    await setup.updateTokenConfigs([
      {
        token: MintKeys.USDC,
        fee: new BN(0),
        maxUtilization: new BN(1e4),
      },
    ]);

    // ASYMMETRIC: Supply 80% interest-earning, Borrow 100% interest-paying
    // This tests the concentration formula: 100% of interest goes to only 80% of suppliers
    await setup.deposit(
      setup.mockProtocolWithInterest,
      new BN(80 * 1e6),
      MintKeys.USDC,
      setup.alice
    );
    await setup.deposit(
      setup.mockProtocolInterestFree,
      new BN(20 * 1e6),
      MintKeys.USDC,
      setup.alice
    );
    await setup.borrow(
      setup.mockProtocolWithInterest,
      new BN(100 * 1e6),
      MintKeys.USDC,
      setup.alice
    );

    const before = await resolver.getOverallTokenData(MintKeys.USDC);

    // Warp 1 year
    setup.warp(PASS_1YEAR_TIME);
    await setup.deposit(
      setup.mockProtocolInterestFree,
      new BN(1000),
      MintKeys.USDC,
      setup.alice
    );

    const after = await resolver.getOverallTokenData(MintKeys.USDC);

    const accounting = trackInterestAccounting(
      {
        supplyRawInterest: before.supplyRawInterest,
        supplyInterestFree: before.supplyInterestFree,
        borrowRawInterest: before.borrowRawInterest,
        borrowInterestFree: before.borrowInterestFree,
        supplyExchangePrice: before.supplyExchangePrice,
        borrowExchangePrice: before.borrowExchangePrice,
      },
      {
        supplyRawInterest: before.supplyRawInterest,
        supplyInterestFree: before.supplyInterestFree,
        borrowRawInterest: before.borrowRawInterest,
        borrowInterestFree: before.borrowInterestFree,
        supplyExchangePrice: after.supplyExchangePrice,
        borrowExchangePrice: after.borrowExchangePrice,
      }
    );

    // Even with asymmetric ratios, accounting should balance
    // The supply exchange price will grow faster than borrow (concentration effect)
    // But total interest paid = total interest received
    expect(accounting.accountingError.abs().lte(new BN(10))).to.be.true;

    // Verify supply exchange price grew more than borrow (concentration)
    const supplyGrowth = after.supplyExchangePrice.sub(
      before.supplyExchangePrice
    );
    const borrowGrowth = after.borrowExchangePrice.sub(
      before.borrowExchangePrice
    );
    expect(supplyGrowth.gt(borrowGrowth)).to.be.true;
  });

  it("Should accumulate accounting over multiple operations", async () => {
    // Set fee to 0%
    setup.prank(setup.admin);
    await setup.updateTokenConfigs([
      {
        token: MintKeys.USDC,
        fee: new BN(0),
        maxUtilization: new BN(1e4),
      },
    ]);

    // Initial setup
    await setup.deposit(
      setup.mockProtocolWithInterest,
      new BN(100 * 1e6),
      MintKeys.USDC,
      setup.alice
    );
    await setup.deposit(
      setup.mockProtocolInterestFree,
      new BN(50 * 1e6),
      MintKeys.USDC,
      setup.alice
    );
    await setup.borrow(
      setup.mockProtocolWithInterest,
      new BN(80 * 1e6),
      MintKeys.USDC,
      setup.alice
    );
    await setup.borrow(
      setup.mockProtocolInterestFree,
      new BN(20 * 1e6),
      MintKeys.USDC,
      setup.alice
    );

    let prevData = await resolver.getOverallTokenData(MintKeys.USDC);

    // Operation 1: Warp 30 days, add supply
    setup.warp(30 * 24 * 3600);
    await setup.deposit(
      setup.mockProtocolWithInterest,
      new BN(50 * 1e6),
      MintKeys.USDC,
      setup.alice
    );

    let currentData = await resolver.getOverallTokenData(MintKeys.USDC);
    const accounting1 = trackInterestAccounting(
      {
        supplyRawInterest: prevData.supplyRawInterest,
        supplyInterestFree: prevData.supplyInterestFree,
        borrowRawInterest: prevData.borrowRawInterest,
        borrowInterestFree: prevData.borrowInterestFree,
        supplyExchangePrice: prevData.supplyExchangePrice,
        borrowExchangePrice: prevData.borrowExchangePrice,
      },
      {
        supplyRawInterest: prevData.supplyRawInterest,
        supplyInterestFree: prevData.supplyInterestFree,
        borrowRawInterest: prevData.borrowRawInterest,
        borrowInterestFree: prevData.borrowInterestFree,
        supplyExchangePrice: currentData.supplyExchangePrice,
        borrowExchangePrice: currentData.borrowExchangePrice,
      }
    );

    prevData = currentData;

    // Operation 2: Warp another 60 days, add borrow
    setup.warp(60 * 24 * 3600);
    await setup.borrow(
      setup.mockProtocolWithInterest,
      new BN(30 * 1e6),
      MintKeys.USDC,
      setup.alice
    );

    currentData = await resolver.getOverallTokenData(MintKeys.USDC);
    const accounting2 = trackInterestAccounting(
      {
        supplyRawInterest: prevData.supplyRawInterest,
        supplyInterestFree: prevData.supplyInterestFree,
        borrowRawInterest: prevData.borrowRawInterest,
        borrowInterestFree: prevData.borrowInterestFree,
        supplyExchangePrice: prevData.supplyExchangePrice,
        borrowExchangePrice: prevData.borrowExchangePrice,
      },
      {
        supplyRawInterest: prevData.supplyRawInterest,
        supplyInterestFree: prevData.supplyInterestFree,
        borrowRawInterest: prevData.borrowRawInterest,
        borrowInterestFree: prevData.borrowInterestFree,
        supplyExchangePrice: currentData.supplyExchangePrice,
        borrowExchangePrice: currentData.borrowExchangePrice,
      }
    );

    // Cumulative accounting should still balance
    const totalError = accounting1.accountingError.add(
      accounting2.accountingError
    );
    expect(totalError.abs().lte(new BN(1000))).to.be.true; // Allow small rounding across operations
  });
});
