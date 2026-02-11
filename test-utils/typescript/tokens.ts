import { web3 } from "@coral-xyz/anchor";
import {
  PublicKey,
  Signer,
  TransactionInstruction,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createInitializeMint2Instruction,
  createTransferInstruction,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import { bnToBigInt } from "./bn";

export function createMint(
  payer: Signer,
  mintAuthority: PublicKey,
  decimals: number,
  pubkey: PublicKey,
  lamports: number // minimum balance for rent exempt mint
): TransactionInstruction[] {
  const transaction = new Transaction().add(
    web3.SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: mintAuthority,
      lamports: LAMPORTS_PER_SOL,
    }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: pubkey,
      space: 82,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(
      pubkey,
      decimals,
      mintAuthority,
      mintAuthority
    )
  );

  return transaction.instructions;
}

export function transferSplTokenIx(
  sourceAta: PublicKey,
  destinationAta: PublicKey,
  authority: PublicKey,
  amount: BN
) {
  const ix = createTransferInstruction(
    sourceAta,
    destinationAta,
    authority,
    bnToBigInt(amount)
  );

  return ix;
}
