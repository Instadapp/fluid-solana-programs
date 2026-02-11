import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";

import { mint as MintInfo } from "../../ts-sdk/mint";
import { VaultBaseSetup } from "../../test-utils/typescript/vaults/setup";
import { VaultResolver } from "../../test-utils/typescript/vaults/resolver";
import { FluidLiquidityResolver } from "../../test-utils/typescript/liquidity/resolver";

const DEFAULT_ORACLE_PRICE = new BN(10).pow(new BN(8));
const MIN_I128 = new BN("170141183460469231731687303715884105728").neg();

async function parseLiquidateEvent(setup: VaultBaseSetup) {
  try {
    const events = setup.parseEvents(setup.lastTxProgramLogs);
    for (const event of events) {
      if (event.name === "LogLiquidate") {
        return {
          colAmount: event.data.col_amount,
          debtAmount: event.data.debt_amount,
          signer: event.data.signer,
          to: event.data.to,
        };
      }
    }

    throw new Error("LogLiquidate event not found");
  } catch (error) {
    console.error("Error parsing liquidation result:", error);
    throw error;
  }
}

async function createCheckedPosition(
  vaultId: number,
  collateral: BN,
  debt: BN,
  user: Keypair,
  setup: VaultBaseSetup
) {
  const positionId = await setup.getNextPositionId(vaultId);
  await setup.initPosition(vaultId, user);

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

  if (collateral.gt(new BN(0))) {
    collateral = collateral.add(new BN(1));
  }

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

async function performCheckedLiquidate(
  vaultId: number,
  liquidateAmt: BN,
  liquidator: Keypair,
  setup: VaultBaseSetup,
  absorb: boolean = false
) {
  const liquidatorSupplyTokenBalanceBefore = await setup.balanceOf(
    liquidator.publicKey,
    MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
  );

  const liquidatorBorrowTokenBalanceBefore = await setup.balanceOf(
    liquidator.publicKey,
    MintInfo.getMint(setup.getVaultBorrowToken(vaultId))
  );

  await setup.liquidateVault({
    vaultId,
    user: liquidator,
    to: liquidator,
    debtAmount: liquidateAmt,
    colPerUnitDebt: new BN(0), // No slippage protection for test
    absorb,
  });

  const liquidatorSupplyTokenBalanceAfter = await setup.balanceOf(
    liquidator.publicKey,
    MintInfo.getMint(setup.getVaultSupplyToken(vaultId))
  );

  const liquidatorBorrowTokenBalanceAfter = await setup.balanceOf(
    liquidator.publicKey,
    MintInfo.getMint(setup.getVaultBorrowToken(vaultId))
  );

  // prettier-ignore
  if (liquidateAmt.gt(new BN(0))) {
    // As we withdraw collateral, we expect the balance to increase
    expect(liquidatorSupplyTokenBalanceAfter.gt(liquidatorSupplyTokenBalanceBefore)).to.be.true;
    // We do payback of borrow token, so we expect the balance to decrease
    expect(liquidatorBorrowTokenBalanceAfter.lt(liquidatorBorrowTokenBalanceBefore)).to.be.true;

    const { colAmount: actualColAmt, debtAmount: actualDebtAmt } =
    await parseLiquidateEvent(setup);

    return {
      actualColAmt,
      actualDebtAmt,
    };
  }

  return {
    actualColAmt: new BN(0),
    actualDebtAmt: new BN(0),
  };
}

async function verifyLiquidation(
  totalPositions: number,
  vaultId: number,
  expectedTotalFinalCol: BN,
  expectedTotalFinalDebt: BN,
  setup: VaultBaseSetup,
  vaultResolver: VaultResolver
) {
  let totalUserCol = new BN(0);
  let totalUserDebt = new BN(0);
  let totalUserDustDebt = new BN(0);

  // prettier-ignore
  for (let i = 0; i < totalPositions; i++) {
    const nftId = i + 1;

    const { userPosition } = await vaultResolver.positionByNftId(
      nftId,
      vaultId
    );


    totalUserCol = totalUserCol.add(setup.unscaleAmounts(userPosition.supply, vaultId));
    totalUserDebt = totalUserDebt.add(setup.unscaleAmounts(userPosition.borrow, vaultId));
    totalUserDustDebt = totalUserDustDebt.add(setup.unscaleAmounts(userPosition.beforeDustBorrow, vaultId));
  }

  if (!expectedTotalFinalCol.gt(totalUserCol)) {
    throw new Error("Collateral expected should be greater than actual");
  }

  if (!expectedTotalFinalDebt.gt(totalUserDebt)) {
    throw new Error("Debt expected should be greater than actual");
  }

  const PRECISION = new BN(10).pow(new BN(7)); // 1e7
  const PERCENT_99_99 = new BN(9999);
  const PERCENT_100 = new BN(10000);

  const expectedColAdjusted = expectedTotalFinalCol
    .mul(PERCENT_99_99)
    .div(PERCENT_100);

  setup.assertApproxEqRel(expectedColAdjusted, totalUserCol, PRECISION);

  const expectedDebtWithDust = expectedTotalFinalDebt.add(totalUserDustDebt);
  const expectedDebtAdjusted = expectedDebtWithDust
    .mul(PERCENT_99_99)
    .div(PERCENT_100);
  const expectedDebtFinal = expectedDebtAdjusted.sub(totalUserDustDebt);

  setup.assertApproxEqRel(expectedDebtFinal, totalUserDebt, PRECISION);
}

async function verifyPosition(
  vaultId: number,
  vaultResolver: VaultResolver,
  setup: VaultBaseSetup
) {
  const { userPosition } = await vaultResolver.positionByNftId(1, vaultId);
  const { userPosition: userPosition2 } = await vaultResolver.positionByNftId(
    2,
    vaultId
  );

  // prettier-ignore
  {
    setup.assertApproxEqRel(userPosition.supply, userPosition2.supply, new BN(1e4));
    setup.assertApproxEqRel(userPosition.borrow, userPosition2.borrow, new BN(1e4));
  }
}

describe("vaults - liquidateFromSinglePerfectTickTillLiquidationThreshold", () => {
  let setup: VaultBaseSetup;
  let vaultResolver: VaultResolver;
  let resolver: FluidLiquidityResolver;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";

    setup = new VaultBaseSetup();
    await setup.setup();

    resolver = new FluidLiquidityResolver(
      setup.admin,
      setup.liquidity,
      setup.client
    );

    vaultResolver = new VaultResolver(
      setup.admin,
      setup.vault,
      resolver,
      setup.client
    );
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  async function liquidateFromSinglePerfectTickTillLiquidationThreshold(
    positiveTick: boolean
  ) {
    const vaultId = positiveTick ? 1 : 2;

    let collateral = new BN(10000).mul(
      new BN(10).pow(new BN(setup.getVaultSupplyTokenDecimals(vaultId)))
    );
    let debt = new BN(7990).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // Set oracle price (1e18)
    const oraclePrice = DEFAULT_ORACLE_PRICE;
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Create position with alice
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    // Decrease oracle price by 200% (crash scenario)
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(200)
    );

    // Liquidate with larger amount (3000 vs 1000 in previous function)
    let liquidateAmt = new BN(3000).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // prettier-ignore
    const { actualColAmt, actualDebtAmt } =
      await performCheckedLiquidate(vaultId, liquidateAmt, setup.bob, setup);

    const expectedFinalCollateral = collateral.sub(actualColAmt);
    const expectedFinalDebt = debt.sub(actualDebtAmt);

    await verifyLiquidation(
      1,
      vaultId,
      expectedFinalCollateral,
      expectedFinalDebt,
      setup,
      vaultResolver
    );
  }

  it("should testLiquidateFromSinglePerfectTickTillLiquidationThresholdPositive", async () => {
    await liquidateFromSinglePerfectTickTillLiquidationThreshold(true);
  });

  it("should testLiquidateFromSinglePerfectTickTillLiquidationThresholdNegative", async () => {
    await liquidateFromSinglePerfectTickTillLiquidationThreshold(false);
  });
});

