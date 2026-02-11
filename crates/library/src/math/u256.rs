use anchor_lang::prelude::*;
use std::{
    cmp::Ordering,
    fmt::{Display, Formatter, Result as FmtResult},
    str::from_utf8_unchecked,
};

use crate::errors::ErrorCodes;

const NUM_WORDS: usize = 4;

// Copyright 2022 Orca Foundation
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

// Portions of this code are derived from a 2024 version of Orca Whirlpools
// Original source: https://github.com/orca-so/whirlpools/blob/810f504e323f814c7b9fc3f59af53428b9cc92b1/programs/whirlpool/src/math/u256_math.rs
// Modified by INSTADAPP LABS INC

#[derive(Copy, Clone, Debug)]
pub struct U256Muldiv {
    pub items: [u64; NUM_WORDS],
}

impl U256Muldiv {
    pub fn new(h: u128, l: u128) -> Self {
        U256Muldiv {
            items: [l.lo(), l.hi(), h.lo(), h.hi()],
        }
    }

    fn copy(&self) -> Self {
        let mut items: [u64; NUM_WORDS] = [0; NUM_WORDS];
        items.copy_from_slice(&self.items);
        U256Muldiv { items }
    }

    fn update_word(&mut self, index: usize, value: u64) {
        self.items[index] = value;
    }

    fn num_words(&self) -> usize {
        for i in (0..self.items.len()).rev() {
            if self.items[i] != 0 {
                return i + 1;
            }
        }
        0
    }

    pub fn get_word(&self, index: usize) -> u64 {
        self.items[index]
    }

    pub fn get_word_u128(&self, index: usize) -> u128 {
        self.items[index] as u128
    }

    // Logical-left shift, does not trigger overflow
    pub fn shift_word_left(&self) -> Self {
        let mut result = U256Muldiv::new(0, 0);

        for i in (0..NUM_WORDS - 1).rev() {
            result.items[i + 1] = self.items[i];
        }

        result
    }

    pub fn checked_shift_word_left(&self) -> Option<Self> {
        let last_element = self.items.last();

        match last_element {
            None => Some(self.shift_word_left()),
            Some(element) => {
                if *element > 0 {
                    None
                } else {
                    Some(self.shift_word_left())
                }
            }
        }
    }

    // Logical-left shift, does not trigger overflow
    pub fn shift_left(&self, mut shift_amount: u32) -> Self {
        // Return 0 if shift is greater than number of bits
        if shift_amount >= U64_RESOLUTION * (NUM_WORDS as u32) {
            return U256Muldiv::new(0, 0);
        }

        let mut result = self.copy();

        while shift_amount >= U64_RESOLUTION {
            result = result.shift_word_left();
            shift_amount -= U64_RESOLUTION;
        }

        if shift_amount == 0 {
            return result;
        }

        for i in (1..NUM_WORDS).rev() {
            result.items[i] = result.items[i] << shift_amount
                | result.items[i - 1] >> (U64_RESOLUTION - shift_amount);
        }

        result.items[0] <<= shift_amount;

        result
    }

    // Logical-right shift, does not trigger overflow
    pub fn shift_word_right(&self) -> Self {
        let mut result = U256Muldiv::new(0, 0);

        for i in 0..NUM_WORDS - 1 {
            result.items[i] = self.items[i + 1]
        }

        result
    }

    // Logical-right shift, does not trigger overflow
    pub fn shift_right(&self, mut shift_amount: u32) -> Self {
        // Return 0 if shift is greater than number of bits
        if shift_amount >= U64_RESOLUTION * (NUM_WORDS as u32) {
            return U256Muldiv::new(0, 0);
        }

        let mut result = self.copy();

        while shift_amount >= U64_RESOLUTION {
            result = result.shift_word_right();
            shift_amount -= U64_RESOLUTION;
        }

        if shift_amount == 0 {
            return result;
        }

        for i in 0..NUM_WORDS - 1 {
            result.items[i] = (result.items[i] >> shift_amount)
                | (result.items[i + 1] << (U64_RESOLUTION - shift_amount));
        }

        result.items[3] >>= shift_amount;

        result
    }

