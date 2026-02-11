use anchor_lang::prelude::*;
use std::convert::TryInto;
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
// Original source: https://github.com/drift-labs/protocol-v2/blob/master/programs/drift/src/math/casting.rs
// Modified by INSTADAPP LABS INC

use crate::errors::{ErrorCodes, FluidResult};

pub trait Cast: Sized {
    #[track_caller]
    #[inline(always)]
    fn cast<T: std::convert::TryFrom<Self>>(self) -> FluidResult<T> {
        match self.try_into() {
            Ok(result) => Ok(result),
            Err(_) => {
                let caller = Location::caller();
                msg!(
                    "Casting error thrown at {}:{}",
                    caller.file(),
                    caller.line()
                );
                Err(ErrorCodes::LibraryCastingFailure)
            }
        }
    }
}

impl Cast for u128 {}
impl Cast for u64 {}
impl Cast for u32 {}
impl Cast for u16 {}
impl Cast for u8 {}
impl Cast for usize {}
impl Cast for i128 {}
impl Cast for i64 {}
impl Cast for i32 {}
impl Cast for i16 {}
impl Cast for i8 {}
impl Cast for bool {}
