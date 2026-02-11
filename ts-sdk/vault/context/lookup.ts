import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import {
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
} from "@solana/web3.js";

import { Context } from "./context";
import { FlashloanPDA } from "../../flashloan/pda";
import { MintKeys, mint as MintInfo } from "../../mint";
import { AccountLookupTableManager } from "../../lookupTable";
import { Vaults } from "../../../target/types/vaults";
import { Program } from "@coral-xyz/anchor";
import {
  FLASHLOAN_PROGRAM,
  LIQUIDITY_PROGRAM,
  ORACLE_PROGRAM,
  VAULTS_PROGRAM,
} from "../../address";

const flashloanPda = new FlashloanPDA();

export class EnhancedContext extends Context {
  altManager: AccountLookupTableManager;
  vaultLookupTables: Map<number, PublicKey> = new Map();

  constructor(authority: Keypair, program: Program<Vaults>) {
    super(authority, program);
    this.altManager = new AccountLookupTableManager(
      this.program.provider.connection,
      authority
    );
  }

  async initializeVaultLookupTable(vaultId: number): Promise<PublicKey> {
    const lookupTableAddress = await this.altManager.createLookupTable();

    // prettier-ignore
    console.log("  - lookupTableAddress for VaultId", vaultId, lookupTableAddress);

    this.vaultLookupTables.set(vaultId, lookupTableAddress);
    const commonAccounts = await this.getCommonVaultAccounts(vaultId);

    const splitIndex = Math.floor(commonAccounts.length / 2);

    await this.altManager.addAddressesToLookupTable(
      commonAccounts.slice(0, splitIndex),
      lookupTableAddress
    );

    await this.altManager.addAddressesToLookupTable(
      commonAccounts.slice(splitIndex),
      lookupTableAddress
    );

    return lookupTableAddress;
  }

  async getCommonVaultAccounts(vaultId: number): Promise<PublicKey[]> {
    const vaultConfig = await this.readVaultConfig({ vaultId });
    const vaultState = await this.readVaultState({ vaultId });

    if (!vaultConfig || !vaultState) {
      throw new Error("Vault config or state not found");
    }

    const supplyMint = MintInfo.getMintForToken(
      vaultConfig.supplyToken
    ) as keyof typeof MintKeys;
    const borrowMint = MintInfo.getMintForToken(
      vaultConfig.borrowToken
    ) as keyof typeof MintKeys;

    // put 1 branches to lookup table
    const branches = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((branch) =>
      this.get_branch({ vaultId, branchId: branch })
    );

    // Put all 16 tickHasDebt to lookup table
    const tickHasDebtArray = [
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ].map((index) => this.get_tick_has_debt({ vaultId, index }));

    // prettier-ignore
    return [
      this.get_vault_admin(),
      this.get_vault_config({ vaultId }),
      this.get_vault_state({ vaultId }),
      this.get_tick({ vaultId, tick: -16383 }), // init tick for every position in vault
      MintInfo.getMint(supplyMint),
      MintInfo.getMint(borrowMint),
      new PublicKey(vaultConfig.oracle),
      this.get_liquidity_reserve({ mint: supplyMint }),
      this.get_liquidity_reserve({ mint: borrowMint }),
      this.get_user_supply_position({ mint: supplyMint, protocol: this.get_vault_config({ vaultId }) }),
      this.get_user_borrow_position({ mint: borrowMint, protocol: this.get_vault_config({ vaultId }) }),
      this.get_rate_model({ mint: supplyMint }),
      this.get_rate_model({ mint: borrowMint }),
      this.get_liquidity(),
      this.get_claim_account({ mint: supplyMint, user: this.get_vault_config({ vaultId }) }), // default claim account
      this.get_claim_account({ mint: borrowMint, user: this.get_vault_config({ vaultId }) }), // default claim account
      ...branches,
      ...tickHasDebtArray,
      MintInfo.getUserTokenAccountWithPDA(supplyMint, this.get_liquidity()),
      MintInfo.getUserTokenAccountWithPDA(borrowMint, this.get_liquidity()),
      new PublicKey(LIQUIDITY_PROGRAM),
      new PublicKey(ORACLE_PROGRAM),
      new PublicKey(FLASHLOAN_PROGRAM),
      new PublicKey(VAULTS_PROGRAM),

      flashloanPda.get_flashloan_admin(),
      flashloanPda.get_flashloan_borrow_position(supplyMint),
      flashloanPda.get_flashloan_borrow_position(borrowMint),

      SystemProgram.programId,
      SYSVAR_INSTRUCTIONS_PUBKEY,
      TOKEN_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      ComputeBudgetProgram.programId,
      ...(await this.getOracleSources()),
    ];
  }

  async getOracleSources(): Promise<PublicKey[]> {
    const oracleData = await this.oracle.readOracle();

    if (!oracleData) {
      throw new Error("Oracle not found");
    }

    return oracleData.sources.map((source) => new PublicKey(source.source));
  }

  async addAccountsToVaultLookupTable(
    vaultId: number,
    accounts: PublicKey[]
  ): Promise<string> {
    const lookupTableAddress = this.vaultLookupTables.get(vaultId);

    if (!lookupTableAddress) {
      throw new Error(`No lookup table found for vault ${vaultId}`);
    }

    return await this.altManager.addAddressesToLookupTable(
      accounts,
      lookupTableAddress
    );
  }
}
