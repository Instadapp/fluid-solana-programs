import { BN, Program } from "@coral-xyz/anchor";

import { Resolver } from "./resolver";
import { FluidLiquidityResolver } from "../../liquidity/resolver/resolver";
import { keypair } from "../../auth";

import { Vaults } from "../../../target/types/vaults";
import vaultsJson from "../../../target/idl/vaults.json";
import { provider } from "../../connection";

const main = async () => {
  const program = new Program<Vaults>(vaultsJson, provider);
  const resolver = new Resolver(
    keypair,
    program,
    new FluidLiquidityResolver(keypair)
  );

  let supplyTokenDecimals: any = 6;
  let borrowTokenDecimals: any = 6;

  const vaultEntierData = await resolver.getVaultEntireData(7);

  let liquiditySupplyExchangePrice = new BN(
    vaultEntierData.exchangePricesAndRates.liquiditySupplyExchangePrice
  );
  let vaultSupplyExchangePrice = new BN(
    vaultEntierData.exchangePricesAndRates.vaultSupplyExchangePrice
  );
  let liquidityBorrowExchangePrice = new BN(
    vaultEntierData.exchangePricesAndRates.liquidityBorrowExchangePrice
  );
  let vaultBorrowExchangePrice = new BN(
    vaultEntierData.exchangePricesAndRates.vaultBorrowExchangePrice
  );

  const totalSupplyLiquidity = new BN(
    vaultEntierData.liquidityUserSupplyData.supply
  )
    .mul(liquiditySupplyExchangePrice)
    .div(resolver.EXCHANGE_PRICES_PRECISION);

  const totalBorrowLiquidity = new BN(
    vaultEntierData.liquidityUserBorrowData.borrow
  )
    .mul(liquidityBorrowExchangePrice)
    .div(resolver.EXCHANGE_PRICES_PRECISION);

  const supplyDecimalsScaleFactor =
    supplyTokenDecimals < 9
      ? new BN(10).pow(new BN(9 - supplyTokenDecimals))
      : new BN(1);

  const borrowDecimalsScaleFactor =
    borrowTokenDecimals < 9
      ? new BN(10).pow(new BN(9 - borrowTokenDecimals))
      : new BN(1);

  const totalSupplyVault = new BN(vaultEntierData.vaultState.totalSupply)
    .mul(new BN(vaultSupplyExchangePrice))
    .div(resolver.EXCHANGE_PRICES_PRECISION)
    .div(supplyDecimalsScaleFactor);

  const totalBorrowVault = new BN(vaultEntierData.vaultState.totalBorrow)
    .mul(new BN(vaultBorrowExchangePrice))
    .div(resolver.EXCHANGE_PRICES_PRECISION)
    .div(borrowDecimalsScaleFactor);

  supplyTokenDecimals = new BN(10).pow(new BN(supplyTokenDecimals));
  borrowTokenDecimals = new BN(10).pow(new BN(borrowTokenDecimals));

  // if supplyDelta < 0, that means rewards are going on
  const supplyDelta = totalSupplyVault
    .sub(totalSupplyLiquidity)
    .div(new BN(supplyTokenDecimals));

  // if borrowDelta > 0, that means discount on debt on vaults side
  const borrowDelta = totalBorrowLiquidity
    .sub(totalBorrowVault)
    .div(borrowTokenDecimals);

  console.log("supplyDelta", supplyDelta.toString());
  console.log("borrowDelta", borrowDelta.toString());
};

main();
