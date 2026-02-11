import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { MintKeys } from "../../ts-sdk/mint";
import { LiquidityBaseSetup } from "../../test-utils/typescript/liquidity/setup";
import { FluidLiquidityResolver } from "../../test-utils/typescript/liquidity/resolver";

const DEFAULT_AMOUNT = new BN(1 * LAMPORTS_PER_SOL); // 1 SOL
const PASS_1YEAR_TIME = 365 * 24 * 60 * 60; // 1 year

describe("LiquidityUserModuleBorrowTests", () => {
  let setup: LiquidityBaseSetup;
  let resolver: FluidLiquidityResolver;

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

    await setup._setUserAllowancesDefault(MintKeys.USDC, setup.mockProtocol);

    // alice supplies liquidity
    await setup.deposit(
      setup.mockProtocol,
      DEFAULT_AMOUNT,
      MintKeys.USDC,
      setup.alice
    );
  });

  it("Should test: operate_BorrowWhenUtilizationAbove100Percent", async () => {
    // borrow to 100% utilization, with very high borrow rate APR + some fee
    // meaning increase in borrow exchange price happens faster than supply exchange price
    // so utilization will grow above 100%.
    // then someone supplies again and brings utilization down but still above 100%.
    // but this newly supplied amount can immediately be borrowed again.
    // set max possible borrow rate at all utilization levels

    await setup.updateRateDataV1([
      {
        token: MintKeys.USDC,
        kink: setup.DEFAULT_KINK,
        rateAtUtilizationZero: setup.MAX_POSSIBLE_BORROW_RATE,
        rateAtUtilizationKink: setup.MAX_POSSIBLE_BORROW_RATE,
        rateAtUtilizationMax: setup.MAX_POSSIBLE_BORROW_RATE,
      },
    ]);

    // set fee to 30%
    await setup.updateTokenConfigs([
      {
        token: MintKeys.USDC,
        fee: new BN(setup.DEFAULT_PERCENT_PRECISION).mul(new BN(30)), // 30% fee
        maxUtilization: new BN(1e4), // 100%
      },
    ]);

    let overallTokenData = await resolver.getOverallTokenData(MintKeys.USDC);

    // borrow full available supply amount to get to 100% utilization
    await setup.borrow(
      setup.mockProtocol,
      overallTokenData.supplyInterestFree.add(
        overallTokenData.supplyRawInterest
      ),
      MintKeys.USDC,
      setup.alice
    );

    // expect utilization to be 100%
    overallTokenData = await resolver.getOverallTokenData(MintKeys.USDC);
    expect(overallTokenData.lastStoredUtilization.toNumber()).to.equal(1e4);

    // warp until utilization grows enough above 100%
    await setup.warpWithExchangePrice(MintKeys.USDC, PASS_1YEAR_TIME);

    // prettier-ignore
    {
      // expect utilization to be 142,54 %
      overallTokenData = await resolver.getOverallTokenData(MintKeys.USDC);
      expect(overallTokenData.lastStoredUtilization.toNumber()).to.be.eq(14254);
      expect(overallTokenData.supplyExchangePrice.toNumber()).to.be.eq(134600667245412);
      // borrowExchangePrice uses safe_div_ceil to ensure borrowers pay at least the calculated interest.
      // Formula: price += ceil(price * rate * seconds / (SECONDS_PER_YEAR * FOUR_DECIMALS))
      expect(overallTokenData.borrowExchangePrice.toNumber()).to.be.eq(191864066984971);
    }

    // execute supply. Raw supply / borrow is still 1 ether (actually DEFAULT_SUPPLY_AMOUNT_AFTER_BIGMATH which also is 1 ether).
    // so total amounts here = DEFAULT_SUPPLY_AMOUNT_AFTER_BIGMATH * exchangepPrices
    // total supply: 1e18 * 134600667245412 / 1e12 = 1.34600667245412 × 10^20
    // total borrow: 1e18 * 191864066984971 / 1e12 = 1.91864066984971 × 10^20
    await setup.deposit(
      setup.mockProtocol,
      new BN(50 * LAMPORTS_PER_SOL),
      MintKeys.USDC,
      setup.alice
    );

    // total supply now: 1.34600667245412 × 10^20 + 50 ether = 1.84600667245412×10^20

    // prettier-ignore
    {
      // expect utilization to be down to 1.9186406698454 × 10^20 * 100 / 1.84600667245412×10^20 = 103,93 %
      overallTokenData = await resolver.getOverallTokenData(MintKeys.USDC);
      expect(overallTokenData.lastStoredUtilization.toNumber()).to.be.eq(10393);
    }

    // supplied amount can NOT be borrowed because utilization is above 100%
    expect(
      await setup.expectRevert(
        "USER_MODULE_MAX_UTILIZATION_REACHED",
        setup.borrow.bind(setup),
        setup.mockProtocol,
        DEFAULT_AMOUNT,
        MintKeys.USDC,
        setup.alice
      )
    ).to.be.true;

    // supply again to bring utilization further down
    await setup.deposit(
      setup.mockProtocol,
      new BN(100 * LAMPORTS_PER_SOL),
      MintKeys.USDC,
      setup.alice
    );

    // total supply now: 1.84600667245412×10^20 + 100 ether = 2.84600667245412×10^20
    // total borrow still: 1.9186406698454 × 10^20

    // prettier-ignore
    {
      // expect utilization to be down to 1.9186406698454 × 10^20 * 100 / 2.84600667245412×10^20 = 67,4151 %
      overallTokenData = await resolver.getOverallTokenData(MintKeys.USDC);
      expect(overallTokenData.lastStoredUtilization.toNumber()).to.be.eq(6741);
    }

    // borrow now should work normally again.
    await setup.borrow(
      setup.mockProtocol,
      new BN(10 * LAMPORTS_PER_SOL),
      MintKeys.USDC,
      setup.alice
    );

    // total borrow now: 1.9186406698454 × 10^20 + 10 ether = 2.0186406698454 × 10^20

    {
      // expect utilization to be 2.0186406698454 × 10^20 * 100 / 2.84600667245412×10^20 = 70,9288 %
      overallTokenData = await resolver.getOverallTokenData(MintKeys.USDC);
      expect(overallTokenData.lastStoredUtilization.toNumber()).to.be.eq(7092);
    }
  });
});
