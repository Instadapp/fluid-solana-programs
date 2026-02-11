//! Liquidity Yield Tests - Rust port of TypeScript `liquidityYield.test.ts`.
//!
//! This module contains tests for yield/interest calculation in the liquidity program.

#[cfg(test)]
mod tests {
    use crate::liquidity::fixture::{LiquidityFixture, OverallTokenData, TokenReserveData};
    use fluid_test_framework::helpers::MintKey;
    use fluid_test_framework::prelude::*;
    use liquidity::state::{TokenConfig, UserBorrowConfig, UserSupplyConfig};

    const DEFAULT_BORROW_AMOUNT: u64 = 5 * 1_000_000; // 5 USDC (6 decimals)
    const PASS_1YEAR_TIME: i64 = time::YEAR; // 1 year
    const BASE_LIMIT: u64 = 5 * LAMPORTS_PER_SOL;

    fn setup_fixture() -> LiquidityFixture {
        let mut fixture = LiquidityFixture::new().expect("Failed to create fixture");
        fixture.setup().expect("Failed to setup fixture");
        fixture
    }

    fn assert_exchange_prices(
        fixture: &mut LiquidityFixture,
        expected_supply_exchange_price: u64,
        expected_borrow_exchange_price: u64,
    ) {
        let protocol = fixture.mock_protocol_with_interest.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(&protocol, DEFAULT_BORROW_AMOUNT, MintKey::USDC, &alice)
            .expect("Failed to deposit for exchange price assertion");

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get overall token data");

        assert_eq!(
            overall_data.supply_exchange_price, expected_supply_exchange_price,
            "Supply exchange price mismatch"
        );
        assert_eq!(
            overall_data.borrow_exchange_price, expected_borrow_exchange_price,
            "Borrow exchange price mismatch"
        );
    }

    fn setup_combination_fixture() -> LiquidityFixture {
        let mut fixture = setup_fixture();

        fixture
            .update_token_config_with_params(
                MintKey::USDC,
                TokenConfig {
                    token: MintKey::USDC.pubkey(),
                    fee: LiquidityFixture::DEFAULT_PERCENT_PRECISION * 5,
                    max_utilization: 10_000,
                },
            )
            .expect("Failed to update token config");

        let protocol_pubkey = fixture.mock_protocol.pubkey();

        fixture
            .update_user_supply_config_with_params(
                MintKey::USDC,
                &protocol_pubkey,
                UserSupplyConfig {
                    mode: 1,
                    expand_percent: LiquidityFixture::DEFAULT_EXPAND_WITHDRAWAL_LIMIT_PERCENT,
                    expand_duration: LiquidityFixture::DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION,
                    base_withdrawal_limit: BASE_LIMIT as u128,
                },
            )
            .expect("Failed to update user supply config");

        fixture
            .update_user_borrow_config_with_params(
                MintKey::USDC,
                &protocol_pubkey,
                UserBorrowConfig {
                    mode: 1,
                    expand_percent: LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_PERCENT,
                    expand_duration: LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION,
                    base_debt_ceiling: BASE_LIMIT as u128,
                    max_debt_ceiling: (20 * LAMPORTS_PER_SOL) as u128,
                },
            )
            .expect("Failed to update user borrow config");

        fixture
    }

    fn assert_close(actual: u64, expected: u64, tolerance: u64, label: &str) {
        let diff = actual.max(expected) - actual.min(expected);
        assert!(
            diff <= tolerance,
            "{label} mismatch: expected {expected}, got {actual}, tolerance {tolerance}"
        );
    }

    fn calc_borrow_limit(exchange_price: u128) -> u64 {
        ((BASE_LIMIT as u128 * exchange_price) / 1_000_000_000_000u128) as u64
    }

    #[derive(Clone, Copy)]
    struct AccountingSnapshot {
        supply_raw_interest: u64,
        supply_interest_free: u64,
        borrow_raw_interest: u64,
        borrow_interest_free: u64,
        supply_exchange_price: u64,
        borrow_exchange_price: u64,
    }

    #[derive(Debug)]
    struct AccountingResult {
        interest_paid_by_borrowers: u128,
        interest_received_by_suppliers: u128,
        accounting_error: i128,
        error_percentage: u128,
    }

    fn snapshot_from(data: &OverallTokenData) -> AccountingSnapshot {
        AccountingSnapshot {
            supply_raw_interest: data.supply_raw_interest,
            supply_interest_free: data.supply_interest_free,
            borrow_raw_interest: data.borrow_raw_interest,
            borrow_interest_free: data.borrow_interest_free,
            supply_exchange_price: data.supply_exchange_price,
            borrow_exchange_price: data.borrow_exchange_price,
        }
    }

    fn track_interest_accounting(
        before: &AccountingSnapshot,
        after_exchange_prices: (u64, u64),
    ) -> AccountingResult {
        let borrow_value_before = (before.borrow_raw_interest as u128
            * before.borrow_exchange_price as u128)
            / LiquidityFixture::EXCHANGE_PRICES_PRECISION as u128;
        let borrow_value_after = (before.borrow_raw_interest as u128
            * after_exchange_prices.1 as u128)
            / LiquidityFixture::EXCHANGE_PRICES_PRECISION as u128;
        let interest_paid = borrow_value_after.saturating_sub(borrow_value_before);

        let supply_value_before = (before.supply_raw_interest as u128
            * before.supply_exchange_price as u128)
            / LiquidityFixture::EXCHANGE_PRICES_PRECISION as u128;
        let supply_value_after = (before.supply_raw_interest as u128
            * after_exchange_prices.0 as u128)
            / LiquidityFixture::EXCHANGE_PRICES_PRECISION as u128;
        let interest_received = supply_value_after.saturating_sub(supply_value_before);

        let accounting_error = interest_received as i128 - interest_paid as i128;
        let error_percentage = if interest_paid == 0 {
            0
        } else {
            (accounting_error.abs().saturating_mul(10_000_i128) as u128) / interest_paid.max(1)
        };

        AccountingResult {
            interest_paid_by_borrowers: interest_paid,
            interest_received_by_suppliers: interest_received,
            accounting_error,
            error_percentage,
        }
    }

    fn calc_supply_rate_from_data(
        overall_data: &OverallTokenData,
        reserve: &TokenReserveData,
    ) -> u16 {
        if overall_data.supply_raw_interest == 0 {
            return 0;
        }
        let borrow_with_interest = (overall_data.borrow_raw_interest as u128
            * overall_data.borrow_exchange_price as u128)
            / LiquidityFixture::EXCHANGE_PRICES_PRECISION as u128;
        let supply_with_interest = (overall_data.supply_raw_interest as u128
            * overall_data.supply_exchange_price as u128)
            / LiquidityFixture::EXCHANGE_PRICES_PRECISION as u128;
        if supply_with_interest == 0 {
            return 0;
        }
        let numerator = overall_data.borrow_rate as u128
            * (10_000u128.saturating_sub(reserve.fee_on_interest as u128))
            * borrow_with_interest;
        let denominator = supply_with_interest * 10_000u128;
        (numerator / denominator) as u16
    }