    #[allow(clippy::should_implement_trait)]
    pub fn eq(&self, other: U256Muldiv) -> bool {
        for i in 0..self.items.len() {
            if self.items[i] != other.items[i] {
                return false;
            }
        }

        true
    }

    pub fn lt(&self, other: U256Muldiv) -> bool {
        for i in (0..self.items.len()).rev() {
            match self.items[i].cmp(&other.items[i]) {
                Ordering::Less => return true,
                Ordering::Greater => return false,
                Ordering::Equal => {}
            }
        }

        false
    }

    pub fn gt(&self, other: U256Muldiv) -> bool {
        for i in (0..self.items.len()).rev() {
            match self.items[i].cmp(&other.items[i]) {
                Ordering::Less => return false,
                Ordering::Greater => return true,
                Ordering::Equal => {}
            }
        }

        false
    }

    pub fn lte(&self, other: U256Muldiv) -> bool {
        for i in (0..self.items.len()).rev() {
            match self.items[i].cmp(&other.items[i]) {
                Ordering::Less => return true,
                Ordering::Greater => return false,
                Ordering::Equal => {}
            }
        }

        true
    }

    pub fn gte(&self, other: U256Muldiv) -> bool {
        for i in (0..self.items.len()).rev() {
            match self.items[i].cmp(&other.items[i]) {
                Ordering::Less => return false,
                Ordering::Greater => return true,
                Ordering::Equal => {}
            }
        }

        true
    }

    pub fn try_into_u128(&self) -> Result<u128> {
        if self.num_words() > 2 {
            return Err(ErrorCodes::LibraryU256NumberDownCastError.into());
        }

        Ok((self.items[1] as u128) << U64_RESOLUTION | (self.items[0] as u128))
    }

    pub fn is_zero(self) -> bool {
        for i in 0..NUM_WORDS {
            if self.items[i] != 0 {
                return false;
            }
        }

        true
    }

    // Input:
    //  m = U256::MAX + 1 (which is the amount used for overflow)
    //  n = input value
    // Output:
    //  r = smallest positive additive inverse of n mod m
    //
    // We wish to find r, s.t., r + n ≡ 0 mod m;
    // We generally wish to find this r since r ≡ -n mod m
    // and can make operations with n with large number of bits
    // fit into u256 space without overflow
    pub fn get_add_inverse(&self) -> Self {
        // Additive inverse of 0 is 0
        if self.eq(U256Muldiv::new(0, 0)) {
            return U256Muldiv::new(0, 0);
        }
        // To ensure we don't overflow, we begin with max and do a subtraction
        U256Muldiv::new(u128::MAX, u128::MAX)
            .sub(*self)
            .add(U256Muldiv::new(0, 1))
    }

    // Result overflows if the result is greater than 2^256-1
    pub fn add(&self, other: U256Muldiv) -> Self {
        let mut result = U256Muldiv::new(0, 0);

        let mut carry = 0;
        for i in 0..NUM_WORDS {
            let x = self.get_word_u128(i);
            let y = other.get_word_u128(i);
            let t = x + y + carry;
            result.update_word(i, t.lo());

            carry = t.hi_u128();
        }

        result
    }

    // Result underflows if the result is greater than 2^256-1
    pub fn sub(&self, other: U256Muldiv) -> Self {
        let mut result = U256Muldiv::new(0, 0);

        let mut carry = 0;
        for i in 0..NUM_WORDS {
            let x = self.get_word(i);
            let y = other.get_word(i);
            let (t0, overflowing0) = x.overflowing_sub(y);
            let (t1, overflowing1) = t0.overflowing_sub(carry);
            result.update_word(i, t1);

            carry = if overflowing0 || overflowing1 { 1 } else { 0 };
        }

        result
    }

