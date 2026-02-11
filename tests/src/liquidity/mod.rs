//! Liquidity program tests
//!
//! This module contains tests for the liquidity program, porting
//! the TypeScript tests from __tests__/liquidity/*.test.ts to Rust.

pub mod fixture;

mod base_test;
mod borrow_limit_test;
mod borrow_test;
mod claim_test;
mod liquidity_yield_test;
mod operate_test;
mod payback_test;
mod supply_test;
mod withdraw_test;
mod withdrawal_limit_test;
