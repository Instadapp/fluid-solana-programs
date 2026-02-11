import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  AccountLayout,
  ACCOUNT_SIZE,
  createTransferInstruction,
  unpackAccount,
  unpackMint,
  NATIVE_MINT,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  MintLayout,
  MINT_SIZE,
  createApproveCheckedInstruction,
  RawMint,
} from "@solana/spl-token";
import {
  InstructionErrorCustom,
  TransactionErrorInstructionError,
  InstructionErrorBorshIo,
  TransactionErrorDuplicateInstruction,
  TransactionErrorInsufficientFundsForRent,
  Clock,
  ComputeBudget,
} from "litesvm/dist/internal";
import { LiteSVMProvider } from "anchor-litesvm";
import { BN } from "@coral-xyz/anchor";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";

import { connection } from "../../ts-sdk/connection";
import { MintKeys, mint as MintInfo } from "../../ts-sdk/mint";
import { AccountLookupTableManager } from "./lookup";
import { keypair as altAuth } from "../../ts-sdk/auth";
import ComputeBudgetLogger from "./computeBudgetLogger";
import { bnToBigInt } from "./bn";

export class BaseSetup extends ComputeBudgetLogger {
  signer: Keypair;
  logTx = false;
  logBudget = true;
  client = new LiteSVM();
  errorLogs: Array<string>;
  provider = new LiteSVMProvider(this.client);
  lookupTableManager: AccountLookupTableManager = new AccountLookupTableManager(
    altAuth,
    this.client
  );
  lastTxProgramLogs: Array<string>;

  constructor() {
    super();
    this.setupSystemVars();
    this.airdrop(altAuth.publicKey);
  }

  assertApproxEqRel(expected: BN, actual: BN, maxPercentDelta: BN) {
    // Calculate relative difference: |expected - actual| / expected
    const diff = expected.sub(actual).abs();
    const relativeDiff = diff.mul(new BN(10).pow(new BN(9))).div(expected); // Scale to 1e9

    if (relativeDiff.gt(maxPercentDelta)) {
      const expectedStr = expected.toString();
      const actualStr = actual.toString();
      const diffPercent = relativeDiff
        .div(new BN(10).pow(new BN(7)))
        .toString(); // Convert to basis points

      throw new Error(
        `Expected: ${expectedStr}\n` +
          `Actual: ${actualStr}\n` +
          `Relative difference: ${diffPercent} basis points (max allowed: ${maxPercentDelta
            .div(new BN(10).pow(new BN(7)))
            .toString()})`
      );
    }
  }

  addAddressesToLookupTable(tableAddress: PublicKey, addresses: PublicKey[]) {
    const existingAddresses = this.lookupTableManager
      .getLookUpTableAddress(tableAddress)
      .map((x) => x.toString());

    const newAddresses = addresses.filter(
      (address) => !existingAddresses.includes(address.toString())
    );

    if (newAddresses.length === 0) return;

    const ix = this.lookupTableManager.addAddressesToLookupTableIx(
      newAddresses,
      tableAddress
    );

    const tx = this.getTx();
    tx.add(ix);
    this.execute(tx, altAuth);
  }

  flipLogTx() {
    this.logTx = !this.logTx;
  }

  makeAddress() {
    const keypair = Keypair.generate();
    this.airdrop(keypair.publicKey);
    return keypair;
  }

  private async findTokenAccountForOwner(
    owner: PublicKey,
    mint: PublicKey
  ): Promise<PublicKey | null> {
    try {
      // First try the standard token account address
      const tokenAccount = getAssociatedTokenAddressSync(mint, owner, true);
      const accountInfo = this.client.getAccount(tokenAccount);
      if (accountInfo) return tokenAccount;
      return null;
    } catch (error) {
      console.error(`Error finding token account:`, error);
      return null;
    }
  }

  async expectRevert(
    err: string,
    call: Function,
    ...args: any[]
  ): Promise<boolean> {
    try {
      await call(...args);
      return false;
    } catch (error) {
      if (this.errorLogs.some((log) => log.includes(err))) return true;
      console.log(error);
      return false;
    }
  }

  async balanceOf(owner: PublicKey, mint: PublicKey): Promise<BN> {
    const tokenAccount = await this.findTokenAccountForOwner(owner, mint);
    if (!tokenAccount) {
      throw new Error("Token account not found");
    }

    const tokenAccountInfo = this.client.getAccount(tokenAccount);

    const accountInfoWithBuffer = {
      ...tokenAccountInfo,
      data: Buffer.from(tokenAccountInfo.data),
    };

    const decoded = unpackAccount(tokenAccount, accountInfoWithBuffer);
    return new BN(decoded.amount.toString());
  }

