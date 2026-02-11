import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import {
  UpdateUserSupplyConfigParams,
  UpdateUserBorrowConfigParams,
} from "../../ts-sdk/liquidity/types";
import { MintKeys, mint as MintInfo } from "../../ts-sdk/mint";
import { LiquidityBaseSetup } from "../../test-utils/typescript/liquidity/setup";

const DEFAULT_SUPPLY_AMOUNT = new BN(1 * LAMPORTS_PER_SOL);

describe("LiquidityUserModuleOperateTests", () => {
  let setup: LiquidityBaseSetup;

  afterEach(async () => {
    setup.logComputeBudget();
  });

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";

    setup = new LiquidityBaseSetup();
    await setup.setup();
    await setup._setUserAllowancesDefault(MintKeys.USDC, setup.mockProtocol);
  });

  it("Should test: operate_RevertOperateAmountsZero", async () => {
    expect(
      await setup.expectRevert(
        "USER_MODULE_OPERATE_AMOUNTS_ZERO",
        setup.operate.bind(setup),
        setup.mockProtocol,
        new BN(0), // supply amount
        new BN(0), // borrow amount
        MintKeys.USDC,
        setup.alice
      )
    ).to.be.true;
  });

  it("Should test: operate_AfterUnpaused", async () => {
    const balanceBefore = await setup.balanceOf(
      setup.mockProtocol.publicKey,
      MintInfo.getMint(MintKeys.USDC)
    );

    // Pause user
    await setup.pauseUser(
      MintKeys.USDC,
      MintKeys.USDC,
      setup.mockProtocol.publicKey,
      1,
      1
    );

    expect(
      await setup.expectRevert(
        "USER_MODULE_USER_PAUSED",
        setup.operate.bind(setup),
        setup.mockProtocol,
        DEFAULT_SUPPLY_AMOUNT,
        new BN(0),
        MintKeys.USDC,
        setup.alice
      )
    ).to.be.true;

    // Now unpause and execute again
    await setup.unpauseUser(
      MintKeys.USDC,
      MintKeys.USDC,
      setup.mockProtocol.publicKey,
      0,
      0
    );

    await setup.operate(
      setup.mockProtocol,
      DEFAULT_SUPPLY_AMOUNT,
      new BN(0),
      MintKeys.USDC,
      setup.alice
    );

    const balanceAfter = await setup.balanceOf(
      setup.mockProtocol.publicKey,
      MintInfo.getMint(MintKeys.USDC)
    );

    expect(balanceAfter.sub(balanceBefore).toString()).to.equal(
      DEFAULT_SUPPLY_AMOUNT.toString()
    );
  });
});

