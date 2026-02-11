import { BN, Program, BorshCoder, EventParser, Idl } from "@coral-xyz/anchor";
import {
  AccountInfo,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  createTransferInstruction,
} from "@solana/spl-token";

import { Vaults } from "../../../target/types/vaults";
import vaultsJson from "../../../target/idl/vaults.json";

import { Oracle } from "../../../target/types/oracle";
import oracleJson from "../../../target/idl/oracle.json";

import { VAULTS_PROGRAM } from "../../../ts-sdk/address";
import { LiquidityBaseSetup } from "../liquidity/setup";
import LookUpAccountInfoJson from "../accountInfo.json";
import { UserModule } from "../../../ts-sdk/vault/module/user";
import { MintKeys, mint as MintInfo } from "../../../ts-sdk/mint";
import { InitVaultConfigParams } from "../../../ts-sdk/vault/config/vault";
import { TOKEN_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PythV2BufferUpdater } from "./oracle";
import { ORACLE_PROGRAM } from "../../../ts-sdk/address";
import { TransferType } from "../../../ts-sdk/vault/context/context";
import { enumMap } from "../../../ts-sdk/vault/module/user";
import { VaultResolver } from "../vaults/resolver";
import { FluidLiquidityResolver } from "../liquidity/resolver";
import { UpdateCoreSettingsParams } from "../../../ts-sdk/vault/module/admin";

export enum SourceType {
  pyth = 0,
  chainlink = 1,
}

export type OPERATE_VARS = {
  vaultId: number;
  positionId: number;
  user: Keypair; // user who is operating the vault
  positionOwner: Keypair; // owner of the position
  collateralAmount: BN;
  debtAmount: BN;
  recipient: Keypair;
  transferType?: TransferType;
};

export type LIQUIDATE_VARS = {
  vaultId: number;
  user: Keypair;
  to: Keypair;
  debtAmount: BN;
  colPerUnitDebt: BN;
  absorb: boolean;
};

const SOL_USDC_FEED = "HT2PLQBcG5EiCcNSaMHAjSgd9F98ecpATbk4Sk5oYuM";
let sourceAccountInfo: AccountInfo<Buffer> | null;

export class VaultBaseSetup extends LiquidityBaseSetup {
  vaultModule: UserModule;
  vault: Program<Vaults>;
  oracle: Program<Oracle>;
  vaultToLookUpTableMap: Map<number, PublicKey> = new Map();
  vaultResolver: VaultResolver;

  vaultOne: PublicKey;
  vaultTwo: PublicKey;
  vaultThree: PublicKey;
  vaultFour: PublicKey;
  vaultFive: PublicKey;

  oracleOne: Program<Oracle>;
  oracleTwo: Program<Oracle>;
  oracleThree: Program<Oracle>;
  oracleFour: Program<Oracle>;
  oracleFive: Program<Oracle>;

  oraclePrice: BN;

  supplyTokenDecimals: number;
  borrowTokenDecimals: number;
  nativeTokenDecimals: number;
  singlePoolTokenDecimals: number;

  supplyToken: MintKeys;
  borrowToken: MintKeys;
  nativeToken: MintKeys;
  heliusSinglePoolToken: MintKeys;

  MIN_TICK = -16383;

  MAX_TICK_SINGLE_TX = 15;
  MAX_BRANCH_SINGLE_TX = 15;
  MAX_TICK_ID_LIQUIDATION_SINGLE_TX = 8;
  MAX_TICK_HAS_DEBT_ARRAY_SINGLE_TX = 15;

