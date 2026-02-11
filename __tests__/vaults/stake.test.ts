import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { StakeProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";

import { mint as MintInfo } from "../../ts-sdk/mint";
import {
  StakeSetup,
  SINGLE_POOL_STAKE_ACCOUNT,
  SINGLE_POOL_MINT,
  SINGLE_POOL_VAULT_ID,
  STAKE_RENT,
} from "../../test-utils/typescript/stake/setup";
import { BigNumber } from "bignumber.js";

const DEFAULT_ORACLE_PRICE = new BN(1059262514823212);
const ORACLE_PRECISION = new BN(10).pow(new BN(15));
const MIN_I128 = new BN("170141183460469231731687303715884105728").neg(); // Maximum repay amount

describe("Helius Single Pool Stake Integration", () => {
  let setup: StakeSetup;

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";
    setup = new StakeSetup();
    await setup.setup();
    await setup.setOraclePrice(DEFAULT_ORACLE_PRICE);
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  describe("Address Derivation", () => {
    it("derives pool mint and stake from Helius vote account", async () => {
      expect(setup.poolMint.toBase58()).to.equal(SINGLE_POOL_MINT);
      expect(setup.poolStake.toBase58()).to.equal(SINGLE_POOL_STAKE_ACCOUNT);
      expect(setup.poolStakeAuthority).to.not.be.empty;
      expect(setup.poolMintAuthority).to.not.be.empty;

      const poolMintInfo = setup.getAccountData(setup.poolMint);
      const poolStakeInfo = setup.getAccountData(setup.poolStake);
      expect(poolMintInfo).to.not.be.null;
      expect(poolStakeInfo).to.not.be.null;
    });
  });

  describe("Stake Account Operations", () => {
    it("creates stake account ready for single pool deposit", async () => {
      const user = setup.alice;
      const stakeAmount = BigInt(10 * LAMPORTS_PER_SOL);

      // here we set up the account directly in delegated state
      // in actual scenario user will have stake account which intialized and delegated
      const stakeAccount = setup.createUserStakeAccount(user, stakeAmount);
      const stakeAccountInfo = setup.getAccountData(stakeAccount.publicKey);

      expect(stakeAccountInfo).to.not.be.null;
      expect(stakeAccountInfo?.owner.equals(StakeProgram.programId)).to.be.true;
      expect(stakeAccountInfo?.lamports).to.equal(
        Number(stakeAmount) + STAKE_RENT
      );
      expect(stakeAccountInfo?.data).to.not.be.null;
      expect(stakeAccountInfo?.data.length).to.be.greaterThan(0);
    });

    it("sets up delegated stake account for Helius validator", async () => {
      const user = setup.alice;
      const stakeAmount = BigInt(5 * LAMPORTS_PER_SOL);

      const userStakeAccount = setup.createUserStakeAccount(user, stakeAmount);

      const stakeAccountInfo = setup.getAccountData(userStakeAccount.publicKey);
      expect(stakeAccountInfo).to.not.be.null;
      expect(stakeAccountInfo?.owner.equals(StakeProgram.programId)).to.be.true;
      expect(stakeAccountInfo?.lamports).to.equal(
        Number(stakeAmount) + STAKE_RENT
      );
    });

    it("can create multiple stake accounts for partial deposits", async () => {
      const user = setup.alice;
      const stakeAmount1 = BigInt(10 * LAMPORTS_PER_SOL);
      const stakeAmount2 = BigInt(5 * LAMPORTS_PER_SOL);

      // create two stake accounts - simulating a user who wants to deposit partially
      const stakeAccount1 = setup.createUserStakeAccount(user, stakeAmount1);
      const stakeAccount2 = setup.createUserStakeAccount(user, stakeAmount2);

      const account1Info = setup.getAccountData(stakeAccount1.publicKey);
      const account2Info = setup.getAccountData(stakeAccount2.publicKey);

      expect(account1Info?.lamports).to.equal(
        Number(stakeAmount1) + STAKE_RENT
      );
      expect(account2Info?.lamports).to.equal(
        Number(stakeAmount2) + STAKE_RENT
      );
      expect(account1Info?.owner.equals(StakeProgram.programId)).to.be.true;
      expect(account2Info?.owner.equals(StakeProgram.programId)).to.be.true;
    });
  });

  describe("Single Pool Deposit via Program", () => {
    it("deposits stake to single pool and receives minted tokens", async () => {
      const user = setup.alice;
      const userStakeAmount = BigInt(5 * LAMPORTS_PER_SOL);

      const { poolTokensReceived, userTokenAccount } =
        await setup.executeStakeDeposit(user, userStakeAmount);

      expect(poolTokensReceived.gt(new BN(0))).to.be.true;

      const initialSolBig = new BigNumber(userStakeAmount.toString());
      const calculatedSOlBig = new BigNumber(poolTokensReceived.toString())
        .multipliedBy(new BigNumber(DEFAULT_ORACLE_PRICE.toString()))
        .div(new BigNumber(ORACLE_PRECISION.toString()));

      // Allow 1% tolerance for rounding errors
      const diff = initialSolBig.minus(calculatedSOlBig);
      const tolerance = initialSolBig.div(new BigNumber(100));
      expect(diff.lte(tolerance)).to.be.true;

      const tokenAccountInfo = setup.getAccountData(userTokenAccount);
      expect(tokenAccountInfo).to.not.be.null;
    });
  });

  describe.skip("End-to-End Deposit: Stake → Single Pool → Vault → Borrow", () => {
    it("deposits stake to single pool, uses minted tokens as vault collateral, borrows SOL", async () => {
      const vaultId = SINGLE_POOL_VAULT_ID;
      const user = setup.alice;
      const positionId = 1;
      const userStakeAmount = BigInt(10 * LAMPORTS_PER_SOL);

      const supplyToken = MintInfo.getMint(setup.getVaultSupplyToken(vaultId));
      const borrowToken = MintInfo.getMint(setup.getVaultBorrowToken(vaultId));

      // Step 1: Deposit stake to single pool
      const { poolTokensReceived } = await setup.executeStakeDeposit(
        user,
        userStakeAmount
      );
      expect(poolTokensReceived.gt(new BN(0))).to.be.true;

      const poolTokensBeforeBN = await setup.balanceOf(
        user.publicKey,
        setup.poolMint
      );
      const poolTokensBefore = new BigNumber(poolTokensBeforeBN.toString());
      const poolTokensReceivedBN = new BigNumber(poolTokensReceived.toString());
      expect(poolTokensBefore.isEqualTo(poolTokensReceivedBN)).to.be.true;

      // Step 2: Init vault position
      await setup.initPosition(vaultId, user);
      const position = await setup.vaultModule.readUserPosition({
        vaultId,
        positionId,
      });
      expect(position).to.not.be.null;

      const collateralAmount = poolTokensReceived.sub(new BN(1));
      const collateralBeforeBN = await setup.balanceOf(
        user.publicKey,
        supplyToken
      );
      const collateralBefore = new BigNumber(collateralBeforeBN.toString());

      await setup.operateVault({
        vaultId,
        positionId,
        user,
        positionOwner: user,
        collateralAmount,
        debtAmount: new BN(0),
        recipient: user,
      });

      const collateralAfterBN = await setup.balanceOf(
        user.publicKey,
        supplyToken
      );
      const collateralAfter = new BigNumber(collateralAfterBN.toString());
      const expectedDeposit = new BigNumber(
        collateralAmount.add(new BN(1)).toString()
      );
      const actualDeposited = collateralBefore.minus(collateralAfter);
      expect(actualDeposited.isEqualTo(expectedDeposit)).to.be.true;

      const positionAfterDeposit = await setup.vaultModule.readUserPosition({
        vaultId,
        positionId,
      });
      expect(positionAfterDeposit?.supplyAmount.gt(new BN(0))).to.be.true;

      // Step 4: Borrow SOL against collateral
      const borrowBeforeBN = await setup.balanceOf(user.publicKey, borrowToken);
      const borrowBefore = new BigNumber(borrowBeforeBN.toString());
      const borrowAmount = new BN("2000000000"); // 2 SOL (9 decimals)
      const borrowAmountBN = new BigNumber(borrowAmount.toString());

      await setup.operateVault({
        vaultId,
        positionId,
        user,
        positionOwner: user,
        collateralAmount: new BN(0),
        debtAmount: borrowAmount,
        recipient: user,
      });

      const borrowAfterBN = await setup.balanceOf(user.publicKey, borrowToken);
      const borrowAfter = new BigNumber(borrowAfterBN.toString());
      const actualBorrowed = borrowAfter.minus(borrowBefore);
      expect(actualBorrowed.isEqualTo(borrowAmountBN)).to.be.true;
      expect(borrowAfter.gt(borrowBefore)).to.be.true;
    });

    it("completes reverse flow: repay debt → withdraw collateral → withdraw from single pool", async () => {
      const vaultId = SINGLE_POOL_VAULT_ID;
      const user = setup.alice;
      const user2 = setup.bob;
      const positionId = 1;
      const positionId2 = 2;
      const userStakeAmount = BigInt(10 * LAMPORTS_PER_SOL);

      const supplyToken = MintInfo.getMint(setup.getVaultSupplyToken(vaultId));
      const borrowToken = MintInfo.getMint(setup.getVaultBorrowToken(vaultId));

      // Step 1: Set up positions (deposit stake → get pool tokens → deposit to vault → borrow SOL)
      const { poolTokensReceived, userStakeAccount, userTokenAccount } =
        await setup.executeStakeDeposit(user, userStakeAmount);

      const { poolTokensReceived: poolTokensReceived2 } =
        await setup.executeStakeDeposit(user2, userStakeAmount);

      await setup.initPosition(vaultId, user);
      await setup.initPosition(vaultId, user2);

      const collateralAmount = poolTokensReceived.sub(new BN(1));
      const collateralAmount2 = poolTokensReceived2.sub(new BN(1));

      await setup.operateVault({
        vaultId,
        positionId,
        user,
        positionOwner: user,
        collateralAmount,
        debtAmount: new BN(0),
        recipient: user,
      });

      await setup.operateVault({
        vaultId,
        positionId: positionId2,
        user: user2,
        positionOwner: user2,
        collateralAmount: collateralAmount2,
        debtAmount: new BN(0),
        recipient: user2,
      });

      const collateralBalanceAfterDeposit = await setup.balanceOf(
        user.publicKey,
        supplyToken
      );

      const borrowBalanceBeforeBorrow = await setup.balanceOf(
        user.publicKey,
        borrowToken
      );

      const borrowAmount = new BN("2000000000"); // 2 SOL
      await setup.operateVault({
        vaultId,
        positionId: positionId2,
        user: user2,
        positionOwner: user2,
        collateralAmount: new BN(0),
        debtAmount: borrowAmount,
        recipient: user2,
      });

      await setup.operateVault({
        vaultId,
        positionId,
        user,
        positionOwner: user,
        collateralAmount: new BN(0),
        debtAmount: borrowAmount,
        recipient: user,
      });

      const borrowBalanceAfterBorrow = await setup.balanceOf(
        user.publicKey,
        borrowToken
      );
      const actualBorrowed = borrowBalanceAfterBorrow.sub(
        borrowBalanceBeforeBorrow
      );
      expect(actualBorrowed.gte(borrowAmount)).to.be.true;

      // Step 2: Repay all borrowed SOL
      await setup.operateVault({
        vaultId,
        positionId,
        user,
        positionOwner: user,
        collateralAmount: new BN(0),
        debtAmount: MIN_I128,
        recipient: user,
      });

      const borrowBalanceAfterRepay = await setup.balanceOf(
        user.publicKey,
        borrowToken
      );
      const actualRepaid = borrowBalanceAfterBorrow.sub(
        borrowBalanceAfterRepay
      );
      expect(actualRepaid.gte(actualBorrowed.sub(new BN(1000)))).to.be.true; // 1000 lamports tolerance

      const positionAfterRepay = await setup.vaultModule.readUserPosition({
        vaultId,
        positionId,
      });
      expect(
        positionAfterRepay?.debtAmount?.isZero() ||
          positionAfterRepay?.debtAmount === undefined
      ).to.be.true;

      // Step 3: Withdraw all collateral
      await setup.operateVault({
        vaultId,
        positionId,
        user,
        positionOwner: user,
        collateralAmount: MIN_I128,
        debtAmount: new BN(0),
        recipient: user,
      });

      const collateralBalanceAfterWithdraw = await setup.balanceOf(
        user.publicKey,
        supplyToken
      );
      const actualWithdrawn = collateralBalanceAfterWithdraw.sub(
        collateralBalanceAfterDeposit
      );
      const withdrawalDifference = actualWithdrawn.sub(collateralAmount);
      const withdrawalTolerance = collateralAmount
        .mul(new BN(5))
        .div(new BN(100)); // 5% tolerance
      expect(withdrawalDifference.abs().lte(withdrawalTolerance)).to.be.true;

      // Step 4: Withdraw from single pool (redeem pool tokens back to stake)
      // Verify we have pool tokens to withdraw
      const poolTokensBeforeWithdraw = await setup.balanceOf(
        user.publicKey,
        setup.poolMint
      );
      expect(poolTokensBeforeWithdraw.gt(new BN(0))).to.be.true;

      const withdrawTokenAmount = BigInt(
        collateralBalanceAfterWithdraw.toString()
      );
      const stakeAccountInfoBefore = setup.getAccountData(
        userStakeAccount.publicKey
      );
      if (!stakeAccountInfoBefore) {
        throw new Error("Failed to fetch stake account info before withdrawal");
      }
      const stakeBeforeBN = new BN(stakeAccountInfoBefore.lamports).sub(
        new BN(STAKE_RENT)
      );
      const stakeBefore = new BigNumber(stakeBeforeBN.toString());

      await setup.executeStakeWithdraw(
        user,
        userStakeAccount,
        userTokenAccount,
        withdrawTokenAmount
      );

      const poolTokensAfterBN = await setup.balanceOf(
        user.publicKey,
        setup.poolMint
      );
      const poolTokensAfter = new BigNumber(poolTokensAfterBN.toString());
      expect(poolTokensAfter.isZero()).to.be.true;

      const stakeAccountInfoAfter = setup.getAccountData(
        userStakeAccount.publicKey
      );
      if (!stakeAccountInfoAfter) {
        throw new Error("Failed to fetch stake account info after withdrawal");
      }
      const stakeAfterBN = new BN(stakeAccountInfoAfter.lamports).sub(
        new BN(STAKE_RENT)
      );
      const stakeAfter = new BigNumber(stakeAfterBN.toString());
      expect(stakeAfter.gt(stakeBefore)).to.be.true;

      const stakeReceived = stakeAfter.minus(stakeBefore);
      const initialStakeBN = new BigNumber(userStakeAmount.toString());
      const stakeReceivedBN = new BigNumber(stakeReceived.toString());
      const diff = initialStakeBN.minus(stakeReceivedBN).abs();
      const stakeTolerance = initialStakeBN.div(100); // 1% tolerance
      expect(diff.lte(stakeTolerance)).to.be.true;
    });
  });
});