describe("vaults - liquidateSingleFromPerfectTickTillBetween", () => {
  let setup: VaultBaseSetup;
  let vaultResolver: VaultResolver;
  let resolver: FluidLiquidityResolver;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";

    setup = new VaultBaseSetup();
    await setup.setup();

    resolver = new FluidLiquidityResolver(
      setup.admin,
      setup.liquidity,
      setup.client
    );

    vaultResolver = new VaultResolver(
      setup.admin,
      setup.vault,
      resolver,
      setup.client
    );
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  async function liquidateFromSinglePerfectTickTillBetween(
    positiveTick: boolean
  ) {
    const vaultId = positiveTick ? 1 : 2;

    let collateral = new BN(10000).mul(
      new BN(10).pow(new BN(setup.getVaultSupplyTokenDecimals(vaultId)))
    );
    let debt = new BN(7990).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // Set oracle price (1e17)
    const oraclePrice = DEFAULT_ORACLE_PRICE;
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Create position with alice
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    // Decrease oracle price by 200% (crash scenario)
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(200)
    );

    let liquidateAmt = new BN(100).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // prettier-ignore
    const { actualColAmt, actualDebtAmt } =
      await performCheckedLiquidate(vaultId, liquidateAmt, setup.bob, setup);

    const expectedFinalCollateral = collateral.sub(actualColAmt);
    const expectedFinalDebt = debt.sub(actualDebtAmt);

    await verifyLiquidation(
      1,
      vaultId,
      expectedFinalCollateral,
      expectedFinalDebt,
      setup,
      vaultResolver
    );
  }

  it("should testLiquidateFromSinglePerfectTickTillBetweenPositive", async () => {
    await liquidateFromSinglePerfectTickTillBetween(true);
  });

  it("should testLiquidateFromSinglePerfectTickTillBetweenNegative", async () => {
    await liquidateFromSinglePerfectTickTillBetween(false);
  });
});

describe("vaults - liquidateFromBranch", () => {
  let setup: VaultBaseSetup;
  let vaultResolver: VaultResolver;
  let resolver: FluidLiquidityResolver;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";

    setup = new VaultBaseSetup();
    await setup.setup();

    resolver = new FluidLiquidityResolver(
      setup.admin,
      setup.liquidity,
      setup.client
    );

    vaultResolver = new VaultResolver(
      setup.admin,
      setup.vault,
      resolver,
      setup.client
    );
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  async function liquidateFromBranch(positiveTick: boolean) {
    const vaultId = positiveTick ? 1 : 2;

    let collateral = new BN(10000).mul(
      new BN(10).pow(new BN(setup.getVaultSupplyTokenDecimals(vaultId)))
    );
    let debt = new BN(7990).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // Set oracle price (1e18)
    const oraclePrice = DEFAULT_ORACLE_PRICE;
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Create position with alice
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    // Decrease oracle price by 200% (crash scenario)
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(200)
    );

    let totalColLiquidated = new BN(0);
    let totalDebtLiquidated = new BN(0);
    let liquidateAmt = new BN(100).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // prettier-ignore
    const { actualColAmt, actualDebtAmt } =
      await performCheckedLiquidate(vaultId, liquidateAmt, setup.bob, setup);

    totalColLiquidated = totalColLiquidated.add(actualColAmt);
    totalDebtLiquidated = totalDebtLiquidated.add(actualDebtAmt);

    liquidateAmt = new BN(200).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );
    // prettier-ignore
    const { actualColAmt: actualColAmt2, actualDebtAmt: actualDebtAmt2 } =
      await performCheckedLiquidate(vaultId, liquidateAmt, setup.bob, setup);

    totalColLiquidated = totalColLiquidated.add(actualColAmt2);
    totalDebtLiquidated = totalDebtLiquidated.add(actualDebtAmt2);

    const expectedFinalCollateral = collateral.sub(totalColLiquidated);
    const expectedFinalDebt = debt.sub(totalDebtLiquidated);

    await verifyLiquidation(
      1,
      vaultId,
      expectedFinalCollateral,
      expectedFinalDebt,
      setup,
      vaultResolver
    );
  }

  it("should testLiquidateFromBranchPositive", async () => {
    await liquidateFromBranch(true);
  });

  it("should testLiquidateFromBranchNegative", async () => {
    await liquidateFromBranch(false);
  });
});

describe("vaults - multiplePerfectTickLiquidation", () => {
  let setup: VaultBaseSetup;
  let vaultResolver: VaultResolver;
  let resolver: FluidLiquidityResolver;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";

    setup = new VaultBaseSetup();
    await setup.setup();

    resolver = new FluidLiquidityResolver(
      setup.admin,
      setup.liquidity,
      setup.client
    );

    vaultResolver = new VaultResolver(
      setup.admin,
      setup.vault,
      resolver,
      setup.client
    );
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  async function liquidateFromMultiplePerfectTick(positiveTick: boolean) {
    const vaultId = positiveTick ? 1 : 2;

    let collateral = new BN(10000).mul(
      new BN(10).pow(new BN(setup.getVaultSupplyTokenDecimals(vaultId)))
    );
    let debt = new BN(7990).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );
    let debtTwo = debt.mul(new BN(994)).div(new BN(1000)); // 0.4% less will result in a different tick

    // Set oracle price (1e17)
    const oraclePrice = DEFAULT_ORACLE_PRICE;
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Create position with alice
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    // create a similar position with bob
    await createCheckedPosition(vaultId, collateral, debt, setup.bob, setup);

    // create a similar position with alice
    // prettier-ignore
    await createCheckedPosition(vaultId, collateral, debtTwo, setup.alice, setup);

    // Decrease oracle price by 200% (crash scenario)
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(200)
    );

    let liquidateAmt = new BN(1000).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // prettier-ignore
    const { actualColAmt, actualDebtAmt } =
      await performCheckedLiquidate(vaultId, liquidateAmt, setup.bob, setup);

    const expectedFinalCollateral = collateral
      .add(collateral)
      .add(collateral)
      .sub(actualColAmt);

    const expectedFinalDebt = debt.add(debt).add(debtTwo).sub(actualDebtAmt);

    await verifyLiquidation(
      3,
      vaultId,
      expectedFinalCollateral,
      expectedFinalDebt,
      setup,
      vaultResolver
    );
  }

  it("should testLiquidateFromMultiplePerfectTickPositive", async () => {
    await liquidateFromMultiplePerfectTick(true);
  });

  it("should testLiquidateFromMultiplePerfectTickNegative", async () => {
    await liquidateFromMultiplePerfectTick(false);
  });
});

