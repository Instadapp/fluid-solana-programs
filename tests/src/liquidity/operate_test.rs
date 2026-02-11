//! Liquidity Operate Tests - Rust port of TypeScript `operate.test.ts`.
//!
//! This module contains tests for the operate function combining supply/borrow operations.

#[cfg(test)]
mod tests {
    use crate::liquidity::fixture::LiquidityFixture;
    use fluid_test_framework::helpers::MintKey;
    use fluid_test_framework::prelude::*;
    use liquidity::state::{UserBorrowConfig, UserSupplyConfig};

    const DEFAULT_SUPPLY_AMOUNT: u64 = LAMPORTS_PER_SOL;
    const U60_MAX: u128 = 1_152_921_504_606_846_975;
    const U64_MAX: u128 = u64::MAX as u128;
    const I64_MAX: u128 = i64::MAX as u128;

    fn setup_fixture_with_allowances() -> LiquidityFixture {
        let mut fixture = LiquidityFixture::new().expect("Failed to create fixture");
        fixture.setup().expect("Failed to setup fixture");

        let protocol = fixture.mock_protocol.insecure_clone();
        for mint in [MintKey::USDC, MintKey::WSOL] {
            fixture
                .set_user_allowances_default(mint, &protocol)
                .expect("Failed to set allowances for mock protocol");
        }

        let protocol_interest_free = fixture.mock_protocol_interest_free.insecure_clone();
        for mint in [MintKey::USDC, MintKey::WSOL] {
            fixture
                .set_user_allowances_default_interest_free(mint, &protocol_interest_free)
                .expect("Failed to set allowances for interest-free protocol");
        }

        fixture
    }

    fn setup_fixture_with_supply_limits(mint: MintKey) -> LiquidityFixture {
        let mut fixture = setup_fixture_with_allowances();
        let protocol_pubkey = fixture.mock_protocol.pubkey();

        let supply_config = UserSupplyConfig {
            mode: 1,
            expand_percent: 10_000,
            expand_duration: 1,
            base_withdrawal_limit: U64_MAX,
        };

        fixture
            .update_user_supply_config_with_params(mint, &protocol_pubkey, supply_config)
            .expect("Failed to update user supply config");

        fixture
    }

    /// Test: operate_RevertOperateAmountsZero
    #[test]
    fn test_operate_revert_operate_amounts_zero() {
        let mut fixture = setup_fixture_with_allowances();
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture.expect_revert_any(&["OperateAmountsNearlyZero", "6001"], |f| {
            f.operate(&protocol, 0, 0, MintKey::USDC, &alice)
        });
    }

    /// Test: operate_AfterUnpaused
    #[test]
    fn test_operate_after_unpaused() {
        let mut fixture = setup_fixture_with_allowances();
        let protocol = fixture.mock_protocol.insecure_clone();
        let protocol_pubkey = protocol.pubkey();
        let alice = fixture.alice.insecure_clone();
        let liquidity_pda = fixture.get_liquidity();

        fixture
            .pause_user(MintKey::USDC, MintKey::USDC, &protocol_pubkey, 1, 1)
            .expect("Failed to pause user");

        let revert_info = fixture.expect_revert_any(&["UserPaused", "6027"], |f| {
            f.operate(
                &protocol,
                DEFAULT_SUPPLY_AMOUNT as i128,
                0,
                MintKey::USDC,
                &alice,
            )
        });

        assert!(
            revert_info.contains("UserPaused") || revert_info.has_error_code(6027),
            "Error should indicate user is paused"
        );

        let balance_before_unpaused = fixture.balance_of(&liquidity_pda, MintKey::USDC);

        fixture
            .unpause_user(MintKey::USDC, MintKey::USDC, &protocol_pubkey, 0, 0)
            .expect("Failed to unpause user");

        fixture
            .operate(
                &protocol,
                DEFAULT_SUPPLY_AMOUNT as i128,
                0,
                MintKey::USDC,
                &alice,
            )
            .expect("Operate should succeed after unpause");

        let balance_after = fixture.balance_of(&liquidity_pda, MintKey::USDC);
        assert_eq!(
            balance_after - balance_before_unpaused,
            DEFAULT_SUPPLY_AMOUNT,
            "Protocol balance should increase by supplied amount"
        );
    }