    fn assert_supply_rate(
        fixture: &LiquidityFixture,
        overall_data: &OverallTokenData,
        expected: u16,
        message: &str,
    ) {
        let reserve = fixture
            .read_token_reserve(MintKey::USDC)
            .expect("Failed to read reserve");
        let actual = calc_supply_rate_from_data(overall_data, &reserve);
        assert_eq!(actual, expected, "{message}");
    }

    #[allow(clippy::too_many_arguments)]
    fn asset_state(
        fixture: &mut LiquidityFixture,
        expected_borrow_rate: u16,
        expected_supply_rate: u16,
        expected_supply_exchange_price: u64,
        expected_borrow_exchange_price: u64,
        expected_revenue: u64,
        expected_supply_raw_interest: u64,
        expected_supply_interest_free: u64,
        expected_borrow_raw_interest: u64,
        expected_borrow_interest_free: u64,
        expected_withdrawal_limit: u64,
        expected_borrow_limit: u64,
    ) {
        let mint = MintKey::USDC;
        let protocol_pubkey = fixture.mock_protocol.pubkey();
        let mut user_supply = fixture
            .get_user_supply_data(mint, &protocol_pubkey)
            .expect("Failed to get user supply data");
        let mut overall_data = fixture
            .get_overall_token_data(mint)
            .expect("Failed to get overall token data");

        assert_eq!(
            overall_data.borrow_rate, expected_borrow_rate,
            "Borrow rate mismatch"
        );
        let reserve = fixture
            .read_token_reserve(mint)
            .expect("Failed to read reserve for supply rate");
        let computed_supply_rate = calc_supply_rate_from_data(&overall_data, &reserve);
        assert_eq!(
            computed_supply_rate, expected_supply_rate,
            "Supply rate mismatch"
        );
        assert_eq!(
            overall_data.supply_exchange_price, expected_supply_exchange_price,
            "Supply exchange price mismatch"
        );
        assert_eq!(
            overall_data.borrow_exchange_price, expected_borrow_exchange_price,
            "Borrow exchange price mismatch"
        );
        assert_eq!(
            overall_data.supply_raw_interest, expected_supply_raw_interest,
            "Supply raw interest mismatch"
        );
        assert_eq!(
            overall_data.supply_interest_free, expected_supply_interest_free,
            "Supply interest free mismatch"
        );
        assert_eq!(
            overall_data.borrow_raw_interest, expected_borrow_raw_interest,
            "Borrow raw interest mismatch"
        );
        assert_eq!(
            overall_data.borrow_interest_free, expected_borrow_interest_free,
            "Borrow interest free mismatch"
        );
        let computed_total_supply = ((overall_data.supply_raw_interest as u128
            * overall_data.supply_exchange_price as u128)
            / LiquidityFixture::EXCHANGE_PRICES_PRECISION as u128)
            + overall_data.supply_interest_free as u128;
        assert_eq!(
            computed_total_supply as u64, overall_data.total_supply,
            "Total supply mismatch"
        );
        let computed_total_borrow = ((overall_data.borrow_raw_interest as u128
            * overall_data.borrow_exchange_price as u128)
            / LiquidityFixture::EXCHANGE_PRICES_PRECISION as u128)
            + overall_data.borrow_interest_free as u128;
        assert_eq!(
            computed_total_borrow as u64, overall_data.total_borrow,
            "Total borrow mismatch"
        );

        let liquidity_balance = fixture.balance_of(&fixture.get_liquidity(), mint) as u128;
        let computed_revenue = if computed_total_borrow + liquidity_balance > computed_total_supply
        {
            (computed_total_borrow + liquidity_balance - computed_total_supply) as u64
        } else {
            0
        };
        assert_eq!(computed_revenue, expected_revenue, "Revenue mismatch");
        assert!(
            computed_total_borrow + liquidity_balance
                >= computed_total_supply + computed_revenue as u128,
            "Revenue accounting inequality mismatch"
        );

        let protocol_interest_free = fixture.mock_protocol_interest_free.insecure_clone();
        let mut alice = fixture.alice.insecure_clone();

        fixture
            .deposit(&protocol_interest_free, 30 * LAMPORTS_PER_SOL, mint, &alice)
            .expect("Failed to deposit helper liquidity");

        user_supply = fixture
            .get_user_supply_data(mint, &protocol_pubkey)
            .expect("Failed to get user supply data after helper deposit");
        overall_data = fixture
            .get_overall_token_data(mint)
            .expect("Failed to get overall token data after helper deposit");

        assert_close(
            user_supply.withdrawal_limit,
            expected_withdrawal_limit,
            10,
            "withdrawal limit",
        );
        let expected_withdrawable = user_supply
            .supply
            .saturating_sub(user_supply.withdrawal_limit);
        assert_close(
            user_supply.withdrawable_until_limit,
            expected_withdrawable,
            10,
            "withdrawable until limit",
        );
        assert_close(
            user_supply.withdrawable,
            expected_withdrawable,
            10,
            "withdrawable",
        );

        if user_supply.supply > 0 && user_supply.withdrawable < user_supply.supply {
            let result = fixture.withdraw(
                &fixture.mock_protocol.insecure_clone(),
                user_supply.withdrawable + 5,
                mint,
                &alice,
            );
            assert!(result.is_err(), "Withdrawing beyond limit should revert");
        }

        if user_supply.withdrawable > 0 {
            let withdraw_amount = user_supply.withdrawable.saturating_sub(1);
            fixture
                .withdraw(
                    &fixture.mock_protocol.insecure_clone(),
                    withdraw_amount,
                    mint,
                    &alice,
                )
                .expect("Failed to withdraw within limit");
            fixture
                .deposit(
                    &fixture.mock_protocol.insecure_clone(),
                    withdraw_amount,
                    mint,
                    &alice,
                )
                .expect("Failed to re-deposit withdrawn amount");
        }

        let mut user_borrow = fixture
            .get_user_borrow_data(mint, &protocol_pubkey)
            .expect("Failed to get user borrow data");
        assert_eq!(
            user_borrow.borrow_limit, expected_borrow_limit,
            "Borrow limit mismatch"
        );
        assert_eq!(
            user_borrow.borrowable_until_limit,
            expected_borrow_limit.saturating_sub(user_borrow.borrow),
            "Borrowable until limit mismatch"
        );
        assert_eq!(
            user_borrow.borrowable,
            expected_borrow_limit.saturating_sub(user_borrow.borrow),
            "Borrowable mismatch"
        );

        let result = fixture.borrow(
            &fixture.mock_protocol.insecure_clone(),
            user_borrow.borrowable + 5,
            mint,
            &alice,
        );
        assert!(result.is_err(), "Borrowing past limit should revert");

        if user_borrow.borrowable > 1_000 {
            let borrowed_before = user_borrow.borrow;
            let borrow_amount = user_borrow.borrowable.saturating_sub(1);
            fixture
                .borrow(
                    &fixture.mock_protocol.insecure_clone(),
                    borrow_amount,
                    mint,
                    &alice,
                )
                .expect("Failed to borrow within limit");
            user_borrow = fixture
                .get_user_borrow_data(mint, &protocol_pubkey)
                .expect("Failed to get user borrow data after borrow");
            fixture
                .payback(
                    &fixture.mock_protocol.insecure_clone(),
                    user_borrow.borrow.saturating_sub(borrowed_before),
                    mint,
                    &alice,
                )
                .expect("Failed to payback borrowed amount");
        }

        fixture
            .withdraw(&protocol_interest_free, 30 * LAMPORTS_PER_SOL, mint, &alice)
            .expect("Failed to withdraw helper liquidity");

        let refreshed = fixture
            .get_overall_token_data(mint)
            .expect("Failed to get refreshed token data");
        assert_eq!(
            refreshed.supply_exchange_price, expected_supply_exchange_price,
            "Supply exchange price drifted"
        );
        assert_eq!(
            refreshed.borrow_exchange_price, expected_borrow_exchange_price,
            "Borrow exchange price drifted"
        );
    }