// - Initializing a tick
// - Liquidating a tick
// - Initializing another tick exactly same as before
// - Liquidating another tick exactly same as before
// - Liquidating again. Final position of both position should be same
describe("vaults - perfectTickAndBranchLiquidation", () => {
  let setup: VaultBaseSetup;
  let vaultResolver: VaultResolver;
  let resolver: FluidLiquidityResolver;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";

    setup = new VaultBaseSetup();
    await setup.setup();

    resolver = new FluidLiquidityResolver(
      setup.admin,
      setup.liquidity,
      setup.client
    );

    vaultResolver = new VaultResolver(
      setup.admin,
      setup.vault,
      resolver,
      setup.client
    );
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  // - Initializing a tick
  // - Liquidating a tick
  // - Initializing another tick exactly same as before
  // - Liquidating another tick exactly same as before
  // - Liquidating again. Final position of both position should be same
  async function liquidateFromPerfectTickAndBranch(positiveTick: boolean) {
    const vaultId = positiveTick ? 1 : 2;

    let collateral = new BN(10000).mul(
      new BN(10).pow(new BN(setup.getVaultSupplyTokenDecimals(vaultId)))
    );
    let debt = new BN(7990).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // Set oracle price (1e17)
    const oraclePrice = DEFAULT_ORACLE_PRICE;
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Create position with alice
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    // Decrease oracle price by 200% (crash scenario)
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(200)
    );

    let liquidateAmt = new BN(50).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    let totalDebtLiquidated_ = new BN(0);
    let totalColLiquidated_ = new BN(0);

    // prettier-ignore
    const { actualColAmt, actualDebtAmt } =
      await performCheckedLiquidate(vaultId, liquidateAmt, setup.bob, setup);

    totalDebtLiquidated_ = totalDebtLiquidated_.add(actualDebtAmt);
    totalColLiquidated_ = totalColLiquidated_.add(actualColAmt);

    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Create another position with alice
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    // Decrease oracle price by 200% (crash scenario)
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(200)
    );

    liquidateAmt = new BN(49).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // prettier-ignore
    const { actualColAmt: actualColAmt2, actualDebtAmt: actualDebtAmt2 } =
      await performCheckedLiquidate(vaultId, liquidateAmt, setup.bob, setup);

    totalDebtLiquidated_ = totalDebtLiquidated_.add(actualDebtAmt2);
    totalColLiquidated_ = totalColLiquidated_.add(actualColAmt2);

    liquidateAmt = new BN(50).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // prettier-ignore
    const { actualColAmt: actualColAmt3, actualDebtAmt: actualDebtAmt3 } =
      await performCheckedLiquidate(vaultId, liquidateAmt, setup.bob, setup);

    totalDebtLiquidated_ = totalDebtLiquidated_.add(actualDebtAmt3);
    totalColLiquidated_ = totalColLiquidated_.add(actualColAmt3);

    const expectedFinalCollateral = collateral
      .add(collateral)
      .sub(totalColLiquidated_);

    const expectedFinalDebt = debt.add(debt).sub(totalDebtLiquidated_);

    await verifyLiquidation(
      2,
      vaultId,
      expectedFinalCollateral,
      expectedFinalDebt,
      setup,
      vaultResolver
    );

    await verifyPosition(vaultId, vaultResolver, setup);
  }

  it("should testLiquidateFromPerfectTickAndBranchPositive", async () => {
    await liquidateFromPerfectTickAndBranch(true);
  });

  it("should testLiquidateFromPerfectTickAndBranchNegative", async () => {
    await liquidateFromPerfectTickAndBranch(false);
  });
});

// initialize a tick
// liquidate
// inititalize again at the exact same tick
// liquidate a bit less such that the branch doesn't merge with other branch
// inititalize again at the exact same tick
// liquidate everything together
// 3rd branch will merge into 2nd branch will merge into 1st branch
describe("vaults - perfectTickAndMultipleBranchesLiquidation", () => {
  let setup: VaultBaseSetup;
  let vaultResolver: VaultResolver;
  let resolver: FluidLiquidityResolver;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";

    setup = new VaultBaseSetup();
    await setup.setup();

    resolver = new FluidLiquidityResolver(
      setup.admin,
      setup.liquidity,
      setup.client
    );

    vaultResolver = new VaultResolver(
      setup.admin,
      setup.vault,
      resolver,
      setup.client
    );
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  async function perfectTickAndMultipleBranchesLiquidation(
    positiveTick: boolean
  ) {
    const vaultId = positiveTick ? 1 : 2;

    let collateral = new BN(10000).mul(
      new BN(10).pow(new BN(setup.getVaultSupplyTokenDecimals(vaultId)))
    );
    let debt = new BN(7990).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // Set oracle price (1e18)
    const oraclePrice = DEFAULT_ORACLE_PRICE;
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Create position with alice
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    // Decrease oracle price by 200% (crash scenario)
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(200)
    );

    let liquidateAmt = new BN(100).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    let totalDebtLiquidated_ = new BN(0);
    let totalColLiquidated_ = new BN(0);

    // // prettier-ignore
    const { actualColAmt, actualDebtAmt } = await performCheckedLiquidate(
      vaultId,
      liquidateAmt,
      setup.bob,
      setup
    );

    totalDebtLiquidated_ = totalDebtLiquidated_.add(actualDebtAmt);
    totalColLiquidated_ = totalColLiquidated_.add(actualColAmt);

    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Create another position with alice
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    // Decrease oracle price by 200% (crash scenario)
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(200)
    );

    liquidateAmt = new BN(50).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // prettier-ignore
    const { actualColAmt: actualColAmt2, actualDebtAmt: actualDebtAmt2 } =
      await performCheckedLiquidate(vaultId, liquidateAmt, setup.bob, setup);

    totalDebtLiquidated_ = totalDebtLiquidated_.add(actualDebtAmt2);
    totalColLiquidated_ = totalColLiquidated_.add(actualColAmt2);

    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Create another position with alice
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    // Decrease oracle price by 200% (crash scenario)
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(200)
    );

    liquidateAmt = new BN(500).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // prettier-ignore
    const { actualColAmt: actualColAmt3, actualDebtAmt: actualDebtAmt3 } =
      await performCheckedLiquidate(vaultId, liquidateAmt, setup.bob, setup);

    totalDebtLiquidated_ = totalDebtLiquidated_.add(actualDebtAmt3);
    totalColLiquidated_ = totalColLiquidated_.add(actualColAmt3);

    const expectedFinalCollateral = collateral
      .mul(new BN(3))
      .sub(totalColLiquidated_);

    const expectedFinalDebt = debt.mul(new BN(3)).sub(totalDebtLiquidated_);

    await verifyLiquidation(
      3,
      vaultId,
      expectedFinalCollateral,
      expectedFinalDebt,
      setup,
      vaultResolver
    );

    await verifyPosition(vaultId, vaultResolver, setup);
  }

  it("should testPerfectTickAndMultipleBranchesLiquidationPositive", async () => {
    await perfectTickAndMultipleBranchesLiquidation(true);
  });

  it("should testPerfectTickAndMultipleBranchesLiquidationNegative", async () => {
    await perfectTickAndMultipleBranchesLiquidation(false);
  });
});

