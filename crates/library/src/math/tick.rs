use anchor_lang::prelude::*;

use crate::{errors::ErrorCodes, math::u256::*};

/// Library that calculates number "tick" and "ratioX48" from this: ratioX48 = (1.0015^tick) * 2^48
/// This library is optimized for u128 calculations in Solana programs.
/// "tick" supports between -16383 and 16383.
/// "ratioX48" supports between 6093 and 13002088133096036565414295
pub struct TickMath;

impl TickMath {
    /// The minimum tick that can be passed in get_ratio_at_tick. 1.0015**-16383
    pub const MIN_TICK: i32 = -16383;
    /// The maximum tick that can be passed in get_ratio_at_tick. 1.0015**16383
    pub const MAX_TICK: i32 = 16383;

    /// The spacing between two consecutive ticks. 1.0015
    pub const TICK_SPACING: u128 = 10015;

    /// The cold tick is used to represent that tick is not set
    pub const COLD_TICK: i32 = i32::MIN;

    // script to verify values - https://play.instadapp.io/ioH-QHu1qaJ4pvQEh_OZB
    const FACTOR00: u128 = 0x10000000000000000; // 2^64
    const FACTOR01: u128 = 0xff9dd7de423466c2; // 2^64/1.0015**1 = 18419115400608638658
    const FACTOR02: u128 = 0xff3bd55f4488ad27; // 2^64/1.0015**2 = 18391528108445969703
    const FACTOR03: u128 = 0xfe78410fd6498b74; // 2^64/1.0015**4 = 18336477419114433396
    const FACTOR04: u128 = 0xfcf2d9987c9be179; // 2^64/1.0015**8 = 18226869890870665593
    const FACTOR05: u128 = 0xf9ef02c4529258b0; // 2^64/1.0015**16 = 18009616477100071088
    const FACTOR06: u128 = 0xf402d288133a85a1; // 2^64/1.0015**32 = 17582847377087825313
    const FACTOR07: u128 = 0xe895615b5beb6386; // 2^64/1.0015**64 = 16759408633341240198
    const FACTOR08: u128 = 0xd34f17a00ffa00a8; // 2^64/1.0015**128 = 15226414841393184936
    const FACTOR09: u128 = 0xae6b7961714e2055; // 2^64/1.0015**256 = 12568272644527235157
    const FACTOR10: u128 = 0x76d6461f27082d75; // 2^64/1.0015**512 = 8563108841104354677
    const FACTOR11: u128 = 0x372a3bfe0745d8b7; // 2^64/1.0015**1024 = 3975055583337633975
    const FACTOR12: u128 = 0xbe32cbee4897976; // 2^64/1.0015**2048 = 856577552520149366
    const FACTOR13: u128 = 0x8d4f70c9ff4925; // 2^64/1.0015**4096 = 39775317560084773
    const FACTOR14: u128 = 0x4e009ae55194; // 2^64/1.0015**8192 = 85764505686420

    /// The minimum value that can be returned from get_ratio_at_tick.
    /// Equivalent to get_ratio_at_tick(MIN_TICK). ~ Equivalent to `(1 << 48) * (1.0015**-16383)`   
    pub const MIN_RATIOX48: u128 = 6093;
    /// The maximum value that can be returned from get_ratio_at_tick.
    /// Equivalent to get_ratio_at_tick(MAX_TICK). ~ Equivalent to `(1 << 48) * (1.0015**16383)`
    pub const MAX_RATIOX48: u128 = 13002088133096036565414295;

    pub const ZERO_TICK_SCALED_RATIO: u128 = 0x1000000000000; // 1 << 48
    const _1E13: u128 = 10000000000000; // 1e13

    pub const SHIFT: u128 = 48;

