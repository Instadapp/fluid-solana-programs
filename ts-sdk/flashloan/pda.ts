import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Flashloan } from "../../target/types/flashloan";

import { MintKeys, mint as MintInfo } from "../mint";

import { FLASHLOAN_PROGRAM, LIQUIDITY_PROGRAM } from "../address";
import { Liquidity } from "../../target/types/liquidity";
import LiquidityJson from "../../target/idl/liquidity.json";

export enum SEEDS {
  FLASHLOAN_ADMIN = "flashloan_admin",
  LIQUIDITY_RESERVE = "reserve", // liquidity reserve
  USER_SUPPLY_POSITION = "user_supply_position", // user supply position on liquidity
  USER_BORROW_POSITION = "user_borrow_position", // user borrow position on liquidity
  RATE_MODEL = "rate_model", // rate model
  LIQUIDITY = "liquidity", // liquidity
  LENDING_REWARDS_RATE_MODEL = "lending_rewards_rate_model",
  CLAIM_ACCOUNT = "user_claim",
}

const pdaMap = new Map<string, PublicKey>();

export class FlashloanPDA {
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

  get_flashloan_admin(key: string = SEEDS.FLASHLOAN_ADMIN) {
    return this.findProgramAddress(
      [Buffer.from(key)],
      new PublicKey(FLASHLOAN_PROGRAM),
      `flashloan:${key}`
    );
  }

  get_flashloan_borrow_position(
    mint: keyof typeof MintKeys,
    key: string = SEEDS.USER_BORROW_POSITION
  ) {
    return this.findProgramAddress(
      [
        Buffer.from(key),
        MintInfo.getMint(mint).toBuffer(),
        this.get_flashloan_admin().toBuffer(),
      ],
      new PublicKey(LIQUIDITY_PROGRAM),
      `liquidity:${key}:${mint}`
    );
  }

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
}

export class PDA extends FlashloanPDA {
  authority: Keypair;
  program: Program<Flashloan>;
  liquidityProgram: Program<Liquidity>;

  constructor(authority: Keypair, program: Program<Flashloan>) {
    super();

    this.program = program;
    this.authority = authority;
    this.liquidityProgram = new Program<Liquidity>(
      LiquidityJson,
      program.provider
    );
  }
}