describe("vaults - tickBranchTickBranchLiquidation", () => {
  let setup: VaultBaseSetup;
  let vaultResolver: VaultResolver;
  let resolver: FluidLiquidityResolver;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";
    setup = new VaultBaseSetup();
    await setup.setup();
    resolver = new FluidLiquidityResolver(
      setup.admin,
      setup.liquidity,
      setup.client
    );
    vaultResolver = new VaultResolver(
      setup.admin,
      setup.vault,
      resolver,
      setup.client
    );
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  async function tickBranchTickBranchLiquidation(positiveTick: boolean) {
    const vaultId = positiveTick ? 1 : 2;
    const length = 5;

    // Initialize arrays for collaterals and debts
    const collaterals: BN[] = [];
    const debts: BN[] = [];

    const supplyDecimals = setup.getVaultSupplyTokenDecimals(vaultId);
    const borrowDecimals = setup.getVaultBorrowTokenDecimals(vaultId);

    // Set up collateral and debt amounts
    collaterals[0] = new BN(10000).mul(new BN(10).pow(new BN(supplyDecimals)));
    debts[0] = new BN(7990).mul(new BN(10).pow(new BN(borrowDecimals)));

    collaterals[1] = new BN(9000).mul(new BN(10).pow(new BN(supplyDecimals)));
    debts[1] = new BN(6800).mul(new BN(10).pow(new BN(borrowDecimals)));

    collaterals[2] = new BN(10000).mul(new BN(10).pow(new BN(supplyDecimals)));
    debts[2] = new BN(7990).mul(new BN(10).pow(new BN(borrowDecimals)));

    collaterals[3] = new BN(10000).mul(new BN(10).pow(new BN(supplyDecimals)));
    debts[3] = new BN(7990).mul(new BN(10).pow(new BN(borrowDecimals)));

    collaterals[4] = new BN(10000).mul(new BN(10).pow(new BN(supplyDecimals)));
    debts[4] = new BN(7840).mul(new BN(10).pow(new BN(borrowDecimals)));

    let totalColLiquidated = new BN(0);
    let totalDebtLiquidated = new BN(0);

    // Set initial oracle price
    const oraclePrice = DEFAULT_ORACLE_PRICE;
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // First position and liquidation
    await createCheckedPosition(
      vaultId,
      collaterals[0],
      debts[0],
      setup.alice,
      setup
    );

    // Decrease oracle price by 500% (severe crash)
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(500)
    );

    let liquidateAmt = new BN(1000).mul(new BN(10).pow(new BN(borrowDecimals)));
    let liquidationResult = await performCheckedLiquidate(
      vaultId,
      liquidateAmt,
      setup.bob,
      setup
    );

    totalDebtLiquidated = totalDebtLiquidated.add(
      liquidationResult.actualDebtAmt
    );
    totalColLiquidated = totalColLiquidated.add(liquidationResult.actualColAmt);

    // Second position (different tick)
    await createCheckedPosition(
      vaultId,
      collaterals[1],
      debts[1],
      setup.alice,
      setup
    );

    // Reset oracle price to original
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Third position (same tick as first)
    await createCheckedPosition(
      vaultId,
      collaterals[2],
      debts[2],
      setup.alice,
      setup
    );

    // Decrease oracle price by 500% again
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(500)
    );

    liquidateAmt = new BN(500).mul(new BN(10).pow(new BN(borrowDecimals)));
    liquidationResult = await performCheckedLiquidate(
      vaultId,
      liquidateAmt,
      setup.bob,
      setup
    );

    totalDebtLiquidated = totalDebtLiquidated.add(
      liquidationResult.actualDebtAmt
    );
    totalColLiquidated = totalColLiquidated.add(liquidationResult.actualColAmt);

    // Reset oracle price again
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Fourth and fifth positions
    await createCheckedPosition(
      vaultId,
      collaterals[3],
      debts[3],
      setup.alice,
      setup
    );
    await createCheckedPosition(
      vaultId,
      collaterals[4],
      debts[4],
      setup.alice,
      setup
    );

    // Final massive price decrease (1000%)
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(1000)
    );

    liquidateAmt = new BN(10000).mul(new BN(10).pow(new BN(borrowDecimals)));
    liquidationResult = await performCheckedLiquidate(
      vaultId,
      liquidateAmt,
      setup.bob,
      setup
    );

    totalDebtLiquidated = totalDebtLiquidated.add(
      liquidationResult.actualDebtAmt
    );
    totalColLiquidated = totalColLiquidated.add(liquidationResult.actualColAmt);

    // Calculate expected final amounts
    let expectedFinalCollateral = new BN(0);
    let expectedFinalDebt = new BN(0);

    for (let i = 0; i < length; i++) {
      expectedFinalCollateral = expectedFinalCollateral.add(collaterals[i]);
      expectedFinalDebt = expectedFinalDebt.add(debts[i]);
    }

    expectedFinalCollateral = expectedFinalCollateral.sub(totalColLiquidated);
    expectedFinalDebt = expectedFinalDebt.sub(totalDebtLiquidated);

    // Verify the liquidation results
    await verifyLiquidation(
      length,
      vaultId,
      expectedFinalCollateral,
      expectedFinalDebt,
      setup,
      vaultResolver
    );
  }

  it("should testTickBranchTickBranchLiquidationPositive", async () => {
    await tickBranchTickBranchLiquidation(true);
  });

  it("should testTickBranchTickBranchLiquidationNegative", async () => {
    await tickBranchTickBranchLiquidation(false);
  });
});

