import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { MintKeys } from "../../ts-sdk/mint";
import { mint as mintInfo } from "../../ts-sdk/mint";
import {
  LiquidityBaseSetup,
  TransferType,
} from "../../test-utils/typescript/liquidity/setup";

const DEFAULT_AMOUNT = new BN(5 * LAMPORTS_PER_SOL);

describe("liquidity claim functionality", () => {
  let setup: LiquidityBaseSetup;

  afterEach(async () => {
    setup.logComputeBudget();
  });

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";

    setup = new LiquidityBaseSetup();
    await setup.setup();
  });

  it("Should test: borrow with claim transfer type", async () => {
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_AMOUNT.mul(new BN(10)),
      MintKeys.USDC,
      setup.alice
    );

    const initialBalance = await setup.balanceOf(
      setup.alice.publicKey,
      mintInfo.getMint(MintKeys.USDC)
    );

    await setup.borrow(
      setup.mockProtocolWithInterest,
      DEFAULT_AMOUNT,
      MintKeys.USDC,
      setup.alice,
      TransferType.claim
    );

    const userClaimData = await setup.liquidity.account.userClaim.fetch(
      setup.adminModule.get_claim_account(MintKeys.USDC, setup.alice.publicKey)
    );
    expect(userClaimData.amount.toString()).to.equal(DEFAULT_AMOUNT.toString());

    const finalBalance = await setup.balanceOf(
      setup.alice.publicKey,
      mintInfo.getMint(MintKeys.USDC)
    );

    expect(finalBalance.toString()).to.equal(initialBalance.toString());

    // perfrom claim now
    await setup.claim(MintKeys.USDC, setup.alice);

    const finalBalanceAfterClaim = await setup.balanceOf(
      setup.alice.publicKey,
      mintInfo.getMint(MintKeys.USDC)
    );

    expect(finalBalanceAfterClaim.toString()).to.equal(
      initialBalance.add(DEFAULT_AMOUNT).toString()
    );
  });

  it("Should test: withdraw with claim transfer type", async () => {
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_AMOUNT.mul(new BN(10)),
      MintKeys.USDC,
      setup.alice
    );

    const initialBalance = await setup.balanceOf(
      setup.alice.publicKey,
      mintInfo.getMint(MintKeys.USDC)
    );

    await setup.withdraw(
      setup.mockProtocolWithInterest,
      DEFAULT_AMOUNT,
      MintKeys.USDC,
      setup.alice,
      TransferType.claim
    );

    const userClaimData = await setup.liquidity.account.userClaim.fetch(
      setup.adminModule.get_claim_account(MintKeys.USDC, setup.alice.publicKey)
    );
    expect(userClaimData.amount.toString()).to.equal(DEFAULT_AMOUNT.toString());

    const finalBalance = await setup.balanceOf(
      setup.alice.publicKey,
      mintInfo.getMint(MintKeys.USDC)
    );

    expect(finalBalance.toString()).to.equal(initialBalance.toString());

    // perfrom claim now
    await setup.claim(MintKeys.USDC, setup.alice);

    const finalBalanceAfterClaim = await setup.balanceOf(
      setup.alice.publicKey,
      mintInfo.getMint(MintKeys.USDC)
    );

    expect(finalBalanceAfterClaim.toString()).to.equal(
      initialBalance.add(DEFAULT_AMOUNT).toString()
    );
  });

  it("Should test: borrow with claim transfer type to recipient", async () => {
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_AMOUNT.mul(new BN(10)),
      MintKeys.USDC,
      setup.alice
    );

    const initialBalance = await setup.balanceOf(
      setup.alice.publicKey,
      mintInfo.getMint(MintKeys.USDC)
    );

    await setup.borrow(
      setup.mockProtocolWithInterest,
      DEFAULT_AMOUNT,
      MintKeys.USDC,
      setup.alice,
      TransferType.claim
    );

    const userClaimData = await setup.liquidity.account.userClaim.fetch(
      setup.adminModule.get_claim_account(MintKeys.USDC, setup.alice.publicKey)
    );
    expect(userClaimData.amount.toString()).to.equal(DEFAULT_AMOUNT.toString());

    const finalBalance = await setup.balanceOf(
      setup.alice.publicKey,
      mintInfo.getMint(MintKeys.USDC)
    );

    expect(finalBalance.toString()).to.equal(initialBalance.toString());

    const initialBalanceBob = await setup.balanceOf(
      setup.bob.publicKey,
      mintInfo.getMint(MintKeys.USDC)
    );

    // perfrom claim now
    await setup.claim(MintKeys.USDC, setup.alice, setup.bob.publicKey);

    const finalBalanceAfterClaim = await setup.balanceOf(
      setup.bob.publicKey,
      mintInfo.getMint(MintKeys.USDC)
    );

    expect(finalBalanceAfterClaim.toString()).to.equal(
      initialBalanceBob.add(DEFAULT_AMOUNT).toString()
    );
  });

  it("Should test: withdraw with claim transfer type to recipient", async () => {
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_AMOUNT.mul(new BN(10)),
      MintKeys.USDC,
      setup.alice
    );

    const initialBalance = await setup.balanceOf(
      setup.alice.publicKey,
      mintInfo.getMint(MintKeys.USDC)
    );

    await setup.withdraw(
      setup.mockProtocolWithInterest,
      DEFAULT_AMOUNT,
      MintKeys.USDC,
      setup.alice,
      TransferType.claim
    );

    const userClaimData = await setup.liquidity.account.userClaim.fetch(
      setup.adminModule.get_claim_account(MintKeys.USDC, setup.alice.publicKey)
    );
    expect(userClaimData.amount.toString()).to.equal(DEFAULT_AMOUNT.toString());

    const finalBalance = await setup.balanceOf(
      setup.alice.publicKey,
      mintInfo.getMint(MintKeys.USDC)
    );

    expect(finalBalance.toString()).to.equal(initialBalance.toString());

    const initialBalanceBob = await setup.balanceOf(
      setup.bob.publicKey,
      mintInfo.getMint(MintKeys.USDC)
    );

    // perfrom claim now
    await setup.claim(MintKeys.USDC, setup.alice, setup.bob.publicKey);

    const finalBalanceAfterClaim = await setup.balanceOf(
      setup.bob.publicKey,
      mintInfo.getMint(MintKeys.USDC)
    );

    expect(finalBalanceAfterClaim.toString()).to.equal(
      initialBalanceBob.add(DEFAULT_AMOUNT).toString()
    );
  });

  it("Should test: close claim account", async () => {
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_AMOUNT.mul(new BN(10)),
      MintKeys.USDC,
      setup.alice
    );

    const initialBalance = await setup.balanceOf(
      setup.alice.publicKey,
      mintInfo.getMint(MintKeys.USDC)
    );

    await setup.borrow(
      setup.mockProtocolWithInterest,
      DEFAULT_AMOUNT,
      MintKeys.USDC,
      setup.alice,
      TransferType.claim
    );

    const claimAccount = setup.adminModule.get_claim_account(
      MintKeys.USDC,
      setup.alice.publicKey
    );

    const userClaimData = await setup.liquidity.account.userClaim.fetch(
      claimAccount
    );
    expect(userClaimData.amount.toString()).to.equal(DEFAULT_AMOUNT.toString());

    const finalBalance = await setup.balanceOf(
      setup.alice.publicKey,
      mintInfo.getMint(MintKeys.USDC)
    );

    expect(finalBalance.toString()).to.equal(initialBalance.toString());

    const initialBalanceBob = await setup.balanceOf(
      setup.bob.publicKey,
      mintInfo.getMint(MintKeys.USDC)
    );

    // perfrom claim now
    await setup.claim(MintKeys.USDC, setup.alice, setup.bob.publicKey);

    const finalBalanceAfterClaim = await setup.balanceOf(
      setup.bob.publicKey,
      mintInfo.getMint(MintKeys.USDC)
    );

    expect(finalBalanceAfterClaim.toString()).to.equal(
      initialBalanceBob.add(DEFAULT_AMOUNT).toString()
    );

    let accountInfo = setup.client.getAccount(claimAccount);
    expect(accountInfo?.lamports).to.be.greaterThan(0);

    await setup.closeClaimAccount(MintKeys.USDC, setup.alice);

    accountInfo = setup.client.getAccount(claimAccount);

    expect(accountInfo?.lamports).to.be.eq(0);
  });

  it("Should test: close claim account when amount is not 0", async () => {
    await setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_AMOUNT.mul(new BN(10)),
      MintKeys.USDC,
      setup.alice
    );

    const initialBalance = await setup.balanceOf(
      setup.alice.publicKey,
      mintInfo.getMint(MintKeys.USDC)
    );

    await setup.borrow(
      setup.mockProtocolWithInterest,
      DEFAULT_AMOUNT,
      MintKeys.USDC,
      setup.alice,
      TransferType.claim
    );

    const claimAccount = setup.adminModule.get_claim_account(
      MintKeys.USDC,
      setup.alice.publicKey
    );

    const userClaimData = await setup.liquidity.account.userClaim.fetch(
      claimAccount
    );
    expect(userClaimData.amount.toString()).to.equal(DEFAULT_AMOUNT.toString());

    const finalBalance = await setup.balanceOf(
      setup.alice.publicKey,
      mintInfo.getMint(MintKeys.USDC)
    );

    let accountInfo = setup.client.getAccount(claimAccount);
    expect(accountInfo?.lamports).to.be.greaterThan(0);

    setup.expectRevert(
      "USER_MODULE_AMOUNT_NOT_ZERO",
      setup.closeClaimAccount.bind(setup),
      MintKeys.USDC,
      setup.alice
    );

    accountInfo = setup.client.getAccount(claimAccount);
    expect(accountInfo?.lamports).to.be.greaterThan(0);
  });
});
