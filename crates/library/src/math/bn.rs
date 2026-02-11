use anchor_lang::prelude::*;

use crate::errors::ErrorCodes;

/// @title Extended version of BigMathMinified. Implements functions for normal operators (*, /, etc) modified to interact with big numbers.
/// @notice this is an optimized version mainly created by taking Fluid vault's codebase into consideration so it's use is limited for other cases.

const COEFFICIENT_SIZE_DEBT_FACTOR: u8 = 35;
const EXPONENT_SIZE_DEBT_FACTOR: u8 = 15;
const EXPONENT_MAX_DEBT_FACTOR: u64 = (1 << EXPONENT_SIZE_DEBT_FACTOR) - 1;
const DECIMALS_DEBT_FACTOR: u64 = 16384;
pub const MAX_MASK_DEBT_FACTOR: u64 =
    (1 << (COEFFICIENT_SIZE_DEBT_FACTOR + EXPONENT_SIZE_DEBT_FACTOR)) - 1;

#[allow(dead_code)]
const COEFFICIENT_MAX: u64 = (1 << COEFFICIENT_SIZE_DEBT_FACTOR) - 1;
#[allow(dead_code)]
const COEFFICIENT_MIN: u64 = 1 << (COEFFICIENT_SIZE_DEBT_FACTOR - 1);

pub const PRECISION: u8 = 64;
pub const TWO_POWER_64: u128 = 1 << PRECISION;
const TWO_POWER_69_MINUS_1: u128 = (1 << 69) - 1;

const COEFFICIENT_PLUS_PRECISION: u8 = COEFFICIENT_SIZE_DEBT_FACTOR + PRECISION; // 99
const COEFFICIENT_PLUS_PRECISION_MINUS_1: u8 = COEFFICIENT_PLUS_PRECISION - 1; // 98
const TWO_POWER_COEFFICIENT_PLUS_PRECISION_MINUS_1: u128 =
    (1 << COEFFICIENT_PLUS_PRECISION_MINUS_1) - 1; // (1 << 98) - 1
const TWO_POWER_COEFFICIENT_PLUS_PRECISION_MINUS_1_MINUS_1: u128 =
    (1 << (COEFFICIENT_PLUS_PRECISION_MINUS_1 - 1)) - 1; // (1 << 97) - 1

/// Multiplies a `normal` number with a `big_number1` and then divides by `big_number2`.
///
/// For vault's use case MUST always:
/// - bigNumbers have exponent size 15 bits
/// - bigNumbers have coefficient size 35 bits and have 35th bit always 1
/// - big_number1 (debt factor) always have exponent >= 1 & <= 16384
/// - big_number2 (connection factor) always have exponent >= 1 & <= 32767
/// - big_number2 always >= big_number1
/// - normal is positionRawDebt and is always within 10000 and u64::MAX
///
/// # Returns
/// normal * big_number1 / big_number2
pub fn mul_div_normal(normal: u64, big_number1: u64, big_number2: u64) -> Result<u64> {
    // Handle zero cases early
    if big_number1 == 0 || big_number2 == 0 {
        return Ok(0);
    }

    // Extract exponents from the big numbers
    let exponent1 = big_number1 & EXPONENT_MAX_DEBT_FACTOR;
    let exponent2 = big_number2 & EXPONENT_MAX_DEBT_FACTOR;

    // Calculate net exponent (exponent2 - exponent1)
    if exponent2 < exponent1 {
        return Err(error!(ErrorCodes::LibraryBnError)); // Should never happen per requirements
    }

    let net_exponent = exponent2 - exponent1;

    if net_exponent < 129 {
        // Extract coefficients
        let coefficient1 = big_number1 >> EXPONENT_SIZE_DEBT_FACTOR;
        let coefficient2 = big_number2 >> EXPONENT_SIZE_DEBT_FACTOR;

        // Calculate (normal * coefficient1) / (coefficient2 << net_exponent)
        // Use u128 for intermediate calculations to prevent overflow
        let numerator: u128 = (normal as u128) * (coefficient1 as u128);
        let denominator: u128 = match (coefficient2 as u128).checked_shl(net_exponent as u32) {
            Some(val) => val,
            None => return Ok(0),
        };

        // Check for division by zero
        if denominator == 0 {
            return Err(error!(ErrorCodes::LibraryDivisionByZero));
        }

        // Calculate result and check for overflow
        let result = numerator / denominator;
        if result > u64::MAX as u128 {
            return Err(error!(ErrorCodes::LibraryBnError));
        }

        Ok(result as u64)
    } else {
        // If net_exponent >= 129, result will always be 0
        Ok(0)
    }
}