/// 1. Initializing a position
/// 2. Unitializing by making debt 0 aka supply only position
/// 3. Initializing another position
/// 4. Liquidating.
describe("vaults - unitializeFirstPosition", () => {
  let setup: VaultBaseSetup;
  let vaultResolver: VaultResolver;
  let resolver: FluidLiquidityResolver;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";
    setup = new VaultBaseSetup();
    await setup.setup();
    resolver = new FluidLiquidityResolver(
      setup.admin,
      setup.liquidity,
      setup.client
    );
    vaultResolver = new VaultResolver(
      setup.admin,
      setup.vault,
      resolver,
      setup.client
    );
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  async function unitializeFirstPosition(positiveTick: boolean) {
    const vaultId = positiveTick ? 1 : 2;

    const collateral = new BN(10000).mul(
      new BN(10).pow(new BN(setup.getVaultSupplyTokenDecimals(vaultId)))
    );
    const debt = new BN(7990).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // Set initial oracle price
    const oraclePrice = DEFAULT_ORACLE_PRICE;
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // prettier-ignore
    const posId = await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    await setup.operateVault({
      vaultId,
      positionId: posId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount: new BN(0),
      debtAmount: MIN_I128,
      recipient: setup.alice,
    });

    const vaultData = await vaultResolver.getVaultEntireData(vaultId);

    // not MIN_TICK as we created a second position before uninitializing first
    expect(vaultData.vaultState.topTick.toString()).to.equal("-149");

    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(200)
    );

    const liquidateAmt = new BN(200).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    const { actualColAmt, actualDebtAmt } = await performCheckedLiquidate(
      vaultId,
      liquidateAmt,
      setup.bob,
      setup
    );

    // Total collateral = collateral + collateral (from both positions)
    // Total debt = debt (only from the second position since first was repaid)
    const expectedFinalCollateral = collateral
      .add(collateral)
      .sub(actualColAmt);
    const expectedFinalDebt = debt.sub(actualDebtAmt);

    await verifyLiquidation(
      2, // 2 positions were created
      vaultId,
      expectedFinalCollateral,
      expectedFinalDebt,
      setup,
      vaultResolver
    );
  }

  it("should testUnitializeFirstPositionPositive", async () => {
    await unitializeFirstPosition(true);
  });

  it("should testUnitializeFirstPositionNegative", async () => {
    await unitializeFirstPosition(false);
  });
});

// 1. Creating a position
// 2. Partial liquidating it
// 3. Creating another position above last liquidation point by changing oracle
// 4. Removing new position entirely
// 5. Liquidating old position again by partial liquidating
// It checks initial top tick was not liquidated, after liquidation it's a liquidated top tick,
// after creating new position it's again not liquidated & after removing the above position it's again liquidated
describe("vaults - liquidateInitializeAndUnitialize", () => {
  let setup: VaultBaseSetup;
  let vaultResolver: VaultResolver;
  let resolver: FluidLiquidityResolver;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";
    setup = new VaultBaseSetup();
    await setup.setup();
    resolver = new FluidLiquidityResolver(
      setup.admin,
      setup.liquidity,
      setup.client
    );
    vaultResolver = new VaultResolver(
      setup.admin,
      setup.vault,
      resolver,
      setup.client
    );
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  async function liquidateInitializeAndUnitialize(positiveTick: boolean) {
    const vaultId = positiveTick ? 1 : 2;

    const collateral = new BN(10000).mul(
      new BN(10).pow(new BN(setup.getVaultSupplyTokenDecimals(vaultId)))
    );
    const debt = new BN(7990).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    let totalColLiquidated = new BN(0);
    let totalDebtLiquidated = new BN(0);

    // Set initial oracle price
    const oraclePrice = DEFAULT_ORACLE_PRICE;
    await setup.setOraclePrice(oraclePrice, positiveTick);

    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(200)
    );

    let liquidateAmt = new BN(100).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // First liquidation
    let liquidationResult = await performCheckedLiquidate(
      vaultId,
      liquidateAmt,
      setup.bob,
      setup
    );

    totalColLiquidated = totalColLiquidated.add(liquidationResult.actualColAmt);
    totalDebtLiquidated = totalDebtLiquidated.add(
      liquidationResult.actualDebtAmt
    );

    await setup.setOraclePrice(oraclePrice, positiveTick);

    // prettier-ignore
    const posId = await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    await setup.operateVault({
      vaultId,
      positionId: posId,
      user: setup.alice,
      positionOwner: setup.alice,
      collateralAmount: MIN_I128,
      debtAmount: MIN_I128,
      recipient: setup.alice,
    });

    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(200)
    );

    // Second liquidation on the original position
    liquidationResult = await performCheckedLiquidate(
      vaultId,
      liquidateAmt,
      setup.bob,
      setup
    );

    totalColLiquidated = totalColLiquidated.add(liquidationResult.actualColAmt);
    totalDebtLiquidated = totalDebtLiquidated.add(
      liquidationResult.actualDebtAmt
    );

    const expectedFinalCollateral = collateral.sub(totalColLiquidated);
    const expectedFinalDebt = debt.sub(totalDebtLiquidated);

    // Verify liquidation results
    await verifyLiquidation(
      2, // 2 positions were involved in the process
      vaultId,
      expectedFinalCollateral,
      expectedFinalDebt,
      setup,
      vaultResolver
    );
  }

  it("should testLiquidateInitializeAndUnitializePositive", async () => {
    await liquidateInitializeAndUnitialize(true);
  });

  it("should testLiquidateInitializeAndUnitializeNegative", async () => {
    await liquidateInitializeAndUnitialize(false);
  });
});

describe("vaults - absorbMultiplePerfectTickOne", () => {
  let setup: VaultBaseSetup;
  let vaultResolver: VaultResolver;
  let resolver: FluidLiquidityResolver;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";
    setup = new VaultBaseSetup();
    await setup.setup();
    resolver = new FluidLiquidityResolver(
      setup.admin,
      setup.liquidity,
      setup.client
    );
    vaultResolver = new VaultResolver(
      setup.admin,
      setup.vault,
      resolver,
      setup.client
    );
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  async function absorbMultiplePerfectTickOne(positiveTick: boolean) {
    const vaultId = positiveTick ? 1 : 2;

    const collateral = new BN(10000).mul(
      new BN(10).pow(new BN(setup.getVaultSupplyTokenDecimals(vaultId)))
    );
    const debt = new BN(7990).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );
    const debtTwo = new BN(990).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // Set initial oracle price
    const oraclePrice = DEFAULT_ORACLE_PRICE;
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Create three identical positions at the same tick
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    for (let i = 0; i < 3; i++) {
      const positionId = i + 1;
      const { userPosition } = await vaultResolver.positionByNftId(
        positionId,
        vaultId
      );

      // decimals delta multiplier
      expect(userPosition.supply.toString()).to.equal(
        collateral.mul(new BN(1000)).toString()
      );
      // debt must be greater
      expect(userPosition.borrow.toNumber()).to.be.gt(
        debt.mul(new BN(1000)).toNumber()
      );
    }

    // Extreme price crash (1500% decrease) to trigger absorption
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(1500)
    );

    await performCheckedLiquidate(vaultId, new BN(0), setup.bob, setup);

    // Reset price to a less extreme crash (200% decrease)
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(200)
    );

    // Verify that all three positions were absorbed (supply and borrow should be 0)
    for (let i = 0; i < 3; i++) {
      const positionId = i + 1;
      const { userPosition } = await vaultResolver.positionByNftId(
        positionId,
        vaultId
      );

      expect(userPosition.supply.toString()).to.equal("0");
      expect(userPosition.borrow.toString()).to.equal("0");
    }

    // // Get vault data to check top tick state
    let vaultData = await vaultResolver.getVaultEntireData(vaultId);
    expect(vaultData.vaultState.topTick).to.equal(-2147483648);

    const posId = await createCheckedPosition(
      vaultId,
      collateral,
      debtTwo,
      setup.alice,
      setup
    );

    const { userPosition } = await vaultResolver.positionByNftId(
      posId,
      vaultId
    );
    vaultData = await vaultResolver.getVaultEntireData(vaultId);

    expect(userPosition.tick).to.equal(vaultData.vaultState.topTick);
  }

  it("should testAbsorbMultiplePerfectTickOnePositive", async () => {
    await absorbMultiplePerfectTickOne(true);
  });

  it("should testAbsorbMultiplePerfectTickOneNegative", async () => {
    await absorbMultiplePerfectTickOne(false);
  });
});

