import { BN } from "@coral-xyz/anchor";

const COEFFICIENT_SIZE_DEBT_FACTOR = 35;
const EXPONENT_SIZE_DEBT_FACTOR = 15;
const EXPONENT_MAX_DEBT_FACTOR = new BN(1)
  .shln(EXPONENT_SIZE_DEBT_FACTOR)
  .subn(1);
const DECIMALS_DEBT_FACTOR = new BN(16384);
export const MAX_MASK_DEBT_FACTOR = new BN(1)
  .shln(COEFFICIENT_SIZE_DEBT_FACTOR + EXPONENT_SIZE_DEBT_FACTOR)
  .subn(1);

export const PRECISION = 64;
export const TWO_POWER_64 = new BN("18446744073709551615"); // u64::MAX
const TWO_POWER_69_MINUS_1 = new BN(1).shln(69).subn(1);

const COEFFICIENT_PLUS_PRECISION = COEFFICIENT_SIZE_DEBT_FACTOR + PRECISION; // 99
const COEFFICIENT_PLUS_PRECISION_MINUS_1 = COEFFICIENT_PLUS_PRECISION - 1; // 98
const TWO_POWER_COEFFICIENT_PLUS_PRECISION_MINUS_1 = new BN(1)
  .shln(COEFFICIENT_PLUS_PRECISION_MINUS_1)
  .subn(1); // (1 << 98) - 1
const TWO_POWER_COEFFICIENT_PLUS_PRECISION_MINUS_1_MINUS_1 = new BN(1)
  .shln(COEFFICIENT_PLUS_PRECISION_MINUS_1 - 1)
  .subn(1); // (1 << 97) - 1

/**
 * Multiplies a `normal` number with a `big_number1` and then divides by `big_number2`.
 *
 * For vault's use case MUST always:
 * - bigNumbers have exponent size 15 bits
 * - bigNumbers have coefficient size 35 bits and have 35th bit always 1
 * - big_number1 (debt factor) always have exponent >= 1 & <= 16384
 * - big_number2 (connection factor) always have exponent >= 1 & <= 32767
 * - big_number2 always >= big_number1
 * - normal is positionRawDebt and is always within 10000 and i128::MAX
 *
 * @returns normal * big_number1 / big_number2
 */
export function mulDivNormal(normal: BN, bigNumber1: BN, bigNumber2: BN): BN {
  // Handle zero cases early
  if (bigNumber1.isZero() || bigNumber2.isZero()) {
    return new BN(0);
  }

  // Extract exponents from the big numbers
  const exponent1 = bigNumber1.and(EXPONENT_MAX_DEBT_FACTOR);
  const exponent2 = bigNumber2.and(EXPONENT_MAX_DEBT_FACTOR);

  // Calculate net exponent (exponent2 - exponent1)
  if (exponent2.lt(exponent1)) {
    throw new Error("LibraryBnError: exponent2 should be >= exponent1");
  }

  const netExponent = exponent2.sub(exponent1);

  if (netExponent.lt(new BN(129))) {
    // Extract coefficients
    const coefficient1 = bigNumber1.shrn(EXPONENT_SIZE_DEBT_FACTOR);
    const coefficient2 = bigNumber2.shrn(EXPONENT_SIZE_DEBT_FACTOR);

    // Calculate (normal * coefficient1) / (coefficient2 << net_exponent)
    const numerator = normal.mul(coefficient1);
    const denominator = coefficient2.shln(netExponent.toNumber());

    // Check for division by zero
    if (denominator.isZero()) {
      throw new Error("LibraryDivisionByZero");
    }

    // Calculate result
    const result = numerator.div(denominator);

    // Check for overflow (result should fit in u64)
    if (result.gt(TWO_POWER_64)) {
      throw new Error("LibraryBnError: result overflow");
    }

    return result;
  } else {
    // If net_exponent >= 129, result will always be 0
    return new BN(0);
  }
}

/**
 * Multiplies a `big_number` with normal `number1` and then divides by `TWO_POWER_64`.
 *
 * For vault's use case (calculating new branch debt factor after liquidation):
 * - number1 is debtFactor, initialized as TWO_POWER_64 and reduced from there
 * - big_number is branch debt factor, which starts with specific values and reduces
 * - big_number must have exponent size 15 bits and be >= 1 & <= 16384
 * - big_number must have coefficient size 35 bits and have 35th bit always 1
 *
 * @returns big_number * number1 / TWO_POWER_64
 */
