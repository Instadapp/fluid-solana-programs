import { BN } from "@coral-xyz/anchor";
import { BigNumber } from "bignumber.js";
import {
  Keypair,
  PublicKey,
  StakeProgram,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  Connection,
} from "@solana/web3.js";
import {
  SinglePoolProgram,
  findPoolAddress,
  findPoolMintAddress,
  findPoolStakeAddress,
  findPoolStakeAuthorityAddress,
  findPoolMintAuthorityAddress,
} from "@solana/spl-single-pool-classic";
import { TOKEN_PROGRAM_ID, MintLayout } from "@solana/spl-token";

import { VaultBaseSetup } from "../vaults/setup";

// Helius single pool addresses
export const HELIUS_VOTE_ACCOUNT =
  "he1iusunGwqrNtafDtLdhsUQDFvo13z9sUa36PauBtk";
export const SINGLE_POOL_STAKE_ACCOUNT =
  "BTST6Wy5XeDoM8UxSdGgqRkQXuae2i7jzF8CJpcr56v1";
export const SINGLE_POOL_MINT = "2k79y8CApbU9jAvWhLS2j6uRbaVjpLJTUzstBTho9vGq";

export const SINGLE_POOL_PROGRAM = new PublicKey(
  "SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE"
);
export const HELIUS_VOTE_PUBKEY = new PublicKey(HELIUS_VOTE_ACCOUNT);

export const SINGLE_POOL_VAULT_ID = 5;
export const STAKE_RENT = 2282880;
export const DEFAULT_POOL_STAKE_AMOUNT = new BigNumber(100 * LAMPORTS_PER_SOL);
const ORACLE_PRECISION = new BigNumber(10 ** 15);

const DEFAULT_ORACLE_PRICE = new BigNumber(1059262514823212).div(
  ORACLE_PRECISION
);
export const STAKE_SUPPLY = DEFAULT_POOL_STAKE_AMOUNT.div(DEFAULT_ORACLE_PRICE);

/**
 * Derives the pool onramp PDA address.
 */
function findPoolOnRampAddress(
  programId: PublicKey,
  poolAddress: PublicKey
): PublicKey {
  const [onrampAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from("onramp"), poolAddress.toBuffer()],
    programId
  );
  return onrampAddress;
}

/**
 * Creates a stake account data buffer in the Initialized state.
 * StakeStateV2 enum: 0=Uninitialized, 1=Initialized, 2=Stake (active), 3=RewardsPool
 */
export function createInitializedStakeAccountData(
  staker: PublicKey,
  withdrawer: PublicKey,
  rentExemptReserve: bigint = BigInt(STAKE_RENT)
): Buffer {
  const data = Buffer.alloc(200);
  let offset = 0;

  data.writeUInt32LE(1, offset); // Initialized state
  offset += 4;

  data.writeBigUInt64LE(rentExemptReserve, offset);
  offset += 8;

  staker.toBuffer().copy(data, offset);
  offset += 32;

  withdrawer.toBuffer().copy(data, offset);
  offset += 32;

  // rest is zeros for initialized state
  return data;
}

/**
 * Creates a stake account data buffer in the Stake (delegated) state.
 * StakeStateV2 enum: 0=Uninitialized, 1=Initialized, 2=Stake (active), 3=RewardsPool
 */
export function createDelegatedStakeAccountData(
  staker: PublicKey,
  withdrawer: PublicKey,
  voterPubkey: PublicKey,
  stake: bigint,
  activationEpoch: bigint = BigInt(0),
  rentExemptReserve: bigint = BigInt(STAKE_RENT)
): Buffer {
  const data = Buffer.alloc(200);
  let offset = 0;

  data.writeUInt32LE(2, offset); // Stake state
  offset += 4;

  data.writeBigUInt64LE(rentExemptReserve, offset);
  offset += 8;

  staker.toBuffer().copy(data, offset);
  offset += 32;

  withdrawer.toBuffer().copy(data, offset);
  offset += 32;

  data.writeBigInt64LE(BigInt(0), offset);
  offset += 8;

  data.writeBigUInt64LE(BigInt(0), offset);
  offset += 8;

  Buffer.alloc(32).copy(data, offset);
  offset += 32;

  voterPubkey.toBuffer().copy(data, offset);
  offset += 32;

  data.writeBigUInt64LE(stake, offset);
  offset += 8;

  data.writeBigUInt64LE(activationEpoch, offset);
  offset += 8;

  data.writeBigUInt64LE(BigInt("18446744073709551615"), offset); // Not deactivated
  offset += 8;

  data.writeDoubleLE(0.25, offset);
  offset += 8;

  data.writeBigUInt64LE(BigInt(0), offset);
  offset += 8;

  data.writeUInt8(0, offset);

  return data;
}

