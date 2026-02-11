import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Lending } from "../../../target/types/lending";

import { PDA } from "./pda";
import { MintKeys } from "../../mint";

export class State extends PDA {
  constructor(authority: Keypair, program: Program<Lending>) {
    super(authority, program);
  }

  async readLendingAdmin() {
    try {
      return await this.program.account.lendingAdmin.fetch(
        this.get_lending_admin()
      );
    } catch (error) {
      return null;
    }
  }

  async readLending(mint: keyof typeof MintKeys) {
    try {
      return await this.program.account.lending.fetch(this.get_lending(mint));
    } catch (error) {
      return null;
    }
  }

  async readLendingbyPDA(pda: PublicKey) {
    try {
      return await this.program.account.lending.fetch(pda);
    } catch (error) {
      return null;
    }
  }

  async readAllLending() {
    const lendingAdmin = this.readLendingAdmin();
    if (!lendingAdmin) {
      return null;
    }

    const lending = await this.program.account.lending.all();

    if (lending.length === 0) {
      return null;
    }

    return lending;
  }
}