describe("LiquidityUserModuleOperateTotalAmountsOverflowTests", () => {
  let setup: LiquidityBaseSetup;
  const u64MAX = new BN("18446744073709551615");
  const u60MAX = new BN("1152921504606846975");
  const i64MAX = new BN("9223372036854775807");

  afterEach(async () => {
    setup.logComputeBudget();
  });

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";

    setup = new LiquidityBaseSetup();
    await setup.setup();

    // manually set user allowances to 1 for all mints
    // Set withdraw config with actual limits
    const supplyConfig: UpdateUserSupplyConfigParams = {
      mint: MintKeys.USDC,
      newSupplyConfig: {
        user: setup.mockProtocol.publicKey,
        token: MintInfo.getMint(MintKeys.USDC),
        mode: 1, // with interest
        expandPercent: new BN(1e4), // 100%
        expandDuration: new BN(1), // every second
        baseWithdrawalLimit: u64MAX,
      },
    };

    await setup.updateUserSupplyConfig([supplyConfig]);
  });

  it("Should test: supply_MAX_TOKEN_AMOUNT_CAP_minus_1", async () => {
    await setup.operate(
      setup.mockProtocol,
      u60MAX.sub(new BN(1)),
      new BN(0),
      MintKeys.USDC,
      setup.alice
    );
  });

  it("Should test: operate_RevertValueOverflowTotalSupplyWithInterest", async () => {
    // Try to supply above max and expect revert
    expect(
      await setup.expectRevert(
        "USER_MODULE_VALUE_OVERFLOW_TOTAL_SUPPLY",
        setup.operate.bind(setup),
        setup.mockProtocol,
        i64MAX.sub(new BN(1)), // u64::MAX
        new BN(0),
        MintKeys.USDC,
        setup.alice
      )
    ).to.be.true;
  });

  it("Should test: operate_WithdrawWhenAboveTotalSupplyWithInterestLimit", async () => {
    const maxSupply = u60MAX.sub(new BN(1));

    // Supply max amount first
    await setup.operate(
      setup.mockProtocol,
      maxSupply,
      new BN(0),
      MintKeys.USDC,
      setup.alice
    );

    // Not Simulating total amounts to be > max (this would need storage manipulation in Solana)
    // For now, just test that withdraw works when at limit
    const withdrawAmount = u60MAX.div(new BN(2));

    // Expect withdraw to work
    await setup.operate(
      setup.mockProtocol,
      withdrawAmount.neg(), // negative for withdraw
      new BN(0),
      MintKeys.USDC,
      setup.alice
    );
  });

  it("Should test: operate_RevertValueOverflowTotalSupplyInterestFree", async () => {
    const initialSupply = new BN(1e6);

    // Supply max amount first with interest-free protocol
    await setup.operate(
      setup.mockProtocolInterestFree,
      initialSupply,
      new BN(0),
      MintKeys.USDC,
      setup.alice
    );

    // Try to supply above max and expect revert
    expect(
      await setup.expectRevert(
        "USER_MODULE_VALUE_OVERFLOW_TOTAL_SUPPLY",
        setup.operate.bind(setup),
        setup.mockProtocolInterestFree,
        i64MAX.sub(initialSupply),
        new BN(0),
        MintKeys.USDC,
        setup.alice
      )
    ).to.be.true;
  });

  it("Should test: operate_RevertValueOverflowTotalBorrowWithInterest", async () => {
    // Mint huge amount for testing
    // Note: In Solana, you'd need to mint to the test account

    // Increase borrow limits
    const borrowConfig: UpdateUserBorrowConfigParams = {
      mint: MintKeys.USDC,
      newBorrowConfig: {
        user: setup.mockProtocol.publicKey,
        token: MintInfo.getMint(MintKeys.USDC),
        mode: 1, // with interest
        expandPercent: new BN(0),
        expandDuration: new BN(1),
        baseDebtCeiling: u60MAX.add(new BN(1)),
        maxDebtCeiling: u60MAX.add(new BN(1)),
      },
    };

    await setup.updateUserBorrowConfig([borrowConfig]);

    const maxAmount = u60MAX;

    // Supply max
    await setup.operate(
      setup.mockProtocol,
      maxAmount.sub(new BN(1)), // 1152921504606846974
      new BN(0),
      MintKeys.USDC,
      setup.alice
    );

    // Borrow max.div(new BN(2))
    await setup.operate(
      setup.mockProtocol,
      new BN(0),
      maxAmount.div(new BN(2)), // 576460752303423487
      MintKeys.USDC,
      setup.alice
    );

    // Try to borrow above max and expect revert
    expect(
      await setup.expectRevert(
        "USER_MODULE_VALUE_OVERFLOW_TOTAL_BORROW",
        setup.operate.bind(setup),
        setup.mockProtocol,
        new BN(0),
        maxAmount.div(new BN(2)).add(new BN(2)), // This will make total borrow to be just above current_borrow_limit, but below max_cap_amount
        MintKeys.USDC,
        setup.alice
      )
    ).to.be.true;
  });

  it("Should test: operate_PaybackWhenAboveTotalBorrowWithInterestLimit", async () => {
    // Similar to above but test payback functionality
    const borrowConfig: UpdateUserBorrowConfigParams = {
      mint: MintKeys.USDC,
      newBorrowConfig: {
        user: setup.mockProtocol.publicKey,
        token: MintInfo.getMint(MintKeys.USDC),
        mode: 1,
        expandPercent: new BN(0),
        expandDuration: new BN(1),
        baseDebtCeiling: u60MAX.add(new BN(1)),
        maxDebtCeiling: u60MAX.add(new BN(1)),
      },
    };

    await setup.updateUserBorrowConfig([borrowConfig]);

    const maxAmount = u60MAX.sub(new BN(10e6));

    // Supply and borrow max
    await setup.operate(
      setup.mockProtocol,
      maxAmount,
      new BN(0),
      MintKeys.USDC,
      setup.alice
    );

    await setup.operate(
      setup.mockProtocol,
      new BN(0),
      u60MAX.sub(new BN(10e6)), // some buffer for rounding
      MintKeys.USDC,
      setup.alice
    );

    // Expect payback to work
    const paybackAmount = new BN(10e6);

    await setup.operate(
      setup.mockProtocol,
      new BN(0),
      paybackAmount.neg(), // negative for payback
      MintKeys.USDC,
      setup.alice
    );
  });

  it("Should test: operate_RevertValueOverflowTotalBorrowInterestFree", async () => {
    const borrowConfig: UpdateUserBorrowConfigParams = {
      mint: MintKeys.USDC,
      newBorrowConfig: {
        user: setup.mockProtocolInterestFree.publicKey,
        token: MintInfo.getMint(MintKeys.USDC),
        mode: 0, // interest free
        expandPercent: new BN(0),
        expandDuration: new BN(1),
        baseDebtCeiling: u60MAX.add(new BN(1)),
        maxDebtCeiling: u60MAX.add(new BN(1)),
      },
    };

    await setup.updateUserBorrowConfig([borrowConfig]);

    const maxAmount = u60MAX.sub(new BN(10e6));

    // Supply max
    await setup.operate(
      setup.mockProtocolInterestFree,
      maxAmount,
      new BN(0),
      MintKeys.USDC,
      setup.alice
    );

    // Borrow max
    await setup.operate(
      setup.mockProtocolInterestFree,
      new BN(0),
      maxAmount,
      MintKeys.USDC,
      setup.alice
    );

    // Try to borrow above max and expect revert
    expect(
      await setup.expectRevert(
        "USER_MODULE_VALUE_OVERFLOW_TOTAL_BORROW",
        setup.operate.bind(setup),
        setup.mockProtocolInterestFree,
        new BN(0),
        new BN(10e6).add(new BN(1)),
        MintKeys.USDC,
        setup.alice
      )
    ).to.be.true;
  });
});

