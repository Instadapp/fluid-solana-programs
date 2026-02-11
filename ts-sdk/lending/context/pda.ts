import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Lending } from "../../../target/types/lending";

import { mint as MintInfo, MintKeys } from "../../mint";
import {
  LENDING_PROGRAM,
  LIQUIDITY_PROGRAM,
  LRRM_PROGRAM,
} from "../../address";
import { Liquidity } from "../../../target/types/liquidity";
import LiquidityJson from "../../../target/idl/liquidity.json";

export enum SEEDS {
  LENDING_ADMIN = "lending_admin",
  F_TOKEN_MINT = "f_token_mint",
  LENDING = "lending",
  LIQUIDITY_RESERVE = "reserve", // liquidity reserve
  USER_SUPPLY_POSITION = "user_supply_position", // user supply position on liquidity
  USER_BORROW_POSITION = "user_borrow_position", // user borrow position on liquidity
  RATE_MODEL = "rate_model", // rate model
  LIQUIDITY = "liquidity", // liquidity
  LENDING_REWARDS_RATE_MODEL = "lending_rewards_rate_model",
  CLAIM_ACCOUNT = "user_claim",
}

const pdaMap = new Map<string, PublicKey>();

export class PdaUtils {
  programId: PublicKey;

  constructor(programId: PublicKey = new PublicKey(LENDING_PROGRAM)) {
    this.programId = programId;
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
  get_lending_admin(key: string = SEEDS.LENDING_ADMIN) {
    return this.findProgramAddress([Buffer.from(key)], this.programId, `lending:${key}`);
  }

  // prettier-ignore
  get_f_token_mint(mint: keyof typeof MintKeys, key: string = SEEDS.F_TOKEN_MINT) {
    return this.findProgramAddress(
      [Buffer.from(key), MintInfo.getMint(mint).toBuffer()],
      this.programId,
      `lending:${key}:${mint}`
    );
  }

  // prettier-ignore
  get_lending(mint: keyof typeof MintKeys, key: string = SEEDS.LENDING) {
    return this.findProgramAddress(
      [Buffer.from(key), MintInfo.getMint(mint).toBuffer(), this.get_f_token_mint(mint).toBuffer()],
      this.programId,
      `lending:${key}:${mint}`
    );
  }

  // LIQUIDITY PDAs to be used for lending
  get_liquidity_reserve(
    mint: keyof typeof MintKeys,
    key: string = SEEDS.LIQUIDITY_RESERVE
  ) {
    return this.findProgramAddress(
      [Buffer.from(key), MintInfo.getMint(mint).toBuffer()],
      new PublicKey(LIQUIDITY_PROGRAM),
      `liquidity:${key}:${mint}`
    );
  }

  get_lending_supply_position(
    mint: keyof typeof MintKeys,
    key: string = SEEDS.USER_SUPPLY_POSITION
  ) {
    return this.findProgramAddress(
      [
        Buffer.from(key),
        MintInfo.getMint(mint).toBuffer(),
        this.get_lending(mint).toBuffer(),
      ],
      new PublicKey(LIQUIDITY_PROGRAM),
      `liquidity:${key}:${mint}`
    );
  }

  get_lending_borrow_position(
    mint: keyof typeof MintKeys,
    key: string = SEEDS.USER_BORROW_POSITION
  ) {
    return this.findProgramAddress(
      [
        Buffer.from(key),
        MintInfo.getMint(mint).toBuffer(),
        this.get_lending(mint).toBuffer(),
      ],
      new PublicKey(LIQUIDITY_PROGRAM),
      `liquidity:${key}:${mint}`
    );
  }

  get_rate_model(mint: keyof typeof MintKeys, key: string = SEEDS.RATE_MODEL) {
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
    mint: keyof typeof MintKeys,
    user: PublicKey,
    key: string = SEEDS.CLAIM_ACCOUNT
  ) {
    return this.findProgramAddress(
      [Buffer.from(key), user.toBuffer(), MintInfo.getMint(mint).toBuffer()],
      new PublicKey(LIQUIDITY_PROGRAM),
      `liquidity:${key}:${mint}`
    );
  }

  // Rewards rate model PDAs to be used for lending
  get_lending_rewards_rate_model(
    mint: keyof typeof MintKeys,
    key: string = SEEDS.LENDING_REWARDS_RATE_MODEL
  ) {
    return this.findProgramAddress(
      [Buffer.from(key), MintInfo.getMint(mint).toBuffer()],
      new PublicKey(LRRM_PROGRAM),
      `lendingRewardsRateModel:${key}:${mint}`
    );
  }
}

export class PDA extends PdaUtils {
  authority: Keypair;
  program: Program<Lending>;
  liquidityProgram: Program<Liquidity>;

  constructor(authority: Keypair, program: Program<Lending>) {
    super(program.programId);

    this.program = program;
    this.authority = authority;
    this.liquidityProgram = new Program<Liquidity>(
      LiquidityJson,
      program.provider
    );
  }
}
