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

const BASE_WITHDRAW_LIMIT = new BN(0.5 * LAMPORTS_PER_SOL);
const DEFAULT_SUPPLY_AMOUNT = new BN(1 * LAMPORTS_PER_SOL);
const DEFAULT_BORROW_AMOUNT = new BN(0.5 * LAMPORTS_PER_SOL);
const BASE_BORROW_LIMIT = new BN(1 * LAMPORTS_PER_SOL);
const MAX_BORROW_LIMIT = new BN(10 * LAMPORTS_PER_SOL);

for (const interestRate of [0, 1])
  describe(`LiquidityUserModuleWithdrawLimitTestsWith${
    interestRate === 0 ? "InterestFree" : "WithInterest"
  }`, () => {
    let resolver: FluidLiquidityResolver;
    let setup: LiquidityBaseSetup;

    afterEach(async () => {
      setup.logComputeBudget();
    });

    async function assertWithdrawalLimits(
      supply: BN,
      withdrawalLimit: BN,
      withdrawableUntilLimit: BN,
      withdrawable: BN
    ) {
      const { userSupplyData } = await resolver.getUserSupplyData(
        setup.mockProtocol.publicKey,
        MintKeys.USDC
      );

      expect(userSupplyData.supply.toString()).to.equal(supply.toString());
      expect(userSupplyData.withdrawalLimit.toString()).to.equal(
        withdrawalLimit.toString()
      );
      expect(userSupplyData.withdrawableUntilLimit.toString()).to.equal(
        withdrawableUntilLimit.toString()
      );
      expect(userSupplyData.withdrawable.toString()).to.equal(
        withdrawable.toString()
      );

      if (
        userSupplyData.supply.gt(new BN(0)) &&
        userSupplyData.withdrawable.lt(userSupplyData.supply) &&
        userSupplyData.withdrawable.add(new BN(1)).gt(new BN(10))
      ) {
        // Assert reverts if withdrawing more
        expect(
          await setup.expectRevert(
            "USER_MODULE_WITHDRAWAL_LIMIT_REACHED",
            setup.withdraw.bind(setup),
            setup.mockProtocol,
            userSupplyData.withdrawable.add(new BN(1)),
            MintKeys.USDC,
            setup.alice
          )
        ).to.be.true;
      }

      if (userSupplyData.withdrawable.gt(new BN(0))) {
        // Assert withdrawing exactly works
        await setup.withdraw(
          setup.mockProtocol,
          userSupplyData.withdrawable,
          MintKeys.USDC,
          setup.alice
        );
        // Supply it back
        await setup.deposit(
          setup.mockProtocol,
          userSupplyData.withdrawable,
          MintKeys.USDC,
          setup.alice
        );
      }
    }

    beforeEach(async () => {
      process.env.TEST_MODE_JEST = "true";

      setup = new LiquidityBaseSetup();
      await setup.setup();

      resolver = new FluidLiquidityResolver(
        setup.admin,
        setup.liquidity,
        setup.client
      );

      // Set withdraw config with actual limits
      const supplyConfig: UpdateUserSupplyConfigParams = {
        mint: MintKeys.USDC,
        newSupplyConfig: {
          user: setup.mockProtocol.publicKey,
          token: MintInfo.getMint(MintKeys.USDC),
          mode: interestRate, // with interest
          expandPercent: new BN(setup.DEFAULT_EXPAND_WITHDRAWAL_LIMIT_PERCENT),
          expandDuration: new BN(
            setup.DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION
          ),
          baseWithdrawalLimit: BASE_WITHDRAW_LIMIT,
        },
      };

      await setup.updateUserSupplyConfig([supplyConfig]);

      const borrowConfig: UpdateUserBorrowConfigParams = {
        mint: MintKeys.USDC,
        newBorrowConfig: {
          user: setup.mockProtocol.publicKey,
          token: MintInfo.getMint(MintKeys.USDC),
          mode: interestRate, // with interest
          expandPercent: new BN(setup.DEFAULT_EXPAND_WITHDRAWAL_LIMIT_PERCENT),
          expandDuration: new BN(
            setup.DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION
          ),
          baseDebtCeiling: BASE_BORROW_LIMIT,
          maxDebtCeiling: MAX_BORROW_LIMIT,
        },
      };

      await setup.updateUserBorrowConfig([borrowConfig]);

      // Alice supplies liquidity
      await setup.deposit(
        setup.mockProtocol,
        DEFAULT_SUPPLY_AMOUNT,
        MintKeys.USDC,
        setup.alice
      );
    });

    it("Should test: operate_WithdrawExactToLimit", async () => {
      const balanceBefore = await setup.balanceOf(
        setup.alice.publicKey,
        MintInfo.getMint(MintKeys.USDC)
      );

      // Withdraw exactly to withdraw limit. It is not base withdraw limit but actually the fully expanded
      // limit from supplied amount of 1 SOL so 1 SOL - 20% = 0.8 SOL
      // so we can withdraw exactly 0.2 SOL
      const withdrawAmount = new BN(0.2 * LAMPORTS_PER_SOL);

      await setup.withdraw(
        setup.mockProtocol,
        withdrawAmount,
        MintKeys.USDC,
        setup.alice
      );

      const balanceAfter = await setup.balanceOf(
        setup.alice.publicKey,
        MintInfo.getMint(MintKeys.USDC)
      );

      // Alice should have received the withdraw amount
      expect(balanceAfter.toString()).to.equal(
        balanceBefore.add(withdrawAmount).toString()
      );
    });

    it("Should test: operate_RevertIfWithdrawLimitReached", async () => {
      const { userSupplyData } = await resolver.getUserSupplyData(
        setup.mockProtocol.publicKey,
        MintKeys.USDC
      );
      expect(userSupplyData.withdrawalLimit.toString()).to.equal(
        new BN(0.8 * LAMPORTS_PER_SOL).toString()
      );

      // Withdraw limit is not base withdraw limit but actually the fully expanded
      // limit from supplied amount of 1 SOL so 1 SOL - 20% = 0.8 SOL.
      // so we can withdraw exactly 0.2 SOL
      const withdrawAmount = new BN(0.2 * LAMPORTS_PER_SOL).add(new BN(1));

      expect(
        await setup.expectRevert(
          "USER_MODULE_WITHDRAWAL_LIMIT_REACHED",
          setup.withdraw.bind(setup),
          setup.mockProtocol,
          withdrawAmount,
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;
    });

    it("Should test: operate_RevertIfWithdrawLimitReachedForWithdrawAndBorrow", async () => {
      const withdrawAmount = new BN(0.2 * LAMPORTS_PER_SOL).add(new BN(1));

      // This test would require implementing a combined operate function
      // that can do both withdraw and borrow in a single transaction
      expect(
        await setup.expectRevert(
          "USER_MODULE_WITHDRAWAL_LIMIT_REACHED",
          setup.operate.bind(setup),
          setup.mockProtocol,
          withdrawAmount.mul(new BN(-1)), // negative for withdraw
          new BN(0.1 * LAMPORTS_PER_SOL), // positive for borrow
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;
    });

    it("Should test: operate_RevertIfWithdrawLimitReachedForWithdrawAndPayback", async () => {
      await setup.borrow(
        setup.mockProtocol,
        DEFAULT_BORROW_AMOUNT,
        MintKeys.USDC,
        setup.alice
      );

      const withdrawAmount = new BN(0.2 * LAMPORTS_PER_SOL).add(new BN(1));

      // This test would require implementing a combined operate function
      // that can do both withdraw and payback in a single transaction
      expect(
        await setup.expectRevert(
          "USER_MODULE_WITHDRAWAL_LIMIT_REACHED",
          setup.operate.bind(setup),
          setup.mockProtocol,
          withdrawAmount.mul(new BN(-1)), // negative for withdraw
          new BN(0.1 * LAMPORTS_PER_SOL).mul(new BN(-1)), // negative for payback
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;
    });

    it("Should test: operate_WithdrawalLimitInstantlyExpandedOnDeposit", async () => {
      // Alice supplies liquidity
      await setup.deposit(
        setup.mockProtocol,
        DEFAULT_SUPPLY_AMOUNT.mul(new BN(10)),
        MintKeys.USDC,
        setup.alice
      );

      const balanceBefore = await setup.balanceOf(
        setup.alice.publicKey,
        MintInfo.getMint(MintKeys.USDC)
      );

      // Withdraw exactly to withdraw limit. It is not base withdraw limit but actually the fully expanded
      // limit from supplied amount of 11 SOL so 11 SOL - 20% = 8.8 SOL
      // so we can withdraw exactly 2.2 SOL
      const withdrawAmount = new BN(2.2 * LAMPORTS_PER_SOL);

      const { userSupplyData } = await resolver.getUserSupplyData(
        setup.mockProtocol.publicKey,
        MintKeys.USDC
      );
      expect(userSupplyData.withdrawalLimit.toString()).to.equal(
        new BN(8.8 * LAMPORTS_PER_SOL).toString()
      );

      // Try to withdraw more and expect revert
      expect(
        await setup.expectRevert(
          "USER_MODULE_WITHDRAWAL_LIMIT_REACHED",
          setup.withdraw.bind(setup),
          setup.mockProtocol,
          withdrawAmount.add(new BN(1)),
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;

      // Expect exact withdrawal limit amount to work
      await setup.withdraw(
        setup.mockProtocol,
        withdrawAmount,
        MintKeys.USDC,
        setup.alice
      );

      const balanceAfter = await setup.balanceOf(
        setup.alice.publicKey,
        MintInfo.getMint(MintKeys.USDC)
      );

      // Alice should have received the withdraw amount
      expect(balanceAfter.toString()).to.equal(
        balanceBefore.add(withdrawAmount).toString()
      );
    });

    it("Should test: operate_WithdrawalLimitShrinkedOnWithdraw", async () => {
      // Withdraw 0.1 out of the 0.2 SOL possible to withdraw
      const withdrawAmount = new BN(0.1 * LAMPORTS_PER_SOL);

      await setup.withdraw(
        setup.mockProtocol,
        withdrawAmount,
        MintKeys.USDC,
        setup.alice
      );

      const balanceBefore = await setup.balanceOf(
        setup.alice.publicKey,
        MintInfo.getMint(MintKeys.USDC)
      );

      // Try to withdraw more than rest available (0.1 SOL) and expect revert
      expect(
        await setup.expectRevert(
          "USER_MODULE_WITHDRAWAL_LIMIT_REACHED",
          setup.withdraw.bind(setup),
          setup.mockProtocol,
          withdrawAmount.add(new BN(1)),
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;

      // Expect exact withdrawal limit amount to work
      await setup.withdraw(
        setup.mockProtocol,
        withdrawAmount,
        MintKeys.USDC,
        setup.alice
      );

      const balanceAfter = await setup.balanceOf(
        setup.alice.publicKey,
        MintInfo.getMint(MintKeys.USDC)
      );

      // Alice should have received the withdraw amount
      expect(balanceAfter.toString()).to.equal(
        balanceBefore.add(withdrawAmount).toString()
      );
    });

    it("Should test: operate_WithdrawalLimitExpansion", async () => {
      // Withdraw 0.1 out of the 0.2 SOL possible to withdraw
      const withdrawAmount = new BN(0.1 * LAMPORTS_PER_SOL);

      await setup.withdraw(
        setup.mockProtocol,
        withdrawAmount,
        MintKeys.USDC,
        setup.alice
      );

      // Try to withdraw more than rest available (0.1 SOL) and expect revert
      expect(
        await setup.expectRevert(
          "USER_MODULE_WITHDRAWAL_LIMIT_REACHED",
          setup.withdraw.bind(setup),
          setup.mockProtocol,
          withdrawAmount.add(new BN(1)),
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;

      // Full expansion of 0.9 SOL is at 0.72 SOL
      // but we are starting at 0.8 SOL as last withdrawal limit.
      // so expanding total 0.18 SOL, 10% of that is 0.018 SOL.
      // so after 10% expansion time, the limit should be 0.8 - 0.018 = 0.782 SOL
      setup.warp(setup.DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION / 10);

      const { userSupplyData } = await resolver.getUserSupplyData(
        setup.mockProtocol.publicKey,
        MintKeys.USDC
      );

      expect(userSupplyData.withdrawalLimit.toString()).to.equal(
        new BN(0.782 * LAMPORTS_PER_SOL).toString()
      );

      const balanceBefore = await setup.balanceOf(
        setup.alice.publicKey,
        MintInfo.getMint(MintKeys.USDC)
      );

      // Expect withdraw more than limit to revert
      const newWithdrawAmount = new BN(0.9 * LAMPORTS_PER_SOL).sub(
        new BN(0.782 * LAMPORTS_PER_SOL)
      );

      expect(
        await setup.expectRevert(
          "USER_MODULE_WITHDRAWAL_LIMIT_REACHED",
          setup.withdraw.bind(setup),
          setup.mockProtocol,
          newWithdrawAmount.add(new BN(1)),
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;

      // Expect exact withdrawal limit amount to work
      await setup.withdraw(
        setup.mockProtocol,
        newWithdrawAmount,
        MintKeys.USDC,
        setup.alice
      );

      const balanceAfter = await setup.balanceOf(
        setup.alice.publicKey,
        MintInfo.getMint(MintKeys.USDC)
      );

      // Alice should have received the withdraw amount
      expect(balanceAfter.toString()).to.equal(
        balanceBefore.add(newWithdrawAmount).toString()
      );
    });

    it("Should test: operate_WithdrawalLimitSequence", async () => {
      const baseLimit = new BN(5 * LAMPORTS_PER_SOL);

      // Set withdraw config with actual limits
      const supplyConfig: UpdateUserSupplyConfigParams = {
        mint: MintKeys.USDC,
        newSupplyConfig: {
          user: setup.mockProtocol.publicKey,
          token: MintInfo.getMint(MintKeys.USDC),
          mode: interestRate, // with interest
          expandPercent: new BN(setup.DEFAULT_EXPAND_WITHDRAWAL_LIMIT_PERCENT), // 20%
          expandDuration: new BN(
            setup.DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION
          ), // 2 days
          baseWithdrawalLimit: baseLimit,
        },
      };
      await setup.updateUserSupplyConfig([supplyConfig]);

      // Withdraw supplied from setUp()
      await setup.withdraw(
        setup.mockProtocol,
        DEFAULT_SUPPLY_AMOUNT.div(new BN(5)),
        MintKeys.USDC,
        setup.alice
      );
      await setup.withdraw(
        setup.mockProtocol,
        DEFAULT_SUPPLY_AMOUNT.div(new BN(5)).mul(new BN(4)),
        MintKeys.USDC,
        setup.alice
      );

      // Seed deposit
      await setup.deposit(
        setup.mockProtocolInterestFree,
        DEFAULT_SUPPLY_AMOUNT,
        MintKeys.USDC,
        setup.alice
      );

      await assertWithdrawalLimits(new BN(0), new BN(0), new BN(0), new BN(0));

      // console.log("--------- 1. action: deposit of 1 SOL ---------");

      await setup.deposit(
        setup.mockProtocol,
        DEFAULT_SUPPLY_AMOUNT,
        MintKeys.USDC,
        setup.alice
      );

      await assertWithdrawalLimits(
        new BN(1 * LAMPORTS_PER_SOL), // user supply
        new BN(0), // withdrawalLimit
        new BN(1 * LAMPORTS_PER_SOL), // withdrawableUntilLimit
        new BN(1 * LAMPORTS_PER_SOL) // withdrawable
      );

      // console.log(
      //   "--------- 2. action: deposit of 4.5 SOL to 5.5 SOL total ---------"
      // );

      await setup.deposit(
        setup.mockProtocol,
        new BN(4.5 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      await assertWithdrawalLimits(
        new BN(5.5 * LAMPORTS_PER_SOL), // user supply
        new BN(4.4 * LAMPORTS_PER_SOL), // withdrawalLimit. fully expanded immediately because of deposits only
        new BN(1.1 * LAMPORTS_PER_SOL), // withdrawableUntilLimit
        new BN(1.1 * LAMPORTS_PER_SOL) // withdrawable
      );

      // console.log(
      //   "--------- 3. action: deposit of 0.5 SOL to 6 SOL total ---------"
      // );

      await setup.deposit(
        setup.mockProtocol,
        new BN(0.5 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      await assertWithdrawalLimits(
        new BN(6 * LAMPORTS_PER_SOL), // user supply
        new BN(4.8 * LAMPORTS_PER_SOL), // withdrawalLimit. fully expanded immediately because of deposits only
        new BN(1.2 * LAMPORTS_PER_SOL), // withdrawableUntilLimit
        new BN(1.2 * LAMPORTS_PER_SOL) // withdrawable
      );

      // console.log(
      //   "--------- 4. action: withdraw 0.01 SOL to total 5.99 ---------"
      // );

      await setup.withdraw(
        setup.mockProtocol,
        new BN(0.01 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      await assertWithdrawalLimits(
        new BN(5.99 * LAMPORTS_PER_SOL), // user supply
        new BN(4.8 * LAMPORTS_PER_SOL), // withdrawalLimit. stays the same, expansion start point
        new BN(1.19 * LAMPORTS_PER_SOL), // withdrawableUntilLimit
        new BN(1.19 * LAMPORTS_PER_SOL) // withdrawable
      );

      // Time warp to full expansion
      // console.log("--------- TIME WARP to full expansion ---------");
      setup.warp(2 * 24 * 60 * 60); // 2 days

      await assertWithdrawalLimits(
        new BN(5.99 * LAMPORTS_PER_SOL), // user supply
        new BN(4.792 * LAMPORTS_PER_SOL), // withdrawalLimit. fully expanded from 5.99
        new BN(1.198 * LAMPORTS_PER_SOL), // withdrawableUntilLimit
        new BN(1.198 * LAMPORTS_PER_SOL) // withdrawable
      );

      // console.log(
      //   "--------- 5. action: deposit of 1.01 SOL to 7 SOL total ---------"
      // );

      await setup.deposit(
        setup.mockProtocol,
        new BN(1.01 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      await assertWithdrawalLimits(
        new BN(7 * LAMPORTS_PER_SOL), // user supply
        new BN(5.6 * LAMPORTS_PER_SOL), // withdrawalLimit. fully expanded immediately because deposit
        new BN(1.4 * LAMPORTS_PER_SOL), // withdrawableUntilLimit
        new BN(1.4 * LAMPORTS_PER_SOL) // withdrawable
      );

      // console.log(
      //   "--------- 6. action: withdraw 1.4 SOL down to 5.6 total ---------"
      // );

      await setup.withdraw(
        setup.mockProtocol,
        new BN(1.4 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      await assertWithdrawalLimits(
        new BN(5.6 * LAMPORTS_PER_SOL), // user supply
        new BN(5.6 * LAMPORTS_PER_SOL), // withdrawalLimit
        new BN(0), // withdrawableUntilLimit
        new BN(0) // withdrawable
      );

      // console.log(
      //   "--------- TIME WARP 20% of duration (20% of 20% expanded, 0.224 down to 5.376) ---------"
      // );
      setup.warp((2 * 24 * 60 * 60) / 5); // 20% of duration

      await assertWithdrawalLimits(
        new BN(5.6 * LAMPORTS_PER_SOL), // user supply
        new BN(5.376 * LAMPORTS_PER_SOL), // withdrawalLimit
        new BN(0.224 * LAMPORTS_PER_SOL), // withdrawableUntilLimit
        new BN(0.224 * LAMPORTS_PER_SOL) // withdrawable
      );

      // console.log(
      //   "--------- 7. action: withdraw 0.1 SOL down to 5.5 total ---------"
      // );

      await setup.withdraw(
        setup.mockProtocol,
        new BN(0.1 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      await assertWithdrawalLimits(
        new BN(5.5 * LAMPORTS_PER_SOL), // user supply
        new BN(5.376 * LAMPORTS_PER_SOL), // withdrawalLimit
        new BN(0.124 * LAMPORTS_PER_SOL), // withdrawableUntilLimit
        new BN(0.124 * LAMPORTS_PER_SOL) // withdrawable
      );

      // Time warp to full expansion
      // console.log("--------- TIME WARP to full expansion (4.4 SOL) ---------");
      setup.warp(2 * 24 * 60 * 60); // 2 days

      await assertWithdrawalLimits(
        new BN(5.5 * LAMPORTS_PER_SOL), // user supply
        new BN(4.4 * LAMPORTS_PER_SOL), // withdrawalLimit
        new BN(1.1 * LAMPORTS_PER_SOL), // withdrawableUntilLimit
        new BN(1.1 * LAMPORTS_PER_SOL) // withdrawable
      );

      // console.log(
      //   "--------- 8. action: withdraw 0.51 SOL down to 4.99 total ---------"
      // );

      await setup.withdraw(
        setup.mockProtocol,
        new BN(0.51 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      await assertWithdrawalLimits(
        new BN(4.99 * LAMPORTS_PER_SOL), // user supply
        new BN(0), // withdrawalLimit. becomes 0 as below base limit
        new BN(4.99 * LAMPORTS_PER_SOL), // withdrawableUntilLimit
        new BN(4.99 * LAMPORTS_PER_SOL) // withdrawable
      );

      //  console.log(
      //   "--------- 9. action: withdraw 4.99 SOL down to 0 total ---------"
      // );

      await setup.withdraw(
        setup.mockProtocol,
        new BN(4.99 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      await assertWithdrawalLimits(
        new BN(0), // user supply
        new BN(0), // withdrawalLimit
        new BN(0), // withdrawableUntilLimit
        new BN(0) // withdrawable
      );
    });

    it("Should test: operate_WhenWithdrawalLimitExpandPercentIncreased", async () => {
      // Alice supplies liquidity
      await setup.deposit(
        setup.mockProtocol,
        DEFAULT_SUPPLY_AMOUNT.mul(new BN(10)),
        MintKeys.USDC,
        setup.alice
      );

      // Withdraw exactly to withdraw limit. It is not base withdraw limit but actually the fully expanded
      // limit from supplied amount of 11 SOL so 11 SOL - 20% = 8.8 SOL
      // so we can withdraw exactly 2.2 SOL
      await assertWithdrawalLimits(
        new BN(11 * LAMPORTS_PER_SOL),
        new BN(8.8 * LAMPORTS_PER_SOL),
        new BN(2.2 * LAMPORTS_PER_SOL),
        new BN(2.2 * LAMPORTS_PER_SOL)
      );

      // Case increase normal when was fully expanded
      const supplyConfig: UpdateUserSupplyConfigParams = {
        mint: MintKeys.USDC,
        newSupplyConfig: {
          user: setup.mockProtocol.publicKey,
          token: MintInfo.getMint(MintKeys.USDC),
          mode: interestRate, // with interest
          expandPercent: new BN(30 * 1e2), // increased from 20% to 30%
          expandDuration: new BN(
            setup.DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION
          ),
          baseWithdrawalLimit: BASE_WITHDRAW_LIMIT,
        },
      };
      await setup.updateUserSupplyConfig([supplyConfig]);

      // After increase, timestamp is still from last interaction so 0% has elapsed so it is still the old limit
      await assertWithdrawalLimits(
        new BN(11 * LAMPORTS_PER_SOL),
        new BN(8.8 * LAMPORTS_PER_SOL),
        new BN(2.2 * LAMPORTS_PER_SOL),
        new BN(2.2 * LAMPORTS_PER_SOL)
      );

      // Let 10% expand
      setup.warp(setup.DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION / 10);

      // Limit from supplied amount of 11 SOL so 11 SOL - 30% = 7.7 SOL
      // so we can withdraw exactly 3.3 SOL. 10% of that is 0.33 SOL so amount should be:
      await assertWithdrawalLimits(
        new BN(11 * LAMPORTS_PER_SOL),
        new BN(8.47 * LAMPORTS_PER_SOL),
        new BN(2.53 * LAMPORTS_PER_SOL),
        new BN(2.53 * LAMPORTS_PER_SOL)
      );

      // Let fully expand
      setup.warp(setup.DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION);

      await assertWithdrawalLimits(
        new BN(11 * LAMPORTS_PER_SOL),
        new BN(7.7 * LAMPORTS_PER_SOL),
        new BN(3.3 * LAMPORTS_PER_SOL),
        new BN(3.3 * LAMPORTS_PER_SOL)
      );

      await setup.withdraw(
        setup.mockProtocol,
        new BN(2.3 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      await assertWithdrawalLimits(
        new BN(8.7 * LAMPORTS_PER_SOL),
        new BN(7.7 * LAMPORTS_PER_SOL),
        new BN(1 * LAMPORTS_PER_SOL),
        new BN(1 * LAMPORTS_PER_SOL)
      );
    });

    it("Should test: operate_WhenWithdrawalLimitExpandPercentDecreased", async () => {
      // Alice supplies liquidity
      await setup.deposit(
        setup.mockProtocol,
        DEFAULT_SUPPLY_AMOUNT.mul(new BN(10)),
        MintKeys.USDC,
        setup.alice
      );

      // Withdraw exactly to withdraw limit. It is not base withdraw limit but actually the fully expanded
      // limit from supplied amount of 11 SOL so 11 SOL - 20% = 8.8 SOL
      // so we can withdraw exactly 2.2 SOL
      await assertWithdrawalLimits(
        new BN(11 * LAMPORTS_PER_SOL),
        new BN(8.8 * LAMPORTS_PER_SOL),
        new BN(2.2 * LAMPORTS_PER_SOL),
        new BN(2.2 * LAMPORTS_PER_SOL)
      );

      // Case decrease normal when was fully expanded
      const supplyConfig: UpdateUserSupplyConfigParams = {
        mint: MintKeys.USDC,
        newSupplyConfig: {
          user: setup.mockProtocol.publicKey,
          token: MintInfo.getMint(MintKeys.USDC),
          mode: interestRate, // with interest
          expandPercent: new BN(10 * 1e2), // decreased from 20% to 10%
          expandDuration: new BN(
            setup.DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION
          ),
          baseWithdrawalLimit: BASE_WITHDRAW_LIMIT,
        },
      };
      await setup.updateUserSupplyConfig([supplyConfig]);

      // After decrease shrinking should be instant
      await assertWithdrawalLimits(
        new BN(11 * LAMPORTS_PER_SOL),
        new BN(9.9 * LAMPORTS_PER_SOL),
        new BN(1.1 * LAMPORTS_PER_SOL),
        new BN(1.1 * LAMPORTS_PER_SOL)
      );
    });
  });
