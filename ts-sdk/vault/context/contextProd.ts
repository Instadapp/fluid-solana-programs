import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  SystemProgram,
  PublicKey,
  TransactionInstruction,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { BN, Program } from "@coral-xyz/anchor";

import { State } from "./state";
import { AdminModule as Oracle } from "../../oracle";
import { mint, mint as MintInfo, MintKeys } from "../../mint";
import { LIQUIDITY_PROGRAM } from "../../address";
import { Vaults } from "../../../target/types/vaults";
import { connection } from "../../connection";
import { VaultState, VaultConfig } from "../resolver/types";
import { Resolver } from "../resolver/resolver";
import { UserPositionWithDebt } from "../resolver/types";
import { FluidLiquidityResolver } from "../../liquidity/resolver/resolver";
import { MPL_TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata";

type LiquidateContextParams = {
  vaultId: number;
  signer: PublicKey;
  to: PublicKey;
};

type OperateContextParams = {
  vaultId: number;
  positionId: number;
  newCol: BN;
  newDebt: BN;
  signer: PublicKey;
  recipient: PublicKey;
  positionOwner: PublicKey;
};

export class Context extends State {
  oracle: Oracle;
  MIN_I128 = new BN("170141183460469231731687303715884105728").neg();
  vaultResolver: Resolver;
  liquidityResolver: FluidLiquidityResolver;

  constructor(authority: Keypair, program: Program<Vaults>) {
    super(authority, program);
    this.oracle = new Oracle(authority);
    this.liquidityResolver = new FluidLiquidityResolver(authority);

    this.vaultResolver = new Resolver(
      authority,
      program,
      this.liquidityResolver
    );
  }

  getInitializeVaultAdminContext(signer: PublicKey = this.authority.publicKey) {
    return {
      signer,
      vaultAdmin: this.get_vault_admin(),
      systemProgram: SystemProgram.programId,
    };
  }

  getInitVaultConfigContext(
    vaultId: number,
    signer: PublicKey = this.authority.publicKey
  ) {
    return {
      authority: signer,
      vaultAdmin: this.get_vault_admin(),
      vaultConfig: this.get_vault_config({ vaultId }),
      systemProgram: SystemProgram.programId,
    };
  }

  async getInitVaultStateContext(
    vaultId: number,
    signer: PublicKey = this.authority.publicKey
  ) {
    const vaultConfig = await this.readVaultConfig({ vaultId });

    if (!vaultConfig) {
      throw new Error("Vault config not found");
    }

    const supplyMint = MintInfo.getMintForToken(
      vaultConfig.supplyToken
    ) as keyof typeof MintKeys;

    const borrowMint = MintInfo.getMintForToken(
      vaultConfig.borrowToken
    ) as keyof typeof MintKeys;

    // prettier-ignore
    return {
        authority: signer,
        vaultAdmin: this.get_vault_admin(),
        vaultConfig: this.get_vault_config({ vaultId }),
        vaultState: this.get_vault_state({ vaultId }),
        supplyTokenReservesLiquidity: this.get_liquidity_reserve({ mint: supplyMint }),
        borrowTokenReservesLiquidity: this.get_liquidity_reserve({ mint: borrowMint }),
        liquidityProgram: new PublicKey(vaultConfig.liquidityProgram),
        systemProgram: SystemProgram.programId,
      };
  }

  getInitBranchContext(
    vaultId: number,
    branchId: number,
    signer: PublicKey = this.authority.publicKey
  ) {
    return {
      signer,
      vaultConfig: this.get_vault_config({ vaultId }),
      branch: this.get_branch({ vaultId, branchId }),
      systemProgram: SystemProgram.programId,
    };
  }

  getInitTickHasDebtArrayContext(
    vaultId: number,
    mapId: number,
    signer: PublicKey = this.authority.publicKey
  ) {
    return {
      signer,
      vaultConfig: this.get_vault_config({ vaultId }),
      tickHasDebtArray: this.get_tick_has_debt({ vaultId, index: mapId }),
      systemProgram: SystemProgram.programId,
    };
  }

  getInitTickContext(
    vaultId: number,
    tick: number,
    signer: PublicKey = this.authority.publicKey
  ) {
    return {
      signer,
      vaultConfig: this.get_vault_config({ vaultId }),
      tickData: this.get_tick({ vaultId, tick }),
      systemProgram: SystemProgram.programId,
    };
  }

  async getInitTickIdLiquidationContext(
    vaultId: number,
    tick: number,
    signer: PublicKey = this.authority.publicKey
  ) {
    const tickData = await this.readTick({ vaultId, tick });

    if (!tickData) {
      // prettier-ignore
      return {
          signer,
          vaultConfig: this.get_vault_config({ vaultId }),
          tickIdLiquidation: this.get_tick_id_liquidation({vaultId, tick, totalIds: 0}),
          tickData: this.get_tick({ vaultId, tick }),
          systemProgram: SystemProgram.programId,
        };
    }

    // prettier-ignore
    return {
        signer,
        vaultConfig: this.get_vault_config({ vaultId }),
        tickIdLiquidation: this.get_tick_id_liquidation({vaultId, tick, totalIds: tickData.totalIds}),
        tickData: this.get_tick({ vaultId, tick }),
        systemProgram: SystemProgram.programId,
      };
  }

  getInitPositionContext(
    vaultId: number,
    positionId: number,
    signer: PublicKey = this.authority.publicKey
  ) {
    // prettier-ignore
    return {
        signer,
        vaultAdmin: this.get_vault_admin(),
        vaultState: this.get_vault_state({ vaultId }),
        position: this.get_position({ vaultId, positionId }),
        positionMint: this.get_position_mint({ vaultId, positionId }),
        positionTokenAccount: this.get_position_token_account({ vaultId, positionId, user: signer }),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      };
  }

  async getOtherInstructionsOperate(
    vaultId: number,
    vaultState: VaultState,
    currentPosition: UserPositionWithDebt,
    finalPosition: UserPositionWithDebt,
    currentTick: number
  ) {
    const otherIxs: TransactionInstruction[] = [];

    const tickToRead: number[] = [currentTick];
    let currentTickData: any;
    let finalTickData: any;

    // check if current position tick exists or not
    if (currentPosition.tick > this.MIN_TICK)
      tickToRead.push(currentPosition.tick);

    // check if final position tick exists or not
    // prettier-ignore
    if (finalPosition.tick > this.MIN_TICK && finalPosition.tick !== currentPosition.tick) 
      tickToRead.push(finalPosition.tick);

    if (tickToRead.length > 0) {
      const tickData = await this.readMultipleTicks({
        vaultId,
        ticks: tickToRead,
      });

      currentTickData = tickData[0];
      finalTickData = tickData[2];

      for (let i = 0; i < tickData.length; i++) {
        if (!tickData[i]) {
          const ix = await this.program.methods
            .initTick(vaultId, tickToRead[i])
            .accounts(this.getInitTickContext(vaultId, tickToRead[i]))
            .instruction();

          otherIxs.push(ix);
        }
      }
    }

    let newBranchId: number;
    if (vaultState.branchLiquidated) {
      // Check if new branch exists (only if we're creating a new one)
      newBranchId = vaultState.totalBranch + 1;

      const newBranchData = await this.readBranch({
        vaultId,
        branchId: newBranchId,
      });

      if (!newBranchData) {
        const ix = await this.program.methods
          .initBranch(vaultId, newBranchId)
          .accounts(this.getInitBranchContext(vaultId, newBranchId))
          .instruction();

        otherIxs.push(ix);
      }
    } else {
      newBranchId = vaultState.currentBranch;
    }

    const newBranchPda = this.get_branch({
      vaultId,
      branchId: newBranchId,
    });

    let currentTickIdDataPda = this.get_tick_id_liquidation({
      vaultId,
      tick: currentTick,
      totalIds: currentTickData ? currentTickData.totalIds : 0,
    });

    const tickIdsToRead = [
      {
        tick: currentTick,
        totalIds: currentTickData ? currentTickData.totalIds : 0,
      },
    ];

    let finalTickIdDataPda = this.get_tick_id_liquidation({
      vaultId,
      tick: finalPosition.tick,
      totalIds: finalTickData ? finalTickData.totalIds : 0,
    });

    if (finalPosition.tick !== currentTick && finalTickData)
      tickIdsToRead.push({
        tick: finalPosition.tick,
        totalIds: finalTickData.totalIds,
      });

    const tickIdData = await this.readMultipleTickIdLiquidation({
      vaultId,
      data: tickIdsToRead,
    });

    if (tickIdData.length > 0) {
      for (let i = 0; i < tickIdData.length; i++) {
        // prettier-ignore
        if (!tickIdData[i]) {
          const ix = await this.program.methods
            .initTickIdLiquidation(vaultId, tickIdsToRead[i].tick, tickIdsToRead[i].totalIds)
            .accounts(this.getInitTickIdLiquidationContext(vaultId, tickIdsToRead[i].tick))
            .instruction();

          otherIxs.push(ix);
        }
      }
    }

    return {
      otherIxs,
      newBranchPda,
      currentTickIdDataPda,
      finalTickIdDataPda,
    };
  }

  async getRemainingAccountsOperate(
    vaultId: number,
    vaultState: VaultState,
    vaultConfig: VaultConfig,
    finalPositionTick: number,
    existingPositionTick: number,
    liquidationStatus: boolean,
    postLiquidationBranchId: number
  ) {
    const remainingAccounts = [];

    const oracleData = await this.oracle.readOracle(
      new PublicKey(vaultConfig.oracle)
    );

    if (!oracleData) {
      throw new Error("Oracle not found, please initialize oracle first");
    }

    for (const source of oracleData.sources)
      remainingAccounts.push({
        pubkey: new PublicKey(source.source),
        isWritable: false,
        isSigner: false,
      });

    const branches = await this.loadRelevantBranches(
      vaultId,
      vaultState,
      liquidationStatus,
      postLiquidationBranchId
    );

    for (const branch of branches) {
      remainingAccounts.push({
        pubkey: this.get_branch({ vaultId, branchId: branch }),
        isWritable: true,
        isSigner: false,
      });
    }

    const tickHasDebt = await this.loadRelevantTicksHasDebtArrays(
      vaultId,
      vaultState.topTick, // max of both ticks
      existingPositionTick,
      finalPositionTick
    );

    // prettier-ignore
    for (const tickHasDebtArray of tickHasDebt) 
        remainingAccounts.push({
          pubkey: tickHasDebtArray,
          isWritable: true,
          isSigner: false,
        });

    const remainingAccountsIndices = [
      oracleData.sources.length,
      branches.length,
      tickHasDebt.length,
    ];

    return {
      remainingAccounts,
      remainingAccountsIndices,
    };
  }

  async getLookUpTableAddress(vaultId: number) {
    const vaultMetadata = await this.readVaultMetadata({ vaultId });
    if (!vaultMetadata) {
      throw new Error("Vault metadata not found");
    }

    return vaultMetadata.lookupTable;
  }

  async getOperateContext({
    vaultId,
    positionId,
    newCol,
    newDebt,
    signer,
    recipient = signer,
    positionOwner = signer,
  }: OperateContextParams) {
    const vaultState = await this.vaultResolver.getVaultState(vaultId);
    const vaultConfig = await this.vaultResolver.getVaultConfig(vaultId);

    if (!vaultState || !vaultConfig) {
      throw new Error("Vault state or config not found");
    }

    const supplyMint = MintInfo.getMintForToken(
      vaultConfig.supplyToken
    ) as keyof typeof MintKeys;
    const borrowMint = MintInfo.getMintForToken(
      vaultConfig.borrowToken
    ) as keyof typeof MintKeys;

    const { decimals: vaultSupplyDecimals } = await MintInfo.getMintInfo(
      connection,
      vaultConfig.supplyToken
    );
    const { decimals: vaultBorrowDecimals } = await MintInfo.getMintInfo(
      connection,
      vaultConfig.borrowToken
    );

    if (newCol.gt(this.MIN_I128)) {
      // prettier-ignore
      const decimalsDelta = vaultSupplyDecimals < 9 ? 9 - vaultSupplyDecimals : 0;
      newCol = newCol.mul(new BN(10).pow(new BN(decimalsDelta)));
    }

    if (newDebt.gt(this.MIN_I128)) {
      // prettier-ignore
      const decimalsDelta = vaultBorrowDecimals < 9 ? 9 - vaultBorrowDecimals : 0;
      newDebt = newDebt.mul(new BN(10).pow(new BN(decimalsDelta)));
    }

    const positionData = await this.readUserPosition({ vaultId, positionId });
    if (!positionData) {
      throw new Error("Position not found, please initialize position first");
    }

    let existingPositionTick = positionData.tick;
    const currentPosition = await this.vaultResolver.getCurrentPositionState({
      vaultId,
      position: positionData,
    });

    if (existingPositionTick === -2147483648) {
      existingPositionTick = currentPosition.tick;
    }

    // Prepare current position tick data
    let currentPositionTickPda: PublicKey = this.get_tick({
      vaultId,
      tick: existingPositionTick,
    });

    const finalPosition = await this.vaultResolver.calculateFinalPosition({
      vaultId,
      currentPosition,
      newColAmount: newCol,
      newDebtAmount: newDebt,
    });

    const { otherIxs, newBranchPda, currentTickIdDataPda, finalTickIdDataPda } =
      await this.getOtherInstructionsOperate(
        vaultId,
        vaultState,
        currentPosition,
        finalPosition,
        existingPositionTick
      );

    const { remainingAccounts, remainingAccountsIndices } =
      await this.getRemainingAccountsOperate(
        vaultId,
        vaultState,
        vaultConfig,
        finalPosition.tick,
        existingPositionTick,
        currentPosition.userLiquidationStatus,
        currentPosition.postLiquidationBranchId
      );

    // prettier-ignore
    const accounts = {
        signer,
        signerSupplyTokenAccount: MintInfo.getUserTokenAccount(supplyMint, signer),
        signerBorrowTokenAccount: MintInfo.getUserTokenAccount(borrowMint, signer),
  
        recipient,
        recipientSupplyTokenAccount: MintInfo.getUserTokenAccount(supplyMint, recipient),
        recipientBorrowTokenAccount: MintInfo.getUserTokenAccount(borrowMint, recipient),
  
        vaultConfig: this.get_vault_config({ vaultId }),
        vaultState: this.get_vault_state({ vaultId }),
  
        supplyToken: MintInfo.getMint(supplyMint),
        borrowToken: MintInfo.getMint(borrowMint),
  
        oracle: new PublicKey(vaultConfig.oracle),
  
        position: this.get_position({ vaultId, positionId }),
        positionTokenAccount: this.get_position_token_account({ vaultId, positionId, user: positionOwner }),
  
        currentPositionTick: currentPositionTickPda,
        finalPositionTick: this.get_tick({vaultId, tick: finalPosition.tick}),
  
        currentPositionTickId: currentTickIdDataPda,
        finalPositionTickId: finalTickIdDataPda,
        newBranch: newBranchPda,
  
        supplyTokenReservesLiquidity: this.get_liquidity_reserve({ mint: supplyMint }),
        borrowTokenReservesLiquidity: this.get_liquidity_reserve({ mint: borrowMint }),
  
        vaultSupplyPositionOnLiquidity: this.get_user_supply_position({ mint: supplyMint, protocol: this.get_vault_config({ vaultId }) }),
        vaultBorrowPositionOnLiquidity: this.get_user_borrow_position({ mint: borrowMint, protocol: this.get_vault_config({ vaultId }) }),
  
        supplyRateModel: this.get_rate_model({ mint: supplyMint }),
        borrowRateModel: this.get_rate_model({ mint: borrowMint }),
  
        liquidity: this.get_liquidity(),
        liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),
  
        vaultSupplyTokenAccount: MintInfo.getUserTokenAccountWithPDA(supplyMint, this.get_liquidity()),
        vaultBorrowTokenAccount: MintInfo.getUserTokenAccountWithPDA(borrowMint, this.get_liquidity()),
  
        oracleProgram: new PublicKey(vaultConfig.oracleProgram),

        supplyTokenClaimAccount: null,
        borrowTokenClaimAccount: null,
  
        supplyTokenProgram: TOKEN_PROGRAM_ID,
        borrowTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      };

    return {
      accounts,
      remainingAccounts,
      otherIxs,
      remainingAccountsIndices,
      lookupTable: await this.getLookUpTableAddress(vaultId),
    };
  }

  async getOtherInstructionsLiquidate(vaultId: number, vaultState: any) {
    const otherIxs: TransactionInstruction[] = [];

    // prettier-ignore
    let newBranchId = vaultState.branchLiquidated === 1 // if liquidated, create a new branch
        ? vaultState.totalBranchId + 1
        : vaultState.currentBranchId; // if not liquidated, use the current branch

    // prettier-ignore
    let newBranchPda: PublicKey = this.get_branch({ vaultId, branchId: newBranchId });

    // prettier-ignore
    const newBranchData = await this.readBranch({ vaultId, branchId: newBranchId, pda: newBranchPda });

    if (!newBranchData) {
      const ix = await this.program.methods
        .initBranch(vaultId, newBranchId)
        .accounts(this.getInitBranchContext(vaultId, newBranchId))
        .instruction();

      otherIxs.push(ix);
    }

    // might be possible that liquidation ends on a tick that is not initialized
    // prettier-ignore
    const tickData = await this.readTick({ vaultId, tick: vaultState.topmostTick });

    if (!tickData) {
      const ix = await this.program.methods
        .initTick(vaultId, vaultState.topmostTick)
        .accounts(this.getInitTickContext(vaultId, vaultState.topmostTick))
        .instruction();

      otherIxs.push(ix);
    }

    return {
      otherIxs,
      newBranchPda,
    };
  }

  async getRemainingAccountsLiquidate(
    vaultId: number,
    vaultState: any,
    vaultConfig: any,
    otherIxs: TransactionInstruction[]
  ) {
    const remainingAccounts = [];

    const oracleData = await this.oracle.readOracle(vaultConfig.oracle);
    if (!oracleData) {
      throw new Error("Oracle not found, please initialize oracle first");
    }

    const { liquidatePrice } = await this.vaultResolver.readOraclePrice(
      vaultConfig.oracle
    );

    const liquidationRatio = new BN(liquidatePrice)
      .mul(new BN(281474976710656))
      .div(new BN(10).pow(new BN(15)));

    const liquidationThresholdRatio = liquidationRatio
      .mul(new BN(vaultConfig.liquidationThreshold))
      .div(new BN(10).pow(new BN(3)));

    const liquidationTick = this.getTickAtRatio(liquidationThresholdRatio);

    const sources = oracleData.sources.map(
      (source) => new PublicKey(source.source)
    );

    for (const source of sources) {
      remainingAccounts.push({
        pubkey: source,
        isWritable: false,
        isSigner: false,
      });
    }

    const branches = await this.loadRelevantBranchesForLiquidate(
      vaultId,
      vaultState
    );

    for (const branch of branches) {
      remainingAccounts.push({
        pubkey: this.get_branch({ vaultId, branchId: branch.branchId }),
        isWritable: true,
        isSigner: false,
      });
    }

    const { ticks: tickAccounts, nextTick } =
      await this.loadRelevantTicksForLiquidate(
        vaultId,
        vaultState,
        liquidationTick
      );

    const tickToInit = [];

    for (const tickData of tickAccounts) {
      const existingTick = await this.readTick({
        vaultId,
        tick: tickData.tick,
      });

      if (!existingTick && !tickToInit.includes(tickData.tick)) {
        tickToInit.push(tickData.tick);

        const ix = await this.program.methods
          .initTick(vaultId, tickData.tick)
          .accounts(this.getInitTickContext(vaultId, tickData.tick))
          .instruction();

        otherIxs.push(ix);
      }

      remainingAccounts.push({
        pubkey: this.get_tick({ vaultId, tick: tickData.tick }),
        isWritable: true,
        isSigner: false,
      });
    }

    const tickHasDebt = await this.loadRelevantTicksHasDebtArraysLiquidate(
      vaultId,
      vaultState.topmostTick,
      nextTick
    );

    // prettier-ignore
    for (const tickHasDebtArray of tickHasDebt) {
      remainingAccounts.push({
        pubkey: this.get_tick_has_debt({ vaultId, index: tickHasDebtArray.index }),
        isWritable: true,
        isSigner: false,
      });
    }

    const remainingAccountsIndices = [
      sources.length,
      branches.length,
      tickAccounts.length,
      tickHasDebt.length,
    ];

    return {
      remainingAccounts,
      otherIxs,
      remainingAccountsIndices,
    };
  }

  async getLiquidateContext(params: LiquidateContextParams) {
    const { signer, to, vaultId } = params;

    const vaultConfig = await this.readVaultConfig({ vaultId });
    const vaultState = await this.readVaultState({ vaultId });
    if (!vaultConfig || !vaultState) {
      throw new Error("Vault not initialized");
    }

    const supplyMint = MintInfo.getMintForToken(
      vaultConfig.supplyToken
    ) as keyof typeof MintKeys;

    const borrowMint = MintInfo.getMintForToken(
      vaultConfig.borrowToken
    ) as keyof typeof MintKeys;

    let { otherIxs, newBranchPda } = await this.getOtherInstructionsLiquidate(
      vaultId,
      vaultState
    );

    const {
      remainingAccounts,
      remainingAccountsIndices,
      otherIxs: finalOtherIxs,
    } = await this.getRemainingAccountsLiquidate(
      vaultId,
      vaultState,
      vaultConfig,
      otherIxs
    );

    // prettier-ignore
    return {
      accounts: {
        signer,
        signerTokenAccount: MintInfo.getUserTokenAccount(borrowMint, signer),
        to,
        toTokenAccount: MintInfo.getUserTokenAccount(supplyMint, to),
        vaultAdmin: this.get_vault_admin(),
        vaultConfig: this.get_vault_config({ vaultId }),
        vaultState: this.get_vault_state({ vaultId }),
        supplyToken: MintInfo.getMint(supplyMint),
        borrowToken: MintInfo.getMint(borrowMint),
        oracle: new PublicKey(vaultConfig.oracle),
        newBranch: newBranchPda,

        supplyTokenReservesLiquidity: this.get_liquidity_reserve({ mint: supplyMint }),
        borrowTokenReservesLiquidity: this.get_liquidity_reserve({ mint: borrowMint }),

        vaultSupplyPositionOnLiquidity: this.get_user_supply_position({ mint: supplyMint, protocol: this.get_vault_config({ vaultId }) }),
        vaultBorrowPositionOnLiquidity: this.get_user_borrow_position({ mint: borrowMint, protocol: this.get_vault_config({ vaultId }) }),

        supplyRateModel: this.get_rate_model({ mint: supplyMint }),
        borrowRateModel: this.get_rate_model({ mint: borrowMint }),

        supplyTokenClaimAccount: this.get_claim_account({ mint: supplyMint, user: to }),
        borrowTokenClaimAccount: this.get_claim_account({ mint: borrowMint, user: to }),

        liquidity: this.get_liquidity(),
        liquidityProgram: new PublicKey(LIQUIDITY_PROGRAM),

        vaultSupplyTokenAccount: MintInfo.getUserTokenAccountWithPDA(supplyMint, this.get_liquidity()),
        vaultBorrowTokenAccount: MintInfo.getUserTokenAccountWithPDA(borrowMint, this.get_liquidity()),

        oracleProgram: new PublicKey(vaultConfig.oracleProgram),

        supplyTokenProgram: TOKEN_PROGRAM_ID,
        borrowTokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      },
      remainingAccounts,
      otherIxs: finalOtherIxs,
      remainingAccountsIndices,
      lookupTable: await this.getLookUpTableAddress(vaultId),
    };
  }

  async loadRelevantBranchesForLiquidate(
    vaultId: number,
    vaultState: any
  ): Promise<any[]> {
    const branches = [];

    const currentBranchId = vaultState.currentBranchId;
    if (currentBranchId > 0) {
      try {
        const currentBranch = await this.readBranch({
          vaultId,
          branchId: currentBranchId,
        });
        if (currentBranch) branches.push(currentBranch);
      } catch (error) {
        // prettier-ignore
        console.warn(`Failed to fetch current branch ${currentBranchId}:`, error);
      }
    }

    let connectedBranchId = branches[0].connectedBranchId;
    const doesBranchExist = (branchId: number) =>
      branches.some((b) => b.branchId === branchId);

    while (!doesBranchExist(connectedBranchId)) {
      try {
        const connectedBranch = await this.readBranch({
          vaultId,
          branchId: connectedBranchId,
        });

        connectedBranchId = connectedBranch.connectedBranchId;
        if (connectedBranch) branches.push(connectedBranch);
      } catch (error) {
        // prettier-ignore
        console.warn(`Failed to fetch connected branch ${connectedBranchId}:`, error);
      }
    }

    return branches;
  }

  async loadRelevantTicksForLiquidate(
    vaultId: number,
    vaultState: any,
    liquidationTick: number
  ): Promise<{ ticks: any[]; nextTick: number }> {
    const ticks = [];

    let topTick = vaultState.topmostTick;

    if (topTick > liquidationTick)
      try {
        const topTickData = await this.readTick({
          vaultId,
          tick: topTick,
        });
        if (topTickData) ticks.push({ tick: topTick, ...topTickData });
      } catch (error) {
        console.warn(`Failed to fetch top tick ${topTick}:`, error);
      }

    // Find next tick with debt for liquidation traversal
    // This would be the next tick that needs to be liquidated
    let nextTick = this.MIN_TICK;
    try {
      nextTick = await this.findNextTickWithDebt(vaultId, topTick);
    } catch (error) {
      console.warn(`Failed to find next tick with debt:`, error);
    }

    const doesTickExist = (tick: number) => ticks.some((t) => t.tick === tick);

    while (nextTick > liquidationTick && !doesTickExist(nextTick)) {
      try {
        const nextTickData = await this.readTick({
          vaultId,
          tick: nextTick,
        });
        if (nextTickData) ticks.push({ tick: nextTick, ...nextTickData });
        else throw new Error("Tick not found to load");

        nextTick = await this.findNextTickWithDebt(vaultId, nextTick);
      } catch (error) {
        console.warn(`Failed to fetch next tick ${nextTick}:`, error);
      }
    }

    return { ticks, nextTick };
  }

  async loadRelevantTicksHasDebtArraysLiquidate(
    vaultId: number,
    topTick: number,
    nextTick: number
  ): Promise<any[]> {
    const tickHasDebtArrays = [];

    const { arrayIndex: topTickIndex } = this.getTickIndices(topTick);
    const { arrayIndex: nextTickIndex } = this.getTickIndices(nextTick);

    try {
      for (let arrIdx = topTickIndex; arrIdx >= nextTickIndex; arrIdx--) {
        const tickHasDebtData = await this.readTickHasDebtArray({
          vaultId,
          index: arrIdx,
        });

        tickHasDebtArrays.push(tickHasDebtData);
      }
    } catch (error) {
      console.warn(`Error finding next tick with debt:`, error);
    }

    return tickHasDebtArrays;
  }

  async loadRelevantTicksHasDebtArrays(
    vaultId: number,
    topTick: number,
    existingPositionTick: number,
    finalTick: number
  ): Promise<any[]> {
    const tickHasDebtArrays = new Set<PublicKey>();

    if (existingPositionTick == topTick) {
      // If the oldTick is topTick, and new tick is smaller than topTick (oldTick), we load all ticks from new tick to topTick
      // as in worst case topTick needs to be replaced, which means finding next tick with debt from topTick -> newTick
      let nextTickWithDebt = await this.findNextTickWithDebt(vaultId, topTick);

      let { arrayIndex: startIndex } = this.getTickIndices(nextTickWithDebt);
      let { arrayIndex: endIndex } = this.getTickIndices(topTick);

      let { arrayIndex: finalTickIndex } = this.getTickIndices(finalTick);

      if (endIndex < 15) endIndex++;

      try {
        // prettier-ignore
        for (let arrIdx = startIndex; arrIdx <= endIndex; arrIdx++) 
            tickHasDebtArrays.add(this.get_tick_has_debt({ vaultId, index: arrIdx }));
      } catch (error) {
        console.warn(`Error finding next tick with debt:`, error);
      }

      let finalTickHasDebtPda = this.get_tick_has_debt({
        vaultId,
        index: finalTickIndex,
      });

      if (!tickHasDebtArrays.has(finalTickHasDebtPda))
        tickHasDebtArrays.add(finalTickHasDebtPda);
    } else {
      // Load only old tick and new tick in tick has debt array
      let { arrayIndex: finalTickIndex } = this.getTickIndices(finalTick);
      // prettier-ignore
      let { arrayIndex: existingPositionTickIndex } = this.getTickIndices(existingPositionTick);

      // prettier-ignore
      tickHasDebtArrays.add(this.get_tick_has_debt({ vaultId, index: finalTickIndex }));
      // prettier-ignore
      tickHasDebtArrays.add(this.get_tick_has_debt({ vaultId, index: existingPositionTickIndex }));
    }

    return Array.from(tickHasDebtArrays);
  }

  async findNextTickWithDebt(
    vaultId: number,
    startTick: number
  ): Promise<number> {
    const { arrayIndex } = this.getTickIndices(startTick);

    try {
      const tickHasDebtData = await this.readTickHasDebtArray({
        vaultId,
        index: arrayIndex,
      });
      if (!tickHasDebtData) {
        return this.MIN_TICK;
      }

      // Look for the next tick with debt in the current array
      // This is a simplified search - you'd implement the actual bitmap traversal
      for (
        let tick = startTick - 1;
        tick >= this.getFirstTickForIndex(arrayIndex);
        tick--
      ) {
        try {
          const tickData = await this.readTick({
            vaultId,
            tick,
          });
          if (
            tickData &&
            !tickData.isLiquidated &&
            tickData.rawDebt.gt(new BN(0))
          ) {
            return tick;
          }
        } catch (error) {
          // Continue searching
        }
      }

      // If no tick found in current array, check previous arrays
      for (let arrIdx = arrayIndex - 1; arrIdx >= 0; arrIdx--) {
        try {
          const tickHasDebt = await this.readTickHasDebtArray({
            vaultId,
            index: arrIdx,
          });
          if (tickHasDebt) {
            // Find the highest tick with debt in this array
            const firstTick = this.getFirstTickForIndex(arrIdx);
            const lastTick = firstTick + this.TICKS_PER_TICK_HAS_DEBT - 1;

            for (let tick = lastTick; tick >= firstTick; tick--) {
              try {
                const tickData = await this.readTick({
                  vaultId,
                  tick,
                });
                if (
                  tickData &&
                  !tickData.isLiquidated &&
                  tickData.rawDebt.gt(new BN(0))
                ) {
                  return tick;
                }
              } catch (error) {
                // Continue searching
              }
            }
          }
        } catch (error) {
          // Continue to next array
        }
      }
    } catch (error) {
      console.warn(`Error finding next tick with debt:`, error);
    }

    return this.MIN_TICK; // No tick found
  }

  async loadRelevantBranches(
    vaultId: number,
    vaultState: any,
    liquidationStatus: boolean,
    postLiquidationBranchId: number
  ): Promise<number[]> {
    const addedBranchIds = new Set<number>();

    const currentBranchId =
      postLiquidationBranchId > 0
        ? postLiquidationBranchId
        : vaultState.currentBranchId;
    let connectedBranchId = 0;

    if (currentBranchId > 0) {
      try {
        const currentBranch = await this.readBranch({
          vaultId,
          branchId: currentBranchId,
        });

        if (currentBranch) {
          addedBranchIds.add(currentBranch.branchId);
          connectedBranchId = currentBranch.connectedBranchId;
        }
      } catch (error) {
        console.warn(
          `Failed to fetch current branch ${currentBranchId}:`,
          error
        );
      }
    }

    if (liquidationStatus) {
      while (connectedBranchId > 0) {
        try {
          const connectedBranch = await this.readBranch({
            vaultId,
            branchId: connectedBranchId,
          });

          if (connectedBranch) {
            if (!addedBranchIds.has(connectedBranch.branchId))
              addedBranchIds.add(connectedBranch.branchId);

            connectedBranchId = connectedBranch.connectedBranchId;
          } else break;
        } catch (error) {
          console.warn(
            `Failed to fetch connected branch ${connectedBranchId}:`,
            error
          );
          break;
        }
      }

      if (!addedBranchIds.has(0)) addedBranchIds.add(0);
    }

    return Array.from(addedBranchIds);
  }

  // Constants to match updated Rust implementation
  MIN_TICK = -16383;
  MAX_TICK = 16383;
  TICK_HAS_DEBT_ARRAY_SIZE = 8;
  TICK_HAS_DEBT_CHILDREN_SIZE = 32; // 32 bytes = 256 bits
  TICKS_PER_TICK_HAS_DEBT = this.TICK_HAS_DEBT_ARRAY_SIZE * 256; // 8 * 256 = 2048
  TOTAL_INDICES_NEEDED = 16;

  // Get the index (0-15) for a given tick
  getIndexForTick(tick: number): number {
    if (tick < this.MIN_TICK || tick > this.MAX_TICK) {
      throw new Error(
        `Invalid tick range: ${tick}. Must be between ${this.MIN_TICK} and ${this.MAX_TICK}`
      );
    }

    // Convert tick to 0-based index
    const tickOffset = tick - this.MIN_TICK; // 0 to 32766

    // Each index covers 2048 ticks
    const index = Math.floor(tickOffset / this.TICKS_PER_TICK_HAS_DEBT);

    return index;
  }

  // Get the first tick for a given index (0-15)
  getFirstTickForIndex(index: number): number {
    if (index >= this.TOTAL_INDICES_NEEDED) {
      throw new Error(
        `Invalid index: ${index}. Must be between 0 and ${
          this.TOTAL_INDICES_NEEDED - 1
        }`
      );
    }

    return this.MIN_TICK + index * this.TICKS_PER_TICK_HAS_DEBT;
  }

  // Given a tick and the array index, returns (mapIndex, byteIndex, bitIndex)
  getTickIndicesForArray(
    tick: number,
    arrayIndex: number
  ): {
    mapIndex: number;
    byteIndex: number;
    bitIndex: number;
  } {
    // Validate tick range
    if (tick < this.MIN_TICK || tick > this.MAX_TICK) {
      throw new Error(
        `Invalid tick range: ${tick}. Must be between ${this.MIN_TICK} and ${this.MAX_TICK}`
      );
    }

    // Get the expected index for this tick
    const expectedIndex = this.getIndexForTick(tick);
    if (expectedIndex !== arrayIndex) {
      throw new Error(
        `Tick ${tick} should be in array index ${expectedIndex}, not ${arrayIndex}`
      );
    }

    // Get the first tick for this array index
    const firstTickForIndex = this.getFirstTickForIndex(arrayIndex);
    const tickDeltaFromMinmumTick = tick - this.MIN_TICK;

    // Calculate position within this array (0 to 2047)
    const tickWithinArray = tick - firstTickForIndex;

    // Each mapIndex covers 256 ticks
    const mapIndex = Math.floor(tickDeltaFromMinmumTick / 256);

    // Within each map, calculate byte and bit position
    const tickWithinMap = tickWithinArray % 256;
    const byteIndex = Math.floor(tickWithinMap / 8); // 8 bits per byte
    const bitIndex = tickWithinMap % 8;

    return {
      mapIndex,
      byteIndex,
      bitIndex,
    };
  }

  // Helper function to get tick indices - updated to match Rust implementation
  getTickIndices(tick: number): {
    arrayIndex: number;
    mapIndex: number;
    byteIndex: number;
    bitIndex: number;
  } {
    const arrayIndex = this.getIndexForTick(tick);
    const { mapIndex, byteIndex, bitIndex } = this.getTickIndicesForArray(
      tick,
      arrayIndex
    );

    return {
      arrayIndex,
      mapIndex,
      byteIndex,
      bitIndex,
    };
  }

  async getAdminContext(vaultId: number) {
    const vaultConfig = await this.readVaultConfig({ vaultId });
    if (!vaultConfig) {
      throw new Error("Vault config not found");
    }

    const supplyMint = MintInfo.getMintForToken(
      vaultConfig.supplyToken
    ) as keyof typeof MintKeys;

    const borrowMint = MintInfo.getMintForToken(
      vaultConfig.borrowToken
    ) as keyof typeof MintKeys;

    return {
      authority: this.authority.publicKey,
      vaultAdmin: this.get_vault_admin(),
      vaultState: this.get_vault_state({ vaultId }),
      vaultConfig: this.get_vault_config({ vaultId }),
      supplyTokenReservesLiquidity: this.get_liquidity_reserve({
        mint: supplyMint,
      }),
      borrowTokenReservesLiquidity: this.get_liquidity_reserve({
        mint: borrowMint,
      }),
    };
  }
}
