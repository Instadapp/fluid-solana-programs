import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";

import { mint as MintInfo } from "../../ts-sdk/mint";
import { VaultBaseSetup } from "../../test-utils/typescript/vaults/setup";

const DEFAULT_ORACLE_PRICE = new BN(10).pow(new BN(8));

async function createCheckedPosition(
  vaultId: number,
  collateral: BN,
  debt: BN,
  user: Keypair,
  setup: VaultBaseSetup,
  positionId?: number
) {
  if (!positionId) {
    positionId = await setup.getNextPositionId(vaultId);
    await setup.initPosition(vaultId, user);
  }

  const userSupplyTokenBalanceBefore = await setup.balanceOf(
    user.publicKey,
    MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
  );

  const userBorrowTokenBalanceBefore = await setup.balanceOf(
    user.publicKey,
    MintInfo.getMint(setup.getVaultBorrowToken(vaultId))
  );

  await setup.operateVault({
    vaultId,
    positionId,
    user: user,
    positionOwner: user,
    collateralAmount: collateral,
    debtAmount: debt,
    recipient: user,
  });

  const userSupplyTokenBalanceAfter = await setup.balanceOf(
    user.publicKey,
    MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
  );

  const userBorrowTokenBalanceAfter = await setup.balanceOf(
    user.publicKey,
    MintInfo.getMint(setup.getVaultBorrowToken(vaultId))
  );

  // round up the collateral during deposit
  if (collateral.gt(new BN(0))) {
    collateral = collateral.add(new BN(1));
  }

  // round down the debt during payback
  if (debt.lt(new BN(0))) {
    debt = debt.sub(new BN(1));
  }

  // prettier-ignore
  {
    expect(userSupplyTokenBalanceBefore.sub(userSupplyTokenBalanceAfter).toString()).to.be.eq(collateral.toString());
    expect(userBorrowTokenBalanceAfter.sub(userBorrowTokenBalanceBefore).toString()).to.be.eq(debt.toString());
  }

  return positionId;
}

