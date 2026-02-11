import axios from "axios";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { publicKey } from "@coral-xyz/anchor/dist/cjs/utils";

export interface TransferFeeDataBaseType {
  transferFeeConfigAuthority: string;
  withdrawWithheldAuthority: string;
  withheldAmount: string;
  olderTransferFee: {
    epoch: string;
    maximumFee: string;
    transferFeeBasisPoints: number;
  };
  newerTransferFee: {
    epoch: string;
    maximumFee: string;
    transferFeeBasisPoints: number;
  };
}

type ExtensionsItem = {
  coingeckoId?: string;
  feeConfig?: TransferFeeDataBaseType;
};

type MintInfo = {
  chainId: number;
  address: string;
  programId: string;
  logoURI: string;
  symbol: string;
  name: string;
  decimals: number;
  tags: string[]; // "hasFreeze" | "hasTransferFee" | "token-2022" | "community" | "unknown" ..etc
  extensions: ExtensionsItem;
  freezeAuthority?: string;
  mintAuthority?: string;
};

export enum MintKeys {
  USDC = "USDC",
  USDT = "USDT",
  EURC = "EURC",
  WSOL = "WSOL",
  JUPSOL = "JUPSOL",
  JITOSOL = "JITOSOL",
  WBTC = "WBTC",
  USDG = "USDG",
  SYRUPUSDC = "SYRUPUSDC",
  DUMMY = "DUMMY",
  XBTC = "XBTC",
  CBBTC = "CBBTC",
  JLP = "JLP",
  USDS = "USDS",
  JUP = "JUP",
  LBTC = "LBTC",
  INF = "INF",
  PST = "PST",
  HELIUS_SINGLE_POOL = "HELIUS_SINGLE_POOL",
  MSOL = "MSOL",
  FWDSOL = "FWDSOL",
  JUPITER_SINGLE_POOL_SOL = "JUPITER_SINGLE_POOL_SOL",
  EURCV = "EURCV",
  USDV = "USDV",
  JUPUSD = "JUPUSD",
  DFDVSOl = "DFDVSOl",
}

class Mint {
  JUP_TOKEN_LIST = "https://tokens.jup.ag/tokens?tags=lst,community";

  whitelistedEnv = ["mainnet", "devnet"];

  // prettier-ignore
  env = this.whitelistedEnv.includes(process.argv[process.argv.indexOf("--env") + 1])
    ? process.argv[process.argv.indexOf("--env") + 1]
    : "mainnet";

  // prettier-ignore
  tokenList = {
    devnet: {
      [MintKeys.USDC]: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
      [MintKeys.USDT]: new PublicKey("EJwZgeZrdC8TXTQbQBoL6bfuAnFUUy1PVCMB4DYPzVaS"),
      [MintKeys.EURC]: new PublicKey("HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr"),
      [MintKeys.WSOL]: new PublicKey("So11111111111111111111111111111111111111112"),
    },
    mainnet: {
      [MintKeys.USDC]: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
      [MintKeys.USDT]: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
      [MintKeys.EURC]: new PublicKey("HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr"),
      [MintKeys.WSOL]: new PublicKey("So11111111111111111111111111111111111111112"),
      [MintKeys.JUPSOL]: new PublicKey("jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v"),
      [MintKeys.JITOSOL]: new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"),
      [MintKeys.WBTC]: new PublicKey("3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh"),
      [MintKeys.USDG]: new PublicKey("2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH"),
      [MintKeys.SYRUPUSDC]: new PublicKey("AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj"),
      [MintKeys.DUMMY]: new PublicKey("8izkdaBZq2twsKbB9Pw7F5t3y5sXtjg73PtwGG2ZjDfg"),
      [MintKeys.XBTC]: new PublicKey("CtzPWv73Sn1dMGVU3ZtLv9yWSyUAanBni19YWDaznnkn"),
      [MintKeys.CBBTC]: new PublicKey("cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij"),
      [MintKeys.JLP]: new PublicKey("27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4"),
      [MintKeys.USDS]: new PublicKey("USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA"),
      [MintKeys.JUP]: new PublicKey("JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"),
      [MintKeys.LBTC]: new PublicKey("LBTCgU4b3wsFKsPwBn1rRZDx5DoFutM6RPiEt1TPDsY"),
      [MintKeys.INF]: new PublicKey("5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm"),
      [MintKeys.PST]: new PublicKey("59obFNBzyTBGowrkif5uK7ojS58vsuWz3ZCvg6tfZAGw"),
      [MintKeys.HELIUS_SINGLE_POOL]: new PublicKey("2k79y8CApbU9jAvWhLS2j6uRbaVjpLJTUzstBTho9vGq"),
      [MintKeys.MSOL]: new PublicKey("mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So"),
      [MintKeys.FWDSOL]: new PublicKey("cPQPBN7WubB3zyQDpzTK2ormx1BMdAym9xkrYUJsctm"),
      [MintKeys.JUPITER_SINGLE_POOL_SOL]: new PublicKey("98B1NMLYaNJQNxiQGr53vbjNFMNTYFmDqoCgj7qD9Vhm"),
      [MintKeys.EURCV]: new PublicKey("DghpMkatCiUsofbTmid3M3kAbDTPqDwKiYHnudXeGG52"),
      [MintKeys.USDV]: new PublicKey("8smindLdDuySY6i2bStQX9o8DVhALCXCMbNxD98unx35"),
      [MintKeys.JUPUSD]: new PublicKey("JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD"),
      [MintKeys.DFDVSOl]: new PublicKey("sctmB7GPi5L2Q5G9tUSzXvhZ4YiDMEGcRov9KfArQpx"),
    }
  }