    // Result overflows if great than 2^256-1
    pub fn mul(&self, other: U256Muldiv) -> Self {
        let mut result = U256Muldiv::new(0, 0);

        let m = self.num_words();
        let n = other.num_words();

        for j in 0..n {
            let mut k = 0;
            for i in 0..m {
                let x = self.get_word_u128(i);
                let y = other.get_word_u128(j);
                if i + j < NUM_WORDS {
                    let z = result.get_word_u128(i + j);
                    let t = x.wrapping_mul(y).wrapping_add(z).wrapping_add(k);
                    result.update_word(i + j, t.lo());
                    k = t.hi_u128();
                }
            }

            // Don't update the carry word
            if j + m < NUM_WORDS {
                result.update_word(j + m, k as u64);
            }
        }

        result
    }

    // Result returns 0 if divide by zero
    pub fn div(&self, mut divisor: U256Muldiv, return_remainder: bool) -> (Self, Self) {
        let mut dividend = self.copy();
        let mut quotient = U256Muldiv::new(0, 0);

        let num_dividend_words = dividend.num_words();
        let num_divisor_words = divisor.num_words();

        if num_divisor_words == 0 {
            panic!("divide by zero");
        }

        // Case 0. If either the dividend or divisor is 0, return 0
        if num_dividend_words == 0 {
            return (U256Muldiv::new(0, 0), U256Muldiv::new(0, 0));
        }

        // Case 1. Dividend is smaller than divisor, quotient = 0, remainder = dividend
        if num_dividend_words < num_divisor_words {
            if return_remainder {
                return (U256Muldiv::new(0, 0), dividend);
            } else {
                return (U256Muldiv::new(0, 0), U256Muldiv::new(0, 0));
            }
        }

        // Case 2. Dividend is smaller than u128, divisor <= dividend, perform math in u128 space
        if num_dividend_words < 3 {
            let dividend = dividend.try_into_u128().unwrap();
            let divisor = divisor.try_into_u128().unwrap();
            let quotient = dividend / divisor;
            if return_remainder {
                let remainder = dividend % divisor;
                return (U256Muldiv::new(0, quotient), U256Muldiv::new(0, remainder));
            } else {
                return (U256Muldiv::new(0, quotient), U256Muldiv::new(0, 0));
            }
        }

        // Case 3. Divisor is single-word, we must isolate this case for correctness
        if num_divisor_words == 1 {
            let mut k = 0;
            for j in (0..num_dividend_words).rev() {
                let d1 = hi_lo(k.lo(), dividend.get_word(j));
                let d2 = divisor.get_word_u128(0);
                let q = d1 / d2;
                k = d1 - d2 * q;
                quotient.update_word(j, q.lo());
            }

            if return_remainder {
                return (quotient, U256Muldiv::new(0, k));
            } else {
                return (quotient, U256Muldiv::new(0, 0));
            }
        }

        // Normalize the division by shifting left
        let s = divisor.get_word(num_divisor_words - 1).leading_zeros();
        let b = dividend.get_word(num_dividend_words - 1).leading_zeros();

        // Conditional carry space for normalized division
        let mut dividend_carry_space: u64 = 0;
        if num_dividend_words == NUM_WORDS && b < s {
            dividend_carry_space = dividend.items[num_dividend_words - 1] >> (U64_RESOLUTION - s);
        }
        dividend = dividend.shift_left(s);
        divisor = divisor.shift_left(s);

        for j in (0..num_dividend_words - num_divisor_words + 1).rev() {
            let result = div_loop(
                j,
                num_divisor_words,
                dividend,
                &mut dividend_carry_space,
                divisor,
                quotient,
            );
            quotient = result.0;
            dividend = result.1;
        }

        if return_remainder {
            dividend = dividend.shift_right(s);
            (quotient, dividend)
        } else {
            (quotient, U256Muldiv::new(0, 0))
        }
    }
}

impl Display for U256Muldiv {
    fn fmt(&self, f: &mut Formatter) -> FmtResult {
        let mut buf = [0_u8; NUM_WORDS * 20];
        let mut i = buf.len() - 1;

        let ten = U256Muldiv::new(0, 10);
        let mut current = *self;

        loop {
            let (quotient, remainder) = current.div(ten, true);
            let digit = remainder.get_word(0) as u8;
            buf[i] = digit + b'0';
            current = quotient;

            if current.is_zero() {
                break;
            }

            i -= 1;
        }

        let s = unsafe { from_utf8_unchecked(&buf[i..]) };

        f.write_str(s)
    }
}

