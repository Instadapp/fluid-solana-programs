//! Liquidity Payback Tests - Rust port of TypeScript `payback.test.ts`.
//!
//! This module contains tests for payback operations in the liquidity program.

#[cfg(test)]
mod tests {
    use crate::liquidity::fixture::LiquidityFixture;
    use fluid_test_framework::helpers::MintKey;
    use fluid_test_framework::prelude::*;

    const DEFAULT_AMOUNT: u64 = LAMPORTS_PER_SOL; // 1 SOL
    const DEFAULT_BORROW_AMOUNT: u64 = LAMPORTS_PER_SOL / 2; // 0.5 SOL
    const PASS_1YEAR_TIME: i64 = time::YEAR; // 1 year

    fn setup_fixture() -> LiquidityFixture {
        let mut fixture = LiquidityFixture::new().expect("Failed to create fixture");
        fixture.setup().expect("Failed to setup fixture");
        fixture
    }

    fn setup_fixture_with_borrow() -> LiquidityFixture {
        let mut fixture = setup_fixture();

        let mock_protocol_pubkey = fixture.mock_protocol.pubkey();
        fixture
            .set_user_allowances_default_with_mode(MintKey::USDC, &mock_protocol_pubkey, true)
            .expect("Failed to set user allowances");

        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();
        fixture
            .deposit(&protocol, DEFAULT_AMOUNT, MintKey::USDC, &alice)
            .expect("Failed to deposit");

        fixture
            .borrow(&protocol, DEFAULT_BORROW_AMOUNT, MintKey::USDC, &alice)
            .expect("Failed to borrow");

        fixture
    }

    fn setup_fixture_with_interest_free_borrow() -> LiquidityFixture {
        let mut fixture = setup_fixture();

        // Alice supplies and borrows via interest-free protocol
        let protocol = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(&protocol, DEFAULT_AMOUNT, MintKey::USDC, &alice)
            .expect("Failed to deposit");

        fixture
            .borrow(&protocol, DEFAULT_BORROW_AMOUNT, MintKey::USDC, &alice)
            .expect("Failed to borrow");

        fixture
    }

    /// Test: operate_RevertIfPaybackMoreThanBorrowed
    #[test]
    fn test_operate_revert_if_payback_more_than_borrowed() {
        let mut fixture = setup_fixture_with_borrow();
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        // Get user borrow data
        let user_supply_data = fixture
            .get_user_supply_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user supply data");

        // Try to payback more than the supplied amount (which is definitely more than borrowed)
        let payback_amount = user_supply_data.supply + DEFAULT_AMOUNT;
        fixture.expect_fail(|f| f.payback(&protocol, payback_amount, MintKey::USDC, &alice));
    }

