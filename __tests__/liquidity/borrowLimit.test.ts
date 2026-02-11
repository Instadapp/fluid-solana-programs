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

const BASE_BORROW_LIMIT = new BN(1 * LAMPORTS_PER_SOL);
const MAX_BORROW_LIMIT = new BN(10 * LAMPORTS_PER_SOL);
const DEFAULT_SUPPLY_AMOUNT = new BN(1 * LAMPORTS_PER_SOL);
const DEFAULT_BORROW_AMOUNT = new BN(0.5 * LAMPORTS_PER_SOL);

for (const interestRate of [0, 1])
  describe(`LiquidityUserModuleBorrowLimitTestsWith${
    interestRate === 0 ? "InterestFree" : "WithInterest"
  }`, () => {
    let resolver: FluidLiquidityResolver;
    let setup: LiquidityBaseSetup;

    async function assertBorrowLimits(
      borrow: BN,
      borrowLimit: BN,
      borrowableUntilLimit: BN,
      borrowable: BN,
      resetToBorrowAmount: BN
    ) {
      const { userBorrowData } = await resolver.getUserBorrowData(
        setup.mockProtocol.publicKey,
        MintKeys.USDC
      );

      // prettier-ignore
      {
        expect(userBorrowData.borrow.toNumber()).to.be.closeTo(borrow.toNumber(), 1e6);
        expect(userBorrowData.borrowLimit.toNumber()).to.be.closeTo(borrowLimit.toNumber(), 1e6);
        expect(userBorrowData.borrowableUntilLimit.toNumber()).to.be.closeTo(borrowableUntilLimit.toNumber(), 1e6);
        expect(userBorrowData.borrowable.toNumber()).to.be.closeTo(borrowable.toNumber(), 1e6);
      }

      // Assert reverts if borrowing more
      if (userBorrowData.borrowable.add(new BN(5)).gt(new BN(10))) {
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
      }

      if (userBorrowData.borrowable.gt(new BN(1e3))) {
        try {
          // Assert borrowing exactly works
          await setup.borrow(
            setup.mockProtocol,
            userBorrowData.borrowable,
            MintKeys.USDC,
            setup.alice
          );
        } catch {
          await setup.borrow(
            setup.mockProtocol,
            userBorrowData.borrowable.sub(new BN(1)),
            MintKeys.USDC,
            setup.alice
          );
        }

        // Payback
        const { userBorrowData: updatedUserBorrowData } =
          await resolver.getUserBorrowData(
            setup.mockProtocol.publicKey,
            MintKeys.USDC
          );

        await setup.payback(
          setup.mockProtocol,
          updatedUserBorrowData.borrow.sub(resetToBorrowAmount),
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

      // Set borrow config with actual limits
      const borrowConfig: UpdateUserBorrowConfigParams = {
        mint: MintKeys.USDC,
        newBorrowConfig: {
          user: setup.mockProtocol.publicKey,
          token: MintInfo.getMint(MintKeys.USDC),
          mode: interestRate,
          expandPercent: new BN(setup.DEFAULT_EXPAND_DEBT_CEILING_PERCENT),
          expandDuration: new BN(setup.DEFAULT_EXPAND_DEBT_CEILING_DURATION),
          baseDebtCeiling: BASE_BORROW_LIMIT,
          maxDebtCeiling: MAX_BORROW_LIMIT,
        },
      };

      await setup.updateUserBorrowConfig([borrowConfig]);

      const supplyConfig: UpdateUserSupplyConfigParams = {
        mint: MintKeys.USDC,
        newSupplyConfig: {
          user: setup.mockProtocol.publicKey,
          token: MintInfo.getMint(MintKeys.USDC),
          mode: interestRate,
          expandPercent: new BN(setup.DEFAULT_EXPAND_WITHDRAWAL_LIMIT_PERCENT),
          expandDuration: new BN(
            setup.DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION
          ),
          baseWithdrawalLimit: new BN(setup.DEFAULT_BASE_WITHDRAWAL_LIMIT),
        },
      };

      await setup.updateUserSupplyConfig([supplyConfig]);

      // Alice supplies liquidity
      await setup.deposit(
        setup.mockProtocol,
        DEFAULT_SUPPLY_AMOUNT,
        MintKeys.USDC,
        setup.alice
      );
    });

    afterEach(async () => {
      setup.logComputeBudget();
    });

    it("Should test: operate_BorrowExactToLimit", async () => {
      const balanceBefore = await setup.balanceOf(
        setup.alice.publicKey,
        MintInfo.getMint(MintKeys.USDC)
      );

      // Borrow exactly to base borrow limit
      await setup.borrow(
        setup.mockProtocol,
        BASE_BORROW_LIMIT,
        MintKeys.USDC,
        setup.alice
      );

      const balanceAfter = await setup.balanceOf(
        setup.alice.publicKey,
        MintInfo.getMint(MintKeys.USDC)
      );

      // Alice should have received the borrow amount
      expect(balanceAfter.toString()).to.equal(
        balanceBefore.add(BASE_BORROW_LIMIT).toString()
      );
    });

    it("Should test: operate_BorrowBaseAndMaxLimitVeryClose", async () => {
      // Alice supplies liquidity
      await setup.deposit(
        setup.mockProtocol,
        new BN(20 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      // Set borrow config
      const borrowConfig: UpdateUserBorrowConfigParams = {
        mint: MintKeys.USDC,
        newBorrowConfig: {
          user: setup.mockProtocol.publicKey,
          token: MintInfo.getMint(MintKeys.USDC),
          mode: interestRate,
          expandPercent: new BN(setup.DEFAULT_EXPAND_DEBT_CEILING_PERCENT),
          expandDuration: new BN(setup.DEFAULT_EXPAND_DEBT_CEILING_DURATION),
          baseDebtCeiling: new BN(9.9 * LAMPORTS_PER_SOL),
          maxDebtCeiling: new BN(10 * LAMPORTS_PER_SOL),
        },
      };
      setup.prank(setup.admin);
      await setup.updateUserBorrowConfig([borrowConfig]);

      // Assert borrow too much would fail
      expect(
        await setup.expectRevert(
          "USER_MODULE_BORROW_LIMIT_REACHED",
          setup.borrow.bind(setup),
          setup.mockProtocol,
          new BN(10.01 * LAMPORTS_PER_SOL),
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;

      // Assert borrow too much would fail
      expect(
        await setup.expectRevert(
          "USER_MODULE_BORROW_LIMIT_REACHED",
          setup.borrow.bind(setup),
          setup.mockProtocol,
          new BN(9.91 * LAMPORTS_PER_SOL),
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;

      // Borrow to base borrow limit
      await setup.borrow(
        setup.mockProtocol,
        new BN(9.9 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      // Assert borrow more would fail
      expect(
        await setup.expectRevert(
          "USER_MODULE_BORROW_LIMIT_REACHED",
          setup.borrow.bind(setup),
          setup.mockProtocol,
          new BN(0.03 * LAMPORTS_PER_SOL),
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;

      // After expansion
      setup.warp(2 * 24 * 60 * 60); // 2 days

      // Assert borrow too much would fail
      expect(
        await setup.expectRevert(
          "USER_MODULE_BORROW_LIMIT_REACHED",
          setup.borrow.bind(setup),
          setup.mockProtocol,
          new BN(0.12 * LAMPORTS_PER_SOL),
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;

      // Borrow to max
      await setup.borrow(
        setup.mockProtocol,
        new BN(0.1 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      // Assert borrow more would fail
      expect(
        await setup.expectRevert(
          "USER_MODULE_BORROW_LIMIT_REACHED",
          setup.borrow.bind(setup),
          setup.mockProtocol,
          new BN(0.03 * LAMPORTS_PER_SOL),
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;

      // After expansion
      setup.warp(2 * 24 * 60 * 60); // 2 days

      // Assert borrow more would fail
      expect(
        await setup.expectRevert(
          "USER_MODULE_BORROW_LIMIT_REACHED",
          setup.borrow.bind(setup),
          setup.mockProtocol,
          new BN(0.03 * LAMPORTS_PER_SOL),
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;
    });

    it("Should test: operate_BorrowExactToMaxLimitRoundedToAbove", async () => {
      // Set borrow config
      const borrowConfig: UpdateUserBorrowConfigParams = {
        mint: MintKeys.USDC,
        newBorrowConfig: {
          user: setup.mockProtocol.publicKey,
          token: MintInfo.getMint(MintKeys.USDC),
          mode: interestRate,
          expandPercent: new BN(setup.DEFAULT_EXPAND_DEBT_CEILING_PERCENT),
          expandDuration: new BN(setup.DEFAULT_EXPAND_DEBT_CEILING_DURATION),
          baseDebtCeiling: BASE_BORROW_LIMIT,
          maxDebtCeiling: BASE_BORROW_LIMIT, // max same as base
        },
      };
      await setup.updateUserBorrowConfig([borrowConfig]);

      const balanceBefore = await setup.balanceOf(
        setup.alice.publicKey,
        MintInfo.getMint(MintKeys.USDC)
      );

      // Borrow exactly to base borrow limit
      await setup.borrow(
        setup.mockProtocol,
        BASE_BORROW_LIMIT,
        MintKeys.USDC,
        setup.alice
      );

      const balanceAfter = await setup.balanceOf(
        setup.alice.publicKey,
        MintInfo.getMint(MintKeys.USDC)
      );

      // Alice should have received the borrow amount
      expect(balanceAfter.toString()).to.equal(
        balanceBefore.add(BASE_BORROW_LIMIT).toString()
      );

      // Get user borrow data
      const { userBorrowData } = await resolver.getUserBorrowData(
        setup.mockProtocol.publicKey,
        MintKeys.USDC
      );

      expect(userBorrowData.borrowLimit.toString()).to.equal(
        BASE_BORROW_LIMIT.toString()
      );
      expect(userBorrowData.maxBorrowLimit.toString()).to.equal(
        BASE_BORROW_LIMIT.toString()
      );
      expect(userBorrowData.borrowableUntilLimit.toString()).to.equal("0");
      expect(userBorrowData.borrowable.toString()).to.equal("0");

      // Assert any new borrow would fail
      expect(
        await setup.expectRevert(
          "USER_MODULE_BORROW_LIMIT_REACHED",
          setup.borrow.bind(setup),
          setup.mockProtocol,
          new BN(10),
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;

      expect(
        await setup.expectRevert(
          "USER_MODULE_BORROW_LIMIT_REACHED",
          setup.borrow.bind(setup),
          setup.mockProtocol,
          new BN(10),
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;
    });

    it("Should test: operate_RevertIfBorrowLimitReached", async () => {
      expect(
        await setup.expectRevert(
          "USER_MODULE_BORROW_LIMIT_REACHED",
          setup.borrow.bind(setup),
          setup.mockProtocol,
          BASE_BORROW_LIMIT.add(new BN(1)),
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;
    });

    it("Should test: operate_RevertIfBorrowLimitReachedForSupplyAndBorrow", async () => {
      expect(
        await setup.expectRevert(
          "USER_MODULE_BORROW_LIMIT_REACHED",
          setup.operate.bind(setup),
          setup.mockProtocol,
          new BN(DEFAULT_SUPPLY_AMOUNT),
          BASE_BORROW_LIMIT.add(new BN(1)),
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;
    });

    it("Should test: operate_RevertIfBorrowLimitReachedForWithdrawAndBorrow", async () => {
      expect(
        await setup.expectRevert(
          "USER_MODULE_BORROW_LIMIT_REACHED",
          setup.operate.bind(setup),
          setup.mockProtocol,
          new BN(DEFAULT_SUPPLY_AMOUNT.div(new BN(10))).mul(new BN(-1)), // 0.1 LAMPORTS_PER_SOL
          BASE_BORROW_LIMIT.add(new BN(1)),
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;
    });

    it("Should test: operate_RevertIfBorrowLimitMaxUtilizationReached", async () => {
      await setup.updateTokenConfigs([
        {
          token: MintKeys.USDC,
          fee: new BN(0),
          maxUtilization: new BN(1), // 1%
        },
      ]);

      expect(
        await setup.expectRevert(
          "USER_MODULE_MAX_UTILIZATION_REACHED",
          setup.borrow.bind(setup),
          setup.mockProtocol,
          BASE_BORROW_LIMIT.sub(new BN(1000)),
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;
    });

    it("Should test: operate_RevertIfBorrowLimitDefaultMaxUtilizationReached", async () => {
      // Default max utilization 100% should be active
      const borrowConfig: UpdateUserBorrowConfigParams = {
        mint: MintKeys.USDC,
        newBorrowConfig: {
          user: setup.mockProtocol.publicKey,
          token: MintInfo.getMint(MintKeys.USDC),
          mode: interestRate,
          expandPercent: new BN(setup.DEFAULT_EXPAND_DEBT_CEILING_PERCENT),
          expandDuration: new BN(setup.DEFAULT_EXPAND_DEBT_CEILING_DURATION),
          baseDebtCeiling: new BN(3 * LAMPORTS_PER_SOL),
          maxDebtCeiling: MAX_BORROW_LIMIT,
        },
      };
      await setup.updateUserBorrowConfig([borrowConfig]);

      expect(
        await setup.expectRevert(
          "USER_MODULE_MAX_UTILIZATION_REACHED",
          setup.borrow.bind(setup),
          setup.mockProtocol,
          new BN(2 * LAMPORTS_PER_SOL),
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;
    });

    it("Should test: operate_RevertIfMaxUtilization1", async () => {
      // Set max utilization to 1, no borrow should be possible at all
      await setup.updateTokenConfigs([
        {
          token: MintKeys.USDC,
          fee: new BN(0),
          maxUtilization: new BN(1),
        },
      ]);

      expect(
        await setup.expectRevert(
          "USER_MODULE_MAX_UTILIZATION_REACHED",
          setup.borrow.bind(setup),
          setup.mockProtocol,
          DEFAULT_SUPPLY_AMOUNT,
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;
    });

    it("Should test: operate_BorrowLimitSequence", async () => {
      const baseLimit = new BN(5 * LAMPORTS_PER_SOL);
      const baseLimitAfterBigMath = baseLimit;

      const maxLimit = new BN(7 * LAMPORTS_PER_SOL);
      const maxLimitAfterBigMath = maxLimit;

      {
        // Set borrow config with actual limits
        const borrowConfig: UpdateUserBorrowConfigParams = {
          mint: MintKeys.USDC,
          newBorrowConfig: {
            user: setup.mockProtocol.publicKey,
            token: MintInfo.getMint(MintKeys.USDC),
            mode: interestRate,
            expandPercent: new BN(setup.DEFAULT_EXPAND_DEBT_CEILING_PERCENT), // 20%
            expandDuration: new BN(setup.DEFAULT_EXPAND_DEBT_CEILING_DURATION), // 2 days
            baseDebtCeiling: baseLimit,
            maxDebtCeiling: maxLimit,
          },
        };

        await setup.updateUserBorrowConfig([borrowConfig]);

        // set rate to essentially 0 so we can ignore yield for this test
        await setup.updateRateDataV1([
          {
            token: MintKeys.USDC,
            kink: 9999,
            rateAtUtilizationZero: 0,
            rateAtUtilizationKink: 1,
            rateAtUtilizationMax: 2,
          },
        ]);
      }

      // Withdraw supplied from setUp()
      await setup.withdraw(
        setup.mockProtocol,
        DEFAULT_SUPPLY_AMOUNT,
        MintKeys.USDC,
        setup.alice
      );

      // Seed deposit & borrow
      await setup.deposit(
        setup.mockProtocolInterestFree,
        DEFAULT_SUPPLY_AMOUNT,
        MintKeys.USDC,
        setup.alice
      );

      await setup.borrow(
        setup.mockProtocolInterestFree,
        DEFAULT_BORROW_AMOUNT,
        MintKeys.USDC,
        setup.alice
      );

      // Supply
      await setup.deposit(
        setup.mockProtocol,
        new BN(20 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      await assertBorrowLimits(
        new BN(0), // user borrow
        baseLimitAfterBigMath, // borrow limit
        baseLimitAfterBigMath, // borrowable until limit
        baseLimitAfterBigMath, // borrowable
        new BN(0) // reset to borrow amount
      );

      // console.log(
      //   "--------- 1. action: borrow of 4.18 SOL, expands to 5.01 (above base limit) ---------"
      // );

      await setup.borrow(
        setup.mockProtocol,
        new BN(4.18 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      let userBorrow = new BN(4.18 * LAMPORTS_PER_SOL);

      await assertBorrowLimits(
        userBorrow, // user borrow
        baseLimitAfterBigMath, // borrow limit
        baseLimitAfterBigMath.sub(userBorrow), // borrowable until limit
        baseLimitAfterBigMath.sub(userBorrow), // borrowable
        new BN(4.18 * LAMPORTS_PER_SOL) // reset to borrow amount
      );

      // console.log("--------- TIME WARP to full expansion ---------");
      setup.warp(2 * 24 * 60 * 60); // 2 days

      await assertBorrowLimits(
        userBorrow, // user borrow
        new BN(5.016 * LAMPORTS_PER_SOL), // borrow limit. fully expanded from 4.18 SOL
        new BN(5.016 * LAMPORTS_PER_SOL).sub(userBorrow), // borrowable until limit
        new BN(5.016 * LAMPORTS_PER_SOL).sub(userBorrow), // borrowable
        new BN(4.18 * LAMPORTS_PER_SOL) // reset to borrow amount
      );

      // console.log(
      //   "--------- 2. action: borrow of 0.82 SOL to 5 SOL total ---------"
      // );

      await setup.borrow(
        setup.mockProtocol,
        new BN(0.82 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      userBorrow = userBorrow.add(new BN(0.82 * LAMPORTS_PER_SOL));

      await assertBorrowLimits(
        userBorrow, // user borrow
        new BN(5.016 * LAMPORTS_PER_SOL), // borrow limit. fully expanded from 4.18 SOL
        new BN(5.016 * LAMPORTS_PER_SOL).sub(userBorrow), // borrowable until limit
        new BN(5.016 * LAMPORTS_PER_SOL).sub(userBorrow), // borrowable
        new BN(5 * LAMPORTS_PER_SOL) // reset to borrow amount
      );

      // Warp tiny bit less than half to get closest to 5.5 & make up for 0.016 already as last limit. makes test easier
      setup.warp((2 * 24 * 60 * 60) / 2 - 2764); // half expansion minus adjustment
      // console.log("--------- TIME WARP (half expanded) ---------");

      await assertBorrowLimits(
        userBorrow, // user borrow
        new BN(5.5 * LAMPORTS_PER_SOL), // borrow limit. half expanded from 5 SOL
        new BN(5.5 * LAMPORTS_PER_SOL).sub(userBorrow), // borrowable until limit
        new BN(5.5 * LAMPORTS_PER_SOL).sub(userBorrow), // borrowable
        new BN(5 * LAMPORTS_PER_SOL) // reset to borrow amount
      );

      // console.log(
      //   "--------- 3. action: borrow of 0.5 SOL to 5.5 SOL total ---------"
      // );

      await setup.borrow(
        setup.mockProtocol,
        new BN(0.5 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      userBorrow = userBorrow.add(new BN(0.5 * LAMPORTS_PER_SOL));

      await assertBorrowLimits(
        userBorrow, // user borrow
        new BN(5.5 * LAMPORTS_PER_SOL), // borrow limit. half expanded from 5 SOL
        new BN(5500004629).sub(userBorrow), // borrowable until limit
        new BN(5500004629).sub(userBorrow), // borrowable
        new BN(5.5 * LAMPORTS_PER_SOL) // reset to borrow amount
      );

      // console.log(
      //   "--------- 4. action: payback 0.01 SOL to total 5.49 ---------"
      // );

      await setup.payback(
        setup.mockProtocol,
        new BN(0.01 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      userBorrow = userBorrow.sub(new BN(0.01 * LAMPORTS_PER_SOL));
      await assertBorrowLimits(
        userBorrow, // user borrow
        new BN(5.5 * LAMPORTS_PER_SOL), // borrow limit. half expanded from 5 SOL
        new BN(5500004629).sub(userBorrow), // borrowable until limit
        new BN(5500004629).sub(userBorrow), // borrowable
        new BN(5.49 * LAMPORTS_PER_SOL) // reset to borrow amount
      );

      // console.log("--------- TIME WARP to full expansion ---------");
      setup.warp(2 * 24 * 60 * 60); // 2 days

      await assertBorrowLimits(
        userBorrow, // user borrow
        new BN(6.588 * LAMPORTS_PER_SOL), // borrow limit
        new BN(6.588 * LAMPORTS_PER_SOL).sub(userBorrow), // borrowable until limit
        new BN(6.588 * LAMPORTS_PER_SOL).sub(userBorrow), // borrowable
        new BN(5.49 * LAMPORTS_PER_SOL) // reset to borrow amount
      );

      // console.log(
      //   "--------- 5. action: borrow of 1.01 SOL to 6.5 SOL total ---------"
      // );

      await setup.borrow(
        setup.mockProtocol,
        new BN(1.01 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      userBorrow = userBorrow.add(new BN(1.01 * LAMPORTS_PER_SOL));
      await assertBorrowLimits(
        userBorrow, // user borrow
        new BN(6.588 * LAMPORTS_PER_SOL), // borrow limit
        new BN(6.588 * LAMPORTS_PER_SOL).sub(userBorrow), // borrowable until limit
        new BN(6.588 * LAMPORTS_PER_SOL).sub(userBorrow), // borrowable
        new BN(6.5 * LAMPORTS_PER_SOL) // reset to borrow amount
      );

      // console.log("--------- TIME WARP to full expansion ---------");
      setup.warp(2 * 24 * 60 * 60); // 2 days

      // Max expansion to 7.8 SOL but max limit of 7 SOL gets active
      await assertBorrowLimits(
        userBorrow, // user borrow
        maxLimitAfterBigMath, // borrow limit
        maxLimitAfterBigMath.sub(userBorrow), // borrowable until limit
        maxLimitAfterBigMath.sub(userBorrow), // borrowable
        new BN(6.5 * LAMPORTS_PER_SOL) // reset to borrow amount
      );

      // console.log(
      //   "--------- 6. action: borrow ~0.49 SOL up to max limit of ~7 total ---------"
      // );

      // Borrow exactly to max limit
      await setup.borrow(
        setup.mockProtocol,
        maxLimitAfterBigMath.sub(userBorrow).sub(new BN(5)),
        MintKeys.USDC,
        setup.alice
      );

      userBorrow = maxLimitAfterBigMath;
      await assertBorrowLimits(
        userBorrow, // user borrow
        maxLimitAfterBigMath, // borrow limit
        new BN(0), // borrowable until limit
        new BN(0), // borrowable
        maxLimitAfterBigMath // reset to borrow amount
      );

      // console.log("--------- TIME WARP to full expansion ---------");
      setup.warp(2 * 24 * 60 * 60); // 2 days

      await assertBorrowLimits(
        userBorrow, // user borrow
        maxLimitAfterBigMath, // borrow limit
        new BN(0), // borrowable until limit
        new BN(0), // borrowable
        maxLimitAfterBigMath // reset to borrow amount
      );

      // console.log(
      //   "--------- 7. action: borrow 0.01 SOL would fail even after expansion (above max limit) ---------"
      // );

      expect(
        await setup.expectRevert(
          "USER_MODULE_BORROW_LIMIT_REACHED",
          setup.borrow.bind(setup),
          setup.mockProtocol,
          new BN(1e3),
          MintKeys.USDC,
          setup.alice
        )
      ).to.be.true;

      // console.log("--------- 8. action: payback down to 5.5 total ---------");

      await setup.payback(
        setup.mockProtocol,
        userBorrow.sub(new BN(5.5 * LAMPORTS_PER_SOL)),
        MintKeys.USDC,
        setup.alice
      );

      userBorrow = userBorrow.sub(
        userBorrow.sub(new BN(5.5 * LAMPORTS_PER_SOL))
      );

      await assertBorrowLimits(
        userBorrow, // user borrow
        new BN(6.6 * LAMPORTS_PER_SOL), // borrow limit. shrinking is instant. max expansion of 5.5 SOL
        new BN(1.1 * LAMPORTS_PER_SOL), // borrowable until limit
        new BN(1.1 * LAMPORTS_PER_SOL), // borrowable
        new BN(5.5 * LAMPORTS_PER_SOL) // reset to borrow amount
      );

      // console.log(
      //   "--------- 9. action: payback 5.5 SOL down to 0 total ---------"
      // );

      await setup.payback(
        setup.mockProtocol,
        new BN(5.5 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      await assertBorrowLimits(
        new BN(0), // user borrow
        baseLimitAfterBigMath, // borrow limit
        baseLimitAfterBigMath, // borrowable until limit
        baseLimitAfterBigMath, // borrowable
        new BN(0) // reset to borrow amount
      );
    });

    it("Should test: operate_WhenBorrowLimitExpandPercentIncreased", async () => {
      // Set borrow rate to very low so tolerance will be ok between interest free and with interest for this test
      await setup.updateRateDataV1([
        {
          token: MintKeys.USDC,
          kink: 8000,
          rateAtUtilizationZero: 50,
          rateAtUtilizationKink: 80,
          rateAtUtilizationMax: 100,
        },
      ]);

      // Alice supplies liquidity
      await setup.deposit(
        setup.mockProtocol,
        DEFAULT_SUPPLY_AMOUNT.mul(new BN(10)),
        MintKeys.USDC,
        setup.alice
      );

      // Assert limits from no borrow start
      await assertBorrowLimits(
        new BN(0),
        BASE_BORROW_LIMIT,
        BASE_BORROW_LIMIT,
        BASE_BORROW_LIMIT,
        new BN(0)
      );

      // Borrow to 0.95 SOL (5% below base borrow limit)
      await setup.borrow(
        setup.mockProtocol,
        new BN(0.95 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      await assertBorrowLimits(
        new BN(0.95 * LAMPORTS_PER_SOL),
        BASE_BORROW_LIMIT,
        new BN("49799117"), // approximate remaining borrowable after BigMath precision
        new BN("49799117"), // approximate remaining borrowable after BigMath precision
        new BN(0.95 * LAMPORTS_PER_SOL)
      );

      // Expand for 10% (half duration)
      setup.warp(setup.DEFAULT_EXPAND_DEBT_CEILING_DURATION / 2);

      await assertBorrowLimits(
        new BN("950013794"), // increased a tiny bit from borrow rate
        new BN("1094815015"), // started at base borrow limit ~1 SOL, increased 10% ~0.095 SOL
        new BN("144817524"), // 0.095 + 0.05 SOL
        new BN("144817524"), // 0.095 + 0.05 SOL
        new BN("950013794")
      );

      // Set borrow config with actual limits
      const borrowConfig: UpdateUserBorrowConfigParams = {
        mint: MintKeys.USDC,
        newBorrowConfig: {
          user: setup.mockProtocol.publicKey,
          token: MintInfo.getMint(MintKeys.USDC),
          mode: interestRate,
          expandPercent: new BN(30 * 1e2),
          expandDuration: new BN(setup.DEFAULT_EXPAND_DEBT_CEILING_DURATION),
          baseDebtCeiling: BASE_BORROW_LIMIT,
          maxDebtCeiling: MAX_BORROW_LIMIT,
        },
      };

      await setup.updateUserBorrowConfig([borrowConfig]);

      await assertBorrowLimits(
        new BN("950013794"), // increased a tiny bit from borrow rate
        new BN("1094815015"), // started at base borrow limit ~1 SOL, increased 10% ~0.095 SOL
        new BN("144817524"), // 0.095 + 0.05 SOL
        new BN("144817524"), // 0.095 + 0.05 SOL
        new BN("950013794")
      );

      // Warp for 1/4 of duration
      setup.warp(setup.DEFAULT_EXPAND_DEBT_CEILING_DURATION / 4);

      await assertBorrowLimits(
        new BN("950013794"), // increased a tiny bit from rounding
        new BN("1166073480"), // started at last borrow of ~0.95 SOL, was already expanded to 1.095 SOL
        // increased 1/4 of 30% so 7.5% from user borrow so 0,07125 SOL. -> ~1,16625 SOL
        new BN("216053823"), // 0.095 + 0.05 + 0.07125103345 SOL = .1925006897 SOL
        new BN("216053823"), // 0.095 + 0.05 + 0.07125103345 SOL = .1925006897 SOL
        new BN("950013794")
      );

      // Borrow exactly to borrow limit
      const { userBorrowData } = await resolver.getUserBorrowData(
        setup.mockProtocol.publicKey,
        MintKeys.USDC
      );

      await setup.borrow(
        setup.mockProtocol,
        userBorrowData.borrowable.sub(new BN(1)), // ROUNDING ISSUE
        MintKeys.USDC,
        setup.alice
      );

      await assertBorrowLimits(
        new BN("1166074514"),
        new BN("1166074514"),
        new BN(0),
        new BN(0),
        new BN("1166074514")
      );

      // Warp for full expansion
      setup.warp(setup.DEFAULT_EXPAND_DEBT_CEILING_DURATION + 1);

      // Assert without interacting to not trigger an update to timestamp
      const { userBorrowData: userBorrowDataAfterWarp } =
        await resolver.getUserBorrowData(
          setup.mockProtocol.publicKey,
          MintKeys.USDC
        );

      // prettier-ignore
      {
        expect(userBorrowDataAfterWarp.borrow.toNumber()).to.be.closeTo(1166074514, 1e7); // same user borrow
        expect(userBorrowDataAfterWarp.borrowLimit.toNumber()).to.be.closeTo(1515896869, 1e7); // 30% expanded from user borrow
        expect(userBorrowDataAfterWarp.borrowableUntilLimit.toNumber()).to.be.closeTo(349815045, 1e7);
        expect(userBorrowDataAfterWarp.borrowable.toNumber()).to.be.closeTo(349815045, 1e7);
      }

      // Update config to increase expand percent to 50%
      const borrowConfig50: UpdateUserBorrowConfigParams = {
        mint: MintKeys.USDC,
        newBorrowConfig: {
          user: setup.mockProtocol.publicKey,
          token: MintInfo.getMint(MintKeys.USDC),
          mode: interestRate,
          expandPercent: new BN(50 * 1e2), // increase to 50%
          expandDuration: new BN(setup.DEFAULT_EXPAND_DEBT_CEILING_DURATION),
          baseDebtCeiling: BASE_BORROW_LIMIT,
          maxDebtCeiling: MAX_BORROW_LIMIT,
        },
      };
      await setup.updateUserBorrowConfig([borrowConfig50]);

      await assertBorrowLimits(
        new BN("1166074514"), // same user borrow
        new BN("1749111772"), // 50% expanded from user borrow
        new BN("583054189"),
        new BN("583054189"),
        new BN("1166074514")
      );

      // Case increase and it goes above max hard cap limit
      const borrowConfig80: UpdateUserBorrowConfigParams = {
        mint: MintKeys.USDC,
        newBorrowConfig: {
          user: setup.mockProtocol.publicKey,
          token: MintInfo.getMint(MintKeys.USDC),
          mode: interestRate,
          expandPercent: new BN(80 * 1e2), // increase to 80%
          expandDuration: new BN(setup.DEFAULT_EXPAND_DEBT_CEILING_DURATION),
          baseDebtCeiling: BASE_BORROW_LIMIT,
          maxDebtCeiling: new BN(1.8 * LAMPORTS_PER_SOL), // set max at 1.8 SOL
        },
      };
      await setup.updateUserBorrowConfig([borrowConfig80]);

      // Warp for full expansion
      setup.warp(setup.DEFAULT_EXPAND_DEBT_CEILING_DURATION + 1);

      await assertBorrowLimits(
        new BN("1166074514"), // same user borrow
        new BN("1799231744"), // ~1.8 SOL after rounding
        new BN("633183365"),
        new BN("633183365"),
        new BN("1166074514")
      );
    });

    it("Should test: operate_WhenBorrowLimitExpandPercentDecreased", async () => {
      // Set borrow rate to very low so tolerance will be ok between interest free and with interest for this test
      await setup.updateRateDataV1([
        {
          token: MintKeys.USDC,
          kink: 8000,
          rateAtUtilizationZero: 50,
          rateAtUtilizationKink: 80,
          rateAtUtilizationMax: 100,
        },
      ]);

      // Alice supplies liquidity
      await setup.deposit(
        setup.mockProtocol,
        DEFAULT_SUPPLY_AMOUNT.mul(new BN(10)),
        MintKeys.USDC,
        setup.alice
      );

      // Assert limits from no borrow start
      await assertBorrowLimits(
        new BN(0),
        BASE_BORROW_LIMIT,
        BASE_BORROW_LIMIT,
        BASE_BORROW_LIMIT,
        new BN(0)
      );

      // Borrow to 0.95 SOL (5% below base borrow limit)
      await setup.borrow(
        setup.mockProtocol,
        new BN(0.95 * LAMPORTS_PER_SOL),
        MintKeys.USDC,
        setup.alice
      );

      await assertBorrowLimits(
        new BN(0.95 * LAMPORTS_PER_SOL),
        BASE_BORROW_LIMIT,
        new BN("49799117"), // approximate remaining borrowable after BigMath precision
        new BN("49799117"), // approximate remaining borrowable after BigMath precision
        new BN(0.95 * LAMPORTS_PER_SOL)
      );

      // Expand for 10% (half duration)
      setup.warp(setup.DEFAULT_EXPAND_DEBT_CEILING_DURATION / 2);

      // Assert without interacting to not trigger an update to timestamp
      const { userBorrowData: userBorrowDataHalfExpand } =
        await resolver.getUserBorrowData(
          setup.mockProtocol.publicKey,
          MintKeys.USDC
        );

      expect(userBorrowDataHalfExpand.borrow.toNumber()).to.be.closeTo(
        0.95 * LAMPORTS_PER_SOL,
        1e7
      ); // same user borrow
      expect(userBorrowDataHalfExpand.borrowLimit.toNumber()).to.be.closeTo(
        1094815014,
        1e7
      ); // 10% expanded, started at base borrow ~1 SOL
      expect(
        userBorrowDataHalfExpand.borrowableUntilLimit.toNumber()
      ).to.be.closeTo(144817524, 1e7); // 0.095 + 0.05 SOL
      expect(userBorrowDataHalfExpand.borrowable.toNumber()).to.be.closeTo(
        144817524,
        1e7
      );

      // Update config to decrease expand percent to 15%
      const borrowConfig15: UpdateUserBorrowConfigParams = {
        mint: MintKeys.USDC,
        newBorrowConfig: {
          user: setup.mockProtocol.publicKey,
          token: MintInfo.getMint(MintKeys.USDC),
          mode: interestRate,
          expandPercent: new BN(15 * 1e2), // decrease to 15%
          expandDuration: new BN(setup.DEFAULT_EXPAND_DEBT_CEILING_DURATION),
          baseDebtCeiling: BASE_BORROW_LIMIT,
          maxDebtCeiling: MAX_BORROW_LIMIT,
        },
      };
      await setup.updateUserBorrowConfig([borrowConfig15]);

      await assertBorrowLimits(
        new BN(0.95 * LAMPORTS_PER_SOL),
        new BN("1071049117"), // increased half of 15% so 7.5% of ~0.095 SOL, started at base borrow ~1 SOL. ~1+ 0.07125
        new BN("121049117"), // 0.07125 + 0.05 SOL
        new BN("121049117"), // 0.07125 + 0.05 SOL
        new BN(0.95 * LAMPORTS_PER_SOL)
      );

      // Warp for 1/10 of duration
      setup.warp(setup.DEFAULT_EXPAND_DEBT_CEILING_DURATION / 10);

      await assertBorrowLimits(
        new BN("950013794"), // increased a tiny bit from rounding
        new BN("1085299117"), // increased 1/4 of 15% so 1.5% from user borrow so 0.01425 SOL. 1071049117 + 0.01425 SOL
        new BN("135315062"), // 0.07125 + 0.05 + 0.01425 SOL
        new BN("135315062"), // 0.07125 + 0.05 + 0.01425 SOL
        new BN("950013794")
      );

      // Borrow exactly to borrow limit
      const { userBorrowData } = await resolver.getUserBorrowData(
        setup.mockProtocol.publicKey,
        MintKeys.USDC
      );

      await setup.borrow(
        setup.mockProtocol,
        userBorrowData.borrowable,
        MintKeys.USDC,
        setup.alice
      );

      await assertBorrowLimits(
        new BN("1085299117"),
        new BN("1085299117"),
        new BN(0),
        new BN(0),
        new BN("1085299117")
      );

      // Warp for full expansion
      setup.warp(setup.DEFAULT_EXPAND_DEBT_CEILING_DURATION + 1);

      // Assert without interacting to not trigger an update to timestamp
      const { userBorrowData: userBorrowDataFullExpand } =
        await resolver.getUserBorrowData(
          setup.mockProtocol.publicKey,
          MintKeys.USDC
        );

      expect(userBorrowDataFullExpand.borrow.toNumber()).to.be.closeTo(
        1085299117,
        1e7
      ); // same user borrow
      expect(userBorrowDataFullExpand.borrowLimit.toNumber()).to.be.closeTo(
        1248093985,
        1e7
      ); // 15% expanded from user borrow
      expect(
        userBorrowDataFullExpand.borrowableUntilLimit.toNumber()
      ).to.be.closeTo(162794868, 1e7);
      expect(userBorrowDataFullExpand.borrowable.toNumber()).to.be.closeTo(
        162794868,
        1e7
      );

      // Update config to further decrease expand percent to 10%
      const borrowConfig10: UpdateUserBorrowConfigParams = {
        mint: MintKeys.USDC,
        newBorrowConfig: {
          user: setup.mockProtocol.publicKey,
          token: MintInfo.getMint(MintKeys.USDC),
          mode: interestRate,
          expandPercent: new BN(10 * 1e2), // decrease to 10%
          expandDuration: new BN(setup.DEFAULT_EXPAND_DEBT_CEILING_DURATION),
          baseDebtCeiling: BASE_BORROW_LIMIT,
          maxDebtCeiling: MAX_BORROW_LIMIT,
        },
      };
      await setup.updateUserBorrowConfig([borrowConfig10]);

      await assertBorrowLimits(
        new BN("1085299117"),
        new BN("1193829029"),
        new BN("108529912"),
        new BN("108529912"),
        new BN("1085299117")
      );

      // Set max hard limit to below current expansion
      const borrowConfigMaxLimit: UpdateUserBorrowConfigParams = {
        mint: MintKeys.USDC,
        newBorrowConfig: {
          user: setup.mockProtocol.publicKey,
          token: MintInfo.getMint(MintKeys.USDC),
          mode: interestRate,
          expandPercent: new BN(10 * 1e2), // keep at 10%
          expandDuration: new BN(setup.DEFAULT_EXPAND_DEBT_CEILING_DURATION),
          baseDebtCeiling: BASE_BORROW_LIMIT,
          maxDebtCeiling: new BN("1153829029"), // set below calculated expansion
        },
      };

      await setup.updateUserBorrowConfig([borrowConfigMaxLimit]);

      await assertBorrowLimits(
        new BN("1085299117"),
        new BN("1152975077"), // limited by max debt ceiling
        new BN("67675960"),
        new BN("67675960"),
        new BN("1085299117")
      );
    });
  });
