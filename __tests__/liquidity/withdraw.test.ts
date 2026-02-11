import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { MintKeys } from "../../ts-sdk/mint";
import { LiquidityBaseSetup } from "../../test-utils/typescript/liquidity/setup";
import { FluidLiquidityResolver } from "../../test-utils/typescript/liquidity/resolver";

const DEFAULT_AMOUNT = new BN(1 * LAMPORTS_PER_SOL); // 1 SOL
const DEFAULT_BORROW_AMOUNT = new BN(0.5 * LAMPORTS_PER_SOL); // 0.5 SOL
const PASS_1YEAR_TIME = 365 * 24 * 60 * 60; // 1 year

describe("LiquidityUserModuleWithdrawTestsInterestFree", () => {
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

    // prettier-ignore
    await setup._setUserAllowancesDefaultInterestFree(MintKeys.USDC, setup.mockProtocol);

    // alice supplies liquidity
    await setup.deposit(
      setup.mockProtocol,
      DEFAULT_AMOUNT,
      MintKeys.USDC,
      setup.alice
    );
  });

  it("should operate_RevertIfWithdrawMoreThanSupplied", async () => {
    expect(
      await setup.expectRevert(
        "LIBRARY_MATH_ERROR",
        setup.withdraw.bind(setup),
        setup.mockProtocol,
        DEFAULT_AMOUNT.add(new BN(1)),
        MintKeys.USDC,
        setup.alice
      )
    ).to.be.true;
  });

  it("should operate_WithdrawMoreThanTotalSupply", async () => {
    // withdraw more than total supply but <= user supply. should reset total supply to 0 and reduce user supply amount
    await setup.exposeTotalAmount(
      MintKeys.USDC,
      new BN(0),
      DEFAULT_AMOUNT.div(new BN(2)),
      new BN(0),
      new BN(0)
    );

    let { userSupplyData, overallTokenData } = await resolver.getUserSupplyData(
      setup.mockProtocol.publicKey,
      MintKeys.USDC
    );

    // prettier-ignore
    {
      expect(userSupplyData.supply.toNumber()).to.be.eq(DEFAULT_AMOUNT.toNumber());
      expect(overallTokenData.supplyRawInterest.toNumber()).to.be.eq(0);
      expect(overallTokenData.supplyInterestFree.toNumber()).to.be.eq(DEFAULT_AMOUNT.div(new BN(2)).toNumber());
      expect(overallTokenData.borrowRawInterest.toNumber()).to.be.eq(0);
      expect(overallTokenData.borrowInterestFree.toNumber()).to.be.eq(0);
    }

    const withdrawAmount = DEFAULT_AMOUNT.div(new BN(2)).add(new BN(10));

    await setup.withdraw(
      setup.mockProtocol,
      withdrawAmount,
      MintKeys.USDC,
      setup.alice
    );

    const newUserSupplyAmount = userSupplyData.supply.sub(withdrawAmount);

    ({ userSupplyData, overallTokenData } = await resolver.getUserSupplyData(
      setup.mockProtocol.publicKey,
      MintKeys.USDC
    ));

    // prettier-ignore
    {
      expect(userSupplyData.supply.toNumber()).to.be.eq(newUserSupplyAmount.toNumber());
      expect(overallTokenData.supplyRawInterest.toNumber()).to.be.eq(0);
      expect(overallTokenData.supplyInterestFree.toNumber()).to.be.eq(0);
      expect(overallTokenData.borrowRawInterest.toNumber()).to.be.eq(0);
      expect(overallTokenData.borrowInterestFree.toNumber()).to.be.eq(0);
    }
  });

  it("should operate_WithdrawExactToZero", async () => {
    // borrow to create some yield for better test setup
    await setup.borrow(
      setup.mockProtocol,
      DEFAULT_BORROW_AMOUNT,
      MintKeys.USDC,
      setup.alice
    );

    // simulate passing time 1 year to get a better predicatable borrow rate and amounts
    setup.warp(PASS_1YEAR_TIME);

    // create more supply so there is actually liquidity for withdrawal, but from other user (other mockProtocol)
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_AMOUNT,
      MintKeys.USDC,
      setup.alice
    );

    // withdraw full available supply amount
    // read supplied amount via resolver
    let { userSupplyData } = await resolver.getUserSupplyData(
      setup.mockProtocol.publicKey,
      MintKeys.USDC
    );

    // prettier-ignore
    expect(userSupplyData.supply.toNumber()).to.be.eq(DEFAULT_AMOUNT.toNumber());

    await setup.withdraw(
      setup.mockProtocol,
      userSupplyData.supply,
      MintKeys.USDC,
      setup.alice
    );

    ({ userSupplyData } = await resolver.getUserSupplyData(
      setup.mockProtocol.publicKey,
      MintKeys.USDC
    ));

    // prettier-ignore
    expect(userSupplyData.supply.toNumber()).to.be.eq(0);
  });
});

