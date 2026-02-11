import { signer } from "../../auth";
import { readableConsoleDump } from "../../util";
import { FluidLiquidityResolver } from "./resolver";

async function example() {
  const resolver = new FluidLiquidityResolver(signer.payer);

  console.log(
    "admin authority:",
    readableConsoleDump((await resolver.getLiquidityAccount()).authority)
  );

  try {
    // Get a list of all supported tokens
    const tokens = await resolver.listedTokens();
    console.log(
      "Listed Tokens:",
      tokens.map((t) => t.toString())
    );

    // Get detailed data for all tokens
    const allTokensData = await resolver.getAllOverallTokensData();
    const allPositions = []; // await resolver.getAllUserPositions();

    await fullDump(allTokensData, resolver, allPositions);

    // console.log(
    //   "All Tokens Data:",
    //   allTokensData.map((t) => {
    //     const token = t.rateData.rateDataV1.token
    //       ? t.rateData.rateDataV1.token.toString()
    //       : t.rateData.rateDataV2.token.toString();

    //     return {
    //       token: token,
    //       supplyRate: t.supplyRate.toString(),
    //       borrowRate: t.borrowRate.toString(),
    //       totalSupply: t.totalSupply.toString(),
    //       totalBorrow: t.totalBorrow.toString(),
    //       supplyRawInterest: t.supplyRawInterest.toString(),
    //       supplyInterestFree: t.supplyInterestFree.toString(),
    //       borrowRawInterest: t.borrowRawInterest.toString(),
    //       borrowInterestFree: t.borrowInterestFree.toString(),
    //       supplyExchangePrice: t.supplyExchangePrice.toString(),
    //       borrowExchangePrice: t.borrowExchangePrice.toString(),
    //       revenue: t.revenue.toString(),
    //     };
    //   })
    // );
  } catch (error) {
    console.error("Error using resolver:", error);
  }
}

const fullDump = async (allTokensData, resolver, userPositions) => {
  // Print all tokens data in a human readable way
  // allTokensData.forEach((tokenData, idx) => {
  //   console.log(`\nToken #${idx + 1}:`);
  //   console.dir(readableConsoleDump(tokenData), {
  //     depth: null,
  //     colors: true,
  //   });
  // });

  // // Print all user positions in a human readable way
  // userPositions.forEach((userPos, idx) => {
  //   console.log(`\nUser Position #${idx + 1}:`);
  //   console.dir(readableConsoleDump(userPos), {
  //     depth: null,
  //     colors: true,
  //   });
  // });

  // Fetch the liquidity account to get all relevant addresses
  const liquidityAccount = await resolver.getLiquidityAccount();

  // 4. Revenue collector
  const revenueCollector = liquidityAccount.revenueCollector
    ? liquidityAccount.revenueCollector.toString()
    : "N/A";

  // Print results
  console.log("\nAddresses with user class set:");
  console.log("liquidityAccount user classes", liquidityAccount.userClasses);

  console.log("\nAuth addresses:");
  console.log("liquidityAccount auths", liquidityAccount.auths);

  console.log("\nGuardian addresses:");
  console.log("liquidityAccount guardians", liquidityAccount.guardians);

  console.log("\nRevenue Collector:");
  console.log(`  ${revenueCollector}`);

  const status = liquidityAccount.status;
  console.log("\nLiquidity Status:");
  if (typeof status !== "undefined") {
    console.log(`"${status}"`);
  } else {
    console.log("Status field is missing or undefined in liquidityAccount.");
  }
};

if (require.main === module) {
  example().then(
    () => process.exit(0),
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}