  constructor() {
    super();

    this.addProgram(VAULTS_PROGRAM, "target/deploy/vaults.so", "Vaults");
    this.addProgram(ORACLE_PROGRAM, "target/deploy/oracle.so", "Oracle");

    // Single Pool and Stake programs for single pool vault
    this.addProgram("SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE", "test-utils/typescript/binaries/singlepool.so", "SinglePool");
    this.addProgram("Stake11111111111111111111111111111111111111", "test-utils/typescript/binaries/stake.so", "Stake");

    this.vault = new Program<Vaults>(
      { ...vaultsJson, address: new PublicKey(VAULTS_PROGRAM) },
      this.provider
    );

    this.oracle = new Program<Oracle>(
      { ...oracleJson, address: new PublicKey(ORACLE_PROGRAM) },
      this.provider
    );

    this.vaultModule = new UserModule(this.admin, this.vault);

    this.supplyToken = MintKeys.USDC;
    this.borrowToken = MintKeys.USDT;
    this.nativeToken = MintKeys.WSOL;
    this.heliusSinglePoolToken = MintKeys.HELIUS_SINGLE_POOL;

    this.supplyTokenDecimals = 6;
    this.borrowTokenDecimals = 6;
    this.nativeTokenDecimals = 9;
    this.singlePoolTokenDecimals = 9;

    this.vaultResolver = new VaultResolver(
      this.admin,
      this.vault,
      new FluidLiquidityResolver(this.admin, this.liquidity, this.client),
      this.client
    );
  }

  async setup() {
    // Handle the liquidity setup first
    await super.setup();

    if (!sourceAccountInfo) {
      sourceAccountInfo = await this.getOnchainAccountInfo(
        new PublicKey(SOL_USDC_FEED) // SOL / USDC feed
      );
    }

    this.prank(this.admin);

    // Init vault Admin first
    {
      let tx = this.getTx();
      tx.add(await this.vaultModule.initVaultAdminIx(this.admin.publicKey));
      this.execute(tx);
    }

    await this.initOracleAdmin();

    this.oracleOne = await this.deployOracle(1);
    this.oracleTwo = await this.deployOracle(2);
    this.oracleThree = await this.deployOracle(3);
    this.oracleFour = await this.deployOracle(4);
    this.oracleFive = await this.deployOracle(5); // Single Pool Oracle

    for (const vaultId of [1, 2, 3, 4, 5]) this.deployLookupTable(vaultId);

    // Init vaults
    this.vaultOne = await this.initVault(1);
    this.vaultTwo = await this.initVault(2);
    this.vaultThree = await this.initVault(3);
    this.vaultFour = await this.initVault(4);
    this.vaultFive = await this.initVault(5); // Single Pool / USDC Vault

    // prettier-ignore
    // set default allowances for vault
    for (const vaultId of [1, 2, 3, 4, 5]) {
      const supplyMint = this.getVaultSupplyToken(vaultId);
      const borrowMint = this.getVaultBorrowToken(vaultId);
      const protocol = this.getVault(vaultId);

      await this.initNewProtocol([{ supplyMint, borrowMint: supplyMint, protocol }]);
      await this.initNewProtocol([{ supplyMint: borrowMint, borrowMint, protocol }]);
      await this._setUserAllowancesDefault(supplyMint, protocol);
      await this._setUserAllowancesDefault(borrowMint, protocol);
    }

    // set default allowances for mockProtocol
    for (const mint of [this.supplyToken, this.borrowToken, this.nativeToken, this.heliusSinglePoolToken]) {
      await this._setUserAllowancesDefault(mint, this.mockProtocol);
    }

    // prettier-ignore
    {
      for (const mint of [this.supplyToken, this.borrowToken, this.nativeToken, this.heliusSinglePoolToken]) {
        await this.initClaimAccount(mint, this.vaultModule.get_vault_config({ vaultId: 1 }));
        await this.initClaimAccount(mint, this.vaultModule.get_vault_config({ vaultId: 2 }));
        await this.initClaimAccount(mint, this.vaultModule.get_vault_config({ vaultId: 3 }));
        await this.initClaimAccount(mint, this.vaultModule.get_vault_config({ vaultId: 4 }));
        await this.initClaimAccount(mint, this.vaultModule.get_vault_config({ vaultId: 5 }));
      }
    }

    {
      await this.deposit(
        this.mockProtocol,
        new BN(100e12), // supply 100 million
        this.supplyToken,
        this.alice
      );

      await this.deposit(
        this.mockProtocol,
        new BN(100e12), // supply 100 million
        this.borrowToken,
        this.alice
      );

      await this.depositNative(
        this.mockProtocol,
        new BN(100e12), // supply 100 million
        this.nativeToken,
        this.alice
      );

      await this.depositNative(
        this.mockProtocol,
        new BN(100e12), // supply 100 million
        this.heliusSinglePoolToken,
        this.alice
      );
    }
  }

