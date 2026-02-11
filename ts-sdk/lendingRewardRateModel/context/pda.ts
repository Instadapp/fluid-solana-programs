import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { LendingRewardRateModel } from "../../../target/types/lending_reward_rate_model";

import { mint as MintInfo, MintKeys } from "../../mint";
import { anchor as localProvider } from "../../connection";
import LendingRewardRateModelJson from "../../../target/idl/lending_reward_rate_model.json";

export enum SEEDS {
  LENDING_REWARDS_ADMIN = "lending_rewards_admin",
  LENDING_MINT_REWARDS_CONFIG = "lending_mint_rewards_config",
  LENDING_REWARDS_RATE_MODEL = "lending_rewards_rate_model",
}

const pdaMap = new Map<string, PublicKey>();

export class PDA {
  authority: Keypair;
  program: Program<LendingRewardRateModel>;

  constructor(authority: Keypair) {
    this.program = new Program(
      LendingRewardRateModelJson,
      localProvider.getProvider()
    );
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
  get_lending_rewards_admin(key: string = SEEDS.LENDING_REWARDS_ADMIN) {
    return this.findProgramAddress([Buffer.from(key)], this.program.programId, `lendingRewardsRateModel:${key}`);
  }

  // prettier-ignore
  get_lending_mint_rewards_config(mint: keyof typeof MintKeys, key: string = SEEDS.LENDING_MINT_REWARDS_CONFIG) {
    return this.findProgramAddress(
      [Buffer.from(key), MintInfo.getMint(mint).toBuffer()],
      this.program.programId,
      `lendingRewardsRateModel:${key}:${mint}`
    );
  }

  // prettier-ignore
  get_lending_rewards_rate_model(mint: keyof typeof MintKeys, key: string = SEEDS.LENDING_REWARDS_RATE_MODEL) {
    return this.findProgramAddress(
      [Buffer.from(key), MintInfo.getMint(mint).toBuffer()],
      this.program.programId,
      `lendingRewardsRateModel:${key}:${mint}`
    );
  }
}