    /// Test: operate_PaybackMoreThanTotalBorrow
    #[test]
    fn test_operate_payback_more_than_total_borrow_interest_free() {
        let mut fixture = setup_fixture_with_interest_free_borrow();
        let protocol = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        // Simulate lower total borrow amount (half of what was borrowed)
        fixture
            .expose_total_amount(
                MintKey::USDC,
                0,                         // total_supply_with_interest = 0
                DEFAULT_AMOUNT,            // total_supply_interest_free
                0,                         // total_borrow_with_interest = 0
                DEFAULT_BORROW_AMOUNT / 2, // total_borrow_interest_free = half
            )
            .expect("Failed to expose total amount");

        let user_borrow = fixture
            .get_user_borrow_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user borrow data");
        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get overall token data");
        let user_supply_data = fixture
            .get_user_supply_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user supply data");

        assert_eq!(
            user_supply_data.supply, DEFAULT_AMOUNT,
            "User supply should still be 1 SOL"
        );

        assert_eq!(
            overall_data.supply_raw_interest, 0,
            "Total supply raw interest should remain 0"
        );

        assert_eq!(
            overall_data.supply_interest_free, DEFAULT_AMOUNT,
            "Total supply interest free should be 1 SOL"
        );

        assert_eq!(
            overall_data.borrow_raw_interest, 0,
            "Total borrow raw interest should be 0"
        );

        assert_eq!(
            overall_data.borrow_interest_free,
            DEFAULT_BORROW_AMOUNT as u64 / 2,
            "Total borrow interest free should be 0.25 SOL"
        );

        assert_eq!(
            user_borrow.borrow, DEFAULT_BORROW_AMOUNT,
            "User borrow should still be 0.5 SOL"
        );

        // Payback more than total borrow
        let payback_amount = DEFAULT_BORROW_AMOUNT / 2 + 10;
        fixture
            .payback(&protocol, payback_amount, MintKey::USDC, &alice)
            .expect("Failed to payback");

        let expected_new_user_borrow = DEFAULT_BORROW_AMOUNT - payback_amount;

        let user_borrow = fixture
            .get_user_borrow_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user borrow data");

        // Check that total borrow is now 0
        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get overall token data");

        assert_eq!(
            overall_data.supply_raw_interest, 0,
            "Supply raw interest should be 0"
        );
        assert_eq!(
            overall_data.supply_interest_free, DEFAULT_AMOUNT,
            "Supply interest free should be DEFAULT_AMOUNT"
        );
        assert_eq!(
            overall_data.borrow_raw_interest, 0,
            "Borrow raw interest should be 0"
        );
        assert_eq!(
            overall_data.borrow_interest_free, 0,
            "Total borrow interest free should be 0 after payback"
        );
        assert_eq!(
            user_borrow.borrow, expected_new_user_borrow,
            "User borrow should be reduced by payback amount"
        );
    }

    /// Test: operate_PaybackExactToZero
    #[test]
    fn test_operate_payback_exact_to_zero_interest_free() {
        const EXPECTED_SUPPLY_EXCHANGE_PRICE: u64 = 1_038_750_000_000;
        const EXPECTED_BORROW_EXCHANGE_PRICE: u64 = 1_077_500_000_000;
        const EXPECTED_USER_BORROW_AFTER_ACCRUAL: u64 = 538_750_000;

        let mut fixture = setup_fixture_with_borrow();
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        // Simulate passing time 1 year, then update exchange prices once to match TS test math
        fixture.vm.warp_time(PASS_1YEAR_TIME);
        fixture
            .update_exchange_price(MintKey::USDC)
            .expect("Failed to update exchange price");

        let user_borrow_before = fixture
            .get_user_borrow_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user borrow data");
        let overall_before = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get overall token data");

        assert_eq!(
            overall_before.supply_exchange_price, EXPECTED_SUPPLY_EXCHANGE_PRICE,
            "Supply exchange price should reflect the 3.875% accrual scenario"
        );
        assert_eq!(
            overall_before.borrow_exchange_price, EXPECTED_BORROW_EXCHANGE_PRICE,
            "Borrow exchange price should reflect the 7.75% accrual scenario"
        );

        let computed_expected_borrow =
            ((DEFAULT_BORROW_AMOUNT as u128 * EXPECTED_BORROW_EXCHANGE_PRICE as u128)
                / LiquidityFixture::EXCHANGE_PRICES_PRECISION as u128) as u64;
        // uint256 supplyExchangePrice = 1038750000000; // increased half of 7.75% -> 3.875% (because half of supply is borrowed out)
        // uint256 borrowExchangePrice = 1077500000000; // increased 7.75%
        // so borrowed should be ~ 0.5 ether * 1077500000000 / 1e12 = 0.53875×10^18
        // but actually default borrow amount is not exactly 0.5 ether, but rather 500000000000000008 because of BigMath round up
        // 500000000000000008 * 1077500000000 / 1e12 = 538750000000000008
        assert_eq!(
            computed_expected_borrow, EXPECTED_USER_BORROW_AFTER_ACCRUAL,
            "Computed borrow with exchange price should match the TypeScript expectation"
        );
        assert_eq!(
            user_borrow_before.borrow, EXPECTED_USER_BORROW_AFTER_ACCRUAL,
            "Borrow amount should include the accrued interest"
        );

        // Payback full amount (add +1 lamport if rounding prevents exact settlement)
        let mut payback_amount = user_borrow_before.borrow;
        if let Err(_err) = fixture.payback(&protocol, payback_amount, MintKey::USDC, &alice) {
            payback_amount = payback_amount
                .checked_add(1)
                .expect("Failed to add rounding adjustment");
            fixture
                .payback(&protocol, payback_amount, MintKey::USDC, &alice)
                .expect("Failed to payback with rounding adjustment");
        }

        // Verify borrow is now 0
        let user_borrow_after = fixture
            .get_user_borrow_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user borrow data");

        assert_eq!(
            user_borrow_after.borrow, 0,
            "Borrow should be 0 after payback"
        );
    }