  approve(from: Keypair, to: PublicKey, amount: BN, mint: PublicKey) {
    const tx = this.getTx();
    const tokenAccount = this.getAta(mint, from.publicKey);

    tx.add(
      createApproveCheckedInstruction(
        tokenAccount,
        mint,
        to,
        from.publicKey,
        bnToBigInt(amount),
        this.decimals(mint)
      )
    );

    this.execute(tx, from);
  }

  async balance(address: PublicKey): Promise<BN> {
    const accountInfo = this.client.getAccount(address);
    if (!accountInfo) {
      throw new Error("Account not found");
    }
    return new BN(accountInfo.lamports.toString());
  }

  decimals(mint: PublicKey): number {
    const mintInfo = this.client.getAccount(mint);
    if (!mintInfo) {
      throw new Error("Mint account not found");
    }

    const accountInfoWithBuffer = {
      ...mintInfo,
      data: Buffer.from(mintInfo.data),
    };

    const decoded = unpackMint(mint, accountInfoWithBuffer);
    return decoded.decimals;
  }

  transferSplToken({
    mint,
    from,
    to,
    authority,
    amount,
  }: {
    mint: PublicKey;
    from: PublicKey;
    to: PublicKey;
    authority: Keypair;
    amount: BN;
  }) {
    const sourceAta = getAssociatedTokenAddressSync(mint, from, true);
    const destinationAta = getAssociatedTokenAddressSync(mint, to, true);

    const tx = this.getTx();
    tx.add(
      createTransferInstruction(
        sourceAta,
        destinationAta,
        authority.publicKey,
        bnToBigInt(amount)
      )
    );

    this.execute(tx, authority);
  }