  parseEvents(logs: Array<string>) {
    const parser = new EventParser(
      new PublicKey(vaultsJson.address),
      new BorshCoder(vaultsJson as Idl)
    );

    return parser.parseLogs(logs);
  }

  unscaleAmounts(amount: BN, vaultId: number) {
    const scaleFactor = this.getDecimalScaleFactor(
      this.getVaultSupplyToken(vaultId)
    );

    return amount.div(scaleFactor);
  }

  async createPositionInEveryTickArrayRange(vaultId: number, oraclePrice: BN) {
    // collateral factor is debt per collateral
    const collateralFactor = (
      await this.vault.account.vaultConfig.fetch(
        this.vaultModule.get_vault_config({ vaultId })
      )
    ).collateralFactor;

    // since oracle price is in 1e15 decimals, we need to divide by 1e15
    const maxRawCollateralFactor = new BN(collateralFactor)
      .mul(new BN(10).pow(new BN(8)))
      .div(oraclePrice)
      .toNumber();

    const maxPossibleTick =
      Math.log(maxRawCollateralFactor / 1e3) / Math.log(1.0015);

    let totalCollateralAmount = new BN(0);

    // Hop 2048 ticks, and create a position in every tick array range minimum tick
    for (let i = this.MIN_TICK + 2048; i < maxPossibleTick; i += 2048) {
      const ratioUtils = this.vaultModule.getRatioFromTick(i);

      const collateral = new BN(1e12);
      const debt = ratioUtils.calculateNetDebtFromCollateral(collateral);

      // Skip the minimum collateral amount case
      if (debt.lte(new BN(1e4))) {
        continue;
      }

      totalCollateralAmount = totalCollateralAmount.add(collateral);

      const positionId = await this.getNextPositionId(vaultId);
      await this.initPosition(vaultId, this.bob);

      await this.operateVault({
        vaultId,
        positionId,
        user: this.bob,
        positionOwner: this.bob,
        collateralAmount: collateral,
        debtAmount: debt,
        recipient: this.bob,
        transferType: TransferType.direct,
      });
    }

    return totalCollateralAmount;
  }

  async transferPosition(
    vaultId: number,
    positionId: number,
    from: Keypair,
    to: Keypair
  ) {
    const mint = this.vaultModule.get_position_mint({ vaultId, positionId });

    const fromTokenAccount = await getAssociatedTokenAddress(
      mint,
      from.publicKey
    );

    // Get the recipient's associated token account
    const toTokenAccount = await getAssociatedTokenAddress(mint, to.publicKey);

    const ix = createAssociatedTokenAccountInstruction(
      from.publicKey, // payer
      toTokenAccount, // associated token account
      to.publicKey, // owner
      mint // mint
    );

    const tx = this.getTx();
    tx.add(ix);
    this.execute(tx, from);

    // Transfer the NFT to the recipient
    {
      const tx = this.getTx();
      const transferInstruction = createTransferInstruction(
        fromTokenAccount, // source
        toTokenAccount, // destination
        from.publicKey, // owner
        1, // amount (1 NFT)
        [] // multisigners (empty for single signer)
      );

      tx.add(transferInstruction);
      this.execute(tx, from);
    }

    return toTokenAccount;
  }

  async getNextPositionId(vaultId: number) {
    const vaultState = await this.vaultModule.readVaultState({ vaultId });
    return vaultState.nextPositionId;
  }

  async updateCoreSettings(
    vaultId: number,
    coreSettings: UpdateCoreSettingsParams
  ) {
    const context = await this.vaultModule.getAdminContext(vaultId);

    const tx = this.getTx();
    tx.add(
      await this.vault.methods
        .updateCoreSettings(vaultId, coreSettings)
        .accounts(context)
        .instruction()
    );

    this.execute(tx, this.admin);
  }

