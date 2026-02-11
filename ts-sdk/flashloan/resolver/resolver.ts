import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Flashloan } from "../../../target/types/flashloan";
import { anchor as localProvider } from "../../connection";
import { signer } from "../../auth";
import { readableConsoleDump } from "../../util";
import FlashloanJson from "../../../target/idl/flashloan.json";

/**
 * FlashloanResolver provides convenient access to Flashloan program data.
 */
export class FlashloanResolver {
  private program: Program<Flashloan>;
  private authority: Keypair;

  constructor(authority: Keypair) {
    this.program = new Program(FlashloanJson, localProvider.getProvider());
    this.authority = authority;
  }

  /**
   * Get the PDA (Program Derived Address) for the FlashloanAdmin account.
   * @returns The PDA PublicKey for the FlashloanAdmin.
   */
  public getFlashloanAdminPDA(): PublicKey {
    // In Solana, the admin PDA is derived from the static seed "flashloan_admin"
    // and the program ID.
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("flashloan_admin")],
      this.program.programId
    );
    return pda;
  }

  /**
   * Fetch all fields of the FlashloanAdmin account.
   * @returns The full FlashloanAdmin account data, including the PDA.
   */
  public async getFlashloanAdmin(): Promise<{
    authority: PublicKey;
    liquidityProgram: PublicKey;
    status: boolean;
    flashloanFee: number;
    flashloanTimestamp: BN;
    isFlashloanActive: boolean;
    activeFlashloanAmount: BN;
    bump: number;
    raw: any;
    pubkey: PublicKey;
  }> {
    const flashloanAdminPDA = this.getFlashloanAdminPDA();
    const account = await this.program.account.flashloanAdmin.fetch(
      flashloanAdminPDA
    );

    return {
      authority: account.authority,
      liquidityProgram: account.liquidityProgram,
      status: account.status,
      flashloanFee: account.flashloanFee,
      flashloanTimestamp: account.flashloanTimestamp,
      isFlashloanActive: account.isFlashloanActive,
      activeFlashloanAmount: account.activeFlashloanAmount,
      bump: account.bump,
      raw: account,
      pubkey: flashloanAdminPDA,
    };
  }
}

async function main() {
  const resolver = new FlashloanResolver(signer.payer);

  console.log(
    "all flashloan data:",
    readableConsoleDump(await resolver.getFlashloanAdmin())
  );
}

main();