describe("vaults - absorbMultiplePerfectTickTwo", () => {
  let setup: VaultBaseSetup;
  let vaultResolver: VaultResolver;
  let resolver: FluidLiquidityResolver;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";
    setup = new VaultBaseSetup();
    await setup.setup();
    resolver = new FluidLiquidityResolver(
      setup.admin,
      setup.liquidity,
      setup.client
    );
    vaultResolver = new VaultResolver(
      setup.admin,
      setup.vault,
      resolver,
      setup.client
    );
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  async function absorbMultiplePerfectTickTwo(positiveTick: boolean) {
    const vaultId = positiveTick ? 1 : 2;

    const collateral = new BN(10000).mul(
      new BN(10).pow(new BN(setup.getVaultSupplyTokenDecimals(vaultId)))
    );
    const debt = new BN(7990).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );
    const debtTwo = new BN(990).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // Set initial oracle price
    const oraclePrice = DEFAULT_ORACLE_PRICE;
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Create three identical positions at the same tick
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    // Create fourth position with different debt amount (different tick)
    // prettier-ignore
    await createCheckedPosition(vaultId, collateral, debtTwo, setup.alice, setup);

    // Extreme price crash (1500% decrease) to trigger absorption
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(1500)
    );

    // Perform absorption liquidation
    await performCheckedLiquidate(vaultId, new BN(0), setup.bob, setup);

    // Reset price to a less extreme crash (200% decrease)
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(200)
    );

    // Perform regular liquidation on remaining position
    const liquidateAmt = new BN(10000).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    const { actualColAmt, actualDebtAmt } = await performCheckedLiquidate(
      vaultId,
      liquidateAmt,
      setup.bob,
      setup,
      true
    );

    // Verify that the first three positions were absorbed (supply and borrow should be 0)
    for (let i = 0; i < 3; i++) {
      const positionId = i + 1;
      const { userPosition } = await vaultResolver.positionByNftId(
        positionId,
        vaultId
      );

      expect(userPosition.supply.toString()).to.equal("0");
      expect(userPosition.borrow.toString()).to.equal("0");
    }

    // Check the 4th position and vault state
    const { userPosition, vaultData } = await vaultResolver.positionByNftId(
      4,
      vaultId
    );

    // Verify that the 4th position is the top tick
    expect(userPosition.tick).to.equal(vaultData.vaultState.topTick);

    // Verify branch state
    expect(vaultData.vaultState.currentBranch).to.equal(1);

    // Verify total supply (4 collaterals minus liquidated amount)
    const expectedTotalSupply = collateral.mul(new BN(4)).sub(actualColAmt);

    setup.assertApproxEqRel(
      setup.unscaleAmounts(vaultData.vaultState.totalSupply, vaultId),
      expectedTotalSupply,
      new BN(1e7)
    );

    // Verify total borrow (3 debt + 1 debtTwo minus liquidated debt)
    const expectedTotalBorrow = debt
      .mul(new BN(3))
      .add(debtTwo)
      .sub(actualDebtAmt);

    setup.assertApproxEqRel(
      setup.unscaleAmounts(vaultData.vaultState.totalBorrow, vaultId),
      expectedTotalBorrow,
      new BN(1e7)
    );
  }

  it("should testAbsorbMultiplePerfectTickTwoPositive", async () => {
    await absorbMultiplePerfectTickTwo(true);
  });

  it("should testAbsorbMultiplePerfectTickTwoNegative", async () => {
    await absorbMultiplePerfectTickTwo(false);
  });
});

describe("vaults - absorbMultiplePerfectTickAndBranches", () => {
  let setup: VaultBaseSetup;
  let vaultResolver: VaultResolver;
  let resolver: FluidLiquidityResolver;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";
    setup = new VaultBaseSetup();
    await setup.setup();
    resolver = new FluidLiquidityResolver(
      setup.admin,
      setup.liquidity,
      setup.client
    );
    vaultResolver = new VaultResolver(
      setup.admin,
      setup.vault,
      resolver,
      setup.client
    );
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  async function absorbMultiplePerfectTickAndBranches(positiveTick: boolean) {
    const vaultId = positiveTick ? 1 : 2;

    const collateral = new BN(10000).mul(
      new BN(10).pow(new BN(setup.getVaultSupplyTokenDecimals(vaultId)))
    );
    const debt = new BN(7990).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );
    const debtTwo = new BN(7800).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );
    const debtThree = new BN(900).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // Set initial oracle price
    const oraclePrice = DEFAULT_ORACLE_PRICE;
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Create three positions with different debt amounts (different ticks)
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);
    // prettier-ignore
    await createCheckedPosition(vaultId, collateral, debtTwo, setup.alice, setup);
    // prettier-ignore
    await createCheckedPosition(vaultId, collateral, debtThree, setup.alice, setup);

    // Moderate price crash (200% decrease) and partial liquidation
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(200)
    );

    const liquidateAmt = new BN(200).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // First liquidation with absorb = true
    await performCheckedLiquidate(
      vaultId,
      liquidateAmt,
      setup.bob,
      setup,
      true
    );

    // Get vault data after first liquidation
    let vaultData = await vaultResolver.getVaultEntireData(vaultId);

    // Reset oracle price to original
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Create fourth position (this should create a new branch)
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    // Extreme price crash (1500% decrease) to trigger absorption
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(1500)
    );

    // Perform absorption liquidation
    await performCheckedLiquidate(vaultId, new BN(0), setup.bob, setup);

    // Get vault data after absorption
    vaultData = await vaultResolver.getVaultEntireData(vaultId);

    // Verify that the first branch got closed and we're on branch 2
    expect(vaultData.vaultState.currentBranch).to.equal(2);

    // Reset oracle price again
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Final large liquidation
    const largeLiquidateAmt = new BN(10000).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    await performCheckedLiquidate(
      vaultId,
      largeLiquidateAmt,
      setup.bob,
      setup,
      true
    );

    // Get final vault data
    vaultData = await vaultResolver.getVaultEntireData(vaultId);

    // Verify that positions 1, 2, and 4 were absorbed (supply and borrow should be 0)
    // Position 3 should remain active
    for (let i = 0; i < 4; i++) {
      const positionId = i + 1;

      if (positionId !== 3) {
        const { userPosition } = await vaultResolver.positionByNftId(
          positionId,
          vaultId
        );

        expect(userPosition.supply.toString()).to.equal("0");
        expect(userPosition.borrow.toString()).to.equal("0");
      }
    }

    // Verify we're still on branch 2
    expect(vaultData.vaultState.currentBranch).to.equal(2);

    // Verify that position 3 is the top tick
    const { userPosition: position3 } = await vaultResolver.positionByNftId(
      3,
      vaultId
    );

    expect(vaultData.vaultState.topTick).to.equal(position3.tick);
  }

  it("should testAbsorbMultiplePerfectTickAndBranchesPositive", async () => {
    await absorbMultiplePerfectTickAndBranches(true);
  });

  it("should testAbsorbMultiplePerfectTickAndBranchesNegative", async () => {
    await absorbMultiplePerfectTickAndBranches(false);
  });
});