  async getOperateVaultIx(vars: OPERATE_VARS) {
    // prettier-ignore
    const { vaultId, positionId, user, positionOwner, collateralAmount, debtAmount, recipient, transferType = TransferType.direct } = vars;

    const { accounts, remainingAccounts, otherIxs, remainingAccountsIndices } =
      await this.vaultModule.getOperateContext({
        vaultId,
        positionId,
        newCol: collateralAmount,
        newDebt: debtAmount,
        signer: user.publicKey,
        recipient: recipient.publicKey,
        positionOwner: positionOwner.publicKey,
        transferType,
        sources: await this.getOracleSources(vaultId),
        vaultResolver: this.vaultResolver,
      });

    const branchAddresses = remainingAccounts
      .filter((acc) => acc.pubkey.toString().includes("branch"))
      .map((acc) => acc.pubkey);

    if (branchAddresses.length > 0)
      this.addAddressesToLookupTable(
        this.vaultToLookUpTableMap.get(vaultId),
        branchAddresses
      );

    if (otherIxs.length > 0) {
      const tx = this.getTx();
      for (const ix of otherIxs) tx.add(ix);
      this.execute(tx, this.admin);
    }

    for (const [k, v] of Object.entries(accounts)) {
      if (v) {
        const accountInfo = this.client.getAccount(v);
        if (!accountInfo) {
          console.log(k, "Account not found", v.toString());
        }
      }
    }

    const ixs = await this.vault.methods
      .operate(
        collateralAmount,
        debtAmount,
        enumMap[transferType],
        Buffer.from(remainingAccountsIndices)
      )
      .accounts(accounts)
      .remainingAccounts(remainingAccounts)
      .instruction();

    return [ixs];
  }

  async operateVault(vars: OPERATE_VARS) {
    const ix = await this.getOperateVaultIx(vars);

    await this.executeV0(
      ix,
      [this.vaultToLookUpTableMap.get(vars.vaultId)],
      vars.user
    );
  }

  async updateSupplyRateMagnifier(
    vaultId: number,
    supplyRateMagnifier: number
  ) {
    const context = await this.vaultModule.getAdminContext(vaultId);
    const tx = this.getTx();

    const coreSettings = await this.vaultModule.readVaultConfig({ vaultId });

    const settingsParams: UpdateCoreSettingsParams = {
      supplyRateMagnifier: supplyRateMagnifier,
      borrowRateMagnifier: coreSettings.borrowRateMagnifier,
      collateralFactor: coreSettings.collateralFactor,
      liquidationThreshold: coreSettings.liquidationThreshold,
      liquidationMaxLimit: coreSettings.liquidationMaxLimit,
      withdrawGap: coreSettings.withdrawGap,
      liquidationPenalty: coreSettings.liquidationPenalty,
      borrowFee: coreSettings.borrowFee,
    };

    tx.add(
      await this.vault.methods
        .updateCoreSettings(vaultId, settingsParams)
        .accounts(context)
        .instruction()
    );
    this.execute(tx, this.admin);
  }

  async rebalance(vaultId: number) {
    const context = await this.vaultModule.getRebalanceContext(
      this.supplyToken,
      this.borrowToken,
      vaultId,
      this.admin.publicKey
    );

    const tx = this.getTx();
    tx.add(
      await this.vault.methods.rebalance().accounts(context).instruction()
    );
    this.execute(tx, this.admin);
  }

  async liquidateVault(vars: LIQUIDATE_VARS) {
    const ix = await this.getLiquidateVaultIx(vars);

    await this.executeV0(
      ix,
      [this.vaultToLookUpTableMap.get(vars.vaultId)],
      vars.user
    );
  }

  async getLiquidateVaultIx(vars: LIQUIDATE_VARS) {
    // prettier-ignore
    const { vaultId, user, to, debtAmount, colPerUnitDebt, absorb } = vars;

    const oracleSources = await this.getOracleSources(vaultId);

    const { accounts, remainingAccounts, otherIxs, remainingAccountsIndices } =
      await this.vaultModule.getLiquidateContext({
        vaultId,
        signer: user.publicKey,
        to: to.publicKey,
        sources: oracleSources,
        oraclePrice: this.oraclePrice,
      });

    // Add branch addresses to lookup table for efficiency
    const branchAddresses = remainingAccounts
      .slice(2, 2 + remainingAccountsIndices[1])
      .map((acc) => acc.pubkey);

    if (branchAddresses.length > 0) {
      this.addAddressesToLookupTable(
        this.vaultToLookUpTableMap.get(vaultId),
        branchAddresses
      );
    }

    // Add tick addresses to lookup table for efficiency
    const tickAddresses = remainingAccounts
      .slice(
        2 + remainingAccountsIndices[1],
        2 + remainingAccountsIndices[1] + remainingAccountsIndices[2]
      )
      .map((acc) => acc.pubkey);

    if (tickAddresses.length > 0) {
      this.addAddressesToLookupTable(
        this.vaultToLookUpTableMap.get(vaultId),
        tickAddresses
      );
    }

    if (otherIxs.length > 0) {
      const tx = this.getTx();
      for (const ix of otherIxs) tx.add(ix);
      this.execute(tx, this.admin);
    }

    for (const [k, v] of Object.entries(accounts)) {
      const accountInfo = this.client.getAccount(v);
      if (!accountInfo) {
        console.log(k, "Account not found", v.toString());
      }
    }

    // Create the liquidate instruction
    const ixs = await this.vault.methods
      .liquidate(
        debtAmount,
        colPerUnitDebt,
        absorb,
        { direct: {} },
        Buffer.from(remainingAccountsIndices)
      )
      .accounts(accounts)
      .remainingAccounts(remainingAccounts)
      .instruction();

    return [ixs];
  }

