import { BN, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import { Flashloan } from "../../../target/types/flashloan";
import flashloanJson from "../../../target/idl/flashloan.json";

import { FLASHLOAN_PROGRAM } from "../../../ts-sdk/address";
import { LiquidityBaseSetup } from "../liquidity/setup";
import { MintKeys, mint as MintInfo } from "../../../ts-sdk/mint";
import { Context } from "../../../ts-sdk/flashloan/context";

const DEFAULT_UNIT = new BN(1e6);
const DEFAULT_AMOUNT = new BN(1000).mul(DEFAULT_UNIT);

export class FlashloanBaseSetup extends LiquidityBaseSetup {
  flashloan: Program<Flashloan>;
  flashloanContext: Context;

  flashloanProtocol: PublicKey;

  underlying: MintKeys;
  underlyingLending: PublicKey;
  underlyingFToken: PublicKey;

  constructor() {
    super();

    // prettier-ignore
    this.addProgram(FLASHLOAN_PROGRAM, "target/deploy/flashloan.so", "Flashloan");
    this.underlying = MintKeys.USDC;
    this.flashloan = new Program<Flashloan>(flashloanJson, this.provider);
    this.flashloanContext = new Context(this.admin, this.flashloan);

    this.flashloanProtocol = this.flashloanContext.get_flashloan_admin();
  }

  async setup() {
    await super.setup();

    await this.initFlashloanAdmin();

    // prettier-ignore
    {
        await this.initNewProtocol([{ supplyMint: this.underlying, borrowMint: this.underlying, protocol: this.flashloanProtocol }]);
        await this._setUserAllowancesDefault(this.underlying, this.flashloanProtocol);
        await this._setUserAllowancesDefault(this.underlying, this.mockProtocol);
    }

    await this.deposit(
      this.mockProtocol,
      DEFAULT_AMOUNT,
      this.underlying,
      this.admin
    );
  }

  async initFlashloanAdmin(fee = 0) {
    const tx = this.getTx();

    const ix = await this.flashloan.methods
      .initFlashloanAdmin(this.admin.publicKey, fee, this.liquidity.programId)
      .accounts(this.flashloanContext.getInitFlashloanAdminContext())
      .instruction();

    tx.add(ix);

    this.execute(tx);
  }

  async setFlashloanFee(fee: number) {
    const tx = this.getTx();

    const ix = await this.flashloan.methods
      .setFlashloanFee(fee)
      .accounts(this.flashloanContext.getFlashloanProtocolContext())
      .instruction();

    tx.add(ix);

    this.execute(tx);
  }

  async flashloanBorrowIx(amount: BN) {
    return await this.flashloan.methods
      .flashloanBorrow(amount)
      .accounts(
        this.flashloanContext.getFlashloanContext(
          this.admin.publicKey,
          this.underlying
        )
      )
      .instruction();
  }

  async flashloanPaybackIx(amount: BN) {
    return await this.flashloan.methods
      .flashloanPayback(amount)
      .accounts(
        this.flashloanContext.getFlashloanContext(
          this.admin.publicKey,
          this.underlying
        )
      )
      .instruction();
  }
}
