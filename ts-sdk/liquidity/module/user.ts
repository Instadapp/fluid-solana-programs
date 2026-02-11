import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import { AdminModule } from "./admin";
import { mint as MintInfo, MintKeys } from "../../mint";
import { Liquidity } from "../../../target/types/liquidity";

enum TransferType {
  skip = 0,
  direct = 1,
  claim = 2,
}

export class UserModule extends AdminModule {
  constructor(authority: Keypair, program: Program<Liquidity>) {
    super(authority, program);
  }

  getPreOperateContext(
    mint: MintKeys,
    protocol: PublicKey = this.authority.publicKey
  ) {
    return {
      protocol,
      liquidity: this.get_liquidity(),
      userSupplyPosition: this.get_user_supply_position(mint, protocol),
      userBorrowPosition: this.get_user_borrow_position(mint, protocol),
      vault: MintInfo.getUserTokenAccountWithPDA(mint, this.get_liquidity()),
      tokenReserve: this.get_reserve(mint),
      tokenProgram: MintInfo.getTokenProgramForKey(mint),
      associatedTokenProgram: MintInfo.getAssociatedTokenProgram(),
    };
  }

  getOperateContext(
    mint: MintKeys,
    protocol: PublicKey = this.authority.publicKey,
    withdrawTo: PublicKey = protocol,
    borrowTo: PublicKey = protocol
  ) {
    // prettier-ignore
    return {
      protocol,
      liquidity: this.get_liquidity(),
      tokenReserve: this.get_reserve(mint),
      vault: MintInfo.getUserTokenAccountWithPDA(mint, this.get_liquidity()), // owner is liquidity PDA
      userSupplyPosition: this.get_user_supply_position(mint, protocol),
      userBorrowPosition: this.get_user_borrow_position(mint, protocol),
      rateModel: this.get_rate_model(mint),
      withdrawToAccount: MintInfo.getUserTokenAccountWithPDA(mint, withdrawTo),
      borrowToAccount: MintInfo.getUserTokenAccountWithPDA(mint, borrowTo),
      withdrawClaimAccount: this.get_claim_account(mint, withdrawTo),
      borrowClaimAccount: this.get_claim_account(mint, borrowTo),
      mint: MintInfo.getMint(mint),
      tokenProgram: MintInfo.getTokenProgramForKey(mint),
      associatedTokenProgram: MintInfo.getAssociatedTokenProgram(),
    };
  }

  async preOperateIx(mint: MintKeys, protocol: PublicKey) {
    return this.program.methods
      .preOperate(MintInfo.getMint(mint))
      .accounts(this.getPreOperateContext(mint, protocol))
      .instruction();
  }

  async initClaimAccountIx(mint: MintKeys, user: PublicKey) {
    return this.program.methods
      .initClaimAccount(MintInfo.getMint(mint), user)
      .accounts(this.getInitClaimAccountContext({ mint, user }))
      .instruction();
  }

  async closeClaimAccountIx(mint: MintKeys, user: PublicKey) {
    return this.program.methods
      .closeClaimAccount(MintInfo.getMint(mint))
      .accounts(this.getCloseClaimAccountContext({ mint, user }))
      .instruction();
  }

  async depositIx(
    amount: BN,
    mint: MintKeys,
    protocol?: PublicKey,
    withdrawTo: PublicKey = protocol,
    borrowTo: PublicKey = protocol,
    transferType: TransferType = TransferType.direct
  ) {
    if (amount.lt(new BN(0))) {
      throw new Error(
        `Amount must be greater than 0 for deposit, received ${amount.toString()}`
      );
    }

    const enumMap = {
      [TransferType.skip]: { skip: {} },
      [TransferType.direct]: { direct: {} },
      [TransferType.claim]: { claim: {} },
    };

    // prettier-ignore
    const context = this.getOperateContext(mint, protocol, withdrawTo, borrowTo);

    // remove withdrawToAccount, borrowToAccount from context as this is not used in deposit
    delete context.withdrawToAccount;
    delete context.borrowToAccount;

    return this.program.methods
      .operate(amount, new BN(0), withdrawTo, borrowTo, enumMap[transferType])
      .accounts(context)
      .instruction();
  }

  async withdrawIx(
    amount: BN,
    mint: MintKeys,
    protocol?: PublicKey,
    withdrawTo: PublicKey = protocol,
    borrowTo: PublicKey = protocol,
    transferType: TransferType = TransferType.direct
  ) {
    if (amount.gte(new BN(0))) {
      throw new Error(
        `Amount must be less than 0 for withdraw, received ${amount.toString()}`
      );
    }

    const enumMap = {
      [TransferType.skip]: { skip: {} },
      [TransferType.direct]: { direct: {} },
      [TransferType.claim]: { claim: {} },
    };

    // prettier-ignore
    const context = this.getOperateContext(mint, protocol, withdrawTo, borrowTo);

    // remove borrowToAccount from context as this is not used in withdraw
    delete context.borrowToAccount;

    return this.program.methods
      .operate(amount, new BN(0), withdrawTo, borrowTo, enumMap[transferType])
      .accounts(context)
      .instruction();
  }

  async borrowIx(
    amount: BN,
    mint: MintKeys,
    protocol?: PublicKey,
    withdrawTo: PublicKey = protocol,
    borrowTo: PublicKey = protocol,
    transferType: TransferType = TransferType.direct
  ) {
    if (amount.lte(new BN(0)))
      throw new Error(
        `Amount must be greater than 0 for borrow, received ${amount.toString()}`
      );

    const enumMap = {
      [TransferType.skip]: { skip: {} },
      [TransferType.direct]: { direct: {} },
      [TransferType.claim]: { claim: {} },
    };

    // prettier-ignore
    const context = this.getOperateContext(mint, protocol, withdrawTo, borrowTo);

    // remove withdrawToAccount from context as this is not used in borrow
    delete context.withdrawToAccount;

    return this.program.methods
      .operate(new BN(0), amount, withdrawTo, borrowTo, enumMap[transferType])
      .accounts(context)
      .instruction();
  }

  async paybackIx(
    amount: BN,
    mint: MintKeys,
    protocol?: PublicKey,
    withdrawTo: PublicKey = protocol,
    borrowTo: PublicKey = protocol,
    transferType: TransferType = TransferType.direct
  ) {
    if (amount.gt(new BN(0))) {
      throw new Error(
        `Amount must be less than 0 for repay, received ${amount.toString()}`
      );
    }

    const enumMap = {
      [TransferType.skip]: { skip: {} },
      [TransferType.direct]: { direct: {} },
      [TransferType.claim]: { claim: {} },
    };

    // prettier-ignore
    const context = this.getOperateContext(mint, protocol, withdrawTo, borrowTo);

    // remove withdrawToAccount, borrowToAccount from context as this is not used in payback
    delete context.withdrawToAccount;
    delete context.borrowToAccount;

    return this.program.methods
      .operate(new BN(0), amount, withdrawTo, borrowTo, enumMap[transferType])
      .accounts(context)
      .instruction();
  }

  async claimIx(mint: MintKeys, user: PublicKey, recipient: PublicKey = user) {
    return this.program.methods
      .claim(recipient)
      .accounts(this.getClaimContext({ mint, user, recipient }))
      .instruction();
  }
}
