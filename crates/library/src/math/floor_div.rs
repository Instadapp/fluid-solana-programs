use num_traits::{One, Zero};

// Copyright 2021 Drift Labs
// Copyright 2025 INSTADAPP LABS INC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Portions of this code are derived from Drift Protocol
// Original source: https://github.com/drift-labs/protocol-v2/blob/master/programs/drift/src/math/floor_div.rs
// Modified by INSTADAPP LABS INC

pub trait CheckedFloorDiv: Sized {
    /// Perform floor division
    fn checked_floor_div(&self, rhs: Self) -> Option<Self>;
}

macro_rules! checked_impl {
    ($t:ty) => {
        impl CheckedFloorDiv for $t {
            #[track_caller]
            #[inline]
            fn checked_floor_div(&self, rhs: $t) -> Option<$t> {
                let quotient = self.checked_div(rhs)?;
                let remainder = self.checked_rem(rhs)?;

                // Floor division: adjust quotient downward if remainder and divisor have opposite signs
                if remainder != <$t>::zero() && (remainder > <$t>::zero()) != (rhs > <$t>::zero()) {
                    quotient.checked_sub(<$t>::one())
                } else {
                    Some(quotient)
                }
            }
        }
    };
}

checked_impl!(i128);
checked_impl!(i64);
checked_impl!(i32);
checked_impl!(i16);
checked_impl!(i8);

#[cfg(test)]
mod test {
    use crate::math::floor_div::CheckedFloorDiv;

    #[test]
    fn test_basic_cases() {
        // Original test case
        let x = -3_i128;
        assert_eq!(x.checked_floor_div(2), Some(-2));
        assert_eq!(x.checked_floor_div(0), None);
    }

    #[test]
    fn test_positive_dividend_positive_divisor() {
        // Exact division
        assert_eq!(4_i128.checked_floor_div(2), Some(2));
        assert_eq!(6_i128.checked_floor_div(3), Some(2));

        // With remainder - should round down (truncate)
        assert_eq!(5_i128.checked_floor_div(2), Some(2));
        assert_eq!(7_i128.checked_floor_div(3), Some(2));
        assert_eq!(1_i128.checked_floor_div(2), Some(0));
        assert_eq!(3_i128.checked_floor_div(2), Some(1));
    }

    #[test]
    fn test_negative_dividend_positive_divisor() {
        // Exact division
        assert_eq!((-4_i128).checked_floor_div(2), Some(-2));
        assert_eq!((-6_i128).checked_floor_div(3), Some(-2));

        // With remainder - should round down (more negative)
        // This is where the bug occurs in the original implementation
        assert_eq!((-5_i128).checked_floor_div(2), Some(-3)); // floor(-2.5) = -3
        assert_eq!((-7_i128).checked_floor_div(3), Some(-3)); // floor(-2.33...) = -3
        assert_eq!((-1_i128).checked_floor_div(2), Some(-1)); // floor(-0.5) = -1
        assert_eq!((-3_i128).checked_floor_div(2), Some(-2)); // floor(-1.5) = -2
    }

    #[test]
    fn test_positive_dividend_negative_divisor() {
        // Exact division
        assert_eq!(4_i128.checked_floor_div(-2), Some(-2));
        assert_eq!(6_i128.checked_floor_div(-3), Some(-2));

        // With remainder - should round down (more negative)
        assert_eq!(5_i128.checked_floor_div(-2), Some(-3)); // floor(-2.5) = -3
        assert_eq!(7_i128.checked_floor_div(-3), Some(-3)); // floor(-2.33...) = -3
        assert_eq!(1_i128.checked_floor_div(-2), Some(-1)); // floor(-0.5) = -1
    }

    #[test]
    fn test_negative_dividend_negative_divisor() {
        // Exact division
        assert_eq!((-4_i128).checked_floor_div(-2), Some(2));
        assert_eq!((-6_i128).checked_floor_div(-3), Some(2));

        // With remainder - should round down (truncate toward negative infinity)
        assert_eq!((-5_i128).checked_floor_div(-2), Some(2)); // floor(2.5) = 2
        assert_eq!((-7_i128).checked_floor_div(-3), Some(2)); // floor(2.33...) = 2
        assert_eq!((-1_i128).checked_floor_div(-2), Some(0)); // floor(0.5) = 0
        assert_eq!((-3_i128).checked_floor_div(-2), Some(1)); // floor(1.5) = 1
    }

    #[test]
    fn test_edge_cases() {
        // Zero dividend
        assert_eq!(0_i128.checked_floor_div(5), Some(0));
        assert_eq!(0_i128.checked_floor_div(-5), Some(0));

        // Division by zero
        assert_eq!(5_i128.checked_floor_div(0), None);
        assert_eq!((-5_i128).checked_floor_div(0), None);
        assert_eq!(0_i128.checked_floor_div(0), None);

        // Division by one
        assert_eq!(5_i128.checked_floor_div(1), Some(5));
        assert_eq!((-5_i128).checked_floor_div(1), Some(-5));

        // Division by negative one
        assert_eq!(5_i128.checked_floor_div(-1), Some(-5));
        assert_eq!((-5_i128).checked_floor_div(-1), Some(5));
    }

    #[test]
    fn test_boundary_values() {
        // Test with i128 min/max values
        assert_eq!(i128::MAX.checked_floor_div(1), Some(i128::MAX));
        assert_eq!(i128::MIN.checked_floor_div(1), Some(i128::MIN));
        assert_eq!(i128::MIN.checked_floor_div(-1), None); // Overflow case - correctly returns None

        // Test near boundaries
        assert_eq!(i128::MAX.checked_floor_div(2), Some(i128::MAX / 2));
        assert_eq!(i128::MIN.checked_floor_div(2), Some(i128::MIN / 2));
    }

    #[test]
    fn test_different_integer_types() {
        // Test i64
        assert_eq!((-3_i64).checked_floor_div(2), Some(-2));
        assert_eq!((-5_i64).checked_floor_div(2), Some(-3));

        // Test i32
        assert_eq!((-3_i32).checked_floor_div(2), Some(-2));
        assert_eq!((-5_i32).checked_floor_div(2), Some(-3));

        // Test i16
        assert_eq!((-3_i16).checked_floor_div(2), Some(-2));
        assert_eq!((-5_i16).checked_floor_div(2), Some(-3));

        // Test i8
        assert_eq!((-3_i8).checked_floor_div(2), Some(-2));
        assert_eq!((-5_i8).checked_floor_div(2), Some(-3));
    }

    #[test]
    fn test_comparison_with_standard_div() {
        // Show the difference between standard division and floor division
        let test_cases = vec![
            (7, 3),   // 7/3 = 2.33...
            (-7, 3),  // -7/3 = -2.33...
            (7, -3),  // 7/-3 = -2.33...
            (-7, -3), // -7/-3 = 2.33...
        ];

        for (dividend, divisor) in test_cases {
            let standard_div = dividend / divisor;
            let floor_div = dividend.checked_floor_div(divisor).unwrap();

            println!(
                "dividend: {}, divisor: {}, standard: {}, floor: {}",
                dividend, divisor, standard_div, floor_div
            );

            // Floor division should always be <= standard division
            assert!(floor_div <= standard_div);
        }
    }
}