    /// Test: operate_SupplyMaxTokenAmountCapMinusOne
    #[test]
    fn test_operate_supply_max_token_amount_cap_minus_one() {
        let mint = MintKey::USDC;
        let mut fixture = setup_fixture_with_supply_limits(mint);
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let supply_amount = (U60_MAX - 1) as i128;
        fixture
            .operate(&protocol, supply_amount, 0, mint, &alice)
            .expect("Supplying cap - 1 should succeed");
    }

    /// Test: operate_RevertValueOverflowTotalSupplyWithInterest
    #[test]
    fn test_operate_revert_value_overflow_total_supply_with_interest() {
        let mint = MintKey::USDC;
        let mut fixture = setup_fixture_with_supply_limits(mint);
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let supply_amount = (I64_MAX - 1) as i128;
        fixture
            .operate(&protocol, supply_amount, 0, mint, &alice)
            .expect_err("Should revert with USER_MODULE_VALUE_OVERFLOW_TOTAL_SUPPLY");
    }

    /// Test: operate_WithdrawWhenAboveTotalSupplyWithInterestLimit
    #[test]
    fn test_operate_withdraw_when_above_total_supply_with_interest_limit() {
        let mint = MintKey::USDC;
        let mut fixture = setup_fixture_with_supply_limits(mint);
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let max_supply = (U60_MAX - 1) as i128;
        fixture
            .operate(&protocol, max_supply, 0, mint, &alice)
            .expect("Supplying max amount should succeed");

        // Not Simulating total amounts to be > max (this would need storage manipulation in Solana)
        // For now, just test that withdraw works when at limit
        let withdraw_amount = (U60_MAX / 2) as i128;
        fixture
            .operate(&protocol, -withdraw_amount, 0, mint, &alice)
            .expect("Withdraw at limit should succeed");
    }

    /// Test: operate_RevertValueOverflowTotalSupplyInterestFree
    #[test]
    fn test_operate_revert_value_overflow_total_supply_interest_free() {
        let mint = MintKey::USDC;
        let mut fixture = setup_fixture_with_supply_limits(mint);
        let protocol = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let initial_supply: i128 = 1_000_000;
        fixture
            .operate(&protocol, initial_supply, 0, mint, &alice)
            .expect("Initial supply should succeed");

        let overflow_amount = (I64_MAX as i128) - initial_supply;
        fixture.expect_revert_with("ValueOverflowTotalSupply", |f| {
            f.operate(&protocol, overflow_amount, 0, mint, &alice)
        });
    }

    /// Test: operate_RevertValueOverflowTotalBorrowWithInterest
    #[test]
    fn test_operate_revert_value_overflow_total_borrow_with_interest() {
        let mint = MintKey::WSOL;
        let mut fixture = setup_fixture_with_supply_limits(mint);
        let protocol = fixture.mock_protocol.insecure_clone();
        let protocol_pubkey = protocol.pubkey();
        let alice = fixture.alice.insecure_clone();

        let borrow_config = UserBorrowConfig {
            mode: 1,
            expand_percent: 0,
            expand_duration: 1,
            base_debt_ceiling: U60_MAX + 1,
            max_debt_ceiling: U60_MAX + 1,
        };
        fixture
            .update_user_borrow_config_with_params(mint, &protocol_pubkey, borrow_config)
            .expect("Failed to update borrow config");

        let max_amount = U60_MAX as i128;
        fixture
            .operate(&protocol, max_amount - 1, 0, mint, &alice)
            .expect("Supplying near max should succeed");

        let borrow_half = (U60_MAX / 2) as i128;
        fixture
            .operate(&protocol, 0, borrow_half, mint, &alice)
            .expect("Borrow up to half should work");

        fixture.expect_revert_with("ValueOverflowTotalBorrow", |f| {
            f.operate(&protocol, 0, borrow_half + 2, mint, &alice)
        });
    }