describe("LiquidityUserModuleOperateAmountInsufficientTests", () => {
  let setup: LiquidityBaseSetup;
  const u64MAX = new BN("18446744073709551615");
  const u60MAX = new BN("1152921504606846975");

  afterEach(async () => {
    setup.logComputeBudget();
  });

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";

    setup = new LiquidityBaseSetup();
    await setup.setup();

    // manually set user allowances to 1 for all mints
    // Set withdraw config with actual limits
    const supplyConfig: UpdateUserSupplyConfigParams = {
      mint: MintKeys.USDC,
      newSupplyConfig: {
        user: setup.mockProtocol.publicKey,
        token: MintInfo.getMint(MintKeys.USDC),
        mode: 1, // with interest
        expandPercent: new BN(1e4), // 100%
        expandDuration: new BN(1), // every second
        baseWithdrawalLimit: u64MAX,
      },
    };

    await setup.updateUserSupplyConfig([supplyConfig]);
  });

  // Test deprecated, as we are not using bigNumber anymore
  it("Should test: operate_RevertOperateAmountInsufficientWhenUserSupply", async () => {
    // Supply large amount first
    // await setup.operate(
    //   setup.mockProtocol,
    //   u64MAX.sub(new BN(1e3)), // 1e28
    //   new BN(0),
    //   MintKeys.USDC,
    //   setup.alice
    // );
    // // Try to supply insufficient amount and expect revert
    // // 1e28 - big math precision ~1e17 -> 1e11 will be too small
    // expect(
    //   await setup.expectRevert(
    //     "USER_MODULE_OPERATE_AMOUNT_INSUFFICIENT",
    //     setup.operate.bind(setup),
    //     setup.mockProtocol,
    //     new BN(1e2), // 1e11
    //     new BN(0),
    //     MintKeys.USDC,
    //     setup.alice
    //   )
    // ).to.be.true;
    // Not able to test it, as there is restriction on totalSupply check on token transfers
    // // Expect deposit from other user (protocol) to work
    // await setup.operate(
    //   setup.mockProtocolWithInterest,
    //   new BN(1e2), // 1e6
    //   new BN(0),
    //   MintKeys.USDC,
    //   setup.bob
    // );
  });

  it("Should test: operate_OperateAmountWorksForWithdraw", async () => {
    // Supply large amount first
    await setup.operate(
      setup.mockProtocol,
      u60MAX.sub(new BN(1e3)), // 1e28
      new BN(0),
      MintKeys.USDC,
      setup.alice
    );

    await setup.operate(
      setup.mockProtocol,
      new BN(-10), // withdraw 1
      new BN(0),
      MintKeys.USDC,
      setup.alice
    );

    await setup.operate(
      setup.mockProtocol,
      new BN(-100), // withdraw 100
      new BN(0),
      MintKeys.USDC,
      setup.alice
    );
  });

  // it("Should test: operate_RevertOperateAmountInsufficientWhenTotalSupply", async () => {
  //   // Supply large amount first
  //   await setup.operate(
  //     setup.mockProtocol,
  //     u64MAX.sub(new BN(1e3)), // 1e28
  //     new BN(0),
  //     MintKeys.USDC,
  //     setup.alice
  //   );

  //   // Expect deposit to revert if operate amount is too small
  //   expect(
  //     await setup.expectRevert(
  //       "USER_MODULE_OPERATE_AMOUNT_INSUFFICIENT",
  //       setup.operate.bind(setup),
  //       setup.mockProtocolWithInterest,
  //       new BN("100000000000"), // 1e11
  //       new BN(0),
  //       MintKeys.USDC,
  //       setup.alice
  //     )
  //   ).to.be.true;

  //   // Bigger amount will work
  //   await setup.operate(
  //     setup.mockProtocolWithInterest,
  //     new BN("1000000000000"), // 1e12
  //     new BN(0),
  //     MintKeys.USDC,
  //     setup.alice
  //   );
  // });

  // it("Should test: operate_OperateAmountWorksForBorrow", async () => {
  //   // Increase borrow limits
  //   const borrowConfigs: BORROW_CONFIG[] = [
  //     {
  //       mint: MintKeys.USDC,
  //       newBorrowConfig: {
  //         user: setup.mockProtocolWithInterest.publicKey,
  //         token: MintInfo.getMint(MintKeys.USDC),
  //         mode: 1,
  //         expandPercent: new BN(0),
  //         expandDuration: new BN(1),
  //         baseDebtCeiling: new BN("1000000000000000000000000000000000"), // 1e32
  //         maxDebtCeiling: new BN("10000000000000000000000000000000000"), // 1e33
  //       },
  //     },
  //     {
  //       mint: MintKeys.USDC,
  //       newBorrowConfig: {
  //         user: setup.mockProtocol.publicKey,
  //         token: MintInfo.getMint(MintKeys.USDC),
  //         mode: 1,
  //         expandPercent: new BN(0),
  //         expandDuration: new BN(1),
  //         baseDebtCeiling: new BN("1000000000000000000000000000000000"), // 1e32
  //         maxDebtCeiling: new BN("10000000000000000000000000000000000"), // 1e33
  //       },
  //     },
  //   ];
  //   await setup.updateUserBorrowConfig(borrowConfigs);

  //   // Supply large amount
  //   await setup.operate(
  //     setup.mockProtocol,
  //     new BN("1000000000000000000000000000000"), // 1e30
  //     new BN(0),
  //     MintKeys.USDC,
  //     setup.alice
  //   );

  //   // Borrow
  //   await setup.operate(
  //     setup.mockProtocol,
  //     new BN(0),
  //     new BN("100000000000000000000000000000"), // 1e28
  //     MintKeys.USDC,
  //     setup.alice
  //   );

  //   // Borrow is always rounded up so it ALWAYS triggers a change in user borrow amount even if operate amount is only 1
  //   await setup.operate(
  //     setup.mockProtocol,
  //     new BN(0),
  //     new BN(1),
  //     MintKeys.USDC,
  //     setup.alice
  //   );

  //   // Expect borrow from other user (protocol) to work
  //   await setup.operate(
  //     setup.mockProtocolWithInterest,
  //     new BN(0),
  //     new BN("100000000000"), // 1e11
  //     MintKeys.USDC,
  //     setup.alice
  //   );
  // });
});
