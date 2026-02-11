import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";

import { mint as MintInfo } from "../../ts-sdk/mint";
import { VaultBaseSetup } from "../../test-utils/typescript/vaults/setup";

const MIN_I128 = new BN("170141183460469231731687303715884105728").neg();
const DEFAULT_ORACLE_PRICE = new BN(10).pow(new BN(8));

describe("vaults", () => {
  let setup: VaultBaseSetup;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";

    setup = new VaultBaseSetup();
    await setup.setup();

    // set oracle price to be 1e18 for USDC/USDT
    await setup.setOraclePrice(DEFAULT_ORACLE_PRICE, true);
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  // prettier-ignore
  async function _assertState(
    vaultId: number,
    tick: number,
    tickDebt: BN,
    topmostTick: number,
    totalCollateral: BN,
    totalDebt: BN
  ) {
    const vaultState = await setup.vaultModule.readVaultState({ vaultId });
    const decimalScaleFactorBorrowToken = setup.getDecimalScaleFactor(setup.getVaultBorrowToken(vaultId));
    const decimalScaleFactorSupplyToken = setup.getDecimalScaleFactor(setup.getVaultSupplyToken(vaultId));

    const topTick = vaultState.topmostTick.toString();
    const vaultDebt = new BN(vaultState.totalBorrow.toString()).div(decimalScaleFactorBorrowToken);
    const vaultCollateral = new BN(vaultState.totalSupply.toString()).div(decimalScaleFactorSupplyToken);

    expect(topTick).to.be.eq(topmostTick.toString());
    expect(vaultCollateral.toString()).to.be.eq(totalCollateral.toString());
    expect(vaultDebt.toString()).to.be.eq(totalDebt.toString());

    const tickData = await setup.vaultModule.readTick({ vaultId, tick });
    const debtInTick = tickData.rawDebt.div(decimalScaleFactorBorrowToken);
    expect(debtInTick.toString()).to.be.eq(tickDebt.toString());
  }

  async function _createDummyPosition(
    vaultId: number,
    user: Keypair,
    positionId: number = 1
  ) {
    await setup.initPosition(vaultId, user);

    let collateralAmount = new BN("1000000000");
    let debtAmount = new BN(0);

    await setup.operateVault({
      vaultId,
      positionId,
      user: user,
      positionOwner: user,
      collateralAmount,
      debtAmount,
      recipient: user,
    });

    debtAmount = new BN("400000000");

    await setup.operateVault({
      vaultId,
      positionId,
      user: user,
      positionOwner: user,
      collateralAmount: new BN(0),
      debtAmount: debtAmount,
      recipient: user,
    });

    await _assertState(
      vaultId,
      -611,
      new BN("400191013"), // As we calculate debt based on ratio, using collateral so it is a bit bigger
      -611,
      new BN("1000000000"),
      new BN("400000000")
    );
  }

  it("should Init new position", async () => {
    const vaultId = 1;
    await setup.initPosition(vaultId, setup.alice);
  });

  it.skip("should close position", async () => {
    const vaultId = 1;
    const positionId = 1;

    const aliceSolBalanceBefore = await setup.balance(setup.alice.publicKey);

    await setup.initPosition(vaultId, setup.alice);

    const aliceSolBalanceAfterPosition = await setup.balance(
      setup.alice.publicKey
    );

    const diffAfterPosition = aliceSolBalanceBefore.sub(
      aliceSolBalanceAfterPosition
    );

    console.log(
      "Total SOL spent for position init",
      diffAfterPosition.toNumber() / 1e9
    );

    // await setup.closePosition(vaultId, positionId, setup.alice);

    const aliceSolBalanceAfter = await setup.balance(setup.alice.publicKey);

    const diffAfterClose = aliceSolBalanceAfter.sub(
      aliceSolBalanceAfterPosition
    );

    console.log(
      "Total SOL refunded by position close",
      diffAfterClose.toNumber() / 1e9
    );

    const amountRefunded = diffAfterPosition.sub(diffAfterClose);
    console.log("SOL amount not refunded", amountRefunded.toNumber() / 1e9);

    expect(aliceSolBalanceBefore.toNumber()).to.be.greaterThan(
      aliceSolBalanceAfter.toNumber()
    );
  });

  it("should deposit from owner of positionId", async () => {
    const vaultId = 1;
    const positionId = 1;
    await setup.initPosition(vaultId, setup.alice);

    let collateralAmount = new BN("1000000000");
    const debtAmount = new BN(0);

    const aliceBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount,
      debtAmount,
      recipient: setup.alice,
    });

    const aliceBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    if (collateralAmount.gt(new BN(0))) {
      collateralAmount = collateralAmount.add(new BN(1));
    }

    expect(aliceBalanceBefore.sub(aliceBalanceAfter).toString()).to.be.eq(
      collateralAmount.toString()
    );
  });

  it("should deposit from non owner of positionId", async () => {
    const vaultId = 1;
    const positionId = 1;
    await setup.initPosition(vaultId, setup.alice);

    const collateralAmount = new BN("1000000000");
    const debtAmount = new BN(0);

    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.bob,
      positionOwner: setup.alice,
      collateralAmount,
      debtAmount,
      recipient: setup.bob,
    });
  });

  it("should deposit and withdraw from owner of positionId", async () => {
    const vaultId = 1;
    const positionId = 1;
    await setup.initPosition(vaultId, setup.alice);

    const aliceBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    let collateralAmount = new BN("1000000000");
    const debtAmount = new BN(0);

    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount,
      debtAmount,
      recipient: setup.alice,
    });

    const aliceBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    if (collateralAmount.gt(new BN(0))) {
      collateralAmount = collateralAmount.add(new BN(1));
    }

    expect(aliceBalanceBefore.sub(aliceBalanceAfter).toString()).to.be.eq(
      collateralAmount.toString()
    );

    const withdrawAmount = new BN("500000000").neg();

    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount: withdrawAmount,
      debtAmount,
      recipient: setup.alice,
    });

    // Balance should've increased
    const aliceBalanceAfterWithdraw = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    expect(
      aliceBalanceAfterWithdraw.sub(aliceBalanceAfter).toString()
    ).to.be.eq(withdrawAmount.abs().toString());
  });

  it("should deposit(Y) and withdraw(N) from non owner of positionId", async () => {
    const vaultId = 1;
    const positionId = 1;
    await setup.initPosition(vaultId, setup.alice);

    const bobBalanceBefore = await setup.balanceOf(
      setup.bob.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    let collateralAmount = new BN("1000000000");
    const debtAmount = new BN(0);

    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.bob,
      positionOwner: setup.alice,
      collateralAmount,
      debtAmount,
      recipient: setup.bob,
    });

    const bobBalanceAfter = await setup.balanceOf(
      setup.bob.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    if (collateralAmount.gt(new BN(0))) {
      collateralAmount = collateralAmount.add(new BN(1));
    }

    expect(bobBalanceBefore.sub(bobBalanceAfter).toString()).to.be.eq(
      collateralAmount.toString()
    );

    const withdrawAmount = new BN("500000000").neg();

    expect(
      await setup.expectRevert(
        "VAULT_INVALID_POSITION_AUTHORITY",
        setup.operateVault.bind(setup),
        {
          vaultId,
          positionId,
          user: setup.bob,
          positionOwner: setup.alice,
          collateralAmount: withdrawAmount,
          recipient: setup.bob,
          debtAmount,
        }
      )
    ).to.be.true;
  });

  it("should deposit and borrow from owner of positionId", async () => {
    const vaultId = 1;
    const positionId = 1;

    await setup.initPosition(vaultId, setup.alice);

    const aliceBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    let collateralAmount = new BN("1000000000");
    const debtAmount = new BN(0);

    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount,
      debtAmount,
      recipient: setup.alice,
    });

    const aliceBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    if (collateralAmount.gt(new BN(0))) {
      collateralAmount = collateralAmount.add(new BN(1));
    }

    expect(aliceBalanceBefore.sub(aliceBalanceAfter).toString()).to.be.eq(
      collateralAmount.toString()
    );

    const aliceDebtBeforeBorrow = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultBorrowToken(vaultId))
    );

    // set oracle price to be 1e18 for USDC/USDT
    setup.setOraclePrice(DEFAULT_ORACLE_PRICE, true);

    const borrowAmount = new BN("500000000");
    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount: new BN(0),
      debtAmount: borrowAmount,
      recipient: setup.alice,
    });

    // Balance should've increased
    const aliceBalanceAfterBorrow = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultBorrowToken(vaultId))
    );

    expect(
      aliceBalanceAfterBorrow.sub(aliceDebtBeforeBorrow).toString()
    ).to.be.eq(borrowAmount.toString());
  });

  it("should deposit and borrow from delegated of positionId", async () => {
    const vaultId = 1;
    const positionId = 1;

    await setup.initPosition(vaultId, setup.alice);
    const positionMint = setup.vaultModule.get_position_mint({
      vaultId,
      positionId,
    });

    const aliceBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    let collateralAmount = new BN("1000000000");
    const debtAmount = new BN(0);

    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount,
      debtAmount,
      recipient: setup.alice,
    });

    const aliceBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    if (collateralAmount.gt(new BN(0))) {
      collateralAmount = collateralAmount.add(new BN(1));
    }

    expect(aliceBalanceBefore.sub(aliceBalanceAfter).toString()).to.be.eq(
      collateralAmount.toString()
    );

    const bobBalanceBeforeBorrow = await setup.balanceOf(
      setup.bob.publicKey,
      MintInfo.getMint(setup.getVaultBorrowToken(vaultId))
    );

    // set oracle price to be 1e18 for USDC/USDT
    await setup.setOraclePrice(DEFAULT_ORACLE_PRICE, true);

    setup.approve(
      setup.alice,
      setup.bob.publicKey,
      new BN("1"), // delegate amount  = 1 for approval in our contracts
      positionMint
    );

    const borrowAmount = new BN("500000000");
    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.bob,
      positionOwner: setup.alice,
      collateralAmount: new BN(0),
      debtAmount: borrowAmount,
      recipient: setup.bob,
    });

    // Balance should've increased
    const bobBalanceAfterBorrow = await setup.balanceOf(
      setup.bob.publicKey,
      MintInfo.getMint(setup.getVaultBorrowToken(vaultId))
    );

    expect(
      bobBalanceAfterBorrow.sub(bobBalanceBeforeBorrow).toString()
    ).to.be.eq(borrowAmount.toString());
  });

  it("should deposit(Y) and borrow(N) from non owner of positionId", async () => {
    const vaultId = 1;
    const positionId = 1;

    await setup.initPosition(vaultId, setup.alice);

    const bobBalanceBefore = await setup.balanceOf(
      setup.bob.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    let collateralAmount = new BN("1000000000");
    const debtAmount = new BN(0);

    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.bob,
      positionOwner: setup.alice,
      collateralAmount,
      debtAmount,
      recipient: setup.bob,
    });

    const bobBalanceAfter = await setup.balanceOf(
      setup.bob.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    if (collateralAmount.gt(new BN(0))) {
      collateralAmount = collateralAmount.add(new BN(1));
    }

    expect(bobBalanceBefore.sub(bobBalanceAfter).toString()).to.be.eq(
      collateralAmount.toString()
    );

    // set oracle price to be 1e18 for USDC/USDT
    setup.setOraclePrice(DEFAULT_ORACLE_PRICE, true);
    const borrowAmount = new BN("500000000");

    expect(
      await setup.expectRevert(
        "VAULT_INVALID_POSITION_AUTHORITY",
        setup.operateVault.bind(setup),
        {
          vaultId,
          positionId,
          user: setup.bob,
          positionOwner: setup.alice,
          collateralAmount: new BN(0),
          debtAmount: borrowAmount,
          recipient: setup.bob,
        }
      )
    ).to.be.true;
  });

  it("should borrow and payback from owner of positionId", async () => {
    const vaultId = 1;
    // create a dummy position from bob's account
    await _createDummyPosition(vaultId, setup.bob);

    const positionId = 2;
    await setup.initPosition(vaultId, setup.alice);

    const aliceBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    let collateralAmount = new BN("1000000000");
    const debtAmount = new BN(0);

    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount,
      debtAmount,
      recipient: setup.alice,
    });

    const aliceBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    if (collateralAmount.gt(new BN(0))) {
      collateralAmount = collateralAmount.add(new BN(1));
    }

    expect(aliceBalanceBefore.sub(aliceBalanceAfter).toString()).to.be.eq(
      collateralAmount.toString()
    );

    const borrowAmount = new BN("500000000");

    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount: new BN(0),
      debtAmount: borrowAmount,
      recipient: setup.alice,
    });

    // prettier-ignore
    await _assertState(
      vaultId,
      -462,
      new BN("500333316"),
      -462,
      new BN("2000000000"), // including bobs dummy position collateral
      new BN("900000000") // including bobs dummy position debt
    );

    const aliceBalanceBeforePayback = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultBorrowToken(vaultId))
    );

    let paybackAmount = new BN("250000000");
    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount: new BN(0),
      debtAmount: paybackAmount.neg(),
      recipient: setup.alice,
    });

    const aliceBalanceAfterPayback = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultBorrowToken(vaultId))
    );

    if (paybackAmount.gt(new BN(0))) {
      paybackAmount = paybackAmount.add(new BN(1));
    }

    expect(
      aliceBalanceBeforePayback.sub(aliceBalanceAfterPayback).toString()
    ).to.be.eq(paybackAmount.toString());
  });

  it("should borrow(N) and payback(Y) from non owner of positionId", async () => {
    const vaultId = 1;
    // create a dummy position from bob's account
    await _createDummyPosition(vaultId, setup.bob);

    const positionId = 2;
    await setup.initPosition(vaultId, setup.alice);

    const aliceBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    let collateralAmount = new BN("1000000000");
    const debtAmount = new BN(0);

    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount,
      debtAmount,
      recipient: setup.alice,
    });

    const aliceBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    if (collateralAmount.gt(new BN(0))) {
      collateralAmount = collateralAmount.add(new BN(1));
    }

    expect(aliceBalanceBefore.sub(aliceBalanceAfter).toString()).to.be.eq(
      collateralAmount.toString()
    );

    const borrowAmount = new BN("500000000");

    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount: new BN(0),
      debtAmount: borrowAmount,
      recipient: setup.alice,
    });

    // now try to borrow from bob account
    expect(
      await setup.expectRevert(
        "VAULT_INVALID_POSITION_AUTHORITY",
        setup.operateVault.bind(setup),
        {
          vaultId,
          positionId,
          user: setup.bob,
          positionOwner: setup.alice,
          collateralAmount: new BN(0),
          debtAmount: borrowAmount,
          recipient: setup.bob,
        }
      )
    );

    // prettier-ignore
    await _assertState(
      vaultId,
      -462,
      new BN("500333316"),
      -462,
      new BN("2000000000"), // including bobs dummy position collateral
      new BN("900000000") // including bobs dummy position debt
    );

    const bobBalanceBeforePayback = await setup.balanceOf(
      setup.bob.publicKey,
      MintInfo.getMint(setup.getVaultBorrowToken(vaultId))
    );

    let paybackAmount = new BN("250000000");
    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.bob,
      positionOwner: setup.alice,
      collateralAmount: new BN(0),
      debtAmount: paybackAmount.neg(),
      recipient: setup.bob,
    });

    const bobBalanceAfterPayback = await setup.balanceOf(
      setup.bob.publicKey,
      MintInfo.getMint(setup.getVaultBorrowToken(vaultId))
    );

    if (paybackAmount.gt(new BN(0))) {
      paybackAmount = paybackAmount.add(new BN(1));
    }

    expect(
      bobBalanceBeforePayback.sub(bobBalanceAfterPayback).toString()
    ).to.be.eq(paybackAmount.toString());
  });

  it("should deposit and borrow multiple times from owner of positionId", async () => {
    const vaultId = 1;
    const positionId = 1;

    await setup.initPosition(vaultId, setup.alice);

    const aliceBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    let collateralAmount = new BN("1000000000");
    const debtAmount = new BN(0);

    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount,
      debtAmount,
      recipient: setup.alice,
    });

    const aliceBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    if (collateralAmount.gt(new BN(0))) {
      collateralAmount = collateralAmount.add(new BN(1));
    }

    expect(aliceBalanceBefore.sub(aliceBalanceAfter).toString()).to.be.eq(
      collateralAmount.toString()
    );

    const aliceDebtBeforeBorrow = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultBorrowToken(vaultId))
    );

    // set oracle price to be 1e18 for USDC/USDT
    await setup.setOraclePrice(DEFAULT_ORACLE_PRICE, true);

    // fillup the vault ticks with dummy positions
    await setup.createPositionInEveryTickArrayRange(
      vaultId,
      DEFAULT_ORACLE_PRICE
    );

    let totalBorrowAmount = new BN("0");
    for (let i = 1; i <= 5; i++) {
      const borrowAmount = new BN("100000000");

      totalBorrowAmount = totalBorrowAmount.add(borrowAmount);
      await setup.operateVault({
        vaultId,
        positionId,
        user: setup.alice,
        positionOwner: setup.alice,
        collateralAmount: new BN(0),
        debtAmount: borrowAmount,
        recipient: setup.alice,
      });

      // Balance should've increased
      const aliceBalanceAfterBorrow = await setup.balanceOf(
        setup.alice.publicKey,
        MintInfo.getMint(setup.getVaultBorrowToken(vaultId))
      );

      expect(
        aliceBalanceAfterBorrow.sub(aliceDebtBeforeBorrow).toString()
      ).to.be.eq(totalBorrowAmount.toString());
    }
  });

  it("should transfer the position NFT to another user", async () => {
    const vaultId = 1;
    const positionId = 1;

    await setup.initPosition(vaultId, setup.alice);

    // deposit from alice account to operate
    const collateralAmount = new BN("1000000000");
    const debtAmount = new BN(0);

    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount,
      debtAmount,
      recipient: setup.alice,
    });

    // borrow from alice account to operate
    const borrowAmount = new BN("100000000");
    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount: new BN(0),
      debtAmount: borrowAmount,
      recipient: setup.alice,
    });

    await setup.transferPosition(vaultId, positionId, setup.alice, setup.bob);

    await setup.createPositionInEveryTickArrayRange(
      vaultId,
      DEFAULT_ORACLE_PRICE
    );

    // deposit from bob account to operate
    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.bob,
      positionOwner: setup.bob,
      collateralAmount: new BN(1e5),
      debtAmount: new BN(0),
      recipient: setup.bob,
    });

    // borrow from bob account to operate
    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.bob,
      positionOwner: setup.bob,
      collateralAmount: new BN(0),
      debtAmount: borrowAmount,
      recipient: setup.bob,
    });

    // now try to operate from alice account should fail
    expect(
      await setup.expectRevert(
        "VAULT_INVALID_POSITION_AUTHORITY",
        setup.operateVault.bind(setup),
        {
          vaultId,
          positionId,
          user: setup.alice,
          positionOwner: setup.bob,
          collateralAmount: new BN(0),
          debtAmount: borrowAmount,
          recipient: setup.alice,
        }
      )
    );

    // withdraw from alice account should fail
    expect(
      await setup.expectRevert(
        "VAULT_INVALID_POSITION_AUTHORITY",
        setup.operateVault.bind(setup),
        {
          vaultId,
          positionId,
          user: setup.alice,
          positionOwner: setup.bob,
          collateralAmount: new BN(1e6),
          debtAmount: new BN(0),
          recipient: setup.alice,
        }
      )
    );

    // payback from alice account
    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.bob,
      collateralAmount: new BN(0),
      debtAmount: borrowAmount.neg(),
      recipient: setup.alice,
    });
  });

  it("should rebalance", async () => {
    const vaultId = 1;
    const positionId = 1;

    await setup.initPosition(vaultId, setup.alice);
    await setup.updateSupplyRateMagnifier(vaultId, 5000);

    // deposit from alice account to operate
    const collateralAmount = new BN("1000000000");
    const debtAmount = new BN("10000000");

    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount,
      debtAmount,
      recipient: setup.alice,
    });

    const PASS_1D_TIME = 24 * 60 * 60;
    setup.warp(PASS_1D_TIME);

    await setup.rebalance(vaultId);
  });

  it("Should not be able to create phantom debt", async () => {
    const vaultId = 1;
    await setup.initPosition(vaultId, setup.alice);

    // create a debt position with minimum debt amount
    const collateralAmount = new BN("100000000");
    const debtAmount = new BN("1000");

    // Open first position with minimum debt amount
    await setup.operateVault({
      vaultId,
      positionId: 1,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount,
      debtAmount,
      recipient: setup.alice,
    });

    const firstPosition = await setup.vaultModule.readUserPosition({
      vaultId,
      positionId: 1,
    });

    await setup.initPosition(vaultId, setup.alice);

    // Open second position with minimum debt amount
    await setup.operateVault({
      vaultId,
      positionId: 2,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount,
      debtAmount,
      recipient: setup.alice,
    });

    {
      const secondPosition = await setup.vaultModule.readUserPosition({
        vaultId,
        positionId: 2,
      });

      // both positions should be open at the same tick
      expect(firstPosition.tick).to.be.eq(secondPosition.tick);
    }

    // alice repay 100% of the debt on second position
    await setup.operateVault({
      vaultId,
      positionId: 2,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount: new BN(0),
      debtAmount: MIN_I128,
      recipient: setup.alice,
    });

    // second position should be closed
    {
      const secondPosition = await setup.vaultModule.readUserPosition({
        vaultId,
        positionId: 2,
      });

      expect(secondPosition.tick.toString()).to.be.eq("-2147483648");
    }

    {
      const tick = await setup.vaultModule.readTick({
        vaultId,
        tick: firstPosition.tick, // as second position is closed, first position debt should stil be present in the tick
      });

      expect(tick.rawDebt.gt(new BN(0))).to.be.true;
    }

    // alie borrow more debt
    await setup.operateVault({
      vaultId,
      positionId: 1,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount: new BN(0),
      debtAmount: new BN("1000"),
      recipient: setup.alice,
    });
  });
});