/**
 * Creates Single Pool state data.
 * Layout: 1 byte (initialized flag) + 32 bytes (vote account)
 */
export function createSinglePoolStateData(voteAccount: PublicKey): Buffer {
  const data = Buffer.alloc(33);
  data.writeUInt8(1, 0); // Initialized
  voteAccount.toBuffer().copy(data, 1);
  return data;
}

export function createMintData(
  mintAuthority: PublicKey,
  supply: bigint,
  decimals: number = 9
): Buffer {
  const data = Buffer.alloc(82);
  MintLayout.encode(
    {
      mintAuthorityOption: 1,
      mintAuthority: mintAuthority,
      supply: supply,
      decimals: decimals,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data
  );
  return data;
}

export async function getDepositStakeIx(
  pool: PublicKey,
  userStakeAccount: PublicKey,
  userTokenAccount: PublicKey,
  userLamportAccount: PublicKey,
  connection: Connection
): Promise<TransactionInstruction[]> {
  const sdkIx = await SinglePoolProgram.deposit({
    connection,
    userWallet: userLamportAccount,
    pool,
    userStakeAccount,
    userTokenAccount,
  });

  return sdkIx.instructions as TransactionInstruction[];
}

const SINGLE_POOL_PROGRAM_ID = new PublicKey(
  "SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE"
);

export class StakeSetup extends VaultBaseSetup {
  pool!: PublicKey;
  poolMint!: PublicKey;
  poolStake!: PublicKey;
  poolOnRamp!: PublicKey;
  poolStakeAuthority!: PublicKey;
  poolMintAuthority!: PublicKey;

  async setup() {
    await super.setup();

    const voteAccountAddress = new PublicKey(HELIUS_VOTE_ACCOUNT);
    this.pool = await findPoolAddress(
      SINGLE_POOL_PROGRAM_ID,
      voteAccountAddress
    );
    const poolPubkey = new PublicKey(this.pool);
    this.poolMint = new PublicKey(
      await findPoolMintAddress(SINGLE_POOL_PROGRAM_ID, this.pool)
    );
    this.poolStake = new PublicKey(
      await findPoolStakeAddress(SINGLE_POOL_PROGRAM_ID, this.pool)
    );
    this.poolOnRamp = findPoolOnRampAddress(SINGLE_POOL_PROGRAM, poolPubkey);
    this.poolStakeAuthority = await findPoolStakeAuthorityAddress(
      SINGLE_POOL_PROGRAM_ID,
      this.pool
    );
    this.poolMintAuthority = await findPoolMintAuthorityAddress(
      SINGLE_POOL_PROGRAM_ID,
      this.pool
    );

    // Helius vote account
    this.setAccountData(HELIUS_VOTE_PUBKEY, {
      lamports: LAMPORTS_PER_SOL,
      data: Buffer.alloc(3762),
      owner: new PublicKey("Vote111111111111111111111111111111111111111"),
      executable: false,
    });

    // pool state
    this.setAccountData(new PublicKey(this.pool), {
      lamports: LAMPORTS_PER_SOL,
      data: createSinglePoolStateData(HELIUS_VOTE_PUBKEY),
      owner: SINGLE_POOL_PROGRAM,
      executable: false,
    });

    // pool mint with correct authority
    this.setAccountData(this.poolMint, {
      lamports: LAMPORTS_PER_SOL,
      data: createMintData(
        new PublicKey(this.poolMintAuthority),
        BigInt(STAKE_SUPPLY.toFixed(0)),
        9
      ),
      owner: TOKEN_PROGRAM_ID,
      executable: false,
    });

    // pool stake account
    this.setAccountData(this.poolStake, {
      lamports: Number(DEFAULT_POOL_STAKE_AMOUNT) + STAKE_RENT,
      data: createDelegatedStakeAccountData(
        new PublicKey(this.poolStakeAuthority),
        new PublicKey(this.poolStakeAuthority),
        HELIUS_VOTE_PUBKEY,
        BigInt(DEFAULT_POOL_STAKE_AMOUNT.toFixed()),
        BigInt(0),
        BigInt(STAKE_RENT)
      ),
      owner: StakeProgram.programId,
      executable: false,
    });

    // pool onramp account (initialized stake account, not delegated)
    this.setAccountData(this.poolOnRamp, {
      lamports: LAMPORTS_PER_SOL,
      data: createInitializedStakeAccountData(
        new PublicKey(this.poolStakeAuthority),
        new PublicKey(this.poolStakeAuthority),
        BigInt(STAKE_RENT)
      ),
      owner: StakeProgram.programId,
      executable: false,
    });
  }

  setAccountData(
    pubkey: PublicKey,
    accountInfo: {
      lamports: number;
      data: Buffer;
      owner: PublicKey;
      executable: boolean;
    }
  ) {
    this.client.setAccount(pubkey, accountInfo);
  }

  getAccountData(pubkey: PublicKey) {
    return this.client.getAccount(pubkey);
  }

  createUserStakeAccount(user: Keypair, stakeAmount: bigint): Keypair {
    const userStakeAccount = Keypair.generate();
    this.setAccountData(userStakeAccount.publicKey, {
      lamports: Number(stakeAmount) + STAKE_RENT,
      data: createDelegatedStakeAccountData(
        new PublicKey(this.poolStakeAuthority),
        new PublicKey(this.poolStakeAuthority),
        HELIUS_VOTE_PUBKEY,
        stakeAmount,
        BigInt(0),
        BigInt(STAKE_RENT)
      ),
      owner: StakeProgram.programId,
      executable: false,
    });
    return userStakeAccount;
  }

  async createUserPoolTokenAccount(
    user: Keypair,
    amount: bigint = BigInt(0)
  ): Promise<PublicKey> {
    const userTokenAccount = this.getAta(this.poolMint, user.publicKey);
    await this.setupATA(this.poolMint, user.publicKey, amount);
    return userTokenAccount;
  }

  async getDepositStakeIx(
    userStakeAccount: PublicKey,
    userTokenAccount: PublicKey,
    userLamportAccount: PublicKey
  ): Promise<TransactionInstruction[]> {
    return getDepositStakeIx(
      this.pool,
      userStakeAccount,
      userTokenAccount,
      userLamportAccount,
      this.provider.connection
    );
  }

  async executeStakeDeposit(
    user: Keypair,
    stakeAmount: bigint
  ): Promise<{
    userStakeAccount: Keypair;
    userTokenAccount: PublicKey;
    poolTokensReceived: BN;
  }> {
    const userStakeAccount = this.createUserStakeAccount(user, stakeAmount);
    const userTokenAccount = await this.createUserPoolTokenAccount(user);

    const depositIx = await this.getDepositStakeIx(
      userStakeAccount.publicKey,
      userTokenAccount,
      user.publicKey
    );

    const tx = this.getTx();
    tx.add(depositIx[depositIx.length - 1]);
    this.execute(tx, user);

    const poolTokensReceived = await this.balanceOf(
      user.publicKey,
      this.poolMint
    );

    return {
      userStakeAccount,
      userTokenAccount,
      poolTokensReceived,
    };
  }

  /**
   * Executes a withdraw from single pool (redeems pool tokens back to stake).
   *
   * After deposit, the user stake account was merged into the pool and no longer exists.
   * We manually recreate it as an uninitialized account to receive the split stake.
   */
  async executeStakeWithdraw(
    user: Keypair,
    userStakeAccount: Keypair,
    userTokenAccount: PublicKey,
    tokenAmount: bigint
  ): Promise<{
    stakeReceived: BN;
  }> {
    // Ensure user stake account exists with sufficient lamports for the split
    const existingAccount = this.getAccountData(userStakeAccount.publicKey);
    if (!existingAccount || existingAccount.lamports < STAKE_RENT) {
      this.setAccountData(userStakeAccount.publicKey, {
        lamports: STAKE_RENT,
        data: Buffer.alloc(200), // Uninitialized stake account
        owner: StakeProgram.programId,
        executable: false,
      });
    }

    const transaction = await SinglePoolProgram.withdraw({
      connection: this.provider.connection,
      pool: this.pool,
      userWallet: user.publicKey,
      userStakeAccount: userStakeAccount.publicKey,
      userTokenAccount: userTokenAccount,
      userStakeAuthority: user.publicKey,
      userTokenAuthority: user.publicKey,
      tokenAmount,
      createStakeAccount: false, // acc already setup directly via litesvm
    });

    const tx = this.getTx();
    tx.add(...transaction.instructions);

    // only user needs to sign as we create acc directly via litesvm
    this.execute(tx, user);

    const stakeAccountInfo = this.getAccountData(userStakeAccount.publicKey);
    if (!stakeAccountInfo) {
      throw new Error(
        `Failed to fetch stake account info after withdrawal for account ${userStakeAccount.publicKey}`
      );
    }
    const stakeReceived = new BN(stakeAccountInfo.lamports).sub(
      new BN(STAKE_RENT)
    );

    return {
      stakeReceived,
    };
  }

  async setOraclePrice(price: BN) {
    await this._setOraclePriceFive(price);
  }
}