const U64_MAX: u128 = u64::MAX as u128;
const U64_RESOLUTION: u32 = 64;

pub trait LoHi {
    fn lo(self) -> u64;
    fn hi(self) -> u64;
    fn lo_u128(self) -> u128;
    fn hi_u128(self) -> u128;
}

impl LoHi for u128 {
    fn lo(self) -> u64 {
        (self & U64_MAX) as u64
    }
    fn lo_u128(self) -> u128 {
        self & U64_MAX
    }
    fn hi(self) -> u64 {
        (self >> U64_RESOLUTION) as u64
    }
    fn hi_u128(self) -> u128 {
        self >> U64_RESOLUTION
    }
}

pub fn hi_lo(hi: u64, lo: u64) -> u128 {
    (hi as u128) << U64_RESOLUTION | (lo as u128)
}

pub fn mul_u256(v: u128, n: u128) -> U256Muldiv {
    // do 128 bits multiply
    //                   nh   nl
    //                *  vh   vl
    //                ----------
    // a0 =              vl * nl
    // a1 =         vl * nh
    // b0 =         vh * nl
    // b1 =  + vh * nh
    //       -------------------
    //        c1h  c1l  c0h  c0l
    //
    // "a0" is optimized away, result is stored directly in c0.  "b1" is
    // optimized away, result is stored directly in c1.
    //

    let mut c0 = v.lo_u128() * n.lo_u128();
    let a1 = v.lo_u128() * n.hi_u128();
    let b0 = v.hi_u128() * n.lo_u128();

    // add the high word of a0 to the low words of a1 and b0 using c1 as
    // scrach space to capture the carry.  the low word of the result becomes
    // the final high word of c0
    let mut c1 = c0.hi_u128() + a1.lo_u128() + b0.lo_u128();

    c0 = hi_lo(c1.lo(), c0.lo());

    // add the carry from the result above (found in the high word of c1) and
    // the high words of a1 and b0 to b1, the result is c1.
    c1 = v.hi_u128() * n.hi_u128() + c1.hi_u128() + a1.hi_u128() + b0.hi_u128();

    U256Muldiv::new(c1, c0)
}

/// Multiply-divide operation with remainder tracking
#[derive(Debug, Clone, Copy)]
pub struct MulDivResult {
    quotient: u128,
    remainder: u128,
}

impl MulDivResult {
    pub fn new(quotient: u128, remainder: u128) -> Self {
        Self { quotient, remainder }
    }

    /// Get the floor value
    pub fn get(&self) -> u128 {
        self.quotient
    }

    /// Get the ceiling value
    pub fn get_ceil(&self) -> Result<u128> {
        if self.remainder != 0 {
            self.quotient
                .checked_add(1)
                .ok_or(error!(ErrorCodes::LibraryMathError))
        } else {
            Ok(self.quotient)
        }
    }

    /// Check if there is a remainder
    pub fn has_remainder(&self) -> bool {
        self.remainder != 0
    }

    /// Get the raw quotient and remainder
    pub fn into_parts(self) -> (u128, u128) {
        (self.quotient, self.remainder)
    }
}

/// Helper function: safe multiply-divide with remainder (a * b) / c
/// Returns a MulDivResult that allows caller to control rounding direction
pub fn safe_multiply_divide_result(a: u128, b: u128, c: u128) -> Result<MulDivResult> {
    require!(c != 0, ErrorCodes::LibraryDivisionByZero);
    let product = mul_u256(a, b);
    let divisor = U256Muldiv::new(0, c);
    let (quotient, remainder) = product.div(divisor, true);
    
    Ok(MulDivResult::new(
        quotient.try_into_u128()?,
        remainder.try_into_u128()?
    ))
}

/// Helper function: safe multiply-divide-ceil operation (a * b) / c
pub fn safe_multiply_divide_up(a: u128, b: u128, c: u128) -> Result<u128> {
    let result = safe_multiply_divide_result(a, b, c)?;
    result.get_ceil()
}

