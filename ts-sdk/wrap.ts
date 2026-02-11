import {
  NATIVE_MINT,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  getAccount,
} from "@solana/spl-token";
import {
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { keypair } from "./auth";
import { anchor as localProvider } from "./connection";

export const wrap = async () => {
  const connection = localProvider.getProvider().connection;

  // Get associated token account address for WSOL
  const associatedTokenAccount = await getAssociatedTokenAddress(
    NATIVE_MINT,
    keypair.publicKey
  );

  // Check if account already exists
  let accountExists = false;
  try {
    const account = await getAccount(connection, associatedTokenAccount);
    accountExists = true;
    console.log(
      "Account already exists with balance",
      Number(account.amount) / LAMPORTS_PER_SOL
    );
  } catch (error) {
    // Account doesn't exist
    console.log("Account doesn't exist, creating...");
  }

  const tx = new Transaction();

  if (!accountExists) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        keypair.publicKey, // payer
        associatedTokenAccount, // associatedToken
        keypair.publicKey, // owner
        NATIVE_MINT // mint
      )
    );
  }

  tx.add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: associatedTokenAccount,
      lamports: 1 * LAMPORTS_PER_SOL,
    }),
    createSyncNativeInstruction(associatedTokenAccount)
  );
  // return tx.instructions;
  console.log("Sending transaction...");
  const txHash = await sendAndConfirmTransaction(connection, tx, [keypair]);
  console.log("Transaction sent:", txHash);
};