/// Multiplies a `big_number` with normal `number1` and then divides by `TWO_POWER_64`.
///
/// For vault's use case (calculating new branch debt factor after liquidation):
/// - number1 is debtFactor, initialized as TWO_POWER_64 and reduced from there
/// - big_number is branch debt factor, which starts with specific values and reduces
/// - big_number must have exponent size 15 bits and be >= 1 & <= 16384
/// - big_number must have coefficient size 35 bits and have 35th bit always 1
///
/// # Returns
/// big_number * number1 / TWO_POWER_64
pub fn mul_div_big_number(big_number: u64, number1: u128) -> Result<u64> {
    // Handle zero case early
    if big_number == 0 || number1 == 0 {
        return Ok(0);
    }

    // Extract coefficient from big_number
    let coefficient = big_number >> EXPONENT_SIZE_DEBT_FACTOR;
    let exponent = big_number & EXPONENT_MAX_DEBT_FACTOR;

    // Calculate result numerator: big_number coefficient * normal number
    let result_numerator: u128 = (coefficient as u128) * number1;

    // Find the most significant bit position
    let mut diff: u8;
    if result_numerator > TWO_POWER_COEFFICIENT_PLUS_PRECISION_MINUS_1 {
        diff = COEFFICIENT_PLUS_PRECISION;
    } else if result_numerator > TWO_POWER_COEFFICIENT_PLUS_PRECISION_MINUS_1_MINUS_1 {
        diff = COEFFICIENT_PLUS_PRECISION_MINUS_1;
    } else {
        diff = most_significant_bit(result_numerator);
    }

    // Calculate difference in bits to make the result_numerator 35 bits again
    diff = diff.saturating_sub(COEFFICIENT_SIZE_DEBT_FACTOR);

    // Shift result_numerator by the difference
    let adjusted_coefficient = (result_numerator >> diff) as u64;

    // Calculate new exponent
    let result_exponent = exponent.saturating_add(diff as u64);

    // Divide by TWO_POWER_64 by reducing exponent by 64
    if result_exponent > PRECISION as u64 {
        let final_exponent = result_exponent - PRECISION as u64;

        // Check that we don't exceed the exponent max
        if final_exponent > EXPONENT_MAX_DEBT_FACTOR {
            return Err(error!(ErrorCodes::LibraryBnError));
        }

        // Combine coefficient and exponent
        Ok((adjusted_coefficient << EXPONENT_SIZE_DEBT_FACTOR) | final_exponent)
    } else {
        // If we would underflow the exponent, this is an error case
        // Debt factor should never become a BigNumber with exponent <= 0
        Err(error!(ErrorCodes::LibraryBnError))
    }
}