describe("LiquidityUserModuleWithdrawTestsInterestFree", () => {
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

    // prettier-ignore
    await setup._setUserAllowancesDefault(MintKeys.USDC, setup.mockProtocol);

    // alice supplies liquidity
    await setup.deposit(
      setup.mockProtocol,
      DEFAULT_AMOUNT,
      MintKeys.USDC,
      setup.alice
    );
  });

  it("should operate_WithdrawMoreThanTotalSupply", async () => {
    // borrow to create some yield for better test setup
    await setup.borrow(
      setup.mockProtocol,
      DEFAULT_BORROW_AMOUNT,
      MintKeys.USDC,
      setup.alice
    );

    // Simulate lower total supply amount (half of what was supplied)
    // This simulates a scenario where total supply is less than user supply
    await setup.exposeTotalAmount(
      MintKeys.USDC,
      DEFAULT_AMOUNT.div(new BN(2)), // supplyRawInterest = 0.5 SOL
      new BN(0), // supplyInterestFree = 0
      DEFAULT_BORROW_AMOUNT, // borrowRawInterest
      new BN(0) // borrowInterestFree = 0
    );

    // simulate correct utilization of 100%, ratios etc.
    await setup.exposeExchangePriceWithRates(
      MintKeys.USDC,
      new BN(1e12), // supply exchange price
      new BN(1e12), // borrow exchange price
      new BN(1e4), // utilization 100%
      new BN(775), // borrow rate 7.75%
      new BN(setup.getTimestamp().toString())
    );

    // simulate passing time 1 year to get predictable borrow rate and amounts
    setup.warp(PASS_1YEAR_TIME);

    let { userSupplyData, overallTokenData } = await resolver.getUserSupplyData(
      setup.mockProtocol.publicKey,
      MintKeys.USDC
    );

    // uint256 supplyExchangePrice = 1077500000000; // increased 7.75% (because ALL of supply is borrowed out)
    // uint256 borrowExchangePrice = 1077500000000; // increased 7.75%
    // prettier-ignore
    {
      expect(userSupplyData.supply.toNumber()).to.be.eq(1.0775 * LAMPORTS_PER_SOL);
      expect(overallTokenData.supplyRawInterest.toNumber()).to.be.eq(DEFAULT_AMOUNT.div(new BN(2)).toNumber());
      expect(overallTokenData.totalSupply.toNumber()).to.be.eq(0.53875 * LAMPORTS_PER_SOL); // 0.5 ether adjusted for supplyExchangePrice
      expect(overallTokenData.supplyInterestFree.toNumber()).to.be.eq(0);
      expect(overallTokenData.borrowRawInterest.toNumber()).to.be.eq(DEFAULT_BORROW_AMOUNT.toNumber());
      expect(overallTokenData.borrowInterestFree.toNumber()).to.be.eq(0);
    }

    // withdraw more than total amount
    const withdrawAmount = overallTokenData.totalSupply.add(new BN(1));
    const newUserSupplyAmount = userSupplyData.supply.sub(withdrawAmount);

    // payback borrowed amount to create funds at liquidity
    await setup.payback(
      setup.mockProtocol,
      DEFAULT_BORROW_AMOUNT.mul(new BN(1077500000000)).div(new BN(1e12)),
      MintKeys.USDC,
      setup.alice
    );

    await setup.withdraw(
      setup.mockProtocol,
      withdrawAmount,
      MintKeys.USDC,
      setup.alice
    );

    ({ userSupplyData, overallTokenData } = await resolver.getUserSupplyData(
      setup.mockProtocol.publicKey,
      MintKeys.USDC
    ));

    // prettier-ignore
    {
      expect(userSupplyData.supply.toNumber()).to.be.closeTo(newUserSupplyAmount.toNumber(), 1); // tolerance for rounding
      expect(overallTokenData.supplyRawInterest.toNumber()).to.be.eq(0);
      expect(overallTokenData.supplyInterestFree.toNumber()).to.be.eq(0);
      expect(overallTokenData.borrowRawInterest.toNumber()).to.be.closeTo(0, 1); // tolerance for rounding
      expect(overallTokenData.borrowInterestFree.toNumber()).to.be.eq(0);
    }
  });

  it("should operate_WithdrawExactToZero", async () => {
    // borrow to create some yield for better test setup
    await setup.borrow(
      setup.mockProtocol,
      DEFAULT_BORROW_AMOUNT,
      MintKeys.USDC,
      setup.alice
    );

    // simulate passing time 1 year to get predictable borrow rate and amounts
    setup.warp(PASS_1YEAR_TIME);

    // create more supply so there is actually liquidity for withdrawal,
    // but from other user (mockProtocolInterestFree to differentiate)
    await setup.deposit(
      setup.mockProtocolInterestFree, // Using different protocol for additional liquidity
      DEFAULT_AMOUNT,
      MintKeys.USDC,
      setup.alice
    );

    // Read current supplied amount via resolver
    let { userSupplyData } = await resolver.getUserSupplyData(
      setup.mockProtocol.publicKey,
      MintKeys.USDC
    );

    // uint256 supplyExchangePrice = 1038750000000; // increased half of 7.75% -> 3.875% (because half of supply is borrowed out)
    // uint256 borrowExchangePrice = 1077500000000; // increased 7.75%
    // so withdrawable should be ~ 1 ether * 1038750000000 / 1e12 = 1.03875×10^18
    expect(userSupplyData.supply.toString()).to.be.eq(
      new BN(1.03875 * LAMPORTS_PER_SOL).toString()
    );

    // Withdraw the full available supply amount
    await setup.withdraw(
      setup.mockProtocol,
      userSupplyData.supply, // Withdraw exact amount
      MintKeys.USDC,
      setup.alice
    );

    // Verify supply is now exactly 0
    ({ userSupplyData } = await resolver.getUserSupplyData(
      setup.mockProtocol.publicKey,
      MintKeys.USDC
    ));

    expect(userSupplyData.supply.toNumber()).to.be.eq(0);
  });
});
