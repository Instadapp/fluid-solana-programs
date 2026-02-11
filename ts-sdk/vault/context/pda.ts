import { Program, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";

import { Vaults } from "../../../target/types/vaults";

import { mint as MintInfo, MintKeys } from "../../mint";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { LIQUIDITY_PROGRAM } from "../../address";

export enum SEEDS {
  VAULT_STATE = "vault_state",
  VAULT_CONFIG = "vault_config",
  VAULT_METADATA = "vault_metadata",
  VAULT_ADMIN = "vault_admin",
  POSITION = "position",
  POSITION_MINT = "position_mint",
  TICK = "tick",
  TICK_ID_LIQUIDATION = "tick_id_liquidation",
  TICK_HAS_DEBT = "tick_has_debt",
  BRANCH = "branch",

  LIQUIDITY = "liquidity",
  AUTH_LIST = "auth_list",
  SUPPORTED_TOKEN_LIST = "supported_token_list",
  USER_SUPPLY_POSITION = "user_supply_position",
  USER_BORROW_POSITION = "user_borrow_position",
  RESERVE = "reserve",
  RATE_MODEL = "rate_model",
  CLAIM_ACCOUNT = "user_claim",
}

const MAX_TICK = 16383;
const pdaMap = new Map<string, PublicKey>();

export class PDA {
  authority: Keypair;
  program: Program<Vaults>;

  constructor(authority: Keypair, program: Program<Vaults>) {
    this.program = program;
    this.authority = authority;
  }

  findProgramAddress(
    seeds: Buffer[],
    programId: PublicKey,
    key?: string
  ): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(seeds, programId);

    // prettier-ignore
    if (!pdaMap.has(pda.toString()) && process.env.TEST_MODE_JEST !== "true") {
      console.log(`   - Generated PDA for ${key?.length > 0 ? key : "seeds"}: ${pda.toString()}`);
      pdaMap.set(pda.toString(), pda);
    }

    return pda;
  }

  get_vault_state(
    { vaultId }: { vaultId: number },
    key: string = SEEDS.VAULT_STATE
  ) {
    return this.findProgramAddress(
      [Buffer.from(key), new BN(vaultId).toArrayLike(Buffer, "le", 2)],
      this.program.programId,
      `vault:${key}`
    );
  }

  get_vault_config(
    { vaultId }: { vaultId: number },
    key: string = SEEDS.VAULT_CONFIG
  ) {
    return this.findProgramAddress(
      [Buffer.from(key), new BN(vaultId).toArrayLike(Buffer, "le", 2)],
      this.program.programId,
      `vault:${key}`
    );
  }

  get_vault_metadata(
    { vaultId }: { vaultId: number },
    key: string = SEEDS.VAULT_METADATA
  ) {
    return this.findProgramAddress(
      [Buffer.from(key), new BN(vaultId).toArrayLike(Buffer, "le", 2)],
      this.program.programId,
      `vault:${key}`
    );
  }

  get_position(
    { vaultId, positionId }: { vaultId: number; positionId: number },
    key: string = SEEDS.POSITION
  ) {
    return this.findProgramAddress(
      [
        Buffer.from(key),
        new BN(vaultId).toArrayLike(Buffer, "le", 2),
        new BN(positionId).toArrayLike(Buffer, "le", 4),
      ],
      this.program.programId,
      `vault:${key}`
    );
  }

  get_position_mint(
    { vaultId, positionId }: { vaultId: number; positionId: number },
    key: string = SEEDS.POSITION_MINT
  ) {
    return this.findProgramAddress(
      [
        Buffer.from(key),
        new BN(vaultId).toArrayLike(Buffer, "le", 2),
        new BN(positionId).toArrayLike(Buffer, "le", 4),
      ],
      this.program.programId,
      `vault:${key}`
    );
  }

  // prettier-ignore
  get_position_token_account(
    { vaultId, positionId, user }: { vaultId: number; positionId: number; user: PublicKey },
  ) {
    return getAssociatedTokenAddressSync(
      this.get_position_mint({ vaultId, positionId }),
      user,
      false
    );
  }

  get_vault_admin(key: string = SEEDS.VAULT_ADMIN) {
    return this.findProgramAddress(
      [Buffer.from(key)],
      this.program.programId,
      `vault:${key}`
    );
  }

  // Updated to match Rust implementation: tick + MAX_TICK to make it positive
  get_tick(
    { vaultId, tick }: { vaultId: number; tick: number },
    key: string = SEEDS.TICK
  ) {
    return this.findProgramAddress(
      [
        Buffer.from(key),
        new BN(vaultId).toArrayLike(Buffer, "le", 2),
        new BN(tick + MAX_TICK).toArrayLike(Buffer, "le", 4),
      ],
      this.program.programId,
      `vault:${key}:${tick}`
    );
  }

  get_tick_id_liquidation(
    {
      vaultId,
      tick,
      totalIds,
    }: {
      vaultId: number;
      tick: number;
      totalIds: number;
    },
    key: string = SEEDS.TICK_ID_LIQUIDATION
  ) {
    return this.findProgramAddress(
      [
        Buffer.from(key),
        new BN(vaultId).toArrayLike(Buffer, "le", 2),
        new BN(tick + MAX_TICK).toArrayLike(Buffer, "le", 4),
        new BN((totalIds + 2) / 3).toArrayLike(Buffer, "le", 4),
      ],
      this.program.programId,
      `vault:${key}:${tick}:${totalIds}`
    );
  }

  get_tick_has_debt(
    { vaultId, index }: { vaultId: number; index: number },
    key: string = SEEDS.TICK_HAS_DEBT
  ) {
    return this.findProgramAddress(
      [
        Buffer.from(key),
        new BN(vaultId).toArrayLike(Buffer, "le", 2), // 2 bytes
        new BN(index).toArrayLike(Buffer, "le", 1), // 1 byte
      ],
      this.program.programId,
      `vault:${key}:${index}`
    );
  }

  get_branch(
    { vaultId, branchId }: { vaultId: number; branchId: number },
    key: string = SEEDS.BRANCH
  ) {
    return this.findProgramAddress(
      [
        Buffer.from(key),
        new BN(vaultId).toArrayLike(Buffer, "le", 2),
        new BN(branchId).toArrayLike(Buffer, "le", 4),
      ],
      this.program.programId,
      `vault:${key}:${branchId}`
    );
  }

  // Liquidity protocol PDAs
  get_auth_list(key: string = SEEDS.AUTH_LIST) {
    return this.findProgramAddress(
      [Buffer.from(key)],
      new PublicKey(LIQUIDITY_PROGRAM),
      `liquidity:${key}`
    );
  }

  get_supported_token_list(key: string = SEEDS.SUPPORTED_TOKEN_LIST) {
    return this.findProgramAddress(
      [Buffer.from(key)],
      new PublicKey(LIQUIDITY_PROGRAM),
      `liquidity:${key}`
    );
  }

  get_liquidity_reserve(
    { mint }: { mint: keyof typeof MintKeys },
    key: string = SEEDS.RESERVE
  ) {
    return this.findProgramAddress(
      [Buffer.from(key), MintInfo.getMint(mint).toBuffer()],
      new PublicKey(LIQUIDITY_PROGRAM),
      `liquidity:${key}:${mint}`
    );
  }

  get_user_supply_position(
    { mint, protocol }: { mint: keyof typeof MintKeys; protocol: PublicKey },
    key: string = SEEDS.USER_SUPPLY_POSITION
  ) {
    return this.findProgramAddress(
      [
        Buffer.from(key),
        MintInfo.getMint(mint).toBuffer(),
        protocol.toBuffer(),
      ],
      new PublicKey(LIQUIDITY_PROGRAM),
      `liquidity:${key}:${mint}`
    );
  }

  get_user_borrow_position(
    { mint, protocol }: { mint: keyof typeof MintKeys; protocol: PublicKey },
    key: string = SEEDS.USER_BORROW_POSITION
  ) {
    return this.findProgramAddress(
      [
        Buffer.from(key),
        MintInfo.getMint(mint).toBuffer(),
        protocol.toBuffer(),
      ],
      new PublicKey(LIQUIDITY_PROGRAM),
      `liquidity:${key}:${mint}`
    );
  }

  get_reserve(
    { mint }: { mint: keyof typeof MintKeys },
    key: string = SEEDS.RESERVE
  ) {
    return this.findProgramAddress(
      [Buffer.from(key), MintInfo.getMint(mint).toBuffer()],
      new PublicKey(LIQUIDITY_PROGRAM),
      `liquidity:${key}:${mint}`
    );
  }

  get_rate_model(
    { mint }: { mint: keyof typeof MintKeys },
    key: string = SEEDS.RATE_MODEL
  ) {
    return this.findProgramAddress(
      [Buffer.from(key), MintInfo.getMint(mint).toBuffer()],
      new PublicKey(LIQUIDITY_PROGRAM),
      `liquidity:${key}:${mint}`
    );
  }

  get_liquidity(key: string = SEEDS.LIQUIDITY) {
    return this.findProgramAddress(
      [Buffer.from(key)],
      new PublicKey(LIQUIDITY_PROGRAM),
      `liquidity:${key}`
    );
  }

  get_claim_account(
    { mint, user }: { mint: keyof typeof MintKeys; user: PublicKey },
    key: string = SEEDS.CLAIM_ACCOUNT
  ) {
    return this.findProgramAddress(
      [Buffer.from(key), user.toBuffer(), MintInfo.getMint(mint).toBuffer()],
      new PublicKey(LIQUIDITY_PROGRAM),
      `liquidity:${key}:${mint}`
    );
  }
}