  async getInitPositionIx(vaultId: number, user: Keypair) {
    const vaultState = await this.vaultModule.readVaultState({ vaultId });

    if (!vaultState) {
      throw new Error("Vault state not found");
    }

    const positionId = vaultState.nextPositionId;
    const accounts = this.vaultModule.getInitPositionContext(
      vaultId,
      positionId,
      user.publicKey
    );

    return await this.vault.methods
      .initPosition(vaultId, positionId)
      .accounts(accounts)
      .instruction();
  }

  // async getClosePositionIx(vaultId: number, positionId: number, user: Keypair) {
  //   const accounts = this.vaultModule.getClosePositionContext(
  //     vaultId,
  //     positionId,
  //     user.publicKey
  //   );

  //   return await this.vault.methods
  //     .closePosition(vaultId, positionId)
  //     .accounts(accounts)
  //     .instruction();
  // }

  async initPosition(vaultId: number, user: Keypair) {
    const tx = this.getTx();
    
    const ix = await this.getInitPositionIx(vaultId, user);
    tx.add(ix);
    this.execute(tx, user);
  }

  // async closePosition(vaultId: number, positionId: number, user: Keypair) {
  //   const tx = this.getTx();
  //   const ix = await this.getClosePositionIx(vaultId, positionId, user);
  //   tx.add(ix);
  //   this.execute(tx, user);
  // }

  deployLookupTable(vaultId: number) {
    const accountInfo = LookUpAccountInfoJson;
    const newTableAddress = this.makeAddress().publicKey;
    const lookupTableData = Buffer.from(accountInfo.data.data);
    const authorityOffset = 22;
    const newAuthorityBytes = this.lookupTableManager.authority.publicKey.toBytes();
    for (let i = 0; i < 32; i++) {
      lookupTableData[authorityOffset + i] = newAuthorityBytes[i];
    }

    this.client.setAccount(newTableAddress, {
      data: lookupTableData,
      executable: accountInfo.executable,
      lamports: accountInfo.lamports,
      owner: new PublicKey(accountInfo.owner),
    });

    this.vaultToLookUpTableMap.set(vaultId, newTableAddress);
  }

  getVaultSupplyToken(vaultId: number) {
    switch (vaultId) {
      case 1:
        return this.supplyToken;
      case 2:
        return this.borrowToken;
      case 3:
        return this.nativeToken;
      case 4:
        return this.supplyToken;
      case 5:
        return this.heliusSinglePoolToken;
      default:
        throw new Error("Invalid vaultId");
    }
  }

  getDecimalScaleFactor(token: MintKeys) {
    let originalDecimals = 9;
    if (token === this.supplyToken) {
      originalDecimals = this.supplyTokenDecimals;
    } else if (token === this.borrowToken) {
      originalDecimals = this.borrowTokenDecimals;
    } else if (token === this.nativeToken) {
      originalDecimals = this.nativeTokenDecimals;
    } else if (token === this.heliusSinglePoolToken) {
      originalDecimals = this.singlePoolTokenDecimals;
    } else {
      throw new Error("Invalid token");
    }

    return originalDecimals < 9
      ? new BN(10).pow(new BN(9 - originalDecimals))
      : new BN(1);
  }