describe("vaults - combination operations", () => {
  let setup: VaultBaseSetup;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";

    setup = new VaultBaseSetup();
    await setup.setup();

    // set oracle price to be 1e18 for USDC/USDT
    setup.setOraclePrice(DEFAULT_ORACLE_PRICE, true);
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
    const vaultState = await setup.vaultModule.readVaultState({vaultId});
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

  it("should handle deposit + borrow in single transaction", async () => {
    const vaultId = 1;

    const collateralAmount = new BN("1000000000"); // deposit 1000 USDC
    const debtAmount = new BN("500000000"); // borrow 500 USDT

    // prettier-ignore
    await createCheckedPosition(vaultId, collateralAmount, debtAmount, setup.alice, setup);

    // Verify vault state
    await _assertState(
      vaultId,
      -462, // Expected tick for the ratio
      new BN("500333316"), // Expected debt in tick (with some margin)
      -462,
      new BN("1000000000"), // Total collateral
      new BN("500000000") // Total debt
    );
  });

  it("should handle withdraw + payback in single transaction", async () => {
    const vaultId = 1;

    let collateral = new BN("1000000000");
    let debt = new BN("500000000");

    // prettier-ignore
    const positionId = await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    // as we are rounding up now, collateral amount becomes 1 more than the original collateral amount
    // so collateral amount that user transfers to the vault is 1000000001
    // but the amount stored in the position is 1000000000

    const withdrawAmount = new BN("300000000"); // withdraw 300 USDC
    const paybackAmount = new BN("200000000"); // payback 200 USDT

    // prettier-ignore
    // Perform withdraw + payback in single transaction
    await createCheckedPosition(vaultId, withdrawAmount.neg(), paybackAmount.neg(), setup.alice, setup, positionId);

    // Verify remaining position has 700 USDC collateral and 300 USDT debt
    await _assertState(
      vaultId,
      -565, // New tick after partial payback
      new BN("300129883"), // Expected remaining debt in tick
      -565,
      new BN("700000000"), // Remaining collateral
      new BN("300000000") // Remaining debt
    );
  });

  it("should handle deposit + payback in single transaction", async () => {
    const vaultId = 1;

    const collateralAmount = new BN("1000000000");
    const debtAmount = new BN("500000000");

    // First create a position with collateral and debt
    // prettier-ignore
    const positionId = await createCheckedPosition(vaultId, collateralAmount, debtAmount, setup.alice, setup);

    const additionalCollateral = new BN("500000000"); // deposit 500 more USDC
    const paybackAmount = new BN("200000000"); // payback 200 USDT

    const totalCollateralFromThis =
      await setup.createPositionInEveryTickArrayRange(
        vaultId,
        DEFAULT_ORACLE_PRICE
      );

    // prettier-ignore
    await createCheckedPosition(vaultId, additionalCollateral, paybackAmount.neg(), setup.alice, setup, positionId);

    // Verify position now has 1500 USDC collateral and 300 USDT debt
    await _assertState(
      vaultId,
      -1073, // New tick after adding collateral and reducing debt
      new BN("300343345"), // Expected remaining debt in tick
      -1073,
      new BN("1500000000").add(totalCollateralFromThis), // Total collateral after deposit
      new BN("49142585008") // Remaining debt after payback
    );
  });

  it("should handle withdraw + borrow in single transaction (if valid)", async () => {
    const vaultId = 1;

    let supplyAmount = new BN("2000000000");
    let debtAmount = new BN(0);

    const positionId = await createCheckedPosition(
      vaultId,
      supplyAmount,
      debtAmount,
      setup.alice,
      setup
    );

    // as we are rounding up now, supply amount becomes 1 more than the original supply amount
    // so supply amount is 2000000001

    const withdrawAmount = new BN("500000000").neg(); // withdraw 500 USDC
    const borrowAmount = new BN("400000000"); // borrow 400 USDT

    // prettier-ignore
    await createCheckedPosition(vaultId, withdrawAmount, borrowAmount, setup.alice, setup, positionId);

    // Verify position now has 1500 USDC collateral and 400 USDT debt
    await _assertState(
      vaultId,
      -881, // Expected tick for the new ratio
      new BN("400498700"), // Expected debt in tick
      -881,
      new BN("1500000000"), // Remaining collateral after withdrawal, original collateral rounded up during tranfers
      new BN("400000000") // Total debt after borrow
    );
  });

  it("should reject withdraw + borrow if it makes position unsafe", async () => {
    const vaultId = 1;

    let supplyAmount = new BN("1000000000");
    let debtAmount = new BN(0);

    // prettier-ignore
    const positionId = await createCheckedPosition(vaultId, supplyAmount, debtAmount, setup.alice, setup);

    // Try to withdraw too much while borrowing (should exceed collateral factor)
    const withdrawAmount = new BN("800000000"); // withdraw 800 USDC
    const borrowAmount = new BN("700000000"); // borrow 700 USDT

    expect(
      await setup.expectRevert(
        "VAULT_POSITION_ABOVE_CF",
        setup.operateVault.bind(setup),
        {
          vaultId,
          positionId,
          user: setup.alice,
          positionOwner: setup.alice,
          collateralAmount: withdrawAmount.neg(),
          debtAmount: borrowAmount,
          recipient: setup.alice,
        }
      )
    ).to.be.true;
  });

  it("should allow non-owner to deposit + payback in single transaction", async () => {
    const vaultId = 1;

    let collateral = new BN("1000000000");
    let debt = new BN("500000000");

    // prettier-ignore
    const positionId = await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    let additionalCollateral = new BN("300000000"); // Bob deposits 300 USDC
    let paybackAmount = new BN("200000000"); // Bob pays back 200 USDT

    const totalCollateralFromThis =
      await setup.createPositionInEveryTickArrayRange(
        vaultId,
        DEFAULT_ORACLE_PRICE
      );

    const bobSupplyTokenBefore = await setup.balanceOf(
      setup.bob.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    const bobBorrowTokenBefore = await setup.balanceOf(
      setup.bob.publicKey,
      MintInfo.getMint(setup.getVaultBorrowToken(vaultId))
    );

    // Bob can deposit + payback on Alice's position
    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.bob,
      positionOwner: setup.alice,
      collateralAmount: additionalCollateral,
      debtAmount: paybackAmount.neg(),
      recipient: setup.bob,
    });

    const bobSupplyTokenAfter = await setup.balanceOf(
      setup.bob.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    const bobBorrowTokenAfter = await setup.balanceOf(
      setup.bob.publicKey,
      MintInfo.getMint(setup.getVaultBorrowToken(vaultId))
    );

    // round up the additional collateral during deposit
    if (additionalCollateral.gt(new BN(0))) {
      additionalCollateral = additionalCollateral.add(new BN(1));
    }

    // round down the payback amount during payback
    if (paybackAmount.gt(new BN(0))) {
      // +1 to the negative payback amount becomes extra payback
      paybackAmount = paybackAmount.add(new BN(1));
    }

    // Check Bob's token balances changed correctly
    expect(bobSupplyTokenBefore.sub(bobSupplyTokenAfter).toString()).to.be.eq(
      additionalCollateral.toString()
    );

    expect(bobBorrowTokenBefore.sub(bobBorrowTokenAfter).toString()).to.be.eq(
      paybackAmount.toString()
    );

    // Verify position state improved
    await _assertState(
      vaultId,
      -978, // New safer tick
      new BN("300130894"), // Remaining debt
      -978,
      new BN("1300000000").add(totalCollateralFromThis), // Total collateral
      new BN("49142585008") // Remaining debt
    );
  });

  it("should reject non-owner trying withdraw + borrow", async () => {
    const vaultId = 1;

    let collateral = new BN("2000000000");
    let debt = new BN("0");

    // Alice creates a position
    // prettier-ignore
    const positionId = await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    // Bob tries to withdraw + borrow from Alice's position (should fail)
    expect(
      await setup.expectRevert(
        "VAULT_INVALID_POSITION_AUTHORITY",
        setup.operateVault.bind(setup),
        {
          vaultId,
          positionId,
          user: setup.bob,
          positionOwner: setup.alice,
          collateralAmount: new BN("500000000").neg(), // withdraw
          debtAmount: new BN("300000000"), // borrow
          recipient: setup.bob,
        }
      )
    ).to.be.true;
  });
});
