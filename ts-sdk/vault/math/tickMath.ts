import { BN } from "@coral-xyz/anchor";

class TickMath {
  MIN_TICK = -16383;
  MAX_TICK = 16383;
  INIT_TICK = -2147483648;
  TICK_SPACING = new BN(10015);
  FOUR_DECIMALS = new BN(10000);
  ZERO_TICK_SCALED_RATIO = new BN(0x1000000000000);

  getRatioAtTick(tick: number): BN {
    if (tick < this.MIN_TICK || tick > this.MAX_TICK) {
      throw new Error(
        `Tick ${tick} out of range [${this.MIN_TICK}, ${this.MAX_TICK}]`
      );
    }

    // Rust TickMath constants (using string representation for large numbers)
    const FACTOR00 = new BN("18446744073709551616"); // 2^64
    const FACTOR01 = new BN("18419115400608638658"); // 2^64/1.0015**1
    const FACTOR02 = new BN("18391528108445969703"); // 2^64/1.0015**2
    const FACTOR03 = new BN("18336477419114433396"); // 2^64/1.0015**4
    const FACTOR04 = new BN("18226869890870665593"); // 2^64/1.0015**8
    const FACTOR05 = new BN("18009616477100071088"); // 2^64/1.0015**16
    const FACTOR06 = new BN("17582847377087825313"); // 2^64/1.0015**32
    const FACTOR07 = new BN("16759408633341240198"); // 2^64/1.0015**64
    const FACTOR08 = new BN("15226414841393184936"); // 2^64/1.0015**128
    const FACTOR09 = new BN("12568272644527235157"); // 2^64/1.0015**256
    const FACTOR10 = new BN("8563108841104354677"); // 2^64/1.0015**512
    const FACTOR11 = new BN("3975055583337633975"); // 2^64/1.0015**1024
    const FACTOR12 = new BN("856577552520149366"); // 2^64/1.0015**2048
    const FACTOR13 = new BN("39775317560084773"); // 2^64/1.0015**4096
    const FACTOR14 = new BN("85764505686420"); // 2^64/1.0015**8192
    const FACTOR15 = new BN("398745188"); // 2^64/1.0015**16384

    const absTick = Math.abs(tick);
    let factor = FACTOR00;

    // Binary calculation exactly like Rust
    if (absTick & 0x1) factor = FACTOR01;
    if (absTick & 0x2) factor = this.mulShift64(factor, FACTOR02);
    if (absTick & 0x4) factor = this.mulShift64(factor, FACTOR03);
    if (absTick & 0x8) factor = this.mulShift64(factor, FACTOR04);
    if (absTick & 0x10) factor = this.mulShift64(factor, FACTOR05);
    if (absTick & 0x20) factor = this.mulShift64(factor, FACTOR06);
    if (absTick & 0x40) factor = this.mulShift64(factor, FACTOR07);
    if (absTick & 0x80) factor = this.mulShift64(factor, FACTOR08);
    if (absTick & 0x100) factor = this.mulShift64(factor, FACTOR09);
    if (absTick & 0x200) factor = this.mulShift64(factor, FACTOR10);
    if (absTick & 0x400) factor = this.mulShift64(factor, FACTOR11);
    if (absTick & 0x800) factor = this.mulShift64(factor, FACTOR12);
    if (absTick & 0x1000) factor = this.mulShift64(factor, FACTOR13);
    if (absTick & 0x2000) factor = this.mulShift64(factor, FACTOR14);
    if (absTick & 0x4000) factor = this.mulShift64(factor, FACTOR15);

    let precision = new BN(0);

    if (tick > 0) {
      const maxU128 = new BN(2).pow(new BN(128)).sub(new BN(1));
      factor = maxU128.div(factor);

      if (!factor.mod(new BN(0x10000)).isZero()) {
        precision = new BN(1);
      }
    }

    const ratioX48 = factor.shrn(16).add(precision);
    return ratioX48;
  }

  // Helper function for mul_shift_64 operation (more robust implementation)
  private mulShift64(n0: BN, n1: BN): BN {
    try {
      return n0.mul(n1).shrn(64);
    } catch (error) {
      // Fallback for very large numbers
      const product = n0.mul(n1);
      return product.div(new BN(2).pow(new BN(64)));
    }
  }

  // Helper to get tick from ratio (matches Rust TickMath exactly)
  getTickAtRatio(ratioX48: BN): number {
    const MIN_RATIOX48 = new BN(6093);
    const MAX_RATIOX48 = new BN("13002088133096036565414295");
    const _1E13 = new BN("10000000000000");

    if (ratioX48.lt(MIN_RATIOX48) || ratioX48.gt(MAX_RATIOX48)) {
      throw new Error(`Ratio ${ratioX48.toString()} out of bounds`);
    }

    const isNegative = ratioX48.lt(this.ZERO_TICK_SCALED_RATIO);
    let factor: BN;

    if (isNegative) {
      // For ratios < 1 (negative ticks)
      factor = this.ZERO_TICK_SCALED_RATIO.mul(_1E13).div(ratioX48);
    } else {
      // For ratios >= 1 (positive ticks)
      factor = ratioX48.mul(_1E13).div(this.ZERO_TICK_SCALED_RATIO);
    }

    let tick = 0;

    // Binary search through powers of 2 - exactly like Rust
    if (factor.gte(new BN("2150859953785115391"))) {
      tick |= 0x2000;
      factor = factor.mul(_1E13).div(new BN("2150859953785115391"));
    }
    if (factor.gte(new BN("4637736467054931"))) {
      tick |= 0x1000;
      factor = factor.mul(_1E13).div(new BN("4637736467054931"));
    }
    if (factor.gte(new BN("215354044936586"))) {
      tick |= 0x800;
      factor = factor.mul(_1E13).div(new BN("215354044936586"));
    }
    if (factor.gte(new BN("46406254420777"))) {
      tick |= 0x400;
      factor = factor.mul(_1E13).div(new BN("46406254420777"));
    }
    if (factor.gte(new BN("21542110950596"))) {
      tick |= 0x200;
      factor = factor.mul(_1E13).div(new BN("21542110950596"));
    }
    if (factor.gte(new BN("14677230989051"))) {
      tick |= 0x100;
      factor = factor.mul(_1E13).div(new BN("14677230989051"));
    }
    if (factor.gte(new BN("12114962232319"))) {
      tick |= 0x80;
      factor = factor.mul(_1E13).div(new BN("12114962232319"));
    }
    if (factor.gte(new BN("11006798913544"))) {
      tick |= 0x40;
      factor = factor.mul(_1E13).div(new BN("11006798913544"));
    }
    if (factor.gte(new BN("10491329235871"))) {
      tick |= 0x20;
      factor = factor.mul(_1E13).div(new BN("10491329235871"));
    }
    if (factor.gte(new BN("10242718992470"))) {
      tick |= 0x10;
      factor = factor.mul(_1E13).div(new BN("10242718992470"));
    }
    if (factor.gte(new BN("10120631893548"))) {
      tick |= 0x8;
      factor = factor.mul(_1E13).div(new BN("10120631893548"));
    }
    if (factor.gte(new BN("10060135135051"))) {
      tick |= 0x4;
      factor = factor.mul(_1E13).div(new BN("10060135135051"));
    }
    if (factor.gte(new BN("10030022500000"))) {
      tick |= 0x2;
      factor = factor.mul(_1E13).div(new BN("10030022500000"));
    }
    if (factor.gte(new BN("10015000000000"))) {
      tick |= 0x1;
    }

    if (isNegative) {
      tick = ~tick;
    }

    return tick;
  }
}

export const tickMath = new TickMath();