describe("vaults - absorbBranch", () => {
  let setup: VaultBaseSetup;
  let vaultResolver: VaultResolver;
  let resolver: FluidLiquidityResolver;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";
    setup = new VaultBaseSetup();
    await setup.setup();
    resolver = new FluidLiquidityResolver(
      setup.admin,
      setup.liquidity,
      setup.client
    );
    vaultResolver = new VaultResolver(
      setup.admin,
      setup.vault,
      resolver,
      setup.client
    );
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  async function absorbBranch(positiveTick: boolean) {
    const vaultId = positiveTick ? 1 : 2;

    const collateral = new BN(10000).mul(
      new BN(10).pow(new BN(setup.getVaultSupplyTokenDecimals(vaultId)))
    );
    const debt = new BN(7990).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );
    const debtTwo = new BN(800).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // Set initial oracle price
    const oraclePrice = DEFAULT_ORACLE_PRICE;
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Create two positions with different debt amounts (different ticks)
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);
    // prettier-ignore
    await createCheckedPosition(vaultId, collateral, debtTwo, setup.alice, setup);

    // Moderate price crash (200% decrease) and partial liquidation
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(200)
    );

    const liquidateAmt = new BN(200).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // First liquidation with absorb = true
    await performCheckedLiquidate(
      vaultId,
      liquidateAmt,
      setup.bob,
      setup,
      true
    );

    // Get vault data after first liquidation
    let vaultData = await vaultResolver.getVaultEntireData(vaultId);

    // Reset oracle price to original
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Extreme price crash (1500% decrease) to trigger absorption
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(1500)
    );

    // Perform absorption liquidation (absorb = false by default for zero amounts)
    await performCheckedLiquidate(vaultId, new BN(0), setup.bob, setup);

    // Get vault data after absorption
    vaultData = await vaultResolver.getVaultEntireData(vaultId);

    // Verify that the first branch got closed and we're on branch 2
    expect(vaultData.vaultState.currentBranch).to.equal(2);

    // Reset oracle price again
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Final liquidation with larger amount
    const largeLiquidateAmt = new BN(5000).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    await performCheckedLiquidate(
      vaultId,
      largeLiquidateAmt,
      setup.bob,
      setup,
      true
    );

    // Get final vault data
    vaultData = await vaultResolver.getVaultEntireData(vaultId);

    // Verify that position 1 was absorbed (supply and borrow should be 0)
    const { userPosition: position1 } = await vaultResolver.positionByNftId(
      1,
      vaultId
    );

    expect(position1.supply.toString()).to.equal("0");
    expect(position1.borrow.toString()).to.equal("0");

    // Verify we're still on branch 2
    expect(vaultData.vaultState.currentBranch).to.equal(2);

    // Verify that position 2 is the top tick
    const { userPosition: position2 } = await vaultResolver.positionByNftId(
      2,
      vaultId
    );

    expect(vaultData.vaultState.topTick).to.equal(position2.tick);
  }

  it("should testAbsorbBranchPositive", async () => {
    await absorbBranch(true);
  });

  it("should testAbsorbBranchNegative", async () => {
    await absorbBranch(false);
  });
});

describe("vaults - absorbMultipleBranches", () => {
  let setup: VaultBaseSetup;
  let vaultResolver: VaultResolver;
  let resolver: FluidLiquidityResolver;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";
    setup = new VaultBaseSetup();
    await setup.setup();
    resolver = new FluidLiquidityResolver(
      setup.admin,
      setup.liquidity,
      setup.client
    );
    vaultResolver = new VaultResolver(
      setup.admin,
      setup.vault,
      resolver,
      setup.client
    );
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  async function absorbMultipleBranches(positiveTick: boolean) {
    const vaultId = positiveTick ? 1 : 2;

    const collateral = new BN(10000).mul(
      new BN(10).pow(new BN(setup.getVaultSupplyTokenDecimals(vaultId)))
    );
    const debt = new BN(7990).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );
    const debtTwo = new BN(800).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // Set initial oracle price
    const oraclePrice = DEFAULT_ORACLE_PRICE;
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Create first two positions (positions 1 and 2)
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);
    await createCheckedPosition(
      vaultId,
      collateral,
      debtTwo,
      setup.alice,
      setup
    );

    // First liquidation: 500% price crash with substantial liquidation
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(500)
    );

    let liquidateAmt = new BN(500).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // First liquidation with absorb = true (creates branch 2)
    await performCheckedLiquidate(
      vaultId,
      liquidateAmt,
      setup.bob,
      setup,
      true
    );

    // Reset oracle price to original
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Create third position (position 3) - this should create another branch
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    // Second liquidation: 200% price crash
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(200)
    );

    liquidateAmt = new BN(200).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // Second liquidation with absorb = true (creates branch 3)
    await performCheckedLiquidate(
      vaultId,
      liquidateAmt,
      setup.bob,
      setup,
      true
    );

    // Get vault data after second liquidation
    let vaultData = await vaultResolver.getVaultEntireData(vaultId);

    // Reset oracle price to original
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Extreme price crash (1500% decrease) to trigger absorption of multiple branches
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(1500)
    );

    // Perform absorption liquidation (absorb = false by default for zero amounts)
    await performCheckedLiquidate(vaultId, new BN(0), setup.bob, setup);

    // Get vault data after absorption
    vaultData = await vaultResolver.getVaultEntireData(vaultId);

    // Verify that we're now on branch 3 (first and second branches got closed)
    expect(vaultData.vaultState.currentBranch).to.equal(3);

    // Reset oracle price again
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Final liquidation with larger amount
    const largeLiquidateAmt = new BN(5000).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    await performCheckedLiquidate(
      vaultId,
      largeLiquidateAmt,
      setup.bob,
      setup,
      true
    );

    // Get final vault data
    vaultData = await vaultResolver.getVaultEntireData(vaultId);

    // Verify that positions 1 and 3 were absorbed (supply and borrow should be 0)
    const { userPosition: position1 } = await vaultResolver.positionByNftId(
      1,
      vaultId
    );

    expect(position1.supply.toString()).to.equal("0");
    expect(position1.borrow.toString()).to.equal("0");

    const { userPosition: position3 } = await vaultResolver.positionByNftId(
      3,
      vaultId
    );

    expect(position3.supply.toString()).to.equal("0");
    expect(position3.borrow.toString()).to.equal("0");

    // Verify we're still on branch 3
    expect(vaultData.vaultState.currentBranch).to.equal(3);

    // Verify that position 2 is the top tick (the survivor)
    const { userPosition: position2 } = await vaultResolver.positionByNftId(
      2,
      vaultId
    );

    expect(vaultData.vaultState.topTick).to.equal(position2.tick);
  }

  it("should testAbsorbMultipleBranchesPositive", async () => {
    await absorbMultipleBranches(true);
  });

  it("should testAbsorbMultipleBranchesNegative", async () => {
    await absorbMultipleBranches(false);
  });
});

