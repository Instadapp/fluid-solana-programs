import dotenv from "dotenv";
import * as anchor from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";

dotenv.config();

import { signer } from "./auth";

const env = process.argv[process.argv.indexOf("--env") + 1];

// prettier-ignore
export const url = env === "devnet" ? process.env.ANCHOR_PROVIDER_DEVNET_URL : process.env.ANCHOR_PROVIDER_MAINNET_URL;

// Setup connection and provider
export const connection = new Connection(url, "confirmed");

export const provider = new anchor.AnchorProvider(connection, signer, {
  preflightCommitment: "confirmed",
});

anchor.setProvider(provider);

export { anchor };