  async wrapSol(user: Keypair, amount: BN) {
    const associatedTokenAccount = await getAssociatedTokenAddress(
      NATIVE_MINT,
      user.publicKey
    );

    const accountExists = this.client.getAccount(associatedTokenAccount);
    const tx = this.getTx();
    if (!accountExists) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          user.publicKey, // payer
          associatedTokenAccount, // associatedToken
          user.publicKey, // owner
          NATIVE_MINT // mint
        )
      );
    }

    tx.add(
      SystemProgram.transfer({
        fromPubkey: user.publicKey,
        toPubkey: associatedTokenAccount,
        lamports: bnToBigInt(amount),
      }),
      createSyncNativeInstruction(associatedTokenAccount)
    );

    this.execute(tx, user);
  }

  airdrop(publicKey: PublicKey) {
    this.client.airdrop(publicKey, BigInt(10000 * LAMPORTS_PER_SOL));
  }

  prank(signer: Keypair) {
    this.signer = signer;
  }

  warpToSlot(endSlot: number = 1) {
    let clock = this.client.getClock();
    // increase the slot by 1
    this.client.warpToSlot(clock.slot + BigInt(endSlot));
  }

  timestamp() {
    return this.client.getClock().unixTimestamp.toString();
  }

  slot() {
    return this.client.getClock().slot;
  }

  warp(timePeriod: number) {
    let clock = this.client.getClock();
    clock.unixTimestamp += BigInt(timePeriod);
    this.client.setClock(clock);
  }

  setupSystemVars() {
    // prettier-ignore
    const newClock = new Clock(BigInt(1000), BigInt(1), BigInt(100), BigInt(3), BigInt(Math.floor(Date.now() / 1000)));
    this.client.setClock(newClock);
    this.client.withBuiltins();
    this.client.withSplPrograms();
    const budget = new ComputeBudget();
    budget.computeUnitLimit = BigInt(1000000); // 1M

    this.client.withComputeBudget(budget);
    this.client.withTransactionHistory(BigInt(50));
  }

  getAta(mint: PublicKey, owner: PublicKey) {
    return getAssociatedTokenAddressSync(mint, owner, true);
  }

  getNftOwner(mint: PublicKey): PublicKey {
    const nft = this.client.getAccount(mint);
    if (!nft) {
      throw new Error("NFT account not found");
    }

    const accountInfoWithBuffer = {
      ...nft,
      data: Buffer.from(nft.data),
    };

    const decoded = unpackAccount(mint, accountInfoWithBuffer);
    return decoded.owner;
  }

  async setupATA(
    mint: PublicKey,
    owner: PublicKey,
    amount: number | bigint
  ): Promise<PublicKey> {
    const tokenAccData = Buffer.alloc(ACCOUNT_SIZE);

    AccountLayout.encode(
      {
        mint: mint,
        owner,
        amount: BigInt(amount),
        delegateOption: 0,
        delegate: PublicKey.default,
        delegatedAmount: BigInt(0),
        state: 1,
        isNativeOption: 0,
        isNative: BigInt(0),
        closeAuthorityOption: 0,
        closeAuthority: PublicKey.default,
      },
      tokenAccData
    );

    const ata = getAssociatedTokenAddressSync(mint, owner, true);

    const ataAccountInfo = {
      lamports: 1_000_000_000,
      data: tokenAccData,
      owner: TOKEN_PROGRAM_ID,
      executable: false,
    };

    this.client.setAccount(ata, ataAccountInfo);

    return ata;
  }

  async mint(mint: PublicKey, user: PublicKey, amount: number | bigint) {
    await this.setupATA(mint, user, amount);
  }

  async getOnchainAccountInfo(account: PublicKey) {
    return await connection.getAccountInfo(account);
  }

  async setupSplTokenMints(mints: MintKeys[]) {
    for (const mint of mints) {
      const accountInfo = await this.getOnchainAccountInfo(
        MintInfo.getMint(mint)
      );

      this.setProgramName(MintInfo.getMint(mint).toString(), mint.toString());

      const decoded = unpackMint(MintInfo.getMint(mint), accountInfo);
      decoded.supply = bnToBigInt(new BN(2).pow(new BN(58)));

      const buffer = Buffer.alloc(MINT_SIZE);

      const rawMint: RawMint = {
        mintAuthorityOption: decoded.mintAuthority ? 1 : 0,
        mintAuthority: decoded.mintAuthority || PublicKey.default,
        supply: decoded.supply,
        decimals: decoded.decimals,
        isInitialized: decoded.isInitialized,
        freezeAuthorityOption: decoded.freezeAuthority ? 1 : 0,
        freezeAuthority: decoded.freezeAuthority || PublicKey.default,
      };

      MintLayout.encode(rawMint, buffer);

      this.client.setAccount(MintInfo.getMint(mint), {
        data: buffer,
        executable: accountInfo.executable,
        lamports: accountInfo.lamports,
        owner: accountInfo.owner,
      });
    }
  }

  async transferSplTokenIx(
    sourceAta: PublicKey,
    destinationAta: PublicKey,
    authority: PublicKey,
    amount: number | bigint
  ) {
    const ix = createTransferInstruction(
      sourceAta,
      destinationAta,
      authority,
      amount
    );

    return ix;
  }

  getBlockHash = () => {
    return this.client.latestBlockhash();
  };

  getTx = () => {
    const tx = new Transaction();
    this.client.expireBlockhash();
    tx.recentBlockhash = this.getBlockHash();

    return tx;
  };

  private decodeTxFailure(tx: any): string {
    if (tx instanceof TransactionErrorInstructionError)
      if (tx.err() instanceof InstructionErrorCustom)
        return (
          (tx.err() as InstructionErrorCustom).code.toString() +
          (tx.err() as InstructionErrorCustom).toString() +
          " InstructionErrorCustom"
        );
      else if (tx.err() instanceof InstructionErrorBorshIo)
        return (
          (tx.err() as InstructionErrorBorshIo).msg +
          tx.err().toString() +
          " InstructionErrorBorshIo"
        );

    if (tx instanceof TransactionErrorDuplicateInstruction) {
      return (
        tx.index.toString() +
        tx.toString() +
        " TransactionErrorDuplicateInstruction"
      );
    }

    if (tx instanceof TransactionErrorInsufficientFundsForRent)
      return (
        tx.accountIndex.toString() +
        tx.toString() +
        " TransactionErrorInsufficientFundsForRent"
      );

    return tx.toString();
  }

  async executeV0(
    ix: TransactionInstruction[],
    lookupTableAddresses: PublicKey[],
    signer = this.signer
  ) {
    const lookupAccounts = await this.lookupTableManager.getLookupTableAccounts(
      lookupTableAddresses
    );

    const messageV0 = new TransactionMessage({
      payerKey: signer.publicKey,
      recentBlockhash: this.getBlockHash(),
      instructions: ix,
    }).compileToV0Message(lookupAccounts);

    const versionedTx = new VersionedTransaction(messageV0);

    this.execute(versionedTx, signer);
  }

  execute = (tx: Transaction | VersionedTransaction, signer = this.signer) => {
    if (tx instanceof Transaction) tx.sign(signer);
    else tx.sign([signer]);

    this.errorLogs = [];
    const txHash = this.client.sendTransaction(tx);

    if (txHash instanceof FailedTransactionMetadata) {
      this.logTx && console.log("error:Logs", txHash.meta().logs());
      this.errorLogs = txHash.meta().logs();
      this.logTx && console.log(txHash.toString());
      const result = this.decodeTxFailure(txHash.err());
      throw new Error("Transaction failed: " + result);
    }

    this.lastTxProgramLogs = txHash.logs();

    this.logTx && console.log("tx:logs", txHash.logs());
    this.extractComputeBudget(txHash.logs());

    this.warpToSlot();
    return txHash.toString();
  };
}