/// Multiplies a `big_number1` with another `big_number2`.
///
/// For vault's use case (calculating connection factor of merged branches):
/// - bigNumbers must have exponent size 15 bits and be >= 1 & <= 32767
/// - bigNumber must have coefficient size 35 bits and have 35th bit always 1
/// - Sum of exponents should be > 16384
///
/// # Returns
/// BigNumber format with coefficient and exponent
pub fn mul_big_number(big_number1: u64, big_number2: u64) -> Result<u64> {
    // Extract coefficients and exponents
    let coefficient1: u64 = big_number1 >> EXPONENT_SIZE_DEBT_FACTOR;
    let coefficient2: u64 = big_number2 >> EXPONENT_SIZE_DEBT_FACTOR;
    let exponent1: u64 = big_number1 & EXPONENT_MAX_DEBT_FACTOR;
    let exponent2: u64 = big_number2 & EXPONENT_MAX_DEBT_FACTOR;

    // Calculate result coefficient
    // res coefficient at max can be 34359738367 * 34359738367 = 1180591620648691826689 (X35 * X35 fits in 70 bits)
    let res_coefficient: u128 = (coefficient1 as u128) * (coefficient2 as u128);

    // Determine overflow length based on result size
    let overflow_len = if res_coefficient > TWO_POWER_69_MINUS_1 {
        COEFFICIENT_SIZE_DEBT_FACTOR as u64
    } else {
        (COEFFICIENT_SIZE_DEBT_FACTOR - 1) as u64
    };

    // Adjust coefficient to fit in 35 bits
    let adjusted_coefficient = (res_coefficient >> overflow_len) as u64;

    // Calculate result exponent
    let res_exponent = exponent1 + exponent2 + overflow_len;

    // Check for exponent underflow
    if res_exponent < DECIMALS_DEBT_FACTOR {
        return Err(error!(ErrorCodes::LibraryBnError));
    }

    // Adjust exponent
    let final_exponent = res_exponent - DECIMALS_DEBT_FACTOR;

    // Check for exponent overflow
    if final_exponent > EXPONENT_MAX_DEBT_FACTOR {
        // If exponent exceeds max, user is ~100% liquidated
        return Ok(MAX_MASK_DEBT_FACTOR);
    }

    // Combine coefficient and exponent
    Ok((adjusted_coefficient << EXPONENT_SIZE_DEBT_FACTOR) | final_exponent)
}

/// Divides a `big_number1` by `big_number2`.
///
/// For vault's use case (calculating connectionFactor):
/// - Numbers must have exponent size 15 bits and be >= 1 & <= 16384
/// - Numbers must have coefficient size 35 bits and have 35th bit always 1
/// - Numbers must never be 0
///
/// # Returns
/// BigNumber format with coefficient and exponent
pub fn div_big_number(big_number1: u64, big_number2: u64) -> Result<u64> {
    // Handle zero cases early
    if big_number1 == 0 {
        return Ok(0);
    }
    if big_number2 == 0 {
        return Err(error!(ErrorCodes::LibraryDivisionByZero));
    }

    // Extract coefficients and exponents
    let coefficient1 = big_number1 >> EXPONENT_SIZE_DEBT_FACTOR;
    let coefficient2 = big_number2 >> EXPONENT_SIZE_DEBT_FACTOR;
    let exponent1 = big_number1 & EXPONENT_MAX_DEBT_FACTOR;
    let exponent2 = big_number2 & EXPONENT_MAX_DEBT_FACTOR;

    // Check for division by zero coefficient
    if coefficient2 == 0 {
        return Err(error!(ErrorCodes::LibraryDivisionByZero));
    }

    // Calculate result coefficient: (coefficient1 << PRECISION) / coefficient2
    let res_coefficient: u128 =
        ((coefficient1 as u128) << PRECISION as u128) / (coefficient2 as u128);

    // Determine overflow length
    let overflow_len = if (res_coefficient >> PRECISION as u128) == 1 {
        (PRECISION + 1) as u64
    } else {
        PRECISION as u64
    };

    // Adjust overflow length
    let adjusted_overflow_len = overflow_len - COEFFICIENT_SIZE_DEBT_FACTOR as u64;

    // Adjust coefficient to fit in 35 bits
    let adjusted_coefficient = (res_coefficient >> adjusted_overflow_len) as u64;

    // Calculate result exponent components
    let addition_part = exponent1 + DECIMALS_DEBT_FACTOR + adjusted_overflow_len;
    let subtraction_part = exponent2 + PRECISION as u64;

    // Check if addition part is greater than subtraction part
    if addition_part > subtraction_part {
        let final_exponent = addition_part - subtraction_part;

        // Check that we don't exceed the exponent max
        if final_exponent > EXPONENT_MAX_DEBT_FACTOR {
            return Err(error!(ErrorCodes::LibraryBnError));
        }

        // Combine coefficient and exponent
        Ok((adjusted_coefficient << EXPONENT_SIZE_DEBT_FACTOR) | final_exponent)
    } else {
        // If we would underflow the exponent, this is an error case
        // Connection factor should never become a BigNumber with exponent <= 0
        Err(error!(ErrorCodes::LibraryBnError))
    }
}