  getVaultSupplyTokenDecimals(vaultId: number) {
    switch (vaultId) {
      case 1:
        return this.supplyTokenDecimals;
      case 2:
        return this.borrowTokenDecimals;
      case 3:
        return this.nativeTokenDecimals;
      case 4:
        return this.supplyTokenDecimals;
      case 5:
        return this.singlePoolTokenDecimals;
      default:
        throw new Error("Invalid vaultId");
    }
  }

  getVaultBorrowTokenDecimals(vaultId: number) {
    switch (vaultId) {
      case 1:
        return this.borrowTokenDecimals;
      case 2:
        return this.supplyTokenDecimals;
      case 3:
        return this.borrowTokenDecimals;
      case 4:
        return this.nativeTokenDecimals;
      case 5:
        return this.nativeTokenDecimals; // borrow SOL (9 decimals)
      default:
        throw new Error("Invalid vaultId");
    }
  }

  getVaultBorrowToken(vaultId: number) {
    switch (vaultId) {
      case 1:
        return this.borrowToken;
      case 2:
        return this.supplyToken;
      case 3:
        return this.borrowToken;
      case 4:
        return this.nativeToken;
      case 5:
        return this.nativeToken; // borrow SOL against Single Pool
      default:
        throw new Error("Invalid vaultId");
    }
  }

  getVault(vaultId: number) {
    switch (vaultId) {
      case 1:
        return this.vaultOne;
      case 2:
        return this.vaultTwo;
      case 3:
        return this.vaultThree;
      case 4:
        return this.vaultFour;
      case 5:
        return this.vaultFive;
      default:
        throw new Error("Invalid vaultId");
    }
  }

  getOracle(vaultId: number) {
    switch (vaultId) {
      case 1:
        return this.oracleOne;
      case 2:
        return this.oracleTwo;
      case 3:
        return this.oracleThree;
      case 4:
        return this.oracleFour;
      case 5:
        return this.oracleFive;
      default:
        throw new Error("Invalid vaultId");
    }
  }

  getOraclePda(id: number) {
    const [oraclePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle"), new BN(id).toArrayLike(Buffer, "le", 2)],
      new PublicKey(ORACLE_PROGRAM)
    );

    return oraclePda;
  }

