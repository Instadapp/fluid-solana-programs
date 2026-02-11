import { LendingResolver } from "./index";
import { signer } from "../../auth";
import { MintKeys, mint as MintInfo } from "../../mint";
import { BN } from "@coral-xyz/anchor";
import { CONSTANTS } from "../../liquidity/resolver/types";

const main = async () => {
  process.env.TEST_MODE_JEST = "true";

  const resolver = new LendingResolver(signer.payer);

  const lendings = await resolver.program.account.lending.all();

  for (const lending of lendings) {
    const mintKey = MintInfo.getMintForToken(lending.account.mint) as MintKeys;

    const fTokenInternalData = await resolver.getFTokenInternalData(mintKey);
    const fTokensDetails = await resolver.getFTokenDetails(mintKey);
    // total supply of ftokens

    const totalSupplyLending = fTokensDetails.totalSupply
      .mul(fTokenInternalData.tokenExchangePrice)
      .div(CONSTANTS.EXCHANGE_PRICES_PRECISION);

    const totalSupplyLiquidity = new BN(
      fTokensDetails.userSupplyData.supply.toString()
    );

    const decimals = new BN(10).pow(new BN(fTokensDetails.decimals));

    // if supplyDelta < 0, that means rewards are going on
    const supplyDelta = totalSupplyLending
      .sub(totalSupplyLiquidity)
      .div(decimals);

    console.log(mintKey, supplyDelta.toString());
  }
};

main();