/// Gets the most significant bit position of a number (1-indexed)
/// Returns 0 for input 0, otherwise returns the position of the highest set bit
pub fn most_significant_bit(normal: u128) -> u8 {
    if normal == 0 {
        return 0;
    }

    // Use built-in leading_zeros for accuracy and performance
    // leading_zeros counts from the left, so MSB position is 128 - leading_zeros
    // But we want 1-indexed position, so it's 128 - leading_zeros
    128 - (normal.leading_zeros() as u8)
}

#[allow(dead_code)]
/// Helper function to create a big number from coefficient and exponent
fn create_big_number(coefficient: u64, exponent: u64) -> u64 {
    (coefficient << EXPONENT_SIZE_DEBT_FACTOR) | exponent
}

#[allow(dead_code)]
/// Helper function to extract coefficient from big number
fn extract_coefficient(big_number: u64) -> u64 {
    big_number >> EXPONENT_SIZE_DEBT_FACTOR
}

#[allow(dead_code)]
/// Helper function to extract exponent from big number
fn extract_exponent(big_number: u64) -> u64 {
    big_number & EXPONENT_MAX_DEBT_FACTOR
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_most_significant_bit() {
        assert_eq!(most_significant_bit(0), 0);
        assert_eq!(most_significant_bit(1), 1);
        assert_eq!(most_significant_bit(2), 2);
        assert_eq!(most_significant_bit(3), 2);
        assert_eq!(most_significant_bit(4), 3);
        assert_eq!(most_significant_bit(7), 3);
        assert_eq!(most_significant_bit(8), 4);
        assert_eq!(most_significant_bit(15), 4);
        assert_eq!(most_significant_bit(16), 5);
        assert_eq!(most_significant_bit(255), 8);
        assert_eq!(most_significant_bit(256), 9);
        assert_eq!(most_significant_bit(u128::MAX), 128);
    }

    #[test]
    fn test_big_number_format() {
        // Test that we can create and extract BigNumbers correctly
        let coefficient = COEFFICIENT_MAX; // 35 bits all set
        let exponent = 100u64;
        let big_number = create_big_number(coefficient, exponent);

        let extracted_coeff = extract_coefficient(big_number);
        let extracted_exp = extract_exponent(big_number);

        assert_eq!(extracted_coeff, coefficient);
        assert_eq!(extracted_exp, exponent);
    }

    // ===== mul_div_normal tests =====

    #[test]
    fn test_mul_div_normal_normal_is_zero() {
        let normal1 = 0;
        let big_number1 = create_big_number(COEFFICIENT_MIN, 16384);
        let big_number2 = create_big_number(COEFFICIENT_MAX, 16384);

        let result = mul_div_normal(normal1, big_number1, big_number2).unwrap();
        assert_eq!(result, 0);
    }

    #[test]
    fn test_mul_div_normal_big_number1_is_zero() {
        let normal1 = 17179869184;
        let big_number1 = 0;
        let big_number2 = create_big_number(COEFFICIENT_MAX, 16384);

        let result = mul_div_normal(normal1, big_number1, big_number2).unwrap();
        assert_eq!(result, 0);
    }

    #[test]
    fn test_mul_div_normal_all_same_numbers() {
        let big_number1 = create_big_number(COEFFICIENT_MIN, 16384);
        let normal1 = 17179869184;

        let result = mul_div_normal(normal1, big_number1, big_number1).unwrap();
        assert_eq!(result, 17179869184);

        let normal2 = 34359738367;
        let big_number2 = create_big_number(COEFFICIENT_MAX, 16384);

        let result2 = mul_div_normal(normal2, big_number2, big_number2).unwrap();
        // Allowing for 1 unit precision loss
        assert!((result2 as i64 - COEFFICIENT_MAX as i64).abs() <= 1);
    }

    #[test]
    fn test_mul_div_normal_with_smallest_value_for_first_number() {
        let normal1 = 17179869184;
        let big_number1 = create_big_number(25769803775, 16384);
        let big_number2 = create_big_number(COEFFICIENT_MAX, 16384);

        let result = mul_div_normal(normal1, big_number1, big_number2).unwrap();
        assert_eq!(result, 12884901887);
    }

    #[test]
    fn test_mul_div_normal_with_smallest_value_for_second_number() {
        let normal1 = 25769803775;
        let big_number1 = create_big_number(COEFFICIENT_MIN, 16384);
        let big_number2 = create_big_number(COEFFICIENT_MAX, 16384);

        let result = mul_div_normal(normal1, big_number1, big_number2).unwrap();
        assert_eq!(result, 12884901887);
    }

    // ===== mul_div_big_number tests =====

    #[test]
    fn test_mul_div_big_number_multiplication_of_same_big_number() {
        let big_number1 = create_big_number(COEFFICIENT_MIN, 16384);
        let normal1 = 17179869184;

        let result = mul_div_big_number(big_number1, normal1).unwrap();
        let coefficient = extract_coefficient(result);
        let exponent = extract_exponent(result);

        assert_eq!(coefficient, COEFFICIENT_MIN);
        assert_eq!(exponent, 16354);

        let big_number2 = create_big_number(COEFFICIENT_MAX, 16384);
        let normal2 = 34359738367;

        let result2 = mul_div_big_number(big_number2, normal2).unwrap();
        let coefficient2 = extract_coefficient(result2);
        let exponent2 = extract_exponent(result2);

        assert_eq!(coefficient2, 34359738366);
        assert_eq!(exponent2, 16355);
    }

    #[test]
    fn test_mul_div_big_number_multiplication_of_doubled_big_number() {
        let big_number1 = create_big_number(COEFFICIENT_MAX, 16384);
        let normal1 = 34359738367 * 2; // multiplication by 2

        let result = mul_div_big_number(big_number1, normal1).unwrap();
        let coefficient = extract_coefficient(result);
        let exponent = extract_exponent(result);

        assert_eq!(coefficient, 34359738366);
        assert_eq!(exponent, 16356);
    }

    // ===== mul_big_number tests =====

    #[test]
    fn test_mul_big_number_return_max_mask() {
        // Make resExponent equals EXPONENT_MAX_DEBT_FACTOR which will lead to return MAX_MASK_DEBT_FACTOR
        let exponent1 = 24559;
        let exponent2 = 24559;
        let coefficient1 = COEFFICIENT_MIN;
        let coefficient2 = COEFFICIENT_MIN;

        let big_number1 = create_big_number(coefficient1, exponent1);
        let big_number2 = create_big_number(coefficient2, exponent2);

        let result = mul_big_number(big_number1, big_number2).unwrap();
        assert_eq!(result, MAX_MASK_DEBT_FACTOR);
    }

    #[test]
    fn test_mul_big_number_right_below_max_debt_factor() {
        // Make resExponent right BELOW EXPONENT_MAX_DEBT_FACTOR
        let coefficient1 = COEFFICIENT_MIN;
        let exponent1 = 24558;
        let coefficient2 = COEFFICIENT_MIN;
        let exponent2 = 24558;

        let big_number1 = create_big_number(coefficient1, exponent1);
        let big_number2 = create_big_number(coefficient2, exponent2);

        let result = mul_big_number(big_number1, big_number2).unwrap();
        assert_ne!(result, MAX_MASK_DEBT_FACTOR);
    }

    #[test]
    fn test_mul_big_number_multiplication_of_same_big_number() {
        let big_number1 = create_big_number(COEFFICIENT_MIN, 16384);

        let result = mul_big_number(big_number1, big_number1).unwrap();
        let coefficient = extract_coefficient(result);
        let exponent = extract_exponent(result);

        assert_eq!(coefficient, COEFFICIENT_MIN);
        assert_eq!(exponent, 16418);

        let big_number2 = create_big_number(COEFFICIENT_MAX, 16384);

        let result2 = mul_big_number(big_number2, big_number2).unwrap();
        let coefficient2 = extract_coefficient(result2);
        let exponent2 = extract_exponent(result2);

        // Allow for 1 unit precision loss
        assert!((coefficient2 as i64 - COEFFICIENT_MAX as i64).abs() <= 1);
        assert_eq!(exponent2, 16419);
    }

    // ===== div_big_number tests =====

    #[test]
    fn test_div_big_number_zero_value() {
        let big_number1 = 0;
        let big_number2 = create_big_number(COEFFICIENT_MIN, 1);

        let result = div_big_number(big_number1, big_number2).unwrap();
        assert_eq!(result, 0);
    }

    #[test]
    fn test_div_big_number_divide_by_zero() {
        let big_number1 = create_big_number(COEFFICIENT_MIN, 1);
        let big_number2 = 0;

        let result = div_big_number(big_number1, big_number2);
        assert!(result.is_err());
        match result {
            Err(_) => {} // Expected error
            Ok(_) => panic!("Expected division by zero error"),
        }
    }

    #[test]
    fn test_div_big_number_check_with_multiplication() {
        let big_number1 = create_big_number(COEFFICIENT_MAX, 8192);
        let big_number2 = create_big_number(COEFFICIENT_MIN, 8192);

        let mul_result = mul_big_number(big_number1, big_number2).unwrap();
        let div_result = div_big_number(mul_result, big_number2).unwrap();

        assert_eq!(div_result, big_number1);
    }

    #[test]
    fn test_div_big_number_division_of_same_big_number() {
        let big_number1 = create_big_number(COEFFICIENT_MIN, 8192);

        let result = div_big_number(big_number1, big_number1).unwrap();
        let coefficient = extract_coefficient(result);
        let exponent = extract_exponent(result);

        assert_eq!(coefficient, COEFFICIENT_MIN);
        assert_eq!(exponent, 16350);

        let big_number2 = create_big_number(COEFFICIENT_MAX, 8192);

        let result2 = div_big_number(big_number2, big_number2).unwrap();
        let coefficient2 = extract_coefficient(result2);
        let exponent2 = extract_exponent(result2);

        assert_eq!(coefficient2, COEFFICIENT_MIN);
        assert_eq!(exponent2, 16350);
    }

    #[test]
    fn test_div_big_number_with_smaller_coefficient_of_divisor() {
        let big_number1 = create_big_number(COEFFICIENT_MAX, 8192);
        let big_number2 = create_big_number(COEFFICIENT_MIN, 8192);

        let result = div_big_number(big_number1, big_number2).unwrap();
        let coefficient = extract_coefficient(result);
        let exponent = extract_exponent(result);

        assert_eq!(coefficient, COEFFICIENT_MAX);
        assert_eq!(exponent, 16350);
    }

    #[test]
    fn test_div_big_number_with_smaller_exponent_of_divisor() {
        let big_number1 = create_big_number(COEFFICIENT_MAX, 16384);
        let big_number2 = create_big_number(COEFFICIENT_MAX, 8192);

        let result = div_big_number(big_number1, big_number2).unwrap();
        let coefficient = extract_coefficient(result);
        let exponent = extract_exponent(result);

        assert_eq!(coefficient, COEFFICIENT_MIN);
        assert_eq!(exponent, 24542);
    }

    #[test]
    fn test_div_big_number_with_smaller_coefficient_of_first_number() {
        let big_number1 = create_big_number(COEFFICIENT_MIN, 16384);
        let big_number2 = create_big_number(COEFFICIENT_MAX, 16384);

        let result = div_big_number(big_number1, big_number2).unwrap();
        let coefficient = extract_coefficient(result);
        let exponent = extract_exponent(result);

        assert_eq!(coefficient, COEFFICIENT_MIN);
        assert_eq!(exponent, 16349);
    }

    #[test]
    fn test_div_big_number_with_smaller_exponent_of_first_number() {
        let big_number1 = create_big_number(COEFFICIENT_MAX, 8192);
        let big_number2 = create_big_number(COEFFICIENT_MAX, 16384);

        let result = div_big_number(big_number1, big_number2).unwrap();
        let coefficient = extract_coefficient(result);
        let exponent = extract_exponent(result);

        assert_eq!(coefficient, COEFFICIENT_MIN);
        assert_eq!(exponent, 8158);
    }

    // ===== Integration tests =====

    #[test]
    fn test_roundtrip_mul_div_operations() {
        // Test that mul_big_number followed by div_big_number returns original value
        // Use valid big numbers with proper exponents
        let big_number1 = create_big_number(25769803776, 8192); // Use smaller exponent
        let big_number2 = create_big_number(COEFFICIENT_MIN, 8192);

        let mul_result = mul_big_number(big_number1, big_number2).unwrap();
        let div_result = div_big_number(mul_result, big_number2).unwrap();

        // Should be very close to original (allowing for precision loss)
        let orig_coeff = extract_coefficient(big_number1);
        let result_coeff = extract_coefficient(div_result);
        let orig_exp = extract_exponent(big_number1);
        let result_exp = extract_exponent(div_result);

        assert!((orig_coeff as i64 - result_coeff as i64).abs() <= 2);
        assert_eq!(orig_exp, result_exp);
    }

    #[test]
    fn test_edge_case_large_exponents() {
        // Test with large exponents that approach the limits
        let big_number1 = create_big_number(COEFFICIENT_MIN, 16383); // Close to max for debt factor
        let big_number2 = create_big_number(COEFFICIENT_MIN, 16383);

        let result = mul_big_number(big_number1, big_number2).unwrap();
        assert_ne!(result, MAX_MASK_DEBT_FACTOR); // Should not overflow

        let coefficient = extract_coefficient(result);
        let exponent = extract_exponent(result);
        assert!(coefficient >= COEFFICIENT_MIN);
        assert!(exponent <= EXPONENT_MAX_DEBT_FACTOR);
    }

    #[test]
    fn test_precision_consistency() {
        // Test that operations maintain reasonable precision
        let big_number = create_big_number(COEFFICIENT_MAX, 16384);
        let normal = TWO_POWER_64;

        let result = mul_div_big_number(big_number, normal).unwrap();
        let result_coefficient = extract_coefficient(result);
        let result_exponent = extract_exponent(result);

        // The result should have maintained precision
        assert!(result_coefficient >= COEFFICIENT_MIN);
        assert!(result_coefficient <= COEFFICIENT_MAX);
        assert!(result_exponent <= EXPONENT_MAX_DEBT_FACTOR);
    }

    #[test]
    fn test_net_exponent_overflow_returns_zero() {
        // Test the edge case where net_exponent >= 129 returns 0
        let normal = 1000u64;
        let big_number1 = create_big_number(COEFFICIENT_MIN, 1); // Small exponent
        let big_number2 = create_big_number(COEFFICIENT_MIN, 130); // Large exponent difference

        let result = mul_div_normal(normal, big_number1, big_number2).unwrap();
        assert_eq!(result, 0);
    }

    #[test]
    fn test_coefficient_extraction_accuracy() {
        // Test that coefficient extraction is accurate for various values
        let test_coefficients = [
            COEFFICIENT_MIN,
            COEFFICIENT_MIN + 1,
            (COEFFICIENT_MIN + COEFFICIENT_MAX) / 2,
            COEFFICIENT_MAX - 1,
            COEFFICIENT_MAX,
        ];

        let test_exponent = 16384u64;

        for &coeff in &test_coefficients {
            let big_number = create_big_number(coeff, test_exponent);
            assert_eq!(extract_coefficient(big_number), coeff);
            assert_eq!(extract_exponent(big_number), test_exponent);
        }
    }

    #[test]
    fn test_boundary_values() {
        // Test with boundary coefficient values
        let min_big_number = create_big_number(COEFFICIENT_MIN, 16384);
        let max_big_number = create_big_number(COEFFICIENT_MAX, 16384);

        // Test division with boundary values
        let result1 = div_big_number(max_big_number, min_big_number).unwrap();
        let result2 = div_big_number(min_big_number, max_big_number).unwrap();

        // Max / Min should give a result close to 2
        let coeff1 = extract_coefficient(result1);
        let exp1 = extract_exponent(result1);
        assert_eq!(coeff1, COEFFICIENT_MAX);
        assert_eq!(exp1, 16350);

        // Min / Max should give a result close to 0.5
        let coeff2 = extract_coefficient(result2);
        let exp2 = extract_exponent(result2);
        assert_eq!(coeff2, COEFFICIENT_MIN);
        assert_eq!(exp2, 16349);
    }

    #[test]
    fn test_mul_div_normal_consistency() {
        // Test that mul_div_normal produces consistent results
        let normal = 50000u64;
        let big_number1 = create_big_number(20000000000, 16384);
        let big_number2 = create_big_number(30000000000, 16384);

        let result = mul_div_normal(normal, big_number1, big_number2).unwrap();

        // Manual calculation for verification
        // (50000 * 20000000000) / 30000000000 = 33333
        let expected = (normal as u128 * 20000000000u128) / 30000000000u128;
        assert!((result as i64 - expected as i64).abs() <= 1);
    }

    #[test]
    fn test_error_conditions() {
        // Test division by zero
        let big_number1 = create_big_number(COEFFICIENT_MIN, 16384);
        let big_number_zero = 0;

        let result = div_big_number(big_number1, big_number_zero);
        assert!(result.is_err());

        // Test with valid large exponent values
        let big_number_large_exp = create_big_number(COEFFICIENT_MAX, 16384); // Use valid range
        let large_number = TWO_POWER_64 / 2; // Use smaller number to avoid overflow

        let result2 = mul_div_big_number(big_number_large_exp, large_number);
        // This should succeed with valid inputs
        assert!(result2.is_ok());
    }

    #[test]
    fn test_symmetric_operations() {
        // Test that mul and div are symmetric operations
        // Use valid big numbers with proper exponents in the allowed range
        let big_number1 = create_big_number(25000000000, 8192); // Use smaller exponent
        let big_number2 = create_big_number(20000000000, 8192);

        // Test: (a * b) / b = a (approximately)
        let mul_result = mul_big_number(big_number1, big_number2).unwrap();
        let div_result = div_big_number(mul_result, big_number2).unwrap();

        let orig_coeff = extract_coefficient(big_number1);
        let result_coeff = extract_coefficient(div_result);
        let orig_exp = extract_exponent(big_number1);
        let result_exp = extract_exponent(div_result);

        // Allow for small precision differences
        assert!((orig_coeff as i64 - result_coeff as i64).abs() <= 2);
        assert_eq!(orig_exp, result_exp);
    }

    #[test]
    fn test_special_decimal_factor_cases() {
        // Test cases around the DECIMALS_DEBT_FACTOR (16384)
        let big_number1 = create_big_number(COEFFICIENT_MIN, DECIMALS_DEBT_FACTOR);
        let big_number2 = create_big_number(COEFFICIENT_MIN, DECIMALS_DEBT_FACTOR);

        let mul_result = mul_big_number(big_number1, big_number2).unwrap();
        let coeff = extract_coefficient(mul_result);
        let exp = extract_exponent(mul_result);

        // When both exponents equal DECIMALS_DEBT_FACTOR, the result should have specific properties
        assert!(coeff >= COEFFICIENT_MIN);
        assert!(exp >= 0); // Should not underflow
    }
}