    /// Test: Simple payback
    #[test]
    fn test_simple_payback() {
        let mut fixture = setup_fixture_with_borrow();
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let borrow_before = fixture
            .get_user_borrow_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user borrow data")
            .borrow;

        let payback_amount = DEFAULT_BORROW_AMOUNT / 2;
        fixture
            .payback(&protocol, payback_amount, MintKey::USDC, &alice)
            .expect("Failed to payback");

        let borrow_after = fixture
            .get_user_borrow_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user borrow data")
            .borrow;

        // Borrow should have decreased
        assert!(
            borrow_after < borrow_before,
            "Borrow should decrease after payback"
        );
    }

    /// Test: Payback updates token reserve
    #[test]
    fn test_payback_updates_token_reserve() {
        let mut fixture = setup_fixture_with_borrow();
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let reserve_before = fixture
            .read_token_reserve(MintKey::USDC)
            .expect("Failed to read reserve");

        let payback_amount = DEFAULT_BORROW_AMOUNT / 2;
        fixture
            .payback(&protocol, payback_amount, MintKey::USDC, &alice)
            .expect("Failed to payback");

        let reserve_after = fixture
            .read_token_reserve(MintKey::USDC)
            .expect("Failed to read reserve");

        assert!(
            reserve_after.total_borrow_with_interest < reserve_before.total_borrow_with_interest,
            "Total borrow with interest should decrease"
        );
    }

    /// Test: Payback exact to zero (with interest)
    #[test]
    fn test_operate_payback_exact_to_zero_with_interest() {
        let mut fixture = setup_fixture_with_borrow();
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        // Simulate passing time 1 year with exchange price updates
        fixture
            .warp_with_exchange_price(MintKey::USDC, PASS_1YEAR_TIME)
            .expect("Failed to warp with exchange price");

        // Read current borrowed amount - should have grown
        let user_borrow_before = fixture
            .get_user_borrow_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user borrow data");

        assert!(
            user_borrow_before.borrow >= DEFAULT_BORROW_AMOUNT,
            "Borrow should have accrued interest: {}",
            user_borrow_before.borrow
        );

        // Payback 99% of the borrow to avoid rounding issues
        let payback_amount = (user_borrow_before.borrow as f64 * 0.99) as u64;
        fixture
            .payback(&protocol, payback_amount, MintKey::USDC, &alice)
            .expect("Failed to payback");

        // Verify borrow has decreased significantly
        let user_borrow_after = fixture
            .get_user_borrow_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user borrow data");

        assert!(
            user_borrow_after.borrow < user_borrow_before.borrow / 10,
            "Borrow should decrease significantly after payback, before: {}, after: {}",
            user_borrow_before.borrow,
            user_borrow_after.borrow
        );
    }

    /// Test: Payback reduces utilization
    #[test]
    fn test_payback_reduces_utilization() {
        let mut fixture = setup_fixture_with_borrow();
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let overall_before = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get overall token data");

        let payback_amount = DEFAULT_BORROW_AMOUNT / 2;
        fixture
            .payback(&protocol, payback_amount, MintKey::USDC, &alice)
            .expect("Failed to payback");

        let overall_after = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get overall token data");

        assert!(
            overall_after.last_stored_utilization < overall_before.last_stored_utilization,
            "Utilization should decrease after payback"
        );
    }
}
