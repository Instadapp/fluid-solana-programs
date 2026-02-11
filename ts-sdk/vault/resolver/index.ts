import { Program } from "@coral-xyz/anchor";

import { Resolver } from "./resolver";
import { FluidLiquidityResolver } from "../../liquidity/resolver/resolver";
import { keypair } from "../../auth";

import { Vaults } from "../../../target/types/vaults";
import vaultsJson from "../../../target/idl/vaults.json";
import { provider } from "../../connection";
import { PublicKey } from "@solana/web3.js";
import { readableConsoleDump } from "../../util";
import { AdminModule } from "../module/admin";
import { mint as MintInfo, MintKeys } from "../../mint";
import { BN } from "bn.js";

const main = async () => {
  const program = new Program<Vaults>(vaultsJson, provider);
  const resolver = new Resolver(
    keypair,
    program,
    new FluidLiquidityResolver(keypair)
  );

  // const admin = new AdminModule(keypair, program);

  // await admin.initTickIdLiquidation(1, [3281]);

  await getVaultRewards(resolver, 1);

  // console.log(
  //   "vault admin account data:",
  //   readableConsoleDump(await resolver.readVaultAdmin())
  // );

  // const allVaultsData = [await resolver.getVaultEntireData(1)];

  // // const allVaultsData = await resolver.getAllVaultsEntireData();

  // // Print all tokens data in a human readable way
  // let idx = 1;
  // for await (const vaultData of allVaultsData) {
  //   console.log(`\nVault #${idx}:`);
  //   console.dir(readableConsoleDump(vaultData), {
  //     depth: null,
  //     colors: true,
  //   });

  //   const metadata = await resolver.readVaultMetadata({
  //     vaultId: vaultData.constantViews.vaultId,
  //   });

  //   console.log(`\n vault #${idx} metadata: `, readableConsoleDump(metadata));
  //   idx++;
  // }

  // get all vault positions:
  // const getVaultPositionsId = 2;
  // const filterAboveRiskRatio = 0;
  // const allPos = await getAllPositionsAboveRiskRatioForVault(
  //   resolver,
  //   getVaultPositionsId,
  //   filterAboveRiskRatio
  // );
  // console.log(
  //   `\n\n\n all vault positions for vault #${getVaultPositionsId} above risk ${filterAboveRiskRatio}: \n`,
  //   readableConsoleDump(allPos)
  // );

  // const vaultState = await resolver.getVaultState(4);

  // console.log(vaultState.currentBranchState.debtLiquidity.toString());
  // console.log(vaultState.currentBranchState.partials.toString());

  // const position = await resolver.positionByNftId(2, 4);
  // console.log(position.userPosition.supply.toString());
  // console.log(position.userPosition.dustBorrow.toString());
};

const getAllPositionsAboveRiskRatioForVault = async (
  resolver: Resolver,
  vaultId: number,
  riskRatio: number
) => {
  const positions = await resolver.getAllPositionsWithRiskRatio(vaultId);
  const filteredPositions = positions.filter((x) => x.riskRatio >= riskRatio);
  return filteredPositions;
};

const getVaultRewards = async (resolver: Resolver, vaultId: number) => {
  const vaultEntireData = await resolver.getVaultEntireData(vaultId);

  let supplyTokenDecimals: any = (
    await MintInfo.getTokenInfo(
      MintInfo.getMintForToken(
        vaultEntireData.constantViews.supplyToken
      ) as MintKeys
    )
  )[0]?.decimals;
  let borrowTokenDecimals: any = (
    await MintInfo.getTokenInfo(
      MintInfo.getMintForToken(
        vaultEntireData.constantViews.borrowToken
      ) as MintKeys
    )
  )[0]?.decimals;

  const totalSupplyLiquidity = new BN(
    vaultEntireData.totalSupplyAndBorrow.totalSupplyLiquidityOrDex
  );

  const totalBorrowLiquidity = new BN(
    vaultEntireData.totalSupplyAndBorrow.totalBorrowLiquidityOrDex
  );

  console.log("totalSupplyLiquidity", totalSupplyLiquidity.toString());
  console.log("totalBorrowLiquidity", totalBorrowLiquidity.toString());

  const supplyDecimalsScaleFactor =
    supplyTokenDecimals < 9
      ? new BN(10).pow(new BN(9 - supplyTokenDecimals))
      : new BN(1);

  const borrowDecimalsScaleFactor =
    borrowTokenDecimals < 9
      ? new BN(10).pow(new BN(9 - borrowTokenDecimals))
      : new BN(1);

  const totalSupplyVault = new BN(
    vaultEntireData.totalSupplyAndBorrow.totalSupplyVault
  ).div(supplyDecimalsScaleFactor);

  const totalBorrowVault = new BN(
    vaultEntireData.totalSupplyAndBorrow.totalBorrowVault
  ).div(borrowDecimalsScaleFactor);

  console.log("totalSupplyVault", totalSupplyVault.toString());
  console.log("totalBorrowVault", totalBorrowVault.toString());

  supplyTokenDecimals = new BN(10).pow(new BN(supplyTokenDecimals));
  borrowTokenDecimals = new BN(10).pow(new BN(borrowTokenDecimals));

  // if supplyDelta < 0, that means rewards are going on
  const supplyDelta = totalSupplyVault
    .sub(totalSupplyLiquidity)
    .div(new BN(supplyTokenDecimals));

  const borrowDelta = totalBorrowLiquidity
    .sub(totalBorrowVault)
    .div(borrowTokenDecimals);

  console.log(
    "\n\n----------------------------------- rewards deltas: ----------------------------------------------"
  );

  console.log("supplyDelta", supplyDelta.toString());
  console.log("borrowDelta", borrowDelta.toString());
};

main();
