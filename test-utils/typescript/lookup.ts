import {
  PublicKey,
  AddressLookupTableProgram,
  Keypair,
  TransactionInstruction,
  AddressLookupTableAccount,
} from "@solana/web3.js";
import { LiteSVM } from "litesvm";

export class AccountLookupTableManager {
  authority: Keypair;
  client: LiteSVM;

  constructor(authority: Keypair, client: LiteSVM) {
    this.authority = authority;
    this.client = client;
  }

  createLookupTableIx(slot: bigint): [TransactionInstruction, PublicKey] {
    return AddressLookupTableProgram.createLookupTable({
      authority: this.authority.publicKey,
      payer: this.authority.publicKey,
      recentSlot: slot,
    });
  }

  extendLookupTableIx(
    lookupTableAddress: PublicKey,
    newAuth: Keypair
  ): TransactionInstruction {
    const oldAuth = this.authority;
    this.authority = newAuth;

    return AddressLookupTableProgram.extendLookupTable({
      payer: oldAuth.publicKey, // old auth
      authority: newAuth.publicKey,
      lookupTable: lookupTableAddress,
      addresses: [],
    });
  }

  addAddressesToLookupTableIx(
    addresses: PublicKey[],
    lookupTableAddress: PublicKey
  ): TransactionInstruction {
    return AddressLookupTableProgram.extendLookupTable({
      payer: this.authority.publicKey,
      authority: this.authority.publicKey,
      lookupTable: lookupTableAddress,
      addresses: addresses,
    });
  }

  getLookUpTableAddress(lookupTableAddress: PublicKey): PublicKey[] {
    const accountInfo = this.client.getAccount(lookupTableAddress);
    const value = new AddressLookupTableAccount({
      key: lookupTableAddress,
      state: AddressLookupTableAccount.deserialize(accountInfo.data),
    });

    if (value) return value.state.addresses;
    else throw new Error(`Lookup table not found`);
  }

  async getLookupTableAccounts(
    lookupTableAddresses: PublicKey[]
  ): Promise<AddressLookupTableAccount[]> {
    const lookupTableAccounts = [];

    for (const address of lookupTableAddresses) {
      const accountInfo = this.client.getAccount(address);
      const value = new AddressLookupTableAccount({
        key: address,
        state: AddressLookupTableAccount.deserialize(accountInfo.data),
      });

      if (value) lookupTableAccounts.push(value);
      else throw new Error(`Lookup table not found: ${address.toBase58()}`);
    }

    return lookupTableAccounts;
  }
}
