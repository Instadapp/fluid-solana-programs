import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import { mint as MintInfo } from "../../ts-sdk/mint";
import { LendingBaseSetup } from "../../test-utils/typescript/lending/setup";
import {
  MPL_TOKEN_METADATA_PROGRAM_ID,
  deserializeMetadata,
} from "@metaplex-foundation/mpl-token-metadata";

const DEFAULT_UNIT = new BN(1e6);
const DEFAULT_AMOUNT = new BN(1000).mul(DEFAULT_UNIT);

describe("Lending", () => {
  let setup: LendingBaseSetup;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";

    setup = new LendingBaseSetup();
    await setup.setup();
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  it("Should check token metadata", async () => {
    const [metadataAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID).toBuffer(),
        setup.lendingModule.get_f_token_mint(setup.underlying).toBuffer(),
      ],
      new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)
    );

    const accountInfo = setup.client.getAccount(metadataAccount);
    const data = {
      executable: accountInfo.executable,
      owner: accountInfo.owner,
      lamports: accountInfo.lamports,
      rentEpoch: 0,
      data: Buffer.from(accountInfo.data),
      publicKey: metadataAccount,
    };

    const deserialized = deserializeMetadata(data as any);
    expect(deserialized.name).to.be.eq("jupiter lend USDC");
    expect(deserialized.symbol).to.be.eq("jlUSDC");
  });

  it("Should deposit", async () => {
    const aliceFTokenBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    expect(aliceFTokenBalanceBefore.toString()).to.be.eq("0");

    const aliceUnderlyingBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const aliceFTokenBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    const aliceUnderlyingBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    expect(
      aliceUnderlyingBalanceBefore.sub(aliceUnderlyingBalanceAfter).toString()
    ).to.be.eq(DEFAULT_AMOUNT.toString());

    expect(
      aliceFTokenBalanceAfter.sub(aliceFTokenBalanceBefore).toString()
    ).to.be.eq(DEFAULT_AMOUNT.toString());
  });

  it("Should mint", async () => {
    const aliceFTokenBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    expect(aliceFTokenBalanceBefore.toString()).to.be.eq("0");

    const aliceUnderlyingBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    await setup.mintToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const aliceFTokenBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    const aliceUnderlyingBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    expect(
      aliceUnderlyingBalanceBefore.sub(aliceUnderlyingBalanceAfter).toString()
    ).to.be.eq(DEFAULT_AMOUNT.toString());

    expect(
      aliceFTokenBalanceAfter.sub(aliceFTokenBalanceBefore).toString()
    ).to.be.eq(DEFAULT_AMOUNT.toString());
  });

  it("Should withdraw", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const aliceUnderlyingBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    await setup.withdrawFromLending(
      setup.underlying,
      DEFAULT_AMOUNT,
      setup.alice
    );

    const aliceUnderlyingBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    const aliceFTokenBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    expect(aliceFTokenBalanceAfter.toString()).to.be.eq("0");

    expect(
      aliceUnderlyingBalanceAfter.sub(aliceUnderlyingBalanceBefore).toString()
    ).to.be.eq(DEFAULT_AMOUNT.toString());
  });

  it("Should redeem", async () => {
    await setup.mintToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    const aliceUnderlyingBalanceBefore = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    await setup.redeemFromLending(
      setup.underlying,
      DEFAULT_AMOUNT,
      setup.alice
    );

    const aliceUnderlyingBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    const aliceFTokenBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    expect(aliceFTokenBalanceAfter.toString()).to.be.eq("0");

    expect(
      aliceUnderlyingBalanceAfter.sub(aliceUnderlyingBalanceBefore).toString()
    ).to.be.eq(DEFAULT_AMOUNT.toString());
  });

  it("Should withdraw from new owner if fTokens are transferred", async () => {
    await setup.depositToLending(setup.underlying, DEFAULT_AMOUNT, setup.alice);

    setup.transferSplToken({
      mint: setup.underlyingFToken,
      from: setup.alice.publicKey,
      to: setup.bob.publicKey,
      authority: setup.alice,
      amount: DEFAULT_AMOUNT,
    });

    const aliceFTokenBalanceAfter = await setup.balanceOf(
      setup.alice.publicKey,
      setup.underlyingFToken
    );

    let bobFTokenBalanceAfter = await setup.balanceOf(
      setup.bob.publicKey,
      setup.underlyingFToken
    );
    expect(aliceFTokenBalanceAfter.toString()).to.be.eq("0");
    expect(bobFTokenBalanceAfter.toString()).to.be.eq(
      DEFAULT_AMOUNT.toString()
    );

    await setup.withdrawFromLending(
      setup.underlying,
      DEFAULT_AMOUNT,
      setup.bob
    );

    bobFTokenBalanceAfter = await setup.balanceOf(
      setup.bob.publicKey,
      setup.underlyingFToken
    );

    expect(bobFTokenBalanceAfter.toString()).to.be.eq("0");
  });
});