    /// Test: operate_ExchangePriceSupplyWithInterestOnly
    #[test]
    fn test_operate_exchange_price_supply_with_interest_only() {
        let mut fixture = setup_fixture();
        let protocol = fixture.mock_protocol_with_interest.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(
                &protocol,
                DEFAULT_BORROW_AMOUNT * 100,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit with interest");

        fixture
            .borrow(&protocol, DEFAULT_BORROW_AMOUNT, MintKey::USDC, &alice)
            .expect("Failed to borrow");

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to fetch token data");
        assert_supply_rate(&fixture, &overall_data, 4, "Supply rate should be 4");

        fixture.vm.warp_time(PASS_1YEAR_TIME);

        assert_exchange_prices(&mut fixture, 1_000_407_000_000, 1_040_700_000_000);
    }

    /// Test: operate_ExchangePriceSupplyInterestFreeOnly
    #[test]
    fn test_operate_exchange_price_supply_interest_free_only() {
        let mut fixture = setup_fixture();
        let interest_free_protocol = fixture.mock_protocol_interest_free.insecure_clone();
        let borrow_protocol = fixture.mock_protocol_with_interest.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(
                &interest_free_protocol,
                DEFAULT_BORROW_AMOUNT * 100,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit interest free");

        fixture
            .borrow(
                &borrow_protocol,
                DEFAULT_BORROW_AMOUNT,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow");

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get token data");
        assert_supply_rate(
            &fixture,
            &overall_data,
            0,
            "Supply rate should be 0 when only interest-free suppliers exist",
        );

        fixture.vm.warp_time(PASS_1YEAR_TIME);

        assert_exchange_prices(&mut fixture, 1_000_000_000_000, 1_040_700_000_000);
    }

    /// Test: operate_ExchangePriceNumberUpOnlyWhenNoStorageUpdate
    #[test]
    fn test_operate_exchange_price_number_up_only_when_no_storage_update() {
        let mut fixture = setup_fixture();
        let protocol = fixture.mock_protocol_with_interest.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(
                &protocol,
                DEFAULT_BORROW_AMOUNT * 100,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit");

        fixture
            .borrow(&protocol, DEFAULT_BORROW_AMOUNT, MintKey::USDC, &alice)
            .expect("Failed to borrow");

        fixture.vm.warp_time(PASS_1YEAR_TIME / 1_000);

        assert_exchange_prices(&mut fixture, 1_000_000_407_000, 1_000_040_700_000);
    }

    /// Test: operate_ExchangePriceWhenSupplyWithInterestBigger
    #[test]
    fn test_operate_exchange_price_when_supply_with_interest_bigger() {
        let mut fixture = setup_fixture();
        let protocol_with_interest = fixture.mock_protocol_with_interest.insecure_clone();
        let protocol_interest_free = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(
                &protocol_with_interest,
                DEFAULT_BORROW_AMOUNT * 80 / 100,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit with interest");

        fixture
            .deposit(
                &protocol_interest_free,
                DEFAULT_BORROW_AMOUNT * 20 / 100,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit interest free");

        fixture
            .borrow(
                &protocol_with_interest,
                DEFAULT_BORROW_AMOUNT,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow");

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to fetch token data");
        assert_supply_rate(
            &fixture,
            &overall_data,
            18_750,
            "Supply rate should be 187.5%",
        );

        fixture.vm.warp_time(PASS_1YEAR_TIME / 10);

        assert_exchange_prices(&mut fixture, 1_187_500_000_000, 1_150_000_000_000);
    }

    /// Test: operate_ExchangePriceWhenSupplyInterestFreeBigger
    #[test]
    fn test_operate_exchange_price_when_supply_interest_free_bigger() {
        let mut fixture = setup_fixture();
        let protocol_with_interest = fixture.mock_protocol_with_interest.insecure_clone();
        let protocol_interest_free = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(
                &protocol_with_interest,
                DEFAULT_BORROW_AMOUNT * 20,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit with interest");

        fixture
            .deposit(
                &protocol_interest_free,
                DEFAULT_BORROW_AMOUNT * 80,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit interest free");

        fixture
            .borrow(
                &protocol_with_interest,
                DEFAULT_BORROW_AMOUNT,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow");

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to fetch token data");
        assert_supply_rate(&fixture, &overall_data, 20, "Supply rate should be 20");

        fixture.vm.warp_time(PASS_1YEAR_TIME);

        assert_exchange_prices(&mut fixture, 1_002_035_000_000, 1_040_700_000_000);
    }

    /// Test: operate_ExchangePriceWhenSupplyWithInterestExactlySupplyInterestFree
    #[test]
    fn test_operate_exchange_price_when_supply_equal_split() {
        let mut fixture = setup_fixture();
        let protocol_with_interest = fixture.mock_protocol_with_interest.insecure_clone();
        let protocol_interest_free = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(
                &protocol_with_interest,
                DEFAULT_BORROW_AMOUNT * 50,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit with interest");

        fixture
            .deposit(
                &protocol_interest_free,
                DEFAULT_BORROW_AMOUNT * 50,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit interest free");

        fixture
            .borrow(
                &protocol_with_interest,
                DEFAULT_BORROW_AMOUNT,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow");

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to fetch token data");
        assert_supply_rate(&fixture, &overall_data, 8, "Supply rate should be 8");

        fixture.vm.warp_time(PASS_1YEAR_TIME);

        assert_exchange_prices(&mut fixture, 1_000_814_000_000, 1_040_700_000_000);
    }

    /// Test: operate_ExchangePriceWhenSupplyWithInterestBiggerWithRevenueFee
    #[test]
    fn test_operate_exchange_price_when_supply_with_interest_bigger_with_fee() {
        let mut fixture = setup_fixture();
        fixture
            .update_token_config_with_params(
                MintKey::USDC,
                TokenConfig {
                    token: MintKey::USDC.pubkey(),
                    fee: LiquidityFixture::DEFAULT_PERCENT_PRECISION * 10,
                    max_utilization: 10_000,
                },
            )
            .expect("Failed to update token config");

        let protocol_with_interest = fixture.mock_protocol_with_interest.insecure_clone();
        let protocol_interest_free = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(
                &protocol_with_interest,
                DEFAULT_BORROW_AMOUNT * 80,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit with interest");

        fixture
            .deposit(
                &protocol_interest_free,
                DEFAULT_BORROW_AMOUNT * 20,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit interest free");

        fixture
            .borrow(
                &protocol_with_interest,
                DEFAULT_BORROW_AMOUNT,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow");

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to fetch token data");
        assert_supply_rate(&fixture, &overall_data, 4, "Supply rate should be 4");

        fixture.vm.warp_time(PASS_1YEAR_TIME);

        assert_exchange_prices(&mut fixture, 1_000_457_875_000, 1_040_700_000_000);
    }

    /// Test: operate_ExchangePriceWhenSupplyInterestFreeBiggerWithRevenueFee
    #[test]
    fn test_operate_exchange_price_when_supply_interest_free_bigger_with_fee() {
        let mut fixture = setup_fixture();
        fixture
            .update_token_config_with_params(
                MintKey::USDC,
                TokenConfig {
                    token: MintKey::USDC.pubkey(),
                    fee: LiquidityFixture::DEFAULT_PERCENT_PRECISION * 10,
                    max_utilization: 10_000,
                },
            )
            .expect("Failed to update token config");

        let protocol_with_interest = fixture.mock_protocol_with_interest.insecure_clone();
        let protocol_interest_free = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(
                &protocol_with_interest,
                DEFAULT_BORROW_AMOUNT * 20,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit with interest");

        fixture
            .deposit(
                &protocol_interest_free,
                DEFAULT_BORROW_AMOUNT * 80,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit interest free");

        fixture
            .borrow(
                &protocol_with_interest,
                DEFAULT_BORROW_AMOUNT,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow");

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to fetch token data");
        assert_supply_rate(&fixture, &overall_data, 18, "Supply rate should be 18");

        fixture.vm.warp_time(PASS_1YEAR_TIME);

        assert_exchange_prices(&mut fixture, 1_001_831_500_000, 1_040_700_000_000);
    }

    /// Test: operate_ExchangePriceSequences
    #[test]
    fn test_operate_exchange_price_sequences() {
        let mut fixture = setup_fixture();
        let protocol = fixture.mock_protocol_with_interest.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(&protocol, DEFAULT_BORROW_AMOUNT * 10, MintKey::USDC, &alice)
            .expect("Failed to deposit");

        fixture
            .borrow(&protocol, DEFAULT_BORROW_AMOUNT, MintKey::USDC, &alice)
            .expect("Failed to borrow");

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to fetch token data");
        assert_supply_rate(&fixture, &overall_data, 47, "Supply rate should be 47");

        fixture.vm.warp_time(PASS_1YEAR_TIME);

        let mut expected_borrow: u128 = 1_047_500_000_000;
        let mut expected_supply: u128 = 1_004_750_000_000;

        assert_exchange_prices(&mut fixture, expected_supply as u64, expected_borrow as u64);

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to fetch token data after first deposit");
        assert_supply_rate(&fixture, &overall_data, 44, "Supply rate should be 44");

        fixture.vm.warp_time(PASS_1YEAR_TIME);

        expected_borrow = expected_borrow * (10_000 + 471) as u128 / 10_000u128;
        let supply_increase = (1_004_750_000_000u128 * 471u128 * 948u128) / 10_000u128 / 10_000u128;
        expected_supply = 1_004_750_000_000u128 + supply_increase;

        assert_exchange_prices(&mut fixture, expected_supply as u64, expected_borrow as u64);
    }

    /// Test: operate_ExchangePriceBorrowInterestFreeOnly
    #[test]
    fn test_operate_exchange_price_borrow_interest_free_only() {
        let mut fixture = setup_fixture();
        let protocol = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(
                &protocol,
                DEFAULT_BORROW_AMOUNT * 100,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit interest free");

        fixture
            .borrow(&protocol, DEFAULT_BORROW_AMOUNT, MintKey::USDC, &alice)
            .expect("Failed to borrow interest free");

        fixture.vm.warp_time(PASS_1YEAR_TIME);

        assert_exchange_prices(&mut fixture, 1_000_000_000_000, 1_000_000_000_000);
    }

    /// Test: operate_ExchangePriceWhenBorrowWithInterestBigger
    #[test]
    fn test_operate_exchange_price_when_borrow_with_interest_bigger() {
        let mut fixture = setup_fixture();
        let protocol_with_interest = fixture.mock_protocol_with_interest.insecure_clone();
        let protocol_interest_free = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(
                &protocol_with_interest,
                DEFAULT_BORROW_AMOUNT * 100,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit");

        fixture
            .borrow(
                &protocol_with_interest,
                DEFAULT_BORROW_AMOUNT * 8 / 10,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow with interest");

        fixture
            .borrow(
                &protocol_interest_free,
                DEFAULT_BORROW_AMOUNT * 2 / 10,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow interest free");

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get token data");
        assert_supply_rate(&fixture, &overall_data, 3, "Supply rate should be 3");

        fixture.vm.warp_time(PASS_1YEAR_TIME);

        assert_exchange_prices(&mut fixture, 1_000_325_600_000, 1_040_700_000_000);
    }

    /// Test: operate_ExchangePriceWhenBorrowInterestFreeBigger
    #[test]
    fn test_operate_exchange_price_when_borrow_interest_free_bigger() {
        let mut fixture = setup_fixture();
        let protocol_with_interest = fixture.mock_protocol_with_interest.insecure_clone();
        let protocol_interest_free = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(
                &protocol_with_interest,
                DEFAULT_BORROW_AMOUNT * 100,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit");

        fixture
            .borrow(
                &protocol_with_interest,
                DEFAULT_BORROW_AMOUNT * 2 / 10,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow with interest");

        fixture
            .borrow(
                &protocol_interest_free,
                DEFAULT_BORROW_AMOUNT * 8 / 10,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow interest free");

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get token data");
        assert_supply_rate(&fixture, &overall_data, 0, "Supply rate should be 0");

        fixture.vm.warp_time(PASS_1YEAR_TIME);

        assert_exchange_prices(&mut fixture, 1_000_081_400_000, 1_040_700_000_000);
    }

    /// Test: operate_ExchangePriceWhenBorrowWithInterestExactlyBorrowInterestFree
    #[test]
    fn test_operate_exchange_price_when_borrow_equal_split() {
        let mut fixture = setup_fixture();
        let protocol_with_interest = fixture.mock_protocol_with_interest.insecure_clone();
        let protocol_interest_free = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(
                &protocol_with_interest,
                DEFAULT_BORROW_AMOUNT * 100,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit");

        fixture
            .borrow(
                &protocol_with_interest,
                DEFAULT_BORROW_AMOUNT / 2,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow with interest");

        fixture
            .borrow(
                &protocol_interest_free,
                DEFAULT_BORROW_AMOUNT / 2,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow interest free");

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get token data");
        assert_supply_rate(&fixture, &overall_data, 2, "Supply rate should be 2");

        fixture.vm.warp_time(PASS_1YEAR_TIME);

        assert_exchange_prices(&mut fixture, 1_000_203_500_000, 1_040_700_000_000);
    }

    /// Test: operate_ExchangePriceWhenBorrowWithInterestBiggerWithRevenueFee
    #[test]
    fn test_operate_exchange_price_when_borrow_with_interest_bigger_with_fee() {
        let mut fixture = setup_fixture();
        fixture
            .update_token_config_with_params(
                MintKey::USDC,
                TokenConfig {
                    token: MintKey::USDC.pubkey(),
                    fee: LiquidityFixture::DEFAULT_PERCENT_PRECISION * 10,
                    max_utilization: 10_000,
                },
            )
            .expect("Failed to update token config");

        let protocol_with_interest = fixture.mock_protocol_with_interest.insecure_clone();
        let protocol_interest_free = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(
                &protocol_with_interest,
                DEFAULT_BORROW_AMOUNT * 100,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit");

        fixture
            .borrow(
                &protocol_with_interest,
                DEFAULT_BORROW_AMOUNT * 8 / 10,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow with interest");

        fixture
            .borrow(
                &protocol_interest_free,
                DEFAULT_BORROW_AMOUNT * 2 / 10,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow interest free");

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get token data");
        assert_supply_rate(&fixture, &overall_data, 2, "Supply rate should be 2");

        fixture.vm.warp_time(PASS_1YEAR_TIME);

        assert_exchange_prices(&mut fixture, 1_000_293_040_000, 1_040_700_000_000);
    }

    /// Test: operate_ExchangePriceWhenBorrowInterestFreeBiggerWithRevenueFee
    #[test]
    fn test_operate_exchange_price_when_borrow_interest_free_bigger_with_fee() {
        let mut fixture = setup_fixture();
        fixture
            .update_token_config_with_params(
                MintKey::USDC,
                TokenConfig {
                    token: MintKey::USDC.pubkey(),
                    fee: LiquidityFixture::DEFAULT_PERCENT_PRECISION * 10,
                    max_utilization: 10_000,
                },
            )
            .expect("Failed to update token config");

        let protocol_with_interest = fixture.mock_protocol_with_interest.insecure_clone();
        let protocol_interest_free = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(
                &protocol_with_interest,
                DEFAULT_BORROW_AMOUNT * 100,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit");

        fixture
            .borrow(
                &protocol_with_interest,
                DEFAULT_BORROW_AMOUNT * 2 / 10,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow with interest");

        fixture
            .borrow(
                &protocol_interest_free,
                DEFAULT_BORROW_AMOUNT * 8 / 10,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow interest free");

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get token data");
        assert_supply_rate(&fixture, &overall_data, 0, "Supply rate should be 0");

        fixture.vm.warp_time(PASS_1YEAR_TIME);

        assert_exchange_prices(&mut fixture, 1_000_073_260_000, 1_040_700_000_000);
    }

    /// Test: test_operate_YieldCombinationTest
    #[test]
    #[ignore]
    fn test_operate_yield_combination_test() {
        let mut fixture = setup_combination_fixture();
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        // Initial supply and tiny borrow
        fixture
            .deposit(&protocol, 4 * LAMPORTS_PER_SOL, MintKey::USDC, &alice)
            .expect("Failed to deposit initial supply");
        fixture
            .borrow(&protocol, 1_000_000, MintKey::USDC, &alice)
            .expect("Failed to borrow initial amount");

        let mut expected_supply_exchange_price: u128 = 1_000_000_000_000;
        let mut expected_borrow_exchange_price: u128 = 1_000_000_000_000;
        let mut expected_revenue: u64 = 0;
        let mut expected_supply_raw_interest: u64 = 4 * LAMPORTS_PER_SOL;
        let mut expected_borrow_raw_interest: u64 = 1_000_000;
        let mut expected_withdrawal_limit: u64 = 0;
        let mut expected_borrow_limit: u64 = BASE_LIMIT;

        asset_state(
            &mut fixture,
            400,
            0,
            expected_supply_exchange_price as u64,
            expected_borrow_exchange_price as u64,
            expected_revenue,
            expected_supply_raw_interest,
            0,
            expected_borrow_raw_interest,
            0,
            expected_withdrawal_limit,
            expected_borrow_limit,
        );

        // Half-year warp
        fixture
            .warp_with_exchange_price(MintKey::USDC, PASS_1YEAR_TIME / 2)
            .expect("Failed to warp half year");
        expected_supply_exchange_price = 1_000_003_800_002;
        expected_borrow_exchange_price = 1_020_000_000_000;
        expected_revenue = 4_800;
        expected_borrow_limit = calc_borrow_limit(expected_borrow_exchange_price);

        asset_state(
            &mut fixture,
            400,
            0,
            expected_supply_exchange_price as u64,
            expected_borrow_exchange_price as u64,
            expected_revenue,
            expected_supply_raw_interest,
            0,
            expected_borrow_raw_interest,
            0,
            expected_withdrawal_limit,
            expected_borrow_limit,
        );

        // Borrow and supply adjustments below kink 1
        let deposit_amount = 6 * LAMPORTS_PER_SOL - 4_000_015_200;
        fixture
            .deposit(&protocol, deposit_amount, MintKey::USDC, &alice)
            .expect("Failed to deposit for below kink 1");
        let borrow_amount = (12 * LAMPORTS_PER_SOL) / 10 - 1_020_000;
        fixture
            .borrow(&protocol, borrow_amount, MintKey::USDC, &alice)
            .expect("Failed to borrow for below kink 1");

        fixture
            .warp_with_exchange_price(MintKey::USDC, PASS_1YEAR_TIME / 10)
            .expect("Failed to warp 1/10 year");

        expected_supply_exchange_price = expected_supply_exchange_price * 1_001_045 / 1_000_000;
        expected_borrow_exchange_price = expected_borrow_exchange_price * 1_005_500 / 1_000_000;
        expected_revenue += 329_400;
        expected_withdrawal_limit =
            ((4_799_981_760u128 * expected_supply_exchange_price) / 1_000_000_000_000u128) as u64;
        expected_supply_raw_interest = 5_999_977_199;
        expected_borrow_raw_interest = 1_176_470_589;
        expected_borrow_limit = calc_borrow_limit(expected_borrow_exchange_price);

        asset_state(
            &mut fixture,
            550,
            104,
            expected_supply_exchange_price as u64,
            expected_borrow_exchange_price as u64,
            expected_revenue,
            expected_supply_raw_interest,
            0,
            expected_borrow_raw_interest,
            0,
            expected_withdrawal_limit,
            expected_borrow_limit,
        );

        // At kink 1
        let deposit_amount = (62 * LAMPORTS_PER_SOL) / 10 - 6_006_269_999;
        fixture
            .deposit(&protocol, deposit_amount, MintKey::USDC, &alice)
            .expect("Failed to deposit for kink 1");
        let borrow_amount = (496 * LAMPORTS_PER_SOL) / 100 - 1_206_600_000;
        fixture
            .borrow(&protocol, borrow_amount, MintKey::USDC, &alice)
            .expect("Failed to borrow for kink 1");

        fixture
            .warp_with_exchange_price(MintKey::USDC, PASS_1YEAR_TIME)
            .expect("Failed to warp 1 year");

        expected_supply_exchange_price = expected_supply_exchange_price * 1_076_000 / 1_000_000;
        expected_borrow_exchange_price = expected_borrow_exchange_price * 1_100_000 / 1_000_000;
        expected_revenue += 24_800_000;
        expected_withdrawal_limit = 5_336_960_000;
        expected_supply_raw_interest = 6_193_504_227;
        expected_borrow_raw_interest = 4_836_146_295;
        expected_borrow_limit = 6_547_200_002;

        asset_state(
            &mut fixture,
            1_000,
            760,
            expected_supply_exchange_price as u64,
            expected_borrow_exchange_price as u64,
            expected_revenue,
            expected_supply_raw_interest,
            0,
            expected_borrow_raw_interest,
            0,
            expected_withdrawal_limit,
            expected_borrow_limit,
        );

        // Above kink 1 (85% utilization)
        let deposit_amount = (75 * LAMPORTS_PER_SOL) / 10 - 6_671_200_000;
        fixture
            .deposit(&protocol, deposit_amount, MintKey::USDC, &alice)
            .expect("Failed to deposit above kink 1");
        let borrow_amount = (6_375 * LAMPORTS_PER_SOL) / 1_000 - 5_456_000_000;
        fixture
            .borrow(&protocol, borrow_amount, MintKey::USDC, &alice)
            .expect("Failed to borrow above kink 1");

        fixture
            .warp_with_exchange_price(MintKey::USDC, PASS_1YEAR_TIME / 3)
            .expect("Failed to warp 1/3 year");

        expected_supply_exchange_price = expected_supply_exchange_price * 1_121_125 / 1_000_000;
        expected_borrow_exchange_price = expected_borrow_exchange_price * 1_150_000 / 1_000_000;
        expected_revenue += 47_812_500;
        expected_withdrawal_limit = 6_726_749_999;
        expected_supply_raw_interest = 6_962_957_443;
        expected_borrow_raw_interest = 5_650_739_119;
        expected_borrow_limit = 8_797_500_002;

        asset_state(
            &mut fixture,
            4_500,
            3_633,
            expected_supply_exchange_price as u64,
            expected_borrow_exchange_price as u64,
            expected_revenue,
            expected_supply_raw_interest,
            0,
            expected_borrow_raw_interest,
            0,
            expected_withdrawal_limit,
            expected_borrow_limit,
        );

        // At kink 2 (90% utilization)
        let deposit_amount = (85 * LAMPORTS_PER_SOL) / 10 - 8_408_437_500;
        fixture
            .deposit(&protocol, deposit_amount, MintKey::USDC, &alice)
            .expect("Failed to deposit at kink 2");
        let borrow_amount = (765 * LAMPORTS_PER_SOL) / 100 - 7_331_249_990;
        fixture
            .borrow(&protocol, borrow_amount, MintKey::USDC, &alice)
            .expect("Failed to borrow at kink 2");

        fixture
            .warp_with_exchange_price(MintKey::USDC, PASS_1YEAR_TIME / 20)
            .expect("Failed to warp 1/20 year");

        expected_supply_exchange_price = expected_supply_exchange_price * 1_034_200 / 1_000_000;
        expected_borrow_exchange_price = expected_borrow_exchange_price * 1_040_000 / 1_000_000;
        expected_revenue += 15_300_000;
        expected_withdrawal_limit = 7_032_559_999;
        expected_supply_raw_interest = 7_038_779_589;
        expected_borrow_raw_interest = 5_896_423_438;
        expected_borrow_limit = 9_547_200_018;

        asset_state(
            &mut fixture,
            8_000,
            6_840,
            expected_supply_exchange_price as u64,
            expected_borrow_exchange_price as u64,
            expected_revenue,
            expected_supply_raw_interest,
            0,
            expected_borrow_raw_interest,
            0,
            expected_withdrawal_limit,
            expected_borrow_limit,
        );

        // Above kink 2 (92% utilization)
        let deposit_amount = (88 * LAMPORTS_PER_SOL) / 10 - 8_790_699_999;
        fixture
            .deposit(&protocol, deposit_amount, MintKey::USDC, &alice)
            .expect("Failed to deposit above kink 2");
        let borrow_amount = (8_096 * LAMPORTS_PER_SOL) / 1_000 - 7_956_000_000;
        fixture
            .borrow(&protocol, borrow_amount, MintKey::USDC, &alice)
            .expect("Failed to borrow above kink 2");

        fixture
            .warp_with_exchange_price(MintKey::USDC, PASS_1YEAR_TIME / 365)
            .expect("Failed to warp 1/365 year");

        expected_supply_exchange_price = expected_supply_exchange_price
            * 10_022_508_493_150_684u128
            / 10_000_000_000_000_000u128;
        expected_borrow_exchange_price = expected_borrow_exchange_price
            * 10_025_753_424_657_534u128
            / 10_000_000_000_000_000u128;
        expected_revenue += 1_042_498;
        expected_withdrawal_limit = 7_055_845_979;
        expected_supply_raw_interest = 7_046_226_168;
        expected_borrow_raw_interest = 6_000_181_519;
        expected_borrow_limit = 9_740_219_987;

        asset_state(
            &mut fixture,
            9_400,
            8_215,
            expected_supply_exchange_price as u64,
            expected_borrow_exchange_price as u64,
            expected_revenue,
            expected_supply_raw_interest,
            0,
            expected_borrow_raw_interest,
            0,
            expected_withdrawal_limit,
            expected_borrow_limit,
        );

        // Max utilization (100%)
        let deposit_amount = (96 * LAMPORTS_PER_SOL) / 10 - 8_819_807_473;
        fixture
            .deposit(&protocol, deposit_amount, MintKey::USDC, &alice)
            .expect("Failed to deposit at max utilization");
        let borrow_amount = (96 * LAMPORTS_PER_SOL) / 10 - 8_116_849_982;
        fixture
            .borrow(&protocol, borrow_amount, MintKey::USDC, &alice)
            .expect("Failed to borrow at max utilization");

        fixture
            .warp_with_exchange_price(MintKey::USDC, PASS_1YEAR_TIME / 10)
            .expect("Failed to warp 1/10 year");

        expected_supply_exchange_price = expected_supply_exchange_price * 1_142_500 / 1_000_000;
        expected_borrow_exchange_price = expected_borrow_exchange_price * 1_150_000 / 1_000_000;
        expected_revenue += 72_000_000;
        expected_withdrawal_limit = 8_774_399_999;
        expected_supply_raw_interest = 7_669_529_228;
        expected_borrow_raw_interest = 7_096_563_656;
        expected_borrow_limit = 13_248_000_014;

        asset_state(
            &mut fixture,
            15_000,
            14_250,
            expected_supply_exchange_price as u64,
            expected_borrow_exchange_price as u64,
            expected_revenue,
            expected_supply_raw_interest,
            0,
            expected_borrow_raw_interest,
            0,
            expected_withdrawal_limit,
            expected_borrow_limit,
        );

        // Utilization above 100%
        fixture
            .warp_with_exchange_price(MintKey::USDC, PASS_1YEAR_TIME)
            .expect("Failed to warp 1 year");

        expected_supply_exchange_price =
            expected_supply_exchange_price * 24_777_684_625u128 / 10_000_000_000u128;
        expected_borrow_exchange_price = expected_borrow_exchange_price * 25_455 / 10_000;
        expected_revenue += 853_115_999;
        expected_withdrawal_limit = 21_740_931_587;
        expected_supply_raw_interest = 7_669_529_227;
        expected_borrow_raw_interest = 7_096_563_657;
        expected_borrow_limit = 33_722_784_040;

        asset_state(
            &mut fixture,
            15_455,
            14_778,
            expected_supply_exchange_price as u64,
            expected_borrow_exchange_price as u64,
            expected_revenue,
            expected_supply_raw_interest,
            0,
            expected_borrow_raw_interest,
            0,
            expected_withdrawal_limit,
            expected_borrow_limit,
        );

        // Tighter borrow configuration
        fixture
            .update_user_borrow_config_with_params(
                MintKey::USDC,
                &protocol.pubkey(),
                UserBorrowConfig {
                    mode: 1,
                    expand_percent: LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_PERCENT,
                    expand_duration: LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION,
                    base_debt_ceiling: (2 * LAMPORTS_PER_SOL) as u128,
                    max_debt_ceiling: (5 * LAMPORTS_PER_SOL) as u128,
                },
            )
            .expect("Failed to update borrow config");

        let mut user_borrow = fixture
            .get_user_borrow_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to read borrow data");

        assert_eq!(
            user_borrow.borrow_limit,
            calc_borrow_limit(expected_borrow_exchange_price),
            "Borrow limit mismatch after config update"
        );
        assert_eq!(user_borrow.borrowable, 0, "Borrowable should be 0");
        assert_eq!(
            user_borrow.borrowable_until_limit, 0,
            "Borrowable until limit should be 0"
        );

        if user_borrow.borrowable.saturating_add(1) > 10 {
            let result = fixture.borrow(
                &protocol,
                user_borrow.borrowable.saturating_add(1),
                MintKey::USDC,
                &alice,
            );
            assert!(
                result.is_err(),
                "Borrowing beyond limit should revert after config update"
            );
        }

        // Payback down to 50% utilization
        let payback_amount = user_borrow.borrow.saturating_sub(13_588_082_249);
        fixture
            .payback(&protocol, payback_amount, MintKey::USDC, &alice)
            .expect("Failed to pay back to 50% utilization");

        expected_revenue += 1_538;
        expected_supply_raw_interest = 7_669_529_226;
        expected_borrow_raw_interest = 3_431_342_699;
        expected_borrow_limit = 16_305_698_699;

        asset_state(
            &mut fixture,
            775,
            368,
            expected_supply_exchange_price as u64,
            expected_borrow_exchange_price as u64,
            expected_revenue,
            expected_supply_raw_interest,
            0,
            expected_borrow_raw_interest,
            0,
            expected_withdrawal_limit,
            expected_borrow_limit,
        );
    }

    #[test]
    fn test_accounting_at_sixty_percent_utilization() {
        let mut fixture = setup_fixture();
        let protocol_with_interest = fixture.mock_protocol_with_interest.insecure_clone();
        let protocol_interest_free = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(
                &protocol_with_interest,
                80 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit interest-bearing supply");
        fixture
            .deposit(
                &protocol_interest_free,
                20 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit interest-free supply");
        fixture
            .borrow(
                &protocol_with_interest,
                50 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow interest-bearing");
        fixture
            .borrow(
                &protocol_interest_free,
                10 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow interest-free");

        let before = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to read token data");

        fixture.vm.warp_time(PASS_1YEAR_TIME);
        fixture
            .deposit(&protocol_interest_free, 1_000, MintKey::USDC, &alice)
            .expect("Failed to trigger exchange price update");

        let after = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to read token data after warp");

        let accounting = track_interest_accounting(
            &snapshot_from(&before),
            (after.supply_exchange_price, after.borrow_exchange_price),
        );

        assert!(
            accounting.interest_received_by_suppliers <= accounting.interest_paid_by_borrowers,
            "Suppliers should receive less than or equal to borrowers' payments when fee > 0"
        );
    }

    #[test]
    fn test_accounting_zero_fee_sixty_percent() {
        let mut fixture = setup_fixture();
        fixture
            .update_token_config_with_params(
                MintKey::USDC,
                TokenConfig {
                    token: MintKey::USDC.pubkey(),
                    fee: 0,
                    max_utilization: 10_000,
                },
            )
            .expect("Failed to set fee to zero");

        let protocol_with_interest = fixture.mock_protocol_with_interest.insecure_clone();
        let protocol_interest_free = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(
                &protocol_with_interest,
                80 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit interest-bearing supply");
        fixture
            .deposit(
                &protocol_interest_free,
                20 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit interest-free supply");
        fixture
            .borrow(
                &protocol_with_interest,
                50 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow interest-bearing");
        fixture
            .borrow(
                &protocol_interest_free,
                10 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow interest-free");

        let before = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to read token data");

        fixture.vm.warp_time(PASS_1YEAR_TIME);
        fixture
            .deposit(&protocol_interest_free, 1_000, MintKey::USDC, &alice)
            .expect("Failed to trigger exchange price update");

        let after = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to read token data after warp");

        let accounting = track_interest_accounting(
            &snapshot_from(&before),
            (after.supply_exchange_price, after.borrow_exchange_price),
        );

        assert!(
            accounting.accounting_error.abs() <= 10i128,
            "Accounting error should be negligible when fee is zero"
        );
    }

    #[test]
    fn test_accounting_zero_fee_full_utilization() {
        let mut fixture = setup_fixture();
        fixture
            .update_token_config_with_params(
                MintKey::USDC,
                TokenConfig {
                    token: MintKey::USDC.pubkey(),
                    fee: 0,
                    max_utilization: 10_000,
                },
            )
            .expect("Failed to set fee to zero");

        let protocol_with_interest = fixture.mock_protocol_with_interest.insecure_clone();
        let protocol_interest_free = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(
                &protocol_with_interest,
                80 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit interest-bearing supply");
        fixture
            .deposit(
                &protocol_interest_free,
                20 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit interest-free supply");
        fixture
            .borrow(
                &protocol_with_interest,
                80 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow interest-bearing");
        fixture
            .borrow(
                &protocol_interest_free,
                20 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow interest-free");

        let before = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to read token data");

        fixture.vm.warp_time(PASS_1YEAR_TIME);
        fixture
            .deposit(&protocol_interest_free, 1_000, MintKey::USDC, &alice)
            .expect("Failed to trigger exchange price update");

        let after = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to read token data after warp");

        let accounting = track_interest_accounting(
            &snapshot_from(&before),
            (after.supply_exchange_price, after.borrow_exchange_price),
        );

        assert!(
            accounting.accounting_error.abs() <= 10i128,
            "Accounting should balance at 0% fee"
        );
    }

    #[test]
    fn test_accounting_asymmetric_ratios() {
        let mut fixture = setup_fixture();
        fixture
            .update_token_config_with_params(
                MintKey::USDC,
                TokenConfig {
                    token: MintKey::USDC.pubkey(),
                    fee: 0,
                    max_utilization: 10_000,
                },
            )
            .expect("Failed to set fee to zero");

        let protocol_with_interest = fixture.mock_protocol_with_interest.insecure_clone();
        let protocol_interest_free = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(
                &protocol_with_interest,
                80 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit interest-bearing supply");
        fixture
            .deposit(
                &protocol_interest_free,
                20 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit interest-free supply");
        fixture
            .borrow(
                &protocol_with_interest,
                100 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow interest-bearing");

        let before = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to read token data");

        fixture.vm.warp_time(PASS_1YEAR_TIME);
        fixture
            .deposit(&protocol_interest_free, 1_000, MintKey::USDC, &alice)
            .expect("Failed to trigger exchange price update");

        let after = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to read token data after warp");

        let accounting = track_interest_accounting(
            &snapshot_from(&before),
            (after.supply_exchange_price, after.borrow_exchange_price),
        );

        assert!(
            accounting.accounting_error.abs() <= 10i128,
            "Accounting should balance even with asymmetric ratios"
        );

        let supply_growth = after.supply_exchange_price - before.supply_exchange_price;
        let borrow_growth = after.borrow_exchange_price - before.borrow_exchange_price;
        assert!(
            supply_growth > borrow_growth,
            "Supply exchange price should grow faster due to concentration"
        );
    }

    #[test]
    fn test_accounting_accumulates_over_operations() {
        let mut fixture = setup_fixture();
        fixture
            .update_token_config_with_params(
                MintKey::USDC,
                TokenConfig {
                    token: MintKey::USDC.pubkey(),
                    fee: 0,
                    max_utilization: 10_000,
                },
            )
            .expect("Failed to set fee to zero");

        let protocol_with_interest = fixture.mock_protocol_with_interest.insecure_clone();
        let protocol_interest_free = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        // Initial setup
        fixture
            .deposit(
                &protocol_with_interest,
                100 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit interest-bearing supply");
        fixture
            .deposit(
                &protocol_interest_free,
                50 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit interest-free supply");
        fixture
            .borrow(
                &protocol_with_interest,
                80 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow interest-bearing");
        fixture
            .borrow(
                &protocol_interest_free,
                20 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to borrow interest-free");

        let mut prev = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to read token data");

        // Operation 1: warp 30 days, add supply
        fixture.vm.warp_time(time::DAY * 30);
        fixture
            .deposit(
                &protocol_with_interest,
                50 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to deposit additional supply");
        let mut current = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to read token data after op1");
        let accounting1 = track_interest_accounting(
            &snapshot_from(&prev),
            (current.supply_exchange_price, current.borrow_exchange_price),
        );
        prev = current;

        // Operation 2: warp 60 days, add borrow
        fixture.vm.warp_time(60 * 24 * 60 * 60);
        fixture
            .borrow(
                &protocol_with_interest,
                30 * 1_000_000,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to add borrow in op2");
        current = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to read token data after op2");
        let accounting2 = track_interest_accounting(
            &snapshot_from(&prev),
            (current.supply_exchange_price, current.borrow_exchange_price),
        );

        let total_error = accounting1.accounting_error + accounting2.accounting_error;
        assert!(
            total_error.abs() <= 1_000i128,
            "Cumulative accounting error should remain small"
        );
    }
}
