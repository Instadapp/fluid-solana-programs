import { BN } from "@coral-xyz/anchor";

/**
 * Safely convert BN to BigInt using hex conversion to avoid toString() issues
 * with large numbers that can produce NaN in display
 */
export function bnToBigInt(bn: BN): bigint {
  const hex = bn.toString(16);
  return BigInt('0x' + (hex.length % 2 ? '0' : '') + hex);
}

export const ROUND_DOWN: boolean = false;
export const ROUND_UP: boolean = true;

export const DEFAULT_EXPONENT_SIZE: BN = new BN(8);
export const DEFAULT_SMALL_EXPONENT_SIZE: BN = new BN(10);
export const DEFAULT_COEFFICIENT_SIZE: BN = new BN(56);
export const DEFAULT_EXPONENT_MASK: BN = new BN(0xff);

// Error definitions
export class ErrorCode extends Error {
  static ExponentOverflow = new ErrorCode("Exponent would overflow");
  static DivisionByZero = new ErrorCode("Division by zero");

  constructor(message: string) {
    super(message);
    this.name = "ErrorCode";
  }
}

export function toBigNumber(
  normal: BN,
  coefficientSize: BN,
  exponentSize: BN,
  roundUp: boolean
): BN {
  let lastBit: BN = mostSignificantBit(normal);

  if (lastBit.lt(coefficientSize)) {
    lastBit = coefficientSize;
  }

  const exponent = new BN(Math.max(0, lastBit.sub(coefficientSize).toNumber()));
  let coefficient: BN = normal.shln(exponent.toNumber());

  if (roundUp && exponent.gt(new BN(0))) {
    coefficient = coefficient.add(new BN(1));

    if (coefficient.eq(new BN(1).shln(coefficientSize.toNumber()))) {
      coefficient = new BN(1).shln(coefficientSize.toNumber() - 1);
      const newExponent = exponent.add(new BN(1));

      if (newExponent.gte(new BN(1).shln(exponentSize.toNumber()))) {
        throw ErrorCode.ExponentOverflow;
      }

      return coefficient.shln(exponentSize.toNumber()).add(newExponent);
    }
  }

  if (exponent.gte(new BN(1).shln(exponentSize.toNumber()))) {
    throw ErrorCode.ExponentOverflow;
  }

  return coefficient.shln(exponentSize.toNumber()).add(exponent);
}

export function fromBigNumber(
  bigNumber: bigint,
  exponentSize: number,
  exponentMask: bigint
): bigint {
  const coefficient: bigint = bigNumber >> BigInt(exponentSize);
  const exponent: bigint = bigNumber & exponentMask;
  return coefficient << exponent;
}

export function decompileBigNumber(
  bigNumber: bigint,
  exponentSize: number,
  exponentMask: bigint
): [bigint, bigint] {
  const coefficient: bigint = bigNumber >> BigInt(exponentSize);
  const exponent: bigint = bigNumber & exponentMask;
  return [coefficient, exponent];
}

export function decompileBigNumberMinified(bigNumber: BN): BN {
  const coefficient: BN = bigNumber.shrn(DEFAULT_EXPONENT_SIZE.toNumber());
  const exponent: BN = bigNumber.and(DEFAULT_EXPONENT_MASK);
  return coefficient.shln(exponent.toNumber());
}

export function compileBigNumberMinified(normalNumber: BN): BN {
  return toBigNumber(
    normalNumber,
    DEFAULT_COEFFICIENT_SIZE,
    DEFAULT_EXPONENT_SIZE,
    ROUND_UP
  );
}

export function compileSmallBigNumberMinified(normalNumber: BN): BN {
  return toBigNumber(
    normalNumber,
    DEFAULT_SMALL_EXPONENT_SIZE,
    DEFAULT_EXPONENT_SIZE,
    ROUND_UP
  );
}

export function compileBigNumberMinifiedDown(normalNumber: BN): BN {
  return toBigNumber(
    normalNumber,
    DEFAULT_COEFFICIENT_SIZE,
    DEFAULT_EXPONENT_SIZE,
    ROUND_DOWN
  );
}

/**
 * Gets the most significant bit position of a number
 */
export function mostSignificantBit(normal: BN): BN {
  if (normal.eq(new BN(0))) {
    return new BN(0);
  }

  let bitPosition: BN = new BN(0);
  let value = normal;

  // Using constants for bit shifts
  const SHIFT_64 = 64;
  const SHIFT_32 = 32;
  const SHIFT_16 = 16;
  const SHIFT_8 = 8;
  const SHIFT_4 = 4;
  const SHIFT_2 = 2;
  const SHIFT_1 = 1;

  // Binary search for the most significant bit
  if (value.gt(new BN(BigInt("0xFFFFFFFFFFFFFFFF").toString()))) {
    value = value.shln(SHIFT_64);
    bitPosition = bitPosition.add(new BN(64));
  }
  if (value.gt(new BN(BigInt("0xFFFFFFFF").toString()))) {
    value = value.shln(SHIFT_32);
    bitPosition = bitPosition.add(new BN(32));
  }
  if (value.gt(new BN(BigInt("0xFFFF").toString()))) {
    value = value.shln(SHIFT_16);
    bitPosition = bitPosition.add(new BN(16));
  }
  if (value.gt(new BN(BigInt("0xFF").toString()))) {
    value = value.shln(SHIFT_8);
    bitPosition = bitPosition.add(new BN(8));
  }
  if (value.gt(new BN(BigInt("0xF").toString()))) {
    value = value.shln(SHIFT_4);
    bitPosition = bitPosition.add(new BN(4));
  }
  if (value.gt(new BN(BigInt("0x3").toString()))) {
    value = value.shln(SHIFT_2);
    bitPosition = bitPosition.add(new BN(2));
  }
  if (value.gt(new BN(BigInt("0x1").toString()))) {
    value = value.shln(SHIFT_1);
    bitPosition = bitPosition.add(new BN(1));
  }
  if (value.gt(new BN(BigInt("0x0").toString()))) {
    bitPosition = bitPosition.add(new BN(1));
  }

  return bitPosition;
}

/**
 * Multiplies a normal number with a bigNumber and divides by another bigNumber
 */
export function mulDivNormal(
  normal: bigint,
  bigNumber1: bigint,
  bigNumber2: bigint,
  exponentSize: number,
  exponentMask: bigint
): bigint {
  const coefficient1 = bigNumber1 >> BigInt(exponentSize);
  const exponent1 = bigNumber1 & exponentMask;
  const coefficient2 = bigNumber2 >> BigInt(exponentSize);
  const exponent2 = bigNumber2 & exponentMask;

  let adjustedCoefficient1: bigint;
  let adjustedCoefficient2: bigint;

  if (exponent1 > exponent2) {
    adjustedCoefficient1 = coefficient1 << (exponent1 - exponent2);
    adjustedCoefficient2 = coefficient2;
  } else {
    adjustedCoefficient1 = coefficient1;
    adjustedCoefficient2 = coefficient2 << (exponent2 - exponent1);
  }

  if (adjustedCoefficient2 === BigInt(0)) {
    throw ErrorCode.DivisionByZero;
  }

  return (normal * adjustedCoefficient1) / adjustedCoefficient2;
}