    /// Calculate ratioX48 = (1.0015^tick) * 2^48
    ///
    /// # Arguments
    /// * `tick` - The input tick for the above formula
    ///
    /// # Returns
    /// * `Result<u128, ProgramError>` - The ratio or an error if tick is out of bounds
    ///
    /// # Errors
    /// * Returns error if |tick| > MAX_TICK
    pub fn get_ratio_at_tick(tick: i32) -> Result<u128> {
        require!(
            tick >= Self::MIN_TICK && tick <= Self::MAX_TICK,
            ErrorCodes::LibraryTickOutOfBounds
        );

        let abs_tick = tick.abs() as u32;
        let mut factor = Self::FACTOR00;

        if abs_tick & 0x1 != 0 {
            factor = Self::FACTOR01;
        }
        if abs_tick & 0x2 != 0 {
            factor = Self::mul_shift_64(factor, Self::FACTOR02)?;
        }
        if abs_tick & 0x4 != 0 {
            factor = Self::mul_shift_64(factor, Self::FACTOR03)?;
        }
        if abs_tick & 0x8 != 0 {
            factor = Self::mul_shift_64(factor, Self::FACTOR04)?;
        }
        if abs_tick & 0x10 != 0 {
            factor = Self::mul_shift_64(factor, Self::FACTOR05)?;
        }
        if abs_tick & 0x20 != 0 {
            factor = Self::mul_shift_64(factor, Self::FACTOR06)?;
        }
        if abs_tick & 0x40 != 0 {
            factor = Self::mul_shift_64(factor, Self::FACTOR07)?;
        }
        if abs_tick & 0x80 != 0 {
            factor = Self::mul_shift_64(factor, Self::FACTOR08)?;
        }
        if abs_tick & 0x100 != 0 {
            factor = Self::mul_shift_64(factor, Self::FACTOR09)?;
        }
        if abs_tick & 0x200 != 0 {
            factor = Self::mul_shift_64(factor, Self::FACTOR10)?;
        }
        if abs_tick & 0x400 != 0 {
            factor = Self::mul_shift_64(factor, Self::FACTOR11)?;
        }
        if abs_tick & 0x800 != 0 {
            factor = Self::mul_shift_64(factor, Self::FACTOR12)?;
        }
        if abs_tick & 0x1000 != 0 {
            factor = Self::mul_shift_64(factor, Self::FACTOR13)?;
        }
        if abs_tick & 0x2000 != 0 {
            factor = Self::mul_shift_64(factor, Self::FACTOR14)?;
        }

        let mut precision = 0u128;

        if tick >= 0 {
            // For positive ticks, take reciprocal to get 1.0015^|tick|
            factor = u128::MAX / factor;
            // Round up for precision
            if factor % 0x10000 != 0 {
                precision = 1;
            }
        }

        let ratio_x48 = (factor >> 16) + precision;

        Ok(ratio_x48)
    }

