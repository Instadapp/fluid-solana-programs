import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";

import { mint as MintInfo, MintKeys } from "../../mint";
import { Liquidity } from "../../../target/types/liquidity";

export enum SEEDS {
  LIQUIDITY = "liquidity",
  AUTH_LIST = "auth_list",
  SUPPORTED_TOKEN_LIST = "supported_token_list",
  USER_SUPPLY_POSITION = "user_supply_position",
  USER_BORROW_POSITION = "user_borrow_position",
  RESERVE = "reserve",
  RATE_MODEL = "rate_model",
  CLAIM_ACCOUNT = "user_claim",
}

const pdaMap = new Map<string, PublicKey>();

export class PDA {
  authority: Keypair;
  program: Program<Liquidity>;

  constructor(authority: Keypair, program: Program<Liquidity>) {
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
      console.log(`   - PDA for ${key.length > 0 ? key : "seeds"}: ${pda.toString()}`);
      pdaMap.set(pda.toString(), pda);
    }

    return pda;
  }

  // prettier-ignore
  get_liquidity(key: string = SEEDS.LIQUIDITY) {
    return this.findProgramAddress([Buffer.from(key)], this.program.programId, `liquidity:${key}`);
  }

  // prettier-ignore
  get_claim_account(
    mint: keyof typeof MintKeys,
    user: PublicKey,
    key: string = SEEDS.CLAIM_ACCOUNT
  ) {
    return this.findProgramAddress(
      [Buffer.from(key), user.toBuffer(), MintInfo.getMint(mint).toBuffer()],
      this.program.programId,
      `liquidity:${key}:${mint}`
    );
  }

  // prettier-ignore
  get_auth_list(key: string = SEEDS.AUTH_LIST) {
    return this.findProgramAddress(
      [Buffer.from(key)],
      this.program.programId,
      `liquidity:${key}`
    );
  }

  get_supported_token_list(key: string = SEEDS.SUPPORTED_TOKEN_LIST) {
    return this.findProgramAddress(
      [Buffer.from(key)],
      this.program.programId,
      `liquidity:${key}`
    );
  }

  get_user_supply_position(
    mint: keyof typeof MintKeys,
    protocol: PublicKey,
    key: string = SEEDS.USER_SUPPLY_POSITION
  ) {
    return this.findProgramAddress(
      [
        Buffer.from(key),
        MintInfo.getMint(mint).toBuffer(),
        protocol.toBuffer(),
      ],
      this.program.programId,
      `liquidity:${key}:${mint}`
    );
  }

  get_user_borrow_position(
    mint: keyof typeof MintKeys,
    protocol: PublicKey,
    key: string = SEEDS.USER_BORROW_POSITION
  ) {
    return this.findProgramAddress(
      [
        Buffer.from(key),
        MintInfo.getMint(mint).toBuffer(),
        protocol.toBuffer(),
      ],
      this.program.programId,
      `liquidity:${key}:${mint}`
    );
  }

  get_reserve(mint: keyof typeof MintKeys, key: string = SEEDS.RESERVE) {
    return this.findProgramAddress(
      [Buffer.from(key), MintInfo.getMint(mint).toBuffer()],
      this.program.programId,
      `liquidity:${key}:${mint}`
    );
  }

  get_rate_model(mint: keyof typeof MintKeys, key: string = SEEDS.RATE_MODEL) {
    return this.findProgramAddress(
      [Buffer.from(key), MintInfo.getMint(mint).toBuffer()],
      this.program.programId,
      `liquidity:${key}:${mint}`
    );
  }
}