export function mulDivBigNumber(bigNumber: BN, number1: BN): BN {
  // Handle zero case early
  if (bigNumber.isZero()) {
    return new BN(0);
  }

  // Extract coefficient from big_number
  const coefficient = bigNumber.shrn(EXPONENT_SIZE_DEBT_FACTOR);
  const exponent = bigNumber.and(EXPONENT_MAX_DEBT_FACTOR);

  // Calculate result numerator: big_number coefficient * normal number
  const resultNumerator = coefficient.mul(number1);

  // Find the most significant bit position
  let diff: number;
  if (resultNumerator.gt(TWO_POWER_COEFFICIENT_PLUS_PRECISION_MINUS_1)) {
    diff = COEFFICIENT_PLUS_PRECISION;
  } else if (
    resultNumerator.gt(TWO_POWER_COEFFICIENT_PLUS_PRECISION_MINUS_1_MINUS_1)
  ) {
    diff = COEFFICIENT_PLUS_PRECISION_MINUS_1;
  } else {
    const msb = mostSignificantBit(resultNumerator);
    diff = msb < 64 ? msb : 64 + mostSignificantBit(resultNumerator.shrn(64));
  }

  // Calculate difference in bits to make the result_numerator 35 bits again
  diff = Math.max(0, diff - COEFFICIENT_SIZE_DEBT_FACTOR);

  // Shift result_numerator by the difference
  const adjustedCoefficient = resultNumerator.shrn(diff);

  // Calculate new exponent
  const resultExponent = exponent.add(new BN(diff));

  // Divide by TWO_POWER_64 by reducing exponent by 64
  if (resultExponent.gt(new BN(PRECISION))) {
    const finalExponent = resultExponent.sub(new BN(PRECISION));

    // Check that we don't exceed the exponent max
    if (finalExponent.gt(EXPONENT_MAX_DEBT_FACTOR)) {
      throw new Error("LibraryBnError: exponent overflow");
    }

    // Combine coefficient and exponent
    return adjustedCoefficient
      .shln(EXPONENT_SIZE_DEBT_FACTOR)
      .or(finalExponent);
  } else {
    // If we would underflow the exponent, this is an error case
    // Debt factor should never become a BigNumber with exponent <= 0
    throw new Error("LibraryBnError: exponent underflow");
  }
}

/**
 * Multiplies a `big_number1` with another `big_number2`.
 *
 * For vault's use case (calculating connection factor of merged branches):
 * - bigNumbers must have exponent size 15 bits and be >= 1 & <= 32767
 * - bigNumber must have coefficient size 35 bits and have 35th bit always 1
 * - Sum of exponents should be > 16384
 *
 * @returns BigNumber format with coefficient and exponent
 */
export function mulBigNumber(bigNumber1: BN, bigNumber2: BN): BN {
  // Extract coefficients and exponents
  const coefficient1 = bigNumber1.shrn(EXPONENT_SIZE_DEBT_FACTOR);
  const coefficient2 = bigNumber2.shrn(EXPONENT_SIZE_DEBT_FACTOR);

  const exponent1 = bigNumber1.and(EXPONENT_MAX_DEBT_FACTOR);
  const exponent2 = bigNumber2.and(EXPONENT_MAX_DEBT_FACTOR);

  // Calculate result coefficient
  const resCoefficient = coefficient1.mul(coefficient2);

  // Determine overflow length based on result size
  const overflowLen = resCoefficient.gt(TWO_POWER_69_MINUS_1)
    ? COEFFICIENT_SIZE_DEBT_FACTOR
    : COEFFICIENT_SIZE_DEBT_FACTOR - 1;

  // Adjust coefficient to fit in 35 bits
  const adjustedCoefficient = resCoefficient.shrn(overflowLen);

  // Calculate result exponent
  const resExponent = exponent1.add(exponent2).add(new BN(overflowLen));

  // Check for exponent underflow
  if (resExponent.lt(DECIMALS_DEBT_FACTOR)) {
    throw new Error("LibraryBnError: exponent underflow");
  }

  // Adjust exponent
  const finalExponent = resExponent.sub(DECIMALS_DEBT_FACTOR);

  // Check for exponent overflow
  if (finalExponent.gt(EXPONENT_MAX_DEBT_FACTOR)) {
    // If exponent exceeds max, user is ~100% liquidated
    return MAX_MASK_DEBT_FACTOR;
  }

  // Combine coefficient and exponent
  return adjustedCoefficient.shln(EXPONENT_SIZE_DEBT_FACTOR).or(finalExponent);
}