    /// Calculate tick from ratioX48 where ratioX48 = (1.0015^tick) * 2^48
    ///
    /// # Arguments
    /// * `ratio_x48` - The input ratio
    ///
    /// # Returns
    /// * `Result<(i32, u128), ProgramError>` - (tick, perfect_ratio_x48) or error
    ///
    /// # Errors
    /// * Returns error if ratio_x48 is out of valid bounds
    pub fn get_tick_at_ratio(ratio_x48: u128) -> Result<(i32, u128)> {
        require!(
            ratio_x48 >= Self::MIN_RATIOX48 && ratio_x48 <= Self::MAX_RATIOX48,
            ErrorCodes::LibraryTickRatioOutOfBounds
        );

        let is_negative = ratio_x48 < Self::ZERO_TICK_SCALED_RATIO;
        let mut factor = if is_negative {
            // For ratios < 1 (negative ticks)
            safe_multiply_divide(Self::ZERO_TICK_SCALED_RATIO, Self::_1E13, ratio_x48)?
        } else {
            // For ratios >= 1 (positive ticks)
            safe_multiply_divide(ratio_x48, Self::_1E13, Self::ZERO_TICK_SCALED_RATIO)?
        };

        let mut tick = 0i32;

        // Binary search through powers of 2
        // Thresholds are (1.0015^(2^n)) * 1E13
        // https://play.instadapp.io/Z_QfIaO0h8kUQ2A-GwkP9
        if factor >= 2150859953785115391 {
            // 2^13 = 8192
            tick |= 0x2000;
            factor = safe_multiply_divide(factor, Self::_1E13, 2150859953785115391)?;
        }
        if factor >= 4637736467054931 {
            // 2^12 = 4096
            tick |= 0x1000;
            factor = safe_multiply_divide(factor, Self::_1E13, 4637736467054931)?;
        }
        if factor >= 215354044936586 {
            // 2^11 = 2048
            tick |= 0x800;
            factor = safe_multiply_divide(factor, Self::_1E13, 215354044936586)?;
        }
        if factor >= 46406254420777 {
            // 2^10 = 1024
            tick |= 0x400;
            factor = safe_multiply_divide(factor, Self::_1E13, 46406254420777)?;
        }
        if factor >= 21542110950596 {
            // 2^9 = 512
            tick |= 0x200;
            factor = safe_multiply_divide(factor, Self::_1E13, 21542110950596)?;
        }
        if factor >= 14677230989051 {
            // 2^8 = 256
            tick |= 0x100;
            factor = safe_multiply_divide(factor, Self::_1E13, 14677230989051)?;
        }
        if factor >= 12114962232319 {
            // 2^7 = 128
            tick |= 0x80;
            factor = safe_multiply_divide(factor, Self::_1E13, 12114962232319)?;
        }
        if factor >= 11006798913544 {
            // 2^6 = 64
            tick |= 0x40;
            factor = safe_multiply_divide(factor, Self::_1E13, 11006798913544)?;
        }
        if factor >= 10491329235871 {
            // 2^5 = 32
            tick |= 0x20;
            factor = safe_multiply_divide(factor, Self::_1E13, 10491329235871)?;
        }
        if factor >= 10242718992470 {
            // 2^4 = 16
            tick |= 0x10;
            factor = safe_multiply_divide(factor, Self::_1E13, 10242718992470)?;
        }
        if factor >= 10120631893548 {
            // 2^3 = 8
            tick |= 0x8;
            factor = safe_multiply_divide(factor, Self::_1E13, 10120631893548)?;
        }
        if factor >= 10060135135051 {
            // 2^2 = 4
            tick |= 0x4;
            factor = safe_multiply_divide(factor, Self::_1E13, 10060135135051)?;
        }
        if factor >= 10030022500000 {
            // 2^1 = 2
            tick |= 0x2;
            factor = safe_multiply_divide(factor, Self::_1E13, 10030022500000)?;
        }
        if factor >= 10015000000000 {
            // 2^0 = 1
            tick |= 0x1;
            factor = safe_multiply_divide(factor, Self::_1E13, 10015000000000)?;
        }

        let perfect_ratio_x48 = if is_negative {
            // For negative ticks
            tick = !tick; // Bitwise NOT to make negative
            safe_multiply_divide(ratio_x48, factor, 10015000000000)?
        } else {
            // For positive ticks
            safe_multiply_divide(ratio_x48, Self::_1E13, factor)?
        };

        // Verify perfect ratio is not greater than input ratio
        require!(
            perfect_ratio_x48 <= ratio_x48,
            ErrorCodes::LibraryTickInvalidPerfectRatio
        );

        Ok((tick, perfect_ratio_x48))
    }

    fn mul_shift_64(n0: u128, n1: u128) -> Result<u128> {
        Ok(mul_u256(n0, n1).shift_right(64).try_into_u128()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_ratio_at_tick_zero() {
        let ratio = TickMath::get_ratio_at_tick(0).unwrap();
        assert_eq!(ratio, TickMath::ZERO_TICK_SCALED_RATIO);
    }

    #[test]
    fn test_get_ratio_at_tick_positive() {
        let ratio = TickMath::get_ratio_at_tick(1).unwrap();
        assert!(ratio > TickMath::ZERO_TICK_SCALED_RATIO);
    }

    #[test]
    fn test_get_ratio_at_tick_negative() {
        let ratio = TickMath::get_ratio_at_tick(-1).unwrap();
        assert!(ratio < TickMath::ZERO_TICK_SCALED_RATIO);
    }

    #[test]
    fn test_get_tick_at_ratio_round_trip() {
        let original_tick = -462;
        let ratio = TickMath::get_ratio_at_tick(original_tick).unwrap();
        let (recovered_tick, _) = TickMath::get_tick_at_ratio(ratio).unwrap();
        assert_eq!(recovered_tick, original_tick);
    }

    #[test]
    fn test_bounds() {
        // Test max tick
        let max_ratio = TickMath::get_ratio_at_tick(TickMath::MAX_TICK).unwrap();
        assert!(max_ratio <= TickMath::MAX_RATIOX48);

        // Test min tick
        let min_ratio = TickMath::get_ratio_at_tick(TickMath::MIN_TICK).unwrap();
        assert!(min_ratio >= TickMath::MIN_RATIOX48);
    }
}