/// Helper function: safe multiply-divide operation (a * b) / c
pub fn safe_multiply_divide(a: u128, b: u128, c: u128) -> Result<u128> {
    let result = safe_multiply_divide_result(a, b, c)?;
    Ok(result.get())
}

fn div_loop(
    index: usize,
    num_divisor_words: usize,
    mut dividend: U256Muldiv,
    dividend_carry_space: &mut u64,
    divisor: U256Muldiv,
    mut quotient: U256Muldiv,
) -> (U256Muldiv, U256Muldiv) {
    let use_carry = (index + num_divisor_words) == NUM_WORDS;
    let div_hi = if use_carry {
        *dividend_carry_space
    } else {
        dividend.get_word(index + num_divisor_words)
    };
    let d0 = hi_lo(div_hi, dividend.get_word(index + num_divisor_words - 1));
    let d1 = divisor.get_word_u128(num_divisor_words - 1);

    let mut qhat = d0 / d1;
    let mut rhat = d0 - d1 * qhat;

    let d0_2 = dividend.get_word(index + num_divisor_words - 2);
    let d1_2 = divisor.get_word_u128(num_divisor_words - 2);

    let mut cmp1 = hi_lo(rhat.lo(), d0_2);
    let mut cmp2 = qhat.wrapping_mul(d1_2);

    while qhat.hi() != 0 || cmp2 > cmp1 {
        qhat -= 1;
        rhat += d1;
        if rhat.hi() != 0 {
            break;
        }

        cmp1 = hi_lo(rhat.lo(), cmp1.lo());
        cmp2 -= d1_2;
    }

    let mut k = 0;
    let mut t;
    for i in 0..num_divisor_words {
        let p = qhat * (divisor.get_word_u128(i));
        t = (dividend.get_word_u128(index + i))
            .wrapping_sub(k)
            .wrapping_sub(p.lo_u128());
        dividend.update_word(index + i, t.lo());
        k = ((p >> U64_RESOLUTION) as u64).wrapping_sub((t >> U64_RESOLUTION) as u64) as u128;
    }

    let d_head = if use_carry {
        *dividend_carry_space as u128
    } else {
        dividend.get_word_u128(index + num_divisor_words)
    };

    t = d_head.wrapping_sub(k);
    if use_carry {
        *dividend_carry_space = t.lo();
    } else {
        dividend.update_word(index + num_divisor_words, t.lo());
    }

    if k > d_head {
        qhat -= 1;
        k = 0;
        for i in 0..num_divisor_words {
            t = dividend
                .get_word_u128(index + i)
                .wrapping_add(divisor.get_word_u128(i))
                .wrapping_add(k);
            dividend.update_word(index + i, t.lo());
            k = t >> U64_RESOLUTION;
        }

        let new_carry = dividend
            .get_word_u128(index + num_divisor_words)
            .wrapping_add(k)
            .lo();
        if use_carry {
            *dividend_carry_space = new_carry
        } else {
            dividend.update_word(
                index + num_divisor_words,
                dividend
                    .get_word_u128(index + num_divisor_words)
                    .wrapping_add(k)
                    .lo(),
            );
        }
    }

    quotient.update_word(index, qhat.lo());

    (quotient, dividend)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_safe_multiply_divide_up_exact_division() {
        // 10 * 6 / 3 = 20 (no remainder, no ceiling needed)
        assert_eq!(safe_multiply_divide_up(10, 6, 3).unwrap(), 20);
    }

    #[test]
    fn test_safe_multiply_divide_up_with_remainder() {
        // 10 * 7 / 3 = 23.33... -> ceiling = 24
        assert_eq!(safe_multiply_divide_up(10, 7, 3).unwrap(), 24);
        
        // 5 * 3 / 2 = 7.5 -> ceiling = 8
        assert_eq!(safe_multiply_divide_up(5, 3, 2).unwrap(), 8);
    }

    #[test]
    fn test_safe_multiply_divide_up_division_by_zero() {
        assert!(safe_multiply_divide_up(10, 5, 0).is_err());
    }
}