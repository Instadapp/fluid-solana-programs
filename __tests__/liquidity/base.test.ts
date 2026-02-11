import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";

import { signer } from "../../ts-sdk/auth";
import { MintKeys } from "../../ts-sdk/mint";
import { mint as mintInfo } from "../../ts-sdk/mint";
import { getBorrowConfig, getSupplyConfig } from "../../ts-sdk/config";

import { tokenConfig } from "../../ts-sdk/config/token";
import { rateDataV2 } from "../../ts-sdk/config/rateDataV2";
import { rateDataV1 } from "../../ts-sdk/config/rateDataV1";
import { LiquidityBaseSetup } from "../../test-utils/typescript/liquidity/setup";

describe.skip("liquidity", () => {
  const setup = new LiquidityBaseSetup();

  beforeEach(async () => {
    process.env.TEST_MODE_JEST = "true";
    setup.prank(setup.admin);
  });

  afterEach(async () => {
    setup.logComputeBudget();
  });

  it("Should setup mints", async () => {
    await setup.setupSplTokenMints([
      MintKeys.USDC,
      MintKeys.USDT,
      MintKeys.WSOL,
      MintKeys.EURC,
    ]);
  });

  it("Should switch interest mode", async () => {
    await setup.setup();

    await setup._setUserAllowancesDefault(
      MintKeys.USDC,
      setup.mockProtocolInterestFree
    );
  });

  it("Should init liquidity", async () => {
    await setup.initLiquidity();

    const data = await setup.liquidity.account.liquidity.fetch(
      setup.adminModule.get_liquidity()
    );

    // False = unlocked
    expect(data.status).to.be.false;
    expect(data.authority.toString()).to.equal(
      setup.admin.publicKey.toString()
    );
    expect(data.revenueCollector.toString()).to.equal(
      setup.admin.publicKey.toString()
    );
  });

  it("Should update auths", async () => {
    await setup.updateAuths();

    const data = await setup.liquidity.account.authorizationList.fetch(
      setup.adminModule.get_auth_list()
    );

    expect(data.authUsers.length).to.equal(2);
    expect(data.authUsers.map((x) => x.toString())).to.contain(
      setup.signer.publicKey.toString()
    );
  });

  it("Should update guardians", async () => {
    const tx = await setup.updateGuardians();
    // console.log("    - tx:", tx);

    const data = await setup.liquidity.account.authorizationList.fetch(
      setup.adminModule.get_auth_list()
    );

    expect(data.guardians.length).to.equal(2);
    expect(data.guardians.map((x) => x.toString())).to.contain(
      setup.signer.publicKey.toString()
    );
  });

  it("Should update revenue collector", async () => {
    const tx = await setup.updateRevenueCollector();
    // console.log("    - tx:", tx);

    const data = await setup.liquidity.account.liquidity.fetch(
      setup.adminModule.get_liquidity()
    );

    expect(data.revenueCollector.toString()).to.equal(
      setup.signer.publicKey.toString()
    );
  });

  it("Should init token reserve", async () => {
    const mintKeys = [
      MintKeys.USDC,
      MintKeys.USDT,
      MintKeys.WSOL,
      MintKeys.EURC,
    ];

    await setup.initTokenReserve(mintKeys);

    for (const mint of mintKeys) {
      const data = await setup.liquidity.account.tokenReserve.fetch(
        setup.adminModule.get_reserve(mint)
      );

      expect(data.supplyExchangePrice.toString()).to.equal(
        new BN(1e12).toString()
      );
      expect(data.borrowExchangePrice.toString()).to.equal(
        new BN(1e12).toString()
      );
      expect(data.lastUpdateTimestamp.toNumber()).to.gt(0);
      expect(data.totalSupplyWithInterest.toString()).to.equal("0");
      expect(data.totalSupplyInterestFree.toString()).to.equal("0");
      expect(data.totalBorrowWithInterest.toString()).to.equal("0");
      expect(data.totalBorrowInterestFree.toString()).to.equal("0");
    }
  });

  it("Should update rate data v1", async () => {
    const tx = await setup.updateRateDataV1(rateDataV1);
    // console.log("    - tx:", tx);
  });

  it("Should update rate data v2", async () => {
    const tx = await setup.updateRateDataV2(rateDataV2);
    // console.log("    - tx:", tx);
  });

  it("Should update token configs", async () => {
    const tx = await setup.updateTokenConfigs(tokenConfig);
    // console.log("    - tx:", tx);
  });

  it("Should setup ATA for Liquidity", async () => {
    await setup.setupATA(
      mintInfo.getMint(MintKeys.USDC),
      setup.adminModule.get_liquidity(),
      0
    );

    await setup.setupATA(
      mintInfo.getMint(MintKeys.WSOL),
      setup.adminModule.get_liquidity(),
      0
    );

    await setup.setupATA(
      mintInfo.getMint(MintKeys.EURC),
      setup.adminModule.get_liquidity(),
      0
    );
  });

  it("Should setup ATA for user", async () => {
    await setup.setupATA(
      mintInfo.getMint(MintKeys.USDC),
      signer.publicKey,
      1e10
    );

    await setup.setupATA(
      mintInfo.getMint(MintKeys.WSOL),
      signer.publicKey,
      1e12
    );

    await setup.setupATA(
      mintInfo.getMint(MintKeys.EURC),
      signer.publicKey,
      1e10
    );
  });

  it("Should init new protocol", async () => {
    await setup.initNewProtocol([
      {
        supplyMint: MintKeys.USDC,
        borrowMint: MintKeys.USDC,
        protocol: setup.mockProtocol.publicKey,
      },
      {
        supplyMint: MintKeys.WSOL,
        borrowMint: MintKeys.WSOL,
        protocol: setup.mockProtocol.publicKey,
      },
      {
        supplyMint: MintKeys.EURC,
        borrowMint: MintKeys.EURC,
        protocol: setup.mockProtocol.publicKey,
      },
    ]);

    const data = await setup.liquidity.account.userSupplyPosition.fetch(
      setup.adminModule.get_user_supply_position(
        MintKeys.USDC,
        setup.mockProtocol.publicKey
      )
    );

    expect(data.protocol.toString()).to.equal(
      setup.mockProtocol.publicKey.toString()
    );
  });

  it("Should update user supply config", async () => {
    const configs = [
      {
        mint: MintKeys.USDC,
        newSupplyConfig: getSupplyConfig(
          setup.mockProtocol.publicKey,
          MintKeys.USDC
        ),
      },
      {
        mint: MintKeys.WSOL,
        newSupplyConfig: getSupplyConfig(
          setup.mockProtocol.publicKey,
          MintKeys.WSOL
        ),
      },
      {
        mint: MintKeys.EURC,
        newSupplyConfig: getSupplyConfig(
          setup.mockProtocol.publicKey,
          MintKeys.EURC
        ),
      },
    ];

    const accounts = setup.adminModule.getUpdateUserSupplyConfigContext({
      protocol: setup.mockProtocol.publicKey,
      mint: MintKeys.USDC,
    });

    for (const [k, v] of Object.entries(accounts)) {
      const aInfo = setup.client.getAccount(v);
      if (!aInfo) console.log("Account not found", k);
    }

    await setup.updateUserSupplyConfig(configs);
  });

  it("Should update user borrow config", async () => {
    const configs = [
      {
        mint: MintKeys.USDC,
        newBorrowConfig: getBorrowConfig(
          setup.mockProtocol.publicKey,
          MintKeys.USDC
        ),
      },
      {
        mint: MintKeys.EURC,
        newBorrowConfig: getBorrowConfig(
          setup.mockProtocol.publicKey,
          MintKeys.EURC
        ),
      },
    ];

    const accounts = setup.adminModule.getUpdateUserBorrowConfigContext({
      protocol: setup.mockProtocol.publicKey,
      mint: MintKeys.USDC,
    });

    for (const [k, v] of Object.entries(accounts)) {
      const aInfo = setup.client.getAccount(v);
      if (!aInfo) console.log("Account not found", k);
    }

    await setup.updateUserBorrowConfig(configs);
  });
});
