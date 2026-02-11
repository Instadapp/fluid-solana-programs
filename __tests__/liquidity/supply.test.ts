import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { MintKeys } from "../../ts-sdk/mint";
import { LiquidityBaseSetup } from "../../test-utils/typescript/liquidity/setup";

const DEFAULT_AMOUNT = new BN(5 * LAMPORTS_PER_SOL);

describe("LiquidityUserModuleSupplyTests", () => {
  let setup: LiquidityBaseSetup;

  afterEach(async () => {
    setup.logComputeBudget();
  });

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";

    setup = new LiquidityBaseSetup();
    await setup.setup();
  });

  it("Should test: operate_RevertOperateAmountsNearlyZero", async () => {
    setup.expectRevert(
      "USER_MODULE_OPERATE_AMOUNTS_ZERO",
      setup.deposit.bind(setup),
      setup.mockProtocolWithInterest,
      new BN(9),
      MintKeys.USDC,
      setup.alice
    );
  });

  it("Should test: operate_RevertDepositExpected", async () => {
    setup.expectRevert(
      "USER_MODULE_DEPOSIT_EXPECTED",
      setup.deposit.bind(setup),
      setup.mockProtocolWithInterest,
      new BN(DEFAULT_AMOUNT.mul(new BN(10))),
      MintKeys.USDC,
      setup.alice,
      false
    );
  });

  it("Should test: deposit", async () => {
    setup.deposit(
      setup.mockProtocolWithInterest,
      DEFAULT_AMOUNT.mul(new BN(10)),
      MintKeys.USDC,
      setup.alice
    );
  });
});
