//! Liquidity Withdraw Tests - Rust port of TypeScript `withdraw.test.ts`.
//!
//! This module contains tests for withdraw operations in the liquidity program.

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

    fn setup_fixture_with_interest_free_supply() -> LiquidityFixture {
        let mut fixture = setup_fixture();

        // Alice supplies liquidity via interest-free protocol
        let protocol = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();
        fixture
            .deposit(&protocol, DEFAULT_AMOUNT, MintKey::USDC, &alice)
            .expect("Failed to deposit");

        fixture
    }

    fn setup_fixture_with_interest_supply() -> LiquidityFixture {
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
    }

    /// Test: operate_RevertIfWithdrawMoreThanSupplied
    #[test]
    fn test_operate_revert_if_withdraw_more_than_supplied_interest_free() {
        let mut fixture = setup_fixture_with_interest_free_supply();
        let protocol = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let withdraw_amount = DEFAULT_AMOUNT + 1;
        fixture.expect_fail(|f| f.withdraw(&protocol, withdraw_amount, MintKey::USDC, &alice));
    }

    /// Test: operate_WithdrawMoreThanTotalSupply
    /// Withdraw more than total supply but <= user supply. Should reset total supply to 0
    #[test]
    fn test_operate_withdraw_more_than_total_supply_interest_free() {
        let mut fixture = setup_fixture_with_interest_free_supply();
        let protocol = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        // Simulate lower total supply amount (half of what was supplied)
        fixture
            .expose_total_amount(
                MintKey::USDC,
                0,                  // total_supply_with_interest = 0
                DEFAULT_AMOUNT / 2, // total_supply_interest_free = 0.5 SOL
                0,                  // total_borrow_with_interest = 0
                0,                  // total_borrow_interest_free = 0
            )
            .expect("Failed to expose total amount");

        let user_supply = fixture
            .get_user_supply_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user supply data");

        assert_eq!(
            user_supply.supply, DEFAULT_AMOUNT,
            "User supply should still be 1 SOL"
        );

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get overall token data");

        assert_eq!(
            overall_data.supply_interest_free,
            DEFAULT_AMOUNT as u64 / 2,
            "Total supply interest free should be 0.5 SOL"
        );

        let withdraw_amount = DEFAULT_AMOUNT / 2 + 10;
        fixture
            .withdraw(&protocol, withdraw_amount, MintKey::USDC, &alice)
            .expect("Failed to withdraw");

        let new_supply_amount = user_supply.supply - withdraw_amount;

        let user_supply = fixture
            .get_user_supply_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user supply data");

        assert_eq!(
            user_supply.supply, new_supply_amount,
            "User supply should be reduced by withdraw amount"
        );

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get overall token data");

        assert_eq!(
            overall_data.supply_interest_free, 0,
            "Total supply interest free should be 0 after withdraw"
        );
    }

    /// Test: operate_WithdrawExactToZero
    #[test]
    fn test_operate_withdraw_exact_to_zero_interest_free() {
        let mut fixture = setup_fixture_with_interest_free_supply();
        let protocol = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        // Borrow to create some yield for better test setup
        fixture
            .borrow(&protocol, DEFAULT_BORROW_AMOUNT, MintKey::USDC, &alice)
            .expect("Failed to borrow");

        // Simulate passing time 1 year
        fixture.vm.warp_time(PASS_1YEAR_TIME);

        // Create more supply so there is actually liquidity for withdrawal
        let protocol_with_interest = fixture.mock_protocol_with_interest.insecure_clone();
        fixture
            .deposit(
                &protocol_with_interest,
                DEFAULT_AMOUNT,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit");

        // Read current supplied amount
        let user_supply = fixture
            .get_user_supply_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user supply data");

        // In interest-free mode, supply should be same as deposited
        assert_eq!(
            user_supply.supply, DEFAULT_AMOUNT,
            "Interest-free supply should equal deposit"
        );

        // Withdraw full amount
        fixture
            .withdraw(&protocol, user_supply.supply, MintKey::USDC, &alice)
            .expect("Failed to withdraw");

        let user_supply = fixture
            .get_user_supply_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user supply data");

        assert_eq!(user_supply.supply, 0, "Supply should be 0 after withdrawal");
    }

    /// Test: operate_WithdrawMoreThanTotalSupply with interest
    #[test]
    fn test_operate_withdraw_more_than_total_supply_with_interest() {
        let mut fixture = setup_fixture_with_interest_supply();
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .borrow(&protocol, DEFAULT_BORROW_AMOUNT, MintKey::USDC, &alice)
            .expect("Failed to borrow");

        // Simulate lower total supply amount (half of what was supplied)
        // This simulates a scenario where total supply is less than user supply
        // supplyRawInterest = 0.5 SOL, supplyInterestFree = 0
        // borrowRawInterest = 0.5 SOL, borrowInterestFree = 0
        fixture
            .expose_total_amount(
                MintKey::USDC,
                DEFAULT_AMOUNT / 2, // total_supply_with_interest = 0.5 SOL (raw)
                0,                  // total_supply_interest_free = 0
                DEFAULT_BORROW_AMOUNT, // total_borrow_with_interest = 0.5 SOL
                0,                  // total_borrow_interest_free = 0
            )
            .expect("Failed to expose total amount");

        // Simulate correct utilization of 100%, ratios etc.
        // supply exchange price = 1e12 (1:1)
        // borrow exchange price = 1e12 (1:1)
        // utilization = 10000 (100%)
        // borrow rate = 775 (7.75%)
        let current_timestamp = fixture.get_timestamp();
        fixture
            .expose_exchange_price_with_rates(
                MintKey::USDC,
                1_000_000_000_000, // supply exchange price = 1e12
                1_000_000_000_000, // borrow exchange price = 1e12
                10_000,            // utilization = 100%
                775,               // borrow rate = 7.75% (775 basis points)
                current_timestamp,
            )
            .expect("Failed to expose exchange price with rates");

        fixture.vm.warp_time(PASS_1YEAR_TIME);

        // Update exchange price after time warp to reflect the new rates
        fixture
            .update_exchange_price(MintKey::USDC)
            .expect("Failed to update exchange price");

        let user_supply = fixture
            .get_user_supply_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user supply data");

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get overall token data");

        // uint256 supplyExchangePrice = 1077500000000; // increased 7.75% (because ALL of supply is borrowed out)
        // uint256 borrowExchangePrice = 1077500000000; // increased 7.75%
        // Expected user supply: 1 SOL * 1.0775 = 1.0775 SOL
        let expected_user_supply = (1.0775 * LAMPORTS_PER_SOL as f64) as u64;
        assert_eq!(
            user_supply.supply, expected_user_supply,
            "User supply should be 1.0775 SOL after 1 year at 7.75% rate"
        );

        // supplyRawInterest should still be 0.5 SOL (raw, not adjusted)
        assert_eq!(
            overall_data.supply_raw_interest,
            DEFAULT_AMOUNT / 2,
            "Supply raw interest should be 0.5 SOL"
        );

        // Total supply = 0.5 SOL raw * 1.0775 exchange price = 0.53875 SOL
        let expected_total_supply = (0.53875 * LAMPORTS_PER_SOL as f64) as u64;
        assert_eq!(
            overall_data.total_supply, expected_total_supply,
            "Total supply should be 0.53875 SOL (0.5 ether adjusted for supplyExchangePrice)"
        );

        assert_eq!(
            overall_data.supply_interest_free, 0,
            "Supply interest free should be 0"
        );

        assert_eq!(
            overall_data.borrow_raw_interest, DEFAULT_BORROW_AMOUNT,
            "Borrow raw interest should be 0.5 SOL"
        );

        assert_eq!(
            overall_data.borrow_interest_free, 0,
            "Borrow interest free should be 0"
        );

        // Withdraw more than total amount
        let withdraw_amount = overall_data.total_supply + 1;
        let new_user_supply_amount = user_supply.supply - withdraw_amount;

        // Payback borrowed amount to create funds at liquidity
        // payback_amount = 0.5 SOL * 1.0775 = 0.53875 SOL (borrow with interest after 1 year)
        // Use u128 to avoid overflow: DEFAULT_BORROW_AMOUNT * 1077500000000 / 1e12
        let payback_amount =
            ((DEFAULT_BORROW_AMOUNT as u128 * 1077500000000u128) / 1_000_000_000_000u128) as u64;
        fixture
            .payback(&protocol, payback_amount, MintKey::USDC, &alice)
            .expect("Failed to payback");

        fixture
            .withdraw(&protocol, withdraw_amount, MintKey::USDC, &alice)
            .expect("Failed to withdraw");

        let user_supply_after = fixture
            .get_user_supply_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user supply data after withdrawal");

        let overall_data_after = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get overall token data after withdrawal");

        let supply_diff = (user_supply_after.supply as i64 - new_user_supply_amount as i64).abs();
        assert!(
            supply_diff <= 1,
            "User supply should be close to expected (diff: {}, expected: {}, actual: {})",
            supply_diff,
            new_user_supply_amount,
            user_supply_after.supply
        );

        assert_eq!(
            overall_data_after.supply_raw_interest, 0,
            "Supply raw interest should be 0 after withdrawal"
        );

        assert_eq!(
            overall_data_after.supply_interest_free, 0,
            "Supply interest free should be 0 after withdrawal"
        );

        // Borrow raw interest should be close to 0 (with tolerance for rounding)
        assert!(
            overall_data_after.borrow_raw_interest <= 1,
            "Borrow raw interest should be close to 0 (actual: {})",
            overall_data_after.borrow_raw_interest
        );

        assert_eq!(
            overall_data_after.borrow_interest_free, 0,
            "Borrow interest free should be 0 after withdrawal"
        );
    }

    /// Test: operate_WithdrawExactToZero with interest
    #[test]
    fn test_operate_withdraw_exact_to_zero_with_interest() {
        let mut fixture = setup_fixture_with_interest_supply();
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        // Borrow to create some yield for better test setup
        fixture
            .borrow(&protocol, DEFAULT_BORROW_AMOUNT, MintKey::USDC, &alice)
            .expect("Failed to borrow");

        // Simulate passing time 1 year to get predictable borrow rate and amounts
        fixture.vm.warp_time(PASS_1YEAR_TIME);

        let protocol_interest_free = fixture.mock_protocol_interest_free.insecure_clone();
        fixture
            .deposit(
                &protocol_interest_free,
                DEFAULT_AMOUNT,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit from interest-free protocol");

        // Read current supplied amount via resolver
        let user_supply = fixture
            .get_user_supply_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user supply data");

        // uint256 supplyExchangePrice = 1038750000000; // increased half of 7.75% -> 3.875% (because half of supply is borrowed out)
        // uint256 borrowExchangePrice = 1077500000000; // increased 7.75%
        // so withdrawable should be ~ 1 ether * 1038750000000 / 1e12 = 1.03875 SOL
        let expected_supply = (1.03875 * LAMPORTS_PER_SOL as f64) as u64;
        assert_eq!(
            user_supply.supply, expected_supply,
            "User supply should be ~1.03875 SOL after 1 year (half of 7.75% = 3.875% interest)"
        );

        fixture
            .withdraw(&protocol, user_supply.supply, MintKey::USDC, &alice)
            .expect("Failed to withdraw full supply");

        let user_supply_after = fixture
            .get_user_supply_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user supply data after withdrawal");

        assert_eq!(
            user_supply_after.supply, 0,
            "Supply should be exactly 0 after withdrawing full amount"
        );
    }
}
