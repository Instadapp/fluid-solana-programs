import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";

import { mint as MintInfo } from "../../ts-sdk/mint";
import { VaultBaseSetup } from "../../test-utils/typescript/vaults/setup";

const SINGLE_POOL_VAULT_ID = 5;

// Oracle price for Single Pool Token / SOL (1 pool token = ~1.059 SOL)
const DEFAULT_ORACLE_PRICE = new BN(1059262514823212);

/**
 * The vault program intentionally adds +1 to deposit amounts after unscaling
 * to ensure enough tokens are transferred.
 * See: programs/vaults/src/module/user.rs line 345
 */
function expectAmount(actual: BN, expected: BN) {
  const expectedWithRounding = expected.add(new BN(1));
  expect(actual.toString()).to.be.eq(expectedWithRounding.toString());
}

describe("Single Pool Staking Vault", () => {
  let setup: VaultBaseSetup;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";

    setup = new VaultBaseSetup();
    await setup.setup();

    await setup._setOraclePriceFive(DEFAULT_ORACLE_PRICE);
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  it("should init new position in single pool vault", async () => {
    const vaultId = SINGLE_POOL_VAULT_ID;
    await setup.initPosition(vaultId, setup.alice);
  });

  it("should deposit single pool tokens as collateral", async () => {
    const vaultId = SINGLE_POOL_VAULT_ID;
    const positionId = 1;

    await setup.initPosition(vaultId, setup.alice);

    const collateralAmount = new BN("1000000000"); // 1 Single Pool Token (9 decimals)
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

    expectAmount(aliceBalanceBefore.sub(aliceBalanceAfter), collateralAmount);
  });

  it("should deposit and withdraw single pool tokens", async () => {
    const vaultId = SINGLE_POOL_VAULT_ID;
    const positionId = 1;

    await setup.initPosition(vaultId, setup.alice);

    const aliceBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    const collateralAmount = new BN("1000000000"); // 1 Single Pool Token
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

    expectAmount(aliceBalanceBefore.sub(aliceBalanceAfter), collateralAmount);

    // Withdraw half
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

    const aliceBalanceAfterWithdraw = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    expect(
      aliceBalanceAfterWithdraw.sub(aliceBalanceAfter).toString()
    ).to.be.eq(withdrawAmount.abs().toString());
  });

  it("should deposit single pool tokens and borrow SOL", async () => {
    const vaultId = SINGLE_POOL_VAULT_ID;
    const positionId = 1;

    await setup.initPosition(vaultId, setup.alice);

    const collateralAmount = new BN("1000000000"); // 1 Single Pool Token (9 decimals)
    const borrowAmount = new BN("500000000"); // 0.5 SOL (9 decimals)

    const aliceCollateralBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );
    const aliceBorrowBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultBorrowToken(vaultId))
    );

    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount,
      debtAmount: new BN(0),
      recipient: setup.alice,
    });

    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount: new BN(0),
      debtAmount: borrowAmount,
      recipient: setup.alice,
    });

    const aliceCollateralAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );
    const aliceBorrowAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultBorrowToken(vaultId))
    );

    expectAmount(
      aliceCollateralBefore.sub(aliceCollateralAfter),
      collateralAmount
    );

    expect(aliceBorrowAfter.sub(aliceBorrowBefore).toString()).to.be.eq(
      borrowAmount.toString()
    );
  });

  it("should deposit, borrow, and payback from single pool vault", async () => {
    const vaultId = SINGLE_POOL_VAULT_ID;
    const positionId = 1;

    await setup.initPosition(vaultId, setup.alice);

    const collateralAmount = new BN("1000000000"); // 1 Single Pool Token

    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount,
      debtAmount: new BN(0),
      recipient: setup.alice,
    });

    const borrowAmount = new BN("400000000"); // 0.4 SOL (9 decimals)

    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount: new BN(0),
      debtAmount: borrowAmount,
      recipient: setup.alice,
    });

    const aliceBalanceBeforePayback = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.getVaultBorrowToken(vaultId))
    );

    // Payback half
    const paybackAmount = new BN("200000");

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

    expectAmount(
      aliceBalanceBeforePayback.sub(aliceBalanceAfterPayback),
      paybackAmount
    );
  });

  it("should allow third party to deposit on behalf of position owner", async () => {
    const vaultId = SINGLE_POOL_VAULT_ID;
    const positionId = 1;

    // Alice creates the position
    await setup.initPosition(vaultId, setup.alice);

    const bobBalanceBefore = await setup.balanceOf(
      setup.bob.publicKey,
      MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
    );

    const collateralAmount = new BN("1000000000");
    const debtAmount = new BN(0);

    // Bob deposits on behalf of Alice's position
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

    expectAmount(bobBalanceBefore.sub(bobBalanceAfter), collateralAmount);
  });

  it("should not allow non-owner to borrow from position", async () => {
    const vaultId = SINGLE_POOL_VAULT_ID;
    const positionId = 1;

    // Alice creates the position and deposits
    await setup.initPosition(vaultId, setup.alice);

    const collateralAmount = new BN("1000000000");
    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount,
      debtAmount: new BN(0),
      recipient: setup.alice,
    });

    const borrowAmount = new BN("500000");

    // Bob tries to borrow - should fail
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

  it("should transfer position NFT and allow new owner to operate", async () => {
    const vaultId = SINGLE_POOL_VAULT_ID;
    const positionId = 1;

    // Alice creates position and deposits
    await setup.initPosition(vaultId, setup.alice);

    const collateralAmount = new BN("1000000000");
    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount,
      debtAmount: new BN(0),
      recipient: setup.alice,
    });

    // Transfer position to Bob
    await setup.transferPosition(vaultId, positionId, setup.alice, setup.bob);

    // Bob should now be able to borrow
    const borrowAmount = new BN("400000");
    await setup.operateVault({
      vaultId,
      positionId,
      user: setup.bob,
      positionOwner: setup.bob,
      collateralAmount: new BN(0),
      debtAmount: borrowAmount,
      recipient: setup.bob,
    });

    // Alice should no longer be able to borrow
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
    ).to.be.true;
  });
});