describe("vaults - absorbTickWhileBranchAsNextTopTick", () => {
  let setup: VaultBaseSetup;
  let vaultResolver: VaultResolver;
  let resolver: FluidLiquidityResolver;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";
    setup = new VaultBaseSetup();
    await setup.setup();
    resolver = new FluidLiquidityResolver(
      setup.admin,
      setup.liquidity,
      setup.client
    );
    vaultResolver = new VaultResolver(
      setup.admin,
      setup.vault,
      resolver,
      setup.client
    );
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  async function absorbTickWhileBranchAsNextTopTick(positiveTick: boolean) {
    const vaultId = positiveTick ? 1 : 2;

    const collateral = new BN(10000).mul(
      new BN(10).pow(new BN(setup.getVaultSupplyTokenDecimals(vaultId)))
    );
    const debt = new BN(7990).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // Set initial oracle price
    const oraclePrice = DEFAULT_ORACLE_PRICE;
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Create initial position (position 1)
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    // First liquidation: 200% price crash
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(200)
    );

    let liquidateAmt = new BN(500).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // First liquidation with absorb = true
    await performCheckedLiquidate(
      vaultId,
      liquidateAmt,
      setup.bob,
      setup,
      true
    );

    // Second liquidation: increase crash to 400% with larger liquidation amount
    liquidateAmt = new BN(1000).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(400)
    );

    // Second liquidation with absorb = true (this should create a branch)
    await performCheckedLiquidate(
      vaultId,
      liquidateAmt,
      setup.bob,
      setup,
      true
    );

    // Reset oracle price to original
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Create second position (position 2) - this should go to branch 2
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    // Verify we're on branch 2
    let vaultData = await vaultResolver.getVaultEntireData(vaultId);
    expect(vaultData.vaultState.currentBranch).to.equal(2);

    // Extreme price crash (1300% decrease) to trigger absorption
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(1300)
    );

    // Perform absorption liquidation (absorb = false by default for zero amounts)
    await performCheckedLiquidate(vaultId, new BN(0), setup.bob, setup);

    // Reset oracle price to original
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Get final vault data
    vaultData = await vaultResolver.getVaultEntireData(vaultId);

    // Verify that we're back to branch 1 (branch 2 got absorbed)
    expect(vaultData.vaultState.currentBranch).to.equal(1);

    // Verify that the first branch is in liquidated state
    expect(vaultData.vaultState.currentBranchState.status).to.equal(1);
  }

  it("should testAbsorbTickWhileBranchAsNextTopTickPositive", async () => {
    await absorbTickWhileBranchAsNextTopTick(true);
  });

  it("should testAbsorbTickWhileBranchAsNextTopTickNegative", async () => {
    await absorbTickWhileBranchAsNextTopTick(false);
  });
});

describe("vaults - absorbTickWhileBranchAsNextTopTick", () => {
  let setup: VaultBaseSetup;
  let vaultResolver: VaultResolver;
  let resolver: FluidLiquidityResolver;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";
    setup = new VaultBaseSetup();
    await setup.setup();
    resolver = new FluidLiquidityResolver(
      setup.admin,
      setup.liquidity,
      setup.client
    );
    vaultResolver = new VaultResolver(
      setup.admin,
      setup.vault,
      resolver,
      setup.client
    );
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  async function absorbTickWhileBranchAsNextTopTick(positiveTick: boolean) {
    const vaultId = positiveTick ? 1 : 2;

    const collateral = new BN(10000).mul(
      new BN(10).pow(new BN(setup.getVaultSupplyTokenDecimals(vaultId)))
    );
    const debt = new BN(7990).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // Set initial oracle price
    const oraclePrice = DEFAULT_ORACLE_PRICE;
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Create initial position (position 1)
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    // First liquidation: 200% price crash
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(200)
    );

    let liquidateAmt = new BN(500).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    // First liquidation with absorb = true
    await performCheckedLiquidate(
      vaultId,
      liquidateAmt,
      setup.bob,
      setup,
      true
    );

    // Second liquidation: increase crash to 400% with larger liquidation amount
    liquidateAmt = new BN(1000).mul(
      new BN(10).pow(new BN(setup.getVaultBorrowTokenDecimals(vaultId)))
    );

    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(400)
    );

    // Second liquidation with absorb = true (this should create a branch)
    await performCheckedLiquidate(
      vaultId,
      liquidateAmt,
      setup.bob,
      setup,
      true
    );

    // Reset oracle price to original
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Create second position (position 2) - this should go to branch 2
    await createCheckedPosition(vaultId, collateral, debt, setup.alice, setup);

    // Verify we're on branch 2
    let vaultData = await vaultResolver.getVaultEntireData(vaultId);
    expect(vaultData.vaultState.currentBranch).to.equal(2);

    // Extreme price crash (1300% decrease) to trigger absorption
    await setup.setOraclePricePercentDecrease(
      oraclePrice,
      positiveTick,
      new BN(1300)
    );

    // Perform absorption liquidation (absorb = false by default for zero amounts)
    await performCheckedLiquidate(vaultId, new BN(0), setup.bob, setup);

    // Reset oracle price to original
    await setup.setOraclePrice(oraclePrice, positiveTick);

    // Get final vault data
    vaultData = await vaultResolver.getVaultEntireData(vaultId);

    // Verify that we're back to branch 1 (branch 2 got absorbed)
    expect(vaultData.vaultState.currentBranch).to.equal(1);

    // Verify that the first branch is in liquidated state
    expect(vaultData.vaultState.currentBranchState.status).to.equal(1);
  }

  it("should testAbsorbTickWhileBranchAsNextTopTickPositive", async () => {
    await absorbTickWhileBranchAsNextTopTick(true);
  });

  it("should testAbsorbTickWhileBranchAsNextTopTickNegative", async () => {
    await absorbTickWhileBranchAsNextTopTick(false);
  });
});
