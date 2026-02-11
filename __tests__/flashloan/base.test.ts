import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";

import { mint as MintInfo } from "../../ts-sdk/mint";
import { FlashloanBaseSetup } from "../../test-utils/typescript/flashloan/setup";

const DEFAULT_UNIT = new BN(1e6);
const DEFAULT_AMOUNT = new BN(1000).mul(DEFAULT_UNIT);

describe("Flashloan", () => {
  let setup: FlashloanBaseSetup;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";

    setup = new FlashloanBaseSetup();
    await setup.setup();
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  it("should take flashloan and payback without fee", async () => {
    const tx = setup.getTx();
    tx.add(await setup.flashloanBorrowIx(DEFAULT_AMOUNT));
    tx.add(await setup.flashloanPaybackIx(DEFAULT_AMOUNT));

    setup.execute(tx, setup.admin);
  });

  it("should revert if no payback instruction is found", async () => {
    const tx = setup.getTx();
    tx.add(await setup.flashloanBorrowIx(DEFAULT_AMOUNT));

    setup.expectRevert(
      "FlashloanPaybackNotFound",
      setup.execute.bind(setup),
      tx,
      setup.admin
    );
  });

  it("should take flashloan and payback with fee", async () => {
    // 0.5%
    await setup.setFlashloanFee(50);

    const underlyingBalanceBefore = await setup.balanceOf(
      setup.admin.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    const tx = setup.getTx();
    tx.add(await setup.flashloanBorrowIx(DEFAULT_AMOUNT));
    tx.add(await setup.flashloanPaybackIx(DEFAULT_AMOUNT));

    setup.execute(tx, setup.admin);

    const underlyingBalanceAfter = await setup.balanceOf(
      setup.admin.publicKey,
      MintInfo.getMint(setup.underlying)
    );

    expect(underlyingBalanceAfter.lt(underlyingBalanceBefore)).to.be.true;
  });
});
