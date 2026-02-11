use anchor_lang::prelude::*;
use std::panic::Location;

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
// Original source: https://github.com/drift-labs/protocol-v2/blob/master/programs/drift/src/math/safe_math.rs
// Modified by INSTADAPP LABS INC

use crate::errors::{ErrorCodes, FluidResult};
use crate::math::ceil_div::CheckedCeilDiv;

pub trait SafeMath: Sized {
    fn safe_add(self, rhs: Self) -> FluidResult<Self>;
    fn safe_sub(self, rhs: Self) -> FluidResult<Self>;
    fn safe_mul(self, rhs: Self) -> FluidResult<Self>;
    fn safe_div(self, rhs: Self) -> FluidResult<Self>;
    fn safe_div_ceil(self, rhs: Self) -> FluidResult<Self>;
    fn safe_shr(self, rhs: Self) -> FluidResult<Self>;
}

macro_rules! checked_impl {
    ($t:ty) => {
        impl SafeMath for $t {
            #[track_caller]
            #[inline(always)]
            fn safe_add(self, v: $t) -> FluidResult<$t> {
                match self.checked_add(v) {
                    Some(result) => Ok(result),
                    None => {
                        let caller = Location::caller();
                        msg!("Math error thrown at {}:{}", caller.file(), caller.line());
                        Err(ErrorCodes::LibraryMathError)
                    }
                }
            }

            #[track_caller]
            #[inline(always)]
            fn safe_sub(self, v: $t) -> FluidResult<$t> {
                match self.checked_sub(v) {
                    Some(result) => Ok(result),
                    None => {
                        let caller = Location::caller();
                        msg!("Math error thrown at {}:{}", caller.file(), caller.line());
                        Err(ErrorCodes::LibraryMathError)
                    }
                }
            }

            #[track_caller]
            #[inline(always)]
            fn safe_mul(self, v: $t) -> FluidResult<$t> {
                match self.checked_mul(v) {
                    Some(result) => Ok(result),
                    None => {
                        let caller = Location::caller();
                        msg!("Math error thrown at {}:{}", caller.file(), caller.line());
                        Err(ErrorCodes::LibraryMathError)
                    }
                }
            }

            #[track_caller]
            #[inline(always)]
            fn safe_div(self, v: $t) -> FluidResult<$t> {
                match self.checked_div(v) {
                    Some(result) => Ok(result),
                    None => {
                        let caller = Location::caller();
                        msg!("Math error thrown at {}:{}", caller.file(), caller.line());
                        Err(ErrorCodes::LibraryMathError)
                    }
                }
            }

            #[track_caller]
            #[inline(always)]
            fn safe_div_ceil(self, v: $t) -> FluidResult<$t> {
                match self.checked_ceil_div(v) {
                    Some(result) => Ok(result),
                    None => {
                        let caller = Location::caller();
                        msg!("Math error thrown at {}:{}", caller.file(), caller.line());
                        Err(ErrorCodes::LibraryMathError)
                    }
                }
            }

            #[track_caller]
            #[inline(always)]
            fn safe_shr(self, v: $t) -> FluidResult<$t> {
                match self.checked_shr(v as u32) {
                    Some(result) => Ok(result),
                    None => {
                        let caller = Location::caller();
                        msg!("Math error thrown at {}:{}", caller.file(), caller.line());
                        Err(ErrorCodes::LibraryMathError)
                    }
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
    use crate::math::safe_math::SafeMath;

    #[test]
    fn safe_add() {
        assert_eq!(1_u128.safe_add(1).unwrap(), 2);
        assert_eq!(1_u128.safe_add(u128::MAX).is_err(), true);
    }

    #[test]
    fn safe_sub() {
        assert_eq!(1_u128.safe_sub(1).unwrap(), 0);
        assert_eq!(0_u128.safe_sub(1).is_err(), true);
    }

    #[test]
    fn safe_mul() {
        assert_eq!(8_u128.safe_mul(80).unwrap(), 640);
        assert_eq!(1_u128.safe_mul(1).unwrap(), 1);
        assert_eq!(2_u128.safe_mul(u128::MAX).is_err(), true);
    }

    #[test]
    fn safe_div() {
        assert_eq!(155_u128.safe_div(8).unwrap(), 19);
        assert_eq!(159_u128.safe_div(8).unwrap(), 19);
        assert_eq!(160_u128.safe_div(8).unwrap(), 20);

        assert_eq!(1_u128.safe_div(1).unwrap(), 1);
        assert_eq!(1_u128.safe_div(100).unwrap(), 0);
        assert_eq!(1_u128.safe_div(0).is_err(), true);
    }
}