  // prettier-ignore
  token_mint = this.tokenList[this.env]

  token_program_map = {
    devnet: {
      [MintKeys.USDC]: TOKEN_PROGRAM_ID,
      [MintKeys.USDT]: TOKEN_PROGRAM_ID,
      [MintKeys.WSOL]: TOKEN_PROGRAM_ID,
    },
    mainnet: {
      [MintKeys.USDC]: TOKEN_PROGRAM_ID,
      [MintKeys.USDT]: TOKEN_PROGRAM_ID,
      [MintKeys.WSOL]: TOKEN_PROGRAM_ID,
      [MintKeys.EURC]: TOKEN_PROGRAM_ID,
      [MintKeys.JITOSOL]: TOKEN_PROGRAM_ID,
      [MintKeys.JUPSOL]: TOKEN_PROGRAM_ID,
      [MintKeys.WBTC]: TOKEN_PROGRAM_ID,
      [MintKeys.USDG]: TOKEN_2022_PROGRAM_ID,
      [MintKeys.SYRUPUSDC]: TOKEN_PROGRAM_ID,
      [MintKeys.DUMMY]: TOKEN_PROGRAM_ID,
      [MintKeys.XBTC]: TOKEN_PROGRAM_ID,
      [MintKeys.CBBTC]: TOKEN_PROGRAM_ID,
      [MintKeys.JLP]: TOKEN_PROGRAM_ID,
      [MintKeys.USDS]: TOKEN_PROGRAM_ID,
      [MintKeys.JUP]: TOKEN_PROGRAM_ID,
      [MintKeys.LBTC]: TOKEN_PROGRAM_ID,
      [MintKeys.INF]: TOKEN_PROGRAM_ID,
      [MintKeys.HELIUS_SINGLE_POOL]: TOKEN_PROGRAM_ID,
      [MintKeys.FWDSOL]: TOKEN_PROGRAM_ID,
      [MintKeys.JUPUSD]: TOKEN_PROGRAM_ID,
      [MintKeys.DFDVSOl]: TOKEN_PROGRAM_ID,
    },
  };

  getMint2(key: any) {
    return this.token_mint[MintKeys[key]];
  }

  getMint(key: keyof typeof MintKeys) {
    return this.token_mint[key];
  }

  getMintForToken(token: PublicKey) {
    return Object.keys(this.token_mint).find((key) =>
      this.token_mint[key].equals(token)
    );
  }

  async getTokenInfo(key: keyof typeof MintKeys) {
    return await this.getTokensInfo([this.getMint(key)]);
  }

  async getTokensInfo(mint: (string | PublicKey)[]): Promise<MintInfo[]> {
    const res = await axios.get(
      this.JUP_TOKEN_LIST + `?mints=${mint.map((m) => m.toString()).join(",")}`
    );
    return res.data;
  }

  getUserTokenAccount(
    key: keyof typeof MintKeys,
    user: PublicKey,
    tokenProgram: PublicKey = TOKEN_PROGRAM_ID
  ) {
    return getAssociatedTokenAddressSync(
      this.getMint(key),
      user,
      false,
      tokenProgram
    );
  }

  getUserTokenAccountInfo(
    connection: Connection,
    key: keyof typeof MintKeys,
    user: PublicKey
  ) {
    return getAccount(connection, this.getUserTokenAccount(key, user));
  }

  // since ftoken uses token program 22
  getUserFTokenAccount(
    token: PublicKey,
    user: PublicKey,
    tokenProgram: PublicKey = TOKEN_PROGRAM_ID
  ) {
    return getAssociatedTokenAddressSync(token, user, false, tokenProgram);
  }

  getUserTokenAccountWithPDA(key: keyof typeof MintKeys, user: PublicKey) {
    // Allow owner off curve for PDA accounts
    const programId = this.getTokenProgramForMint(key);
    return getAssociatedTokenAddressSync(
      this.getMint(key),
      user,
      true,
      programId
    );
  }

  getTokenProgram() {
    return TOKEN_PROGRAM_ID;
  }

  getTokenProgramForKey(key: string) {
    return this.getTokenProgramForMint(key);
  }

  getAssociatedTokenProgram() {
    return ASSOCIATED_TOKEN_PROGRAM_ID;
  }

  getTokenProgramForMint(key: string) {
    return this.token_program_map[this.env][key];
  }

  // Get mint info including supply, decimals, etc.
  async getMintInfo(connection: Connection, mintAddress: PublicKey) {
    const mintInfo = await connection.getTokenSupply(mintAddress);
    return {
      supply: Number(mintInfo.value.amount),
      decimals: mintInfo.value.decimals,
    };
  }

  // Get symbol for a mint key
  getSymbol(key: keyof typeof MintKeys): string {
    return key;
  }

  // Get token balance for an account
  async getTokenBalance(
    connection: Connection,
    mintAddress: PublicKey,
    owner: PublicKey
  ): Promise<number> {
    try {
      const token_program = (await connection.getAccountInfo(mintAddress))
        .owner;

      const tokenAccount = getAssociatedTokenAddressSync(
        mintAddress,
        owner,
        false,
        token_program
      );
      const tokenAmount = await connection.getTokenAccountBalance(tokenAccount);
      return Number(tokenAmount.value.amount);
    } catch (e) {
      console.error(`Error fetching token balance: ${e}`);
      return 0;
    }
  }
}

export const mint = new Mint();