  async initOracleAdmin() {
    const oracle = new Program<Oracle>(oracleJson, this.provider);

    const [oracleAdminPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle_admin")],
      new PublicKey(ORACLE_PROGRAM)
    );

    const ix = await oracle.methods
      .initAdmin(this.admin.publicKey)
      .accounts({
        signer: this.admin.publicKey,
        oracleAdmin: oracleAdminPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();

    const tx = this.getTx();
    tx.add(ix);
    this.execute(tx, this.admin);
  }

  async deployOracle(id: number) {
    const oracle = new Program<Oracle>(oracleJson, this.provider);

    const source = this.makeAddress().publicKey;

    if (!sourceAccountInfo) {
      throw new Error("Source account info not found");
    }

    this.client.setAccount(source, {
      data: sourceAccountInfo.data,
      executable: sourceAccountInfo.executable,
      lamports: sourceAccountInfo.lamports,
      owner: sourceAccountInfo.owner,
    });

    const sources = [
      {
        source,
        invert: false,
        multiplier: new BN(1),
        divisor: new BN(1),
        sourceType: { pyth: {} },
      },
    ];

    const [oracleAdminPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle_admin")],
      new PublicKey(ORACLE_PROGRAM)
    );

    const ix = await oracle.methods
      .initOracleConfig(sources, id)
      .accounts({
        signer: this.admin.publicKey,
        oracle: this.getOraclePda(id),
        oracleAdmin: oracleAdminPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();

    const tx = this.getTx();
    tx.add(ix);
    this.execute(tx, this.admin);

    return oracle;
  }

  getDefaultCoreSettings(vaultId: number): InitVaultConfigParams {
    return {
      supplyRateMagnifier: 0, // for t1 vaults
      borrowRateMagnifier: 0, // for t1 vaults
      collateralFactor: 8000, // 80%
      liquidationThreshold: 8100, // 81%
      liquidationMaxLimit: 9000, // 90%
      withdrawGap: 500, // 5%
      liquidationPenalty: 0, // 0%
      borrowFee: 0, // 0%
      oracle: this.getOraclePda(vaultId),
      oracleProgram: new PublicKey(ORACLE_PROGRAM),
      rebalancer: this.admin.publicKey,
      liquidityProgram: this.liquidity.programId,
      supplyToken: MintInfo.getMint(this.getVaultSupplyToken(vaultId)),
      borrowToken: MintInfo.getMint(this.getVaultBorrowToken(vaultId)),
    };
  }

  async initVault(vaultId: number): Promise<PublicKey> {
    this.prank(this.admin);

    // prettier-ignore
    {
      let tx = this.getTx();
      tx.add(await this.vaultModule.initVaultConfigIx(vaultId, this.getDefaultCoreSettings(vaultId)));
      this.execute(tx);
    }

    {
      let tx = this.getTx();
      tx.add(await this.vaultModule.initVaultStateIx(vaultId));
      this.execute(tx);
    }

    // // INIT branches
    {
      let tx = this.getTx();
      for (let i = 0; i < this.MAX_BRANCH_SINGLE_TX; i++) {
        tx.add(await this.vaultModule.initBranchIx(vaultId, i));
      }
      this.execute(tx);
    }

    // INIT ticks
    {
      let tx = this.getTx();
      for (
        let i = this.MIN_TICK;
        i < this.MIN_TICK + this.MAX_TICK_SINGLE_TX;
        i++
      )
        tx.add(await this.vaultModule.initTickIx(vaultId, i));

      tx.add(await this.vaultModule.initTickIx(vaultId, 0));

      this.execute(tx);
    }

    {
      let tx = this.getTx();
      for (let i = 0; i < this.MAX_TICK_HAS_DEBT_ARRAY_SINGLE_TX; i++)
        tx.add(await this.vaultModule.initTickHasDebtArrayIx(vaultId, i));
      this.execute(tx);

      {
        let tx = this.getTx();
        tx.add(await this.vaultModule.initTickHasDebtArrayIx(vaultId, 15));
        this.execute(tx);
      }
    }

    // prettier-ignore
    {
      let tx = this.getTx();
      for (let i = this.MIN_TICK; i < this.MIN_TICK + this.MAX_TICK_ID_LIQUIDATION_SINGLE_TX; i++)
        tx.add(await this.vaultModule.initTickIdLiquidationIx(vaultId, i));
      this.execute(tx);
    }

    await this.initVaultALT(vaultId);

    return this.vaultModule.get_vault_config({ vaultId });
  }

  async getOracleSources(vaultId: number) {
    const oracle = new Program<Oracle>(oracleJson, this.provider);
    const vaultConfig = await this.vaultModule.readVaultConfig({ vaultId });

    const oracleSources = await oracle.account.oracle.fetch(vaultConfig.oracle);

    return oracleSources.sources.map((source) => new PublicKey(source.source));
  }

  async getCommonVaultAccounts(vaultId: number): Promise<PublicKey[]> {
    const vaultConfig = await this.vaultModule.readVaultConfig({ vaultId });
    const vaultState = await this.vaultModule.readVaultState({ vaultId });

    if (!vaultConfig || !vaultState) {
      throw new Error("Vault config or state not found");
    }

    const oracle = new Program<Oracle>(oracleJson, this.provider);
    const oracleSources = await oracle.account.oracle.fetch(vaultConfig.oracle);

    const supplyMint = MintInfo.getMintForToken(
      vaultConfig.borrowToken
    ) as keyof typeof MintKeys;
    const borrowMint = MintInfo.getMintForToken(
      vaultConfig.supplyToken
    ) as keyof typeof MintKeys;

    // prettier-ignore
    return [
      this.vaultModule.get_vault_admin(),
      this.vaultModule.get_vault_config({ vaultId }),
      this.vaultModule.get_vault_state({ vaultId }),
      MintInfo.getMint(supplyMint),
      MintInfo.getMint(borrowMint),
      new PublicKey(vaultConfig.oracle),
      this.vaultModule.get_liquidity_reserve({ mint: supplyMint }),
      this.vaultModule.get_liquidity_reserve({ mint: borrowMint }),
      this.vaultModule.get_user_supply_position({ mint: supplyMint, protocol: this.vaultModule.get_vault_config({ vaultId }) }),
      this.vaultModule.get_user_borrow_position({ mint: borrowMint, protocol: this.vaultModule.get_vault_config({ vaultId }) }),
      this.vaultModule.get_rate_model({ mint: supplyMint }),
      this.vaultModule.get_rate_model({ mint: borrowMint }),
      this.vaultModule.get_liquidity(),
      MintInfo.getUserTokenAccountWithPDA(supplyMint, this.vaultModule.get_liquidity()),
      MintInfo.getUserTokenAccountWithPDA(borrowMint, this.vaultModule.get_liquidity()),
      new PublicKey(vaultConfig.liquidityProgram),
      SystemProgram.programId,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      ...oracleSources.sources.map((source) => new PublicKey(source.source)),
    ];
  }

  async initVaultALT(vaultId: number) {
    const commonAccounts = await this.getCommonVaultAccounts(vaultId);
    this.addAddressesToLookupTable(
      this.vaultToLookUpTableMap.get(vaultId),
      commonAccounts
    );
  }

  async setOraclePriceInternal(source: PublicKey, price: BN) {
    const accountInfo = this.client.getAccount(source);

    const updatedData = PythV2BufferUpdater.updatePrice(
      Buffer.from(accountInfo.data),
      price,
      parseInt(this.timestamp())
    );

    this.client.setAccount(source, {
      data: updatedData,
      executable: accountInfo.executable,
      lamports: accountInfo.lamports,
      owner: accountInfo.owner,
    });
  }

  async _setOraclePriceOne(price: BN) {
    const oracle = this.getOracle(1);
    const vaultConfig = await this.vaultModule.readVaultConfig({ vaultId: 1 });
    const oracleSources = await oracle.account.oracle.fetch(vaultConfig.oracle);

    await this.setOraclePriceInternal(oracleSources.sources[0].source, price);
  }

  async _setOraclePriceTwo(price: BN) {
    const oracle = this.getOracle(2);
    const vaultConfig = await this.vaultModule.readVaultConfig({ vaultId: 2 });
    const oracleSources = await oracle.account.oracle.fetch(vaultConfig.oracle);

    await this.setOraclePriceInternal(oracleSources.sources[0].source, price);
  }

  async _setOraclePriceThree(price: BN) {
    const oracle = this.getOracle(3);
    const vaultConfig = await this.vaultModule.readVaultConfig({ vaultId: 3 });
    const oracleSources = await oracle.account.oracle.fetch(vaultConfig.oracle);

    await this.setOraclePriceInternal(oracleSources.sources[0].source, price);
  }

  async _setOraclePriceFour(price: BN) {
    const oracle = this.getOracle(4);
    const vaultConfig = await this.vaultModule.readVaultConfig({ vaultId: 4 });
    const oracleSources = await oracle.account.oracle.fetch(vaultConfig.oracle);

    await this.setOraclePriceInternal(oracleSources.sources[0].source, price);
  }

  async _setOraclePriceFive(price: BN) {
    const oracle = this.getOracle(5);
    const vaultConfig = await this.vaultModule.readVaultConfig({ vaultId: 5 });
    const oracleSources = await oracle.account.oracle.fetch(vaultConfig.oracle);

    await this.setOraclePriceInternal(oracleSources.sources[0].source, price);
  }

  async setOraclePrice(price: BN, noInverse: boolean) {
    if (noInverse) {
      await this._setOraclePriceOne(price);
    } else {
      await this._setOraclePriceTwo(new BN(10).pow(new BN(16)).div(price));
    }
  }

  /// @param percent should be in 1e2 decimals, 10000 = 100%
  async setOraclePricePercentDecrease(
    price: BN,
    noInverse: boolean,
    percent: BN
  ) {
    let newPrice: BN;
    if (noInverse) {
      newPrice = price.mul(new BN(1e4).sub(percent)).div(new BN(1e4));
      await this._setOraclePriceOne(newPrice);
    } else {
      newPrice = new BN(10).pow(new BN(16)).div(price);
      newPrice = newPrice.mul(new BN(1e4).sub(percent)).div(new BN(1e4));
      this._setOraclePriceTwo(newPrice);
    }

    this.oraclePrice = newPrice;
  }
}
