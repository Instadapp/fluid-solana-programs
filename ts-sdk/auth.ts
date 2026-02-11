import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import * as anchor from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";

dotenv.config();

export const keypair = Keypair.fromSecretKey(
  Buffer.from(
    JSON.parse(
      fs.readFileSync(
        path.join(process.env.HOME, process.env.ANCHOR_WALLET_PATH),
        "utf-8"
      )
    )
  )
);

export const signer = new anchor.Wallet(keypair);
