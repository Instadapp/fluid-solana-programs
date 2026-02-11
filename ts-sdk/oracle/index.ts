import { Program, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import { anchor as localProvider } from "../connection";
import { Oracle } from "../../target/types/oracle";
import OracleJson from "../../target/idl/oracle.json";
import { TransactionBuilder } from "../builder";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

export enum SEEDS {
  ORACLE = "oracle",
  ORACLE_ADMIN = "oracle_admin",
}

export type SourceType =
  | { pyth: {} }
  | { stakePool: {} }
  | { msolPool: {} }
  | { singlePool: {} }
  | { chainlink: {} }
  | { jupLend: {} };

export type Source = {
  source: PublicKey;
  invert: boolean;
  multiplier: BN;
  divisor: BN;
  sourceType: SourceType;
};

const pdaMap = new Map<string, PublicKey>();

export class PDA {
  program: Program<Oracle>;
  authority: Keypair;

  constructor(authority: Keypair, provider = localProvider.getProvider()) {
    this.program = new Program(OracleJson, provider);
    this.authority = authority;
  }

  createTxBuilder(): TransactionBuilder {
    const txBuilder = new TransactionBuilder(
      this.program.provider.connection,
      this.authority,
    );

    txBuilder.addSigner(this.authority);

    return txBuilder;
  }

  findProgramAddress(
    seeds: Buffer[],
    programId: PublicKey,
    key?: string,
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
  get_oracle(key: string = SEEDS.ORACLE, nonce: number = 1) {
    return this.findProgramAddress(
      [Buffer.from(key), new BN(nonce).toArrayLike(Buffer, "le", 2)],
      this.program.programId,
      `oracle:${key}`
    );
  }

  get_oracle_admin(key: string = SEEDS.ORACLE_ADMIN) {
    return this.findProgramAddress(
      [Buffer.from(key)],
      this.program.programId,
      key,
    );
  }
}

export class Context extends PDA {
  constructor(authority: Keypair, provider = localProvider.getProvider()) {
    super(authority, provider);
  }

  getOracleInitContext(nonce: number = 1) {
    return {
      signer: this.authority.publicKey,
      oracle: this.get_oracle(SEEDS.ORACLE, nonce),
      oracleAdmin: this.get_oracle_admin(),
      systemProgram: SystemProgram.programId,
    };
  }

  getOracleInitAdminContext() {
    return {
      signer: this.authority.publicKey,
      oracleAdmin: this.get_oracle_admin(),
      systemProgram: SystemProgram.programId,
    };
  }

  getOracleUpdateAuthContext(authority: PublicKey = this.authority.publicKey) {
    return {
      authority: authority,
      oracleAdmin: this.get_oracle_admin(),
    };
  }
}

export class State extends Context {
  constructor(authority: Keypair, provider = localProvider.getProvider()) {
    super(authority, provider);
  }

  async readOracle(oracle: PublicKey = this.get_oracle()) {
    try {
      return await this.program.account.oracle.fetch(oracle);
    } catch (error) {
      return null;
    }
  }

  async readOracleAdmin(oracleAdmin: PublicKey = this.get_oracle_admin()) {
    try {
      return await this.program.account.oracleAdmin.fetch(oracleAdmin);
    } catch (error) {
      return null;
    }
  }

  async readOraclePrice(
    nonce: number = 1,
    oracle: PublicKey = this.get_oracle(SEEDS.ORACLE, nonce),
  ) {
    const oracleAccount = await this.readOracle(oracle);
    if (!oracle) {
      throw new Error("Oracle not found");
    }

    const remainingAccounts = oracleAccount.sources.map((source) => {
      return {
        pubkey: source.source,
        isWritable: false,
        isSigner: false,
      };
    });

    const price = await this.program.methods
      .getExchangeRateOperate(nonce)
      .accounts({ oracle })
      .remainingAccounts(remainingAccounts)
      .view();

    return price.toString();
  }
}

export class AdminModule extends State {
  constructor(authority: Keypair, provider = localProvider.getProvider()) {
    super(authority, provider);
  }

  async initAdmin(authority: PublicKey = this.authority.publicKey) {
    try {
      const admin = await this.readOracleAdmin(this.get_oracle_admin());
      if (!admin) {
        throw new Error("Oracle admin already initialized");
      }
    } catch (error) {
      const ix = await this.program.methods
        .initAdmin(authority)
        .accounts(this.getOracleInitAdminContext())
        .instruction();

      const txBuilder = this.createTxBuilder();
      const tx = await txBuilder.addInstruction(ix).execute();
      return tx;
    }
  }

  async initOracle(sources: Array<Source>, nonce: number) {
    try {
      const oracle = await this.readOracle(
        this.get_oracle(SEEDS.ORACLE, nonce),
      );
      if (!oracle) {
        throw new Error("Oracle already initialized");
      }
    } catch (error) {
      const ix = await this.program.methods
        .initOracleConfig(sources, nonce)
        .accounts(this.getOracleInitContext(nonce))
        .instruction();

      const txBuilder = this.createTxBuilder();
      const tx = await txBuilder.addInstruction(ix).execute();
      return tx;
    }
  }

  async updateAuth(
    authority: PublicKey = this.authority.publicKey,
    newAuth: PublicKey = this.authority.publicKey,
  ) {
    const ix = await this.program.methods
      .updateAuths([
        {
          addr: newAuth,
          value: true,
        },
      ])
      .accounts(this.getOracleUpdateAuthContext(authority))
      .instruction();

    return bs58.encode(ix.data);
  }
}

// async function main() {
//   const admin = new AdminModule(signer.payer);
//   console.log(
//     "admin authority:",
//     readableConsoleDump((await admin.readOracleAdmin()).authority)
//   );
//   console.log(
//     "auths:",
//     readableConsoleDump((await admin.readOracleAdmin()).auths)
//   );
// }

// main();