/**
 * Divides a `big_number1` by `big_number2`.
 *
 * For vault's use case (calculating connectionFactor):
 * - Numbers must have exponent size 15 bits and be >= 1 & <= 16384
 * - Numbers must have coefficient size 35 bits and have 35th bit always 1
 * - Numbers must never be 0
 *
 * @returns BigNumber format with coefficient and exponent
 */
export function divBigNumber(bigNumber1: BN, bigNumber2: BN): BN {
  // Handle zero cases early
  if (bigNumber1.isZero()) {
    return new BN(0);
  }
  if (bigNumber2.isZero()) {
    throw new Error("LibraryDivisionByZero");
  }

  // Extract coefficients and exponents
  const coefficient1 = bigNumber1.shrn(EXPONENT_SIZE_DEBT_FACTOR);
  const coefficient2 = bigNumber2.shrn(EXPONENT_SIZE_DEBT_FACTOR);
  const exponent1 = bigNumber1.and(EXPONENT_MAX_DEBT_FACTOR);
  const exponent2 = bigNumber2.and(EXPONENT_MAX_DEBT_FACTOR);

  // Check for division by zero coefficient
  if (coefficient2.isZero()) {
    throw new Error("LibraryDivisionByZero");
  }

  // Calculate result coefficient: (coefficient1 << PRECISION) / coefficient2
  const resCoefficient = coefficient1.shln(PRECISION).div(coefficient2);

  // Determine overflow length
  const overflowLen = resCoefficient.shrn(PRECISION).eq(new BN(1))
    ? PRECISION + 1
    : PRECISION;

  // Adjust overflow length
  const adjustedOverflowLen = overflowLen - COEFFICIENT_SIZE_DEBT_FACTOR;

  // Adjust coefficient to fit in 35 bits
  const adjustedCoefficient = resCoefficient.shrn(adjustedOverflowLen);

  // Calculate result exponent components
  const additionPart = exponent1
    .add(DECIMALS_DEBT_FACTOR)
    .add(new BN(adjustedOverflowLen));
  const subtractionPart = exponent2.add(new BN(PRECISION));

  // Check if addition part is greater than subtraction part
  if (additionPart.gt(subtractionPart)) {
    const finalExponent = additionPart.sub(subtractionPart);

    // Check that we don't exceed the exponent max
    if (finalExponent.gt(EXPONENT_MAX_DEBT_FACTOR)) {
      throw new Error("LibraryBnError: exponent overflow");
    }

    // Combine coefficient and exponent
    return adjustedCoefficient
      .shln(EXPONENT_SIZE_DEBT_FACTOR)
      .or(finalExponent);
  } else {
    // If we would underflow the exponent, this is an error case
    // Connection factor should never become a BigNumber with exponent <= 0
    throw new Error("LibraryBnError: exponent underflow");
  }
}

/**
 * Gets the most significant bit position of a number (1-indexed)
 * Returns 0 for input 0, otherwise returns the position of the highest set bit
 */
export function mostSignificantBit(normal: BN): number {
  if (normal.isZero()) {
    return 0;
  }

  // Find the bit length and return it (which gives us the MSB position)
  return normal.bitLength();
}

/**
 * Helper function to create a big number from coefficient and exponent
 */
export function createBigNumber(coefficient: BN, exponent: BN): BN {
  return coefficient.shln(EXPONENT_SIZE_DEBT_FACTOR).or(exponent);
}

/**
 * Helper function to extract coefficient from big number
 */
export function extractCoefficient(bigNumber: BN): BN {
  return bigNumber.shrn(EXPONENT_SIZE_DEBT_FACTOR);
}

/**
 * Helper function to extract exponent from big number
 */
export function extractExponent(bigNumber: BN): BN {
  return bigNumber.and(EXPONENT_MAX_DEBT_FACTOR);
}