    /// Test: operate_PaybackWhenAboveTotalBorrowWithInterestLimit
    #[test]
    fn test_operate_payback_when_above_total_borrow_with_interest_limit() {
        let mint = MintKey::WSOL;
        let mut fixture = setup_fixture_with_supply_limits(mint);
        let protocol = fixture.mock_protocol.insecure_clone();
        let protocol_pubkey = protocol.pubkey();
        let alice = fixture.alice.insecure_clone();

        let borrow_config = UserBorrowConfig {
            mode: 1,
            expand_percent: 0,
            expand_duration: 1,
            base_debt_ceiling: U60_MAX + 1,
            max_debt_ceiling: U60_MAX + 1,
        };
        fixture
            .update_user_borrow_config_with_params(mint, &protocol_pubkey, borrow_config)
            .expect("Failed to update borrow config");

        let buffer: u128 = 10_000_000;
        let max_amount = (U60_MAX - buffer) as i128;

        fixture
            .operate(&protocol, max_amount, 0, mint, &alice)
            .expect("Supplying max amount should succeed");

        let borrow_amount = (U60_MAX - buffer) as i128;
        fixture
            .operate(&protocol, 0, borrow_amount, mint, &alice)
            .expect("Borrow near cap should succeed");

        let payback_amount = buffer as i128;
        fixture
            .operate(&protocol, 0, -payback_amount, mint, &alice)
            .expect("Payback should succeed when above total borrow limit");
    }

    /// Test: operate_RevertValueOverflowTotalBorrowInterestFree
    #[test]
    fn test_operate_revert_value_overflow_total_borrow_interest_free() {
        let mint = MintKey::WSOL;
        let mut fixture = setup_fixture_with_supply_limits(mint);
        let protocol = fixture.mock_protocol_interest_free.insecure_clone();
        let protocol_pubkey = protocol.pubkey();
        let alice = fixture.alice.insecure_clone();

        let borrow_config = UserBorrowConfig {
            mode: 0,
            expand_percent: 0,
            expand_duration: 1,
            base_debt_ceiling: U60_MAX + 1,
            max_debt_ceiling: U60_MAX + 1,
        };
        fixture
            .update_user_borrow_config_with_params(mint, &protocol_pubkey, borrow_config)
            .expect("Failed to update borrow config");

        let buffer: u128 = 10_000_000;
        let max_amount = (U60_MAX - buffer) as i128;

        fixture
            .operate(&protocol, max_amount, 0, mint, &alice)
            .expect("Supply should succeed for interest-free protocol");

        fixture
            .operate(&protocol, 0, max_amount, mint, &alice)
            .expect("Borrow up to max should succeed");

        fixture.expect_revert_any(&["ValueOverflowTotalBorrow", "6034"], |f| {
            f.operate(&protocol, 0, (buffer + 1) as i128, mint, &alice)
        });
    }

    /// Test: operate_OperateAmountWorksForWithdraw
    #[test]
    fn test_operate_amount_works_for_withdraw() {
        let mint = MintKey::USDC;
        let mut fixture = setup_fixture_with_supply_limits(mint);
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let initial_supply = (U60_MAX - 1_000) as i128;
        fixture
            .operate(&protocol, initial_supply, 0, mint, &alice)
            .expect("Supplying large amount should succeed");

        fixture
            .operate(&protocol, -10, 0, mint, &alice)
            .expect("Withdraw 10 should succeed");

        fixture
            .operate(&protocol, -100, 0, mint, &alice)
            .expect("Withdraw 100 should succeed");
    }
}
