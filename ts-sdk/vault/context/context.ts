import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  SystemProgram,
  PublicKey,
  TransactionInstruction,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { BN, Program } from "@coral-xyz/anchor";

import { State } from "./state";
import { AdminModule as Oracle } from "../../oracle";
import { mint as MintInfo, MintKeys } from "../../mint";
import { LIQUIDITY_PROGRAM } from "../../address";
import { Vaults } from "../../../target/types/vaults";
import { UserPositionWithDebt, VaultConfig } from "../resolver/types";
import { VaultResolver as TestVaultResolver } from "../../../tests-utils/vaults/resolver";
import { MPL_TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata";
import { SYSVAR_RENT_PUBKEY } from "@solana/web3.js";

type LiquidateContextParams = {
  vaultId: number;
  signer: PublicKey;
  to: PublicKey;
  sources: PublicKey[];
  oraclePrice: BN;
};

export enum TransferType {
  skip = 0,
  direct = 1,
  claim = 2,
}

type OperateContextParams = {
  vaultId: number;
  positionId: number;
  newCol?: BN;
  newDebt?: BN;
  signer: PublicKey;
  recipient?: PublicKey;
  positionOwner?: PublicKey;
  transferType?: TransferType;
  sources?: PublicKey[];
  vaultResolver?: TestVaultResolver;
};

export class Context extends State {
  oracle: Oracle;
  MIN_I128 = new BN("170141183460469231731687303715884105728").neg();
  TICK_HAS_DEBT_CHILDREN_SIZE_IN_BITS = 256; // 32 * 8

  constructor(authority: Keypair, program: Program<Vaults>) {
    super(authority, program);
    this.oracle = new Oracle(authority, program.provider);
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
    supplyToken: PublicKey,
    borrowToken: PublicKey,
    oracle: PublicKey,
    signer: PublicKey = this.authority.publicKey
  ) {
    return {
      authority: signer,
      vaultAdmin: this.get_vault_admin(),
      vaultConfig: this.get_vault_config({ vaultId }),
      vaultMetadata: this.get_vault_metadata({ vaultId }),
      supplyToken,
      borrowToken,
      oracle,
      systemProgram: SystemProgram.programId,
    };
  }

  getUpdateLookupTableContext(
    vaultId: number,
    signer: PublicKey = this.authority.publicKey
  ) {
    return {
      authority: signer,
      vaultAdmin: this.get_vault_admin(),
      vaultMetadata: this.get_vault_metadata({ vaultId }),
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
        tickIdLiquidation: this.get_tick_id_liquidation({vaultId, tick, totalIds: 0}),
        tickData: this.get_tick({ vaultId, tick }),
        systemProgram: SystemProgram.programId,
      };
    }

    // prettier-ignore
    return {
      signer,
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
    const [metadataAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID).toBuffer(),
        this.get_position_mint({ vaultId, positionId }).toBuffer(),
      ],
      new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)
    );

    // prettier-ignore
    return {
      signer,
      vaultAdmin: this.get_vault_admin(),
      vaultState: this.get_vault_state({ vaultId }),
      position: this.get_position({ vaultId, positionId }),
      positionMint: this.get_position_mint({ vaultId, positionId }),
      positionTokenAccount: this.get_position_token_account({ vaultId, positionId, user: signer }),
      tokenProgram: TOKEN_PROGRAM_ID,
      metadataAccount,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      sysvarInstruction: SYSVAR_INSTRUCTIONS_PUBKEY,
      metadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    };
  }

  getClosePositionContext(
    vaultId: number,
    positionId: number,
    signer: PublicKey = this.authority.publicKey
  ) {
    const [metadataAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID).toBuffer(),
        this.get_position_mint({ vaultId, positionId }).toBuffer(),
      ],
      new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)
    );

    return {
      signer,
      vaultAdmin: this.get_vault_admin(),
      vaultState: this.get_vault_state({ vaultId }),
      vaultConfig: this.get_vault_config({ vaultId }),
      position: this.get_position({ vaultId, positionId }),
      positionMint: this.get_position_mint({ vaultId, positionId }),
      positionTokenAccount: this.get_position_token_account({
        vaultId,
        positionId,
        user: signer,
      }),
      metadataAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      sysvarInstruction: SYSVAR_INSTRUCTIONS_PUBKEY,
      metadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
    };
  }

  async getRebalanceContext(
    supplyMint: MintKeys,
    borrowMint: MintKeys,
    vaultId: number,
    signer: PublicKey = this.authority.publicKey
  ) {
    const vaultConfig = await this.readVaultConfig({ vaultId });

    if (!vaultConfig) {
      throw new Error("Vault config not found");
    }

    return {
      rebalancer: signer,
      rebalancerSupplyTokenAccount: MintInfo.getUserTokenAccount(
        supplyMint,
        signer
      ),
      rebalancerBorrowTokenAccount: MintInfo.getUserTokenAccount(
        borrowMint,
        signer
      ),
      vaultConfig: this.get_vault_config({ vaultId }),
      vaultState: this.get_vault_state({ vaultId }),
      supplyToken: MintInfo.getMint(supplyMint),
      borrowToken: MintInfo.getMint(borrowMint),
      supplyTokenReservesLiquidity: this.get_liquidity_reserve({
        mint: supplyMint,
      }),
      borrowTokenReservesLiquidity: this.get_liquidity_reserve({
        mint: borrowMint,
      }),
      vaultSupplyPositionOnLiquidity: this.get_user_supply_position({
        mint: supplyMint,
        protocol: this.get_vault_config({ vaultId }),
      }),
      vaultBorrowPositionOnLiquidity: this.get_user_borrow_position({
        mint: borrowMint,
        protocol: this.get_vault_config({ vaultId }),
      }),
      supplyRateModel: this.get_rate_model({ mint: supplyMint }),
      borrowRateModel: this.get_rate_model({ mint: borrowMint }),
      liquidity: this.get_liquidity(),
      liquidityProgram: new PublicKey(vaultConfig.liquidityProgram),
      vaultSupplyTokenAccount: MintInfo.getUserTokenAccountWithPDA(
        supplyMint,
        this.get_liquidity()
      ),
      vaultBorrowTokenAccount: MintInfo.getUserTokenAccountWithPDA(
        borrowMint,
        this.get_liquidity()
      ),
      supplyTokenProgram: TOKEN_PROGRAM_ID,
      borrowTokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    };
  }

  async getOtherInstructionsOperate(
    vaultId: number,
    vaultState: any,
    currentPosition: UserPositionWithDebt,
    finalPosition: UserPositionWithDebt,
    currentTick: number,
    currentTickId: number
  ) {
    const otherIxs: TransactionInstruction[] = [];

    const tickToRead: number[] = [currentTick];
    let currentTickData: any;
    let finalTickData: any;

    // check if current position tick exists or not
    tickToRead.push(currentPosition.tick);

    // check if final position tick exists or not
    // prettier-ignore
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
    if (vaultState.branchLiquidated === 1) {
      // Check if new branch exists (only if we're creating a new one)
      newBranchId = vaultState.totalBranchId + 1;

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
      newBranchId = vaultState.currentBranchId;
    }

    const newBranchPda = this.get_branch({
      vaultId,
      branchId: newBranchId,
    });

    let currentTickIdDataPda = this.get_tick_id_liquidation({
      vaultId,
      tick: currentTick, // Position tick
      totalIds: currentTickId, // Position tick ID
    });

    const tickIdsToRead = [
      {
        tick: currentTick,
        totalIds: currentTickId,
      },
    ];

    let finalTickIdDataPda = this.get_tick_id_liquidation({
      vaultId,
      tick: finalPosition.tick,
      totalIds: finalTickData ? finalTickData.totalIds : 0,
    });

    if (finalPosition.tick !== currentTick)
      if (finalTickData) {
        tickIdsToRead.push({
          tick: finalPosition.tick,
          totalIds: finalTickData.totalIds,
        });
      } else {
        const context = await this.getInitTickIdLiquidationContext(
          vaultId,
          finalPosition.tick
        );

        const ix = await this.program.methods
          .initTickIdLiquidation(vaultId, finalPosition.tick, 0)
          .accounts(context)
          .instruction();

        otherIxs.push(ix);
      }

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
            .accounts(await this.getInitTickIdLiquidationContext(vaultId, tickIdsToRead[i].tick))
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
    vaultState: any,
    vaultConfig: VaultConfig,
    topTick: number,
    sources?: PublicKey[]
  ) {
    const remainingAccounts = [];

    if (!sources) {
      const oracleData = await this.oracle.readOracle(
        new PublicKey(vaultConfig.oracle)
      );

      sources = oracleData.sources.map(
        (source) => new PublicKey(source.source)
      );
    }

    for (const source of sources || [])
      remainingAccounts.push({
        pubkey: source,
        isWritable: false,
        isSigner: false,
      });

    const branches = await this.loadRelevantBranches(vaultId, vaultState);
    let branchLength = branches.length;

    for (const branch of branches) {
      remainingAccounts.push({
        pubkey: this.get_branch({ vaultId, branchId: branch }),
        isWritable: true,
        isSigner: false,
      });
    }

    const tickHasDebt = await this.loadRelevantTicksHasDebtArrays(
      vaultId,
      topTick
    );
    let tickHasDebtLength = tickHasDebt.length;

    // prettier-ignore
    for (const tickHasDebtArray of tickHasDebt) 
        remainingAccounts.push({
          pubkey: this.get_tick_has_debt({ vaultId, index: tickHasDebtArray.index }),
          isWritable: true,
          isSigner: false,
        });

    const remainingAccountsIndices = [
      sources?.length || 0,
      branchLength,
      tickHasDebtLength,
    ];

    return {
      remainingAccounts,
      remainingAccountsIndices,
    };
  }

  async getOperateContext(params: OperateContextParams) {
    let {
      vaultId,
      positionId,
      newCol = new BN(0),
      newDebt = new BN(0),
      signer,
      transferType = TransferType.direct, // default to direct transfer
      recipient = signer,
      positionOwner = signer,
      sources,
      vaultResolver,
    } = params;

    const vaultMetadata = await this.readVaultMetadata({vaultId});

    if (newCol.gt(this.MIN_I128) && vaultMetadata.supplyMintDecimals != 9)
      newCol = newCol.mul(new BN(10).pow(new BN(9 - vaultMetadata.supplyMintDecimals)));

    if (newDebt.gt(this.MIN_I128) && vaultMetadata.borrowMintDecimals != 9)
      newDebt = newDebt.mul(new BN(10).pow(new BN(9 - vaultMetadata.borrowMintDecimals)));

    const vaultState = await this.readVaultState({ vaultId });
    const vaultConfig = await this.readVaultConfig({ vaultId });

    if (!vaultState || !vaultConfig) {
      throw new Error("Vault state or config not found");
    }

    const supplyMint = MintInfo.getMintForToken(
      vaultConfig.supplyToken
    ) as keyof typeof MintKeys;

    const borrowMint = MintInfo.getMintForToken(
      vaultConfig.borrowToken
    ) as keyof typeof MintKeys;

    let positionData = await this.readUserPosition({ vaultId, positionId });
    if (!positionData) {
      positionData = {
        tick: this.MIN_TICK,
        tickId: 0,
        isSupplyOnlyPosition: true,
        supplyAmount: new BN(0),
        dustDebtAmount: new BN(0),
        debtAmount: new BN(0),
        vaultId: vaultId,
        nftId: positionId,
        positionMint: new PublicKey(0),
      };
    }

    let existingPositionTick = positionData.tick;
    let existingPositionTickId = positionData.tickId;

    const currentPosition = await this.getCurrentPositionState({
      vaultId,
      position: positionData,
    });

    if (existingPositionTick === -2147483648) {
      existingPositionTick = currentPosition.tick;
    }

    let currentPositionTickPda: PublicKey = this.get_tick({
      vaultId,
      tick: existingPositionTick,
    });

    const finalPosition = await this.calculateFinalPosition({
      vaultId,
      currentPosition,
      newColAmount: newCol,
      newDebtAmount: newDebt,
      vaultResolver,
    });

    const { otherIxs, newBranchPda, currentTickIdDataPda, finalTickIdDataPda } =
      await this.getOtherInstructionsOperate(
        vaultId,
        vaultState,
        currentPosition,
        finalPosition,
        existingPositionTick,
        existingPositionTickId
      );

    const { remainingAccounts, remainingAccountsIndices } =
      await this.getRemainingAccountsOperate(
        vaultId,
        vaultState,
        vaultConfig,
        Math.max(finalPosition.tick, vaultState.topmostTick),
        sources
      );

    // prettier-ignore
    let accounts = {
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

    // if withdraw operation, we need to add the claim account
    if (transferType === TransferType.claim) {
      // withdraw operation
      if (newCol.lt(new BN(0))) {
        accounts.supplyTokenClaimAccount = this.get_claim_account({
          mint: supplyMint,
          user: this.get_vault_config({ vaultId }),
        });
      }

      // borrow operation
      if (newDebt.gt(new BN(0))) {
        accounts.borrowTokenClaimAccount = this.get_claim_account({
          mint: borrowMint,
          user: this.get_vault_config({ vaultId }),
        });
      }
    }

    return {
      accounts,
      remainingAccounts,
      otherIxs,
      remainingAccountsIndices,
      lookupTable: await this.getLookUpTableAddress(vaultId),
    };
  }

  async getLookUpTableAddress(vaultId: number) {
    const vaultMetadata = await this.readVaultMetadata({ vaultId });
    if (!vaultMetadata) {
      throw new Error("Vault metadata not found");
    }

    return vaultMetadata.lookupTable;
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
    oraclePrice: BN,
    otherIxs: TransactionInstruction[],
    sources: PublicKey[]
  ) {
    const remainingAccounts = [];

    if (!sources) {
      const oracleData = await this.oracle.readOracle(
        new PublicKey(vaultConfig.oracle)
      );

      sources = oracleData.sources.map(
        (source) => new PublicKey(source.source)
      );
    }

    const liquidationRatio = oraclePrice
      .mul(new BN(281474976710656))
      .div(new BN(10).pow(new BN(8)));

    const liquidationThresholdRatio = liquidationRatio
      .mul(new BN(vaultConfig.liquidationThreshold))
      .div(new BN(10).pow(new BN(3)));

    const liquidationTick = this.getTickAtRatio(liquidationThresholdRatio);

    for (const source of sources || [])
      remainingAccounts.push({
        pubkey: source,
        isWritable: false,
        isSigner: false,
      });

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
    const { signer, to, vaultId, sources, oraclePrice } = params;

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
      oraclePrice,
      otherIxs,
      sources
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

    // Load current branch (always first)
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

    // Load connected branch if exists
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

    if (!doesBranchExist(0)) branches.push({ branchId: 0 });

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
    topTick: number
  ): Promise<any[]> {
    const tickHasDebtArrays = [];

    const topTickIndex = this.getIndexForTick(topTick);

    try {
      for (let arrIdx = topTickIndex; arrIdx >= 0; arrIdx--) {
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

  async findNextTickWithDebt(
    vaultId: number,
    startTick: number
  ): Promise<number> {
    try {
      const { arrayIndex, mapIndex, byteIndex, bitIndex } =
        this.getTickIndices(startTick);

      // Load the current TickHasDebtArray
      let currentArrayIndex = arrayIndex;
      let currentMapIndex = mapIndex;

      let tickHasDebtData = await this.readTickHasDebtArray({
        vaultId,
        index: currentArrayIndex,
      });

      if (!tickHasDebtData) {
        return this.MIN_TICK;
      }

      // Clear bits for the current tick and all higher ticks (just like Rust code)
      this.clearBitsInBitmap(tickHasDebtData, mapIndex, byteIndex, bitIndex);

      // Main search loop
      while (true) {
        const { nextTick, hasNextTick } = this.fetchNextTopTickFromBitmap(
          tickHasDebtData,
          currentMapIndex
        );

        if (hasNextTick && nextTick !== this.MIN_TICK) {
          return nextTick;
        }

        // No bits found in current array, move to previous array (lower ticks)
        if (currentArrayIndex === 0) {
          return this.MIN_TICK;
        }

        currentArrayIndex -= 1;
        currentMapIndex = this.TICK_HAS_DEBT_ARRAY_SIZE - 1;

        // Load the previous array
        tickHasDebtData = await this.readTickHasDebtArray({
          vaultId,
          index: currentArrayIndex,
        });

        if (!tickHasDebtData) {
          return this.MIN_TICK;
        }
      }
    } catch (error) {
      console.warn(`Error finding next tick with debt:`, error);
      return this.MIN_TICK;
    }
  }

  // Clear bits from current position onwards (mirrors Rust clear_bits function)
  private clearBitsInBitmap(
    tickHasDebtData: any,
    mapIndex: number,
    byteIndex: number,
    bitIndex: number
  ): void {
    // Create a working copy of the current map's bitmap
    const bitmap = [...tickHasDebtData.tickHasDebt[mapIndex].childrenBits];

    // Clear the current tick's bit and all higher bits in the current byte
    if (bitIndex > 0) {
      // Create mask to keep only bits lower than current bit
      const mask = (1 << bitIndex) - 1;
      bitmap[byteIndex] &= mask;
    } else {
      // If bit_index is 0, clear the entire byte
      bitmap[byteIndex] = 0;
    }

    // Clear all bytes with higher indices (representing higher ticks)
    for (let i = byteIndex + 1; i < this.TICK_HAS_DEBT_CHILDREN_SIZE; i++) {
      bitmap[i] = 0;
    }

    // Update the bitmap in place
    tickHasDebtData.tickHasDebt[mapIndex].childrenBits = bitmap;
  }

  // Fetch next tick from bitmap (mirrors Rust fetch_next_top_tick)
  private fetchNextTopTickFromBitmap(
    tickHasDebtData: any,
    startMapIndex: number
  ): { nextTick: number; hasNextTick: boolean } {
    let mapIndex = startMapIndex;

    // Search for the next tick with debt
    while (mapIndex >= 0) {
      if (this.hasBitsInMap(tickHasDebtData, mapIndex)) {
        const { nextTick, hasNextTick } = this.getNextTickFromMap(
          tickHasDebtData,
          mapIndex
        );

        if (hasNextTick) {
          return { nextTick, hasNextTick: true };
        }
      }

      mapIndex--;
    }

    return { nextTick: this.MIN_TICK, hasNextTick: false };
  }

  // Check if a map has any bits set
  private hasBitsInMap(tickHasDebtData: any, mapIndex: number): boolean {
    const childrenBits = tickHasDebtData.tickHasDebt[mapIndex].childrenBits;
    return childrenBits.some((byte: number) => byte !== 0);
  }

  // Get the next tick from a specific map (mirrors Rust get_next_tick)
  private getNextTickFromMap(
    tickHasDebtData: any,
    mapIndex: number
  ): { nextTick: number; hasNextTick: boolean } {
    const childrenBits = tickHasDebtData.tickHasDebt[mapIndex].childrenBits;

    // Search from highest byte to lowest (reverse order)
    for (
      let byteIdx = this.TICK_HAS_DEBT_CHILDREN_SIZE - 1;
      byteIdx >= 0;
      byteIdx--
    ) {
      if (childrenBits[byteIdx] !== 0) {
        // Find the highest set bit in this byte
        const leadingZeros = this.getMostSignificantBit(childrenBits[byteIdx]);
        const bitPos = 7 - leadingZeros;

        // Calculate the tick within the map (0-255)
        const tickWithinMap = byteIdx * 8 + bitPos;

        // Calculate the actual tick value
        const mapFirstTick = this.getFirstTickForMapIndex(
          tickHasDebtData.index,
          mapIndex
        );

        return {
          nextTick: mapFirstTick + tickWithinMap,
          hasNextTick: true,
        };
      }
    }

    return { nextTick: this.MIN_TICK, hasNextTick: false };
  }

  // Get most significant bit position (mirrors Rust get_most_significant_bit)
  private getMostSignificantBit(byte: number): number {
    if (byte === 0) return 8;

    let leadingZeros = 0;
    let mask = 0x80; // 10000000

    while ((byte & mask) === 0 && leadingZeros < 8) {
      leadingZeros++;
      mask >>>= 1;
    }

    return leadingZeros;
  }

  // Get first tick for a map within an array (mirrors Rust function)
  private getFirstTickForMapIndex(
    arrayIndex: number,
    mapIndex: number
  ): number {
    const arrayFirstTick = this.getFirstTickForIndex(arrayIndex);
    return arrayFirstTick + mapIndex * this.TICK_HAS_DEBT_CHILDREN_SIZE_IN_BITS;
  }

  async loadRelevantBranches(
    vaultId: number,
    vaultState: any
  ): Promise<number[]> {
    const addedBranchIds = new Set<number>();

    const currentBranchId = vaultState.currentBranchId;
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

  private getTickIndices(tick: number): {
    arrayIndex: number;
    mapIndex: number;
    byteIndex: number;
    bitIndex: number;
  } {
    if (tick < this.MIN_TICK || tick > this.MAX_TICK) {
      throw new Error("Tick out of range");
    }

    // Convert tick to 0-based index
    const tickOffset = tick - this.MIN_TICK;

    // Each array covers 2048 ticks
    const arrayIndex = Math.floor(tickOffset / this.TICKS_PER_TICK_HAS_DEBT);

    // Get the first tick for this array index
    const firstTickForIndex = this.getFirstTickForIndex(arrayIndex);

    // Calculate position within this array (0 to 2047)
    const tickWithinArray = tick - firstTickForIndex;

    // Each map covers 256 ticks
    const mapIndex = Math.floor(
      tickWithinArray / this.TICK_HAS_DEBT_CHILDREN_SIZE_IN_BITS
    );

    // Within each map, calculate byte and bit position
    const tickWithinMap =
      tickWithinArray % this.TICK_HAS_DEBT_CHILDREN_SIZE_IN_BITS;
    const byteIndex = Math.floor(tickWithinMap / 8);
    const bitIndex = tickWithinMap % 8;

    return { arrayIndex, mapIndex, byteIndex, bitIndex };
  }

  async getUpdateOracleContext(vaultId: number, newOracle: PublicKey) {
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
      newOracle,
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
