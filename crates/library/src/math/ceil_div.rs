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
// Original source: https://github.com/drift-labs/protocol-v2/blob/master/programs/drift/src/math/ceil_div.rs
// Modified by INSTADAPP LABS INC

pub trait CheckedCeilDiv: Sized {
    /// Perform ceiling division
    fn checked_ceil_div(&self, rhs: Self) -> Option<Self>;
}

macro_rules! checked_impl {
    ($t:ty) => {
        impl CheckedCeilDiv for $t {
            #[track_caller]
            #[inline]
            fn checked_ceil_div(&self, rhs: $t) -> Option<$t> {
                let quotient = self.checked_div(rhs)?;
                let remainder = self.checked_rem(rhs)?;

                // Ceiling division: adjust quotient upward if remainder exists and has same sign as divisor
                if remainder != <$t>::zero() && (remainder > <$t>::zero()) == (rhs > <$t>::zero()) {
                    quotient.checked_add(<$t>::one())
                } else {
                    Some(quotient)
                }
            }
        }
    };
}

checked_impl!(u128);
checked_impl!(u64);
checked_impl!(u32);
checked_impl!(u16);
checked_impl!(u8);
checked_impl!(i128);
checked_impl!(i64);
checked_impl!(i32);
checked_impl!(i16);
checked_impl!(i8);

#[cfg(test)]
mod test {
    use crate::math::ceil_div::CheckedCeilDiv;

    #[test]
    fn test_positive_dividend_positive_divisor() {
        // Exact division
        assert_eq!(4_i128.checked_ceil_div(2), Some(2));
        assert_eq!(6_i128.checked_ceil_div(3), Some(2));

        // With remainder - should round up
        assert_eq!(5_i128.checked_ceil_div(2), Some(3)); // ceil(2.5) = 3
        assert_eq!(7_i128.checked_ceil_div(3), Some(3)); // ceil(2.33...) = 3
        assert_eq!(1_i128.checked_ceil_div(2), Some(1)); // ceil(0.5) = 1
    }

    #[test]
    fn test_negative_dividend_positive_divisor() {
        // Exact division
        assert_eq!((-4_i128).checked_ceil_div(2), Some(-2));
        assert_eq!((-6_i128).checked_ceil_div(3), Some(-2));

        // With remainder - should round up (toward zero)
        assert_eq!((-5_i128).checked_ceil_div(2), Some(-2)); // ceil(-2.5) = -2
        assert_eq!((-7_i128).checked_ceil_div(3), Some(-2)); // ceil(-2.33...) = -2
        assert_eq!((-1_i128).checked_ceil_div(2), Some(0)); // ceil(-0.5) = 0
    }

    #[test]
    fn test_positive_dividend_negative_divisor() {
        // Exact division
        assert_eq!(4_i128.checked_ceil_div(-2), Some(-2));
        assert_eq!(6_i128.checked_ceil_div(-3), Some(-2));

        // With remainder - should round up (toward zero)
        assert_eq!(5_i128.checked_ceil_div(-2), Some(-2)); // ceil(-2.5) = -2
        assert_eq!(7_i128.checked_ceil_div(-3), Some(-2)); // ceil(-2.33...) = -2
        assert_eq!(1_i128.checked_ceil_div(-2), Some(0)); // ceil(-0.5) = 0
    }

    #[test]
    fn test_negative_dividend_negative_divisor() {
        // Exact division
        assert_eq!((-4_i128).checked_ceil_div(-2), Some(2));
        assert_eq!((-6_i128).checked_ceil_div(-3), Some(2));

        // With remainder - should round up
        assert_eq!((-5_i128).checked_ceil_div(-2), Some(3)); // ceil(2.5) = 3
        assert_eq!((-7_i128).checked_ceil_div(-3), Some(3)); // ceil(2.33...) = 3
        assert_eq!((-1_i128).checked_ceil_div(-2), Some(1)); // ceil(0.5) = 1
    }

    #[test]
    fn test_unsigned_types() {
        // Test unsigned types work correctly
        assert_eq!(5_u32.checked_ceil_div(2), Some(3)); // ceil(2.5) = 3
        assert_eq!(4_u32.checked_ceil_div(2), Some(2)); // ceil(2) = 2
        assert_eq!(1_u32.checked_ceil_div(2), Some(1)); // ceil(0.5) = 1
    }
}
