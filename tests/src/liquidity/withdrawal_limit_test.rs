//! Liquidity Withdrawal Limit Tests - Rust port of TypeScript `withdrawalLimit.test.ts`.
//!
//! This module contains tests for withdrawal limit functionality.

#[cfg(test)]
mod tests {
    use std::cmp::max;

    use crate::liquidity::fixture::{LiquidityFixture, TokenReserveData, UserSupplyPositionData};
    use fluid_test_framework::helpers::MintKey;
    use fluid_test_framework::prelude::*;
    use liquidity::constants::FOUR_DECIMALS;
    use liquidity::state::{UserBorrowConfig, UserSupplyConfig};

    const BASE_WITHDRAW_LIMIT: u64 = LAMPORTS_PER_SOL / 2;
    const DEFAULT_SUPPLY_AMOUNT: u64 = LAMPORTS_PER_SOL;
    const DEFAULT_BORROW_AMOUNT: u64 = LAMPORTS_PER_SOL / 2;
    const BASE_BORROW_LIMIT: u64 = LAMPORTS_PER_SOL;
    const MAX_BORROW_LIMIT: u64 = 10 * LAMPORTS_PER_SOL;
    const WITHDRAWABLE_REVERT_THRESHOLD: u64 = 10;
    const LAMPORTS_U128: u128 = LAMPORTS_PER_SOL as u128;

    #[derive(Debug, Clone)]
    struct SupplySnapshot {
        supply: u64,
        withdrawal_limit: u64,
        withdrawable_until_limit: u64,
        withdrawable: u64,
    }

    #[test]
    fn test_operate_withdraw_exact_to_limit() {
        for with_interest in [true, false] {
            run_operate_withdraw_exact_to_limit(with_interest);
        }
    }

    #[test]
    fn test_operate_revert_if_withdraw_limit_reached() {
        for with_interest in [true, false] {
            run_operate_revert_if_withdraw_limit_reached(with_interest);
        }
    }

    #[test]
    fn test_operate_revert_if_withdraw_limit_reached_for_withdraw_and_borrow() {
        for with_interest in [true, false] {
            run_operate_revert_if_withdraw_limit_reached_for_withdraw_and_borrow(with_interest);
        }
    }

    #[test]
    fn test_operate_revert_if_withdraw_limit_reached_for_withdraw_and_payback() {
        for with_interest in [true, false] {
            run_operate_revert_if_withdraw_limit_reached_for_withdraw_and_payback(with_interest);
        }
    }

    #[test]
    fn test_operate_withdrawal_limit_instantly_expanded_on_deposit() {
        for with_interest in [true, false] {
            run_operate_withdrawal_limit_instantly_expanded_on_deposit(with_interest);
        }
    }

    #[test]
    fn test_operate_withdrawal_limit_shrinked_on_withdraw() {
        for with_interest in [true, false] {
            run_operate_withdrawal_limit_shrinked_on_withdraw(with_interest);
        }
    }

    #[test]
    fn test_operate_withdrawal_limit_expansion() {
        for with_interest in [true, false] {
            run_operate_withdrawal_limit_expansion(with_interest);
        }
    }

    #[test]
    fn test_operate_withdrawal_limit_sequence() {
        for with_interest in [true, false] {
            run_operate_withdrawal_limit_sequence(with_interest);
        }
    }

    #[test]
    fn test_operate_when_withdrawal_limit_expand_percent_increased() {
        for with_interest in [true, false] {
            run_operate_when_withdrawal_limit_expand_percent_increased(with_interest);
        }
    }

    #[test]
    fn test_operate_when_withdrawal_limit_expand_percent_decreased() {
        for with_interest in [true, false] {
            run_operate_when_withdrawal_limit_expand_percent_decreased(with_interest);
        }
    }

    fn run_operate_withdraw_exact_to_limit(with_interest: bool) {
        let mut fixture = setup_fixture_with_withdrawal_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let balance_before = fixture.balance_of(&alice.pubkey(), MintKey::USDC);
        let withdraw_amount = lamports("0.2");

        fixture
            .withdraw(&protocol, withdraw_amount, MintKey::USDC, &alice)
            .expect("Failed to withdraw exact limit");

        let balance_after = fixture.balance_of(&alice.pubkey(), MintKey::USDC);
        assert_eq!(
            balance_after - balance_before,
            withdraw_amount,
            "Alice should receive the withdrawn amount"
        );
    }

    fn run_operate_revert_if_withdraw_limit_reached(with_interest: bool) {
        let mut fixture = setup_fixture_with_withdrawal_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let snapshot = get_user_supply_snapshot(&fixture);
        assert_eq!(
            snapshot.withdrawal_limit,
            lamports("0.8"),
            "Expected fully expanded withdrawal limit of 0.8 SOL"
        );

        let withdraw_amount = lamports("0.2") + 1;
        let err = fixture
            .withdraw(&protocol, withdraw_amount, MintKey::USDC, &alice)
            .expect_err("Withdrawing above the limit should revert");
        assert_withdrawal_limit_error(err);
    }

    fn run_operate_revert_if_withdraw_limit_reached_for_withdraw_and_borrow(with_interest: bool) {
        let mut fixture = setup_fixture_with_withdrawal_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let withdraw_amount = lamports("0.2") + 1;
        let borrow_amount = lamports("0.1") as i128;
        let err = fixture
            .operate(
                &protocol,
                -(withdraw_amount as i128),
                borrow_amount,
                MintKey::USDC,
                &alice,
            )
            .expect_err("Combined withdraw+borrow should revert when exceeding limit");
        assert_withdrawal_limit_error(err);
    }

    fn run_operate_revert_if_withdraw_limit_reached_for_withdraw_and_payback(with_interest: bool) {
        let mut fixture = setup_fixture_with_withdrawal_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .borrow(&protocol, DEFAULT_BORROW_AMOUNT, MintKey::USDC, &alice)
            .expect("Initial borrow should succeed");

        let withdraw_amount = lamports("0.2") + 1;
        let payback_amount = -(lamports("0.1") as i128);
        let err = fixture
            .operate(
                &protocol,
                -(withdraw_amount as i128),
                payback_amount,
                MintKey::USDC,
                &alice,
            )
            .expect_err("Combined withdraw+payback should respect withdrawal limit");
        assert_withdrawal_limit_error(err);
    }

    fn run_operate_withdrawal_limit_instantly_expanded_on_deposit(with_interest: bool) {
        let mut fixture = setup_fixture_with_withdrawal_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let additional_deposit = DEFAULT_SUPPLY_AMOUNT * 10;
        fixture
            .deposit(&protocol, additional_deposit, MintKey::USDC, &alice)
            .expect("Additional deposit should succeed");

        let withdraw_amount = lamports("2.2");
        assert_withdrawal_limits(
            &mut fixture,
            lamports("11"),
            lamports("8.8"),
            lamports("2.2"),
            lamports("2.2"),
        );

        let balance_before = fixture.balance_of(&alice.pubkey(), MintKey::USDC);

        let err = fixture
            .withdraw(&protocol, withdraw_amount + 1, MintKey::USDC, &alice)
            .expect_err("Withdrawing above expanded limit should revert");
        assert_withdrawal_limit_error(err);

        fixture
            .withdraw(&protocol, withdraw_amount, MintKey::USDC, &alice)
            .expect("Withdrawing exact expanded amount should succeed");

        let balance_after = fixture.balance_of(&alice.pubkey(), MintKey::USDC);
        assert_eq!(
            balance_after - balance_before,
            withdraw_amount,
            "Alice should receive the exact expanded withdrawal amount"
        );
    }

    fn run_operate_withdrawal_limit_shrinked_on_withdraw(with_interest: bool) {
        let mut fixture = setup_fixture_with_withdrawal_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();
        let withdraw_amount = lamports("0.1");

        fixture
            .withdraw(&protocol, withdraw_amount, MintKey::USDC, &alice)
            .expect("Initial withdraw should succeed");

        let balance_before = fixture.balance_of(&alice.pubkey(), MintKey::USDC);
        let err = fixture
            .withdraw(&protocol, withdraw_amount + 1, MintKey::USDC, &alice)
            .expect_err("Withdrawing above remaining limit should revert");
        assert_withdrawal_limit_error(err);

        fixture
            .withdraw(&protocol, withdraw_amount, MintKey::USDC, &alice)
            .expect("Withdrawing remaining allowed amount should succeed");

        let balance_after = fixture.balance_of(&alice.pubkey(), MintKey::USDC);
        assert_eq!(
            balance_after - balance_before,
            withdraw_amount,
            "Alice should receive the exact remaining withdrawal amount"
        );
    }

    fn run_operate_withdrawal_limit_expansion(with_interest: bool) {
        let mut fixture = setup_fixture_with_withdrawal_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();
        let withdraw_amount = lamports("0.1");

        fixture
            .withdraw(&protocol, withdraw_amount, MintKey::USDC, &alice)
            .expect("Initial withdraw should succeed");

        let err = fixture
            .withdraw(&protocol, withdraw_amount + 1, MintKey::USDC, &alice)
            .expect_err("Withdrawing above remaining limit should revert");
        assert_withdrawal_limit_error(err);

        let warp_seconds = (LiquidityFixture::DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION / 10) as i64;
        fixture.vm.warp_time(warp_seconds);

        let snapshot = get_user_supply_snapshot(&fixture);
        assert_eq!(
            snapshot.withdrawal_limit,
            lamports("0.782"),
            "Withdrawal limit should expand to 0.782 SOL after 10% duration"
        );

        let balance_before = fixture.balance_of(&alice.pubkey(), MintKey::USDC);
        let new_withdraw_amount = lamports("0.9") - lamports("0.782");

        let err = fixture
            .withdraw(&protocol, new_withdraw_amount + 1, MintKey::USDC, &alice)
            .expect_err("Withdrawing above expanded limit should revert");
        assert_withdrawal_limit_error(err);

        fixture
            .withdraw(&protocol, new_withdraw_amount, MintKey::USDC, &alice)
            .expect("Withdrawing expanded amount should succeed");

        let balance_after = fixture.balance_of(&alice.pubkey(), MintKey::USDC);
        assert_eq!(
            balance_after - balance_before,
            new_withdraw_amount,
            "Alice should receive the expanded withdrawal amount"
        );
    }

    fn run_operate_withdrawal_limit_sequence(with_interest: bool) {
        let mut fixture = setup_fixture_with_withdrawal_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let protocol_interest_free = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();
        let protocol_pubkey = fixture.mock_protocol.pubkey();

        let base_limit = lamports("5") as u128;
        let supply_config = UserSupplyConfig {
            mode: if with_interest { 1 } else { 0 },
            expand_percent: LiquidityFixture::DEFAULT_EXPAND_WITHDRAWAL_LIMIT_PERCENT,
            expand_duration: LiquidityFixture::DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION,
            base_withdrawal_limit: base_limit,
        };
        fixture
            .update_user_supply_config_with_params(MintKey::USDC, &protocol_pubkey, supply_config)
            .expect("Failed to update supply config for sequence test");

        fixture
            .withdraw(&protocol, DEFAULT_SUPPLY_AMOUNT / 5, MintKey::USDC, &alice)
            .expect("Failed to withdraw initial portion");
        fixture
            .withdraw(
                &protocol,
                (DEFAULT_SUPPLY_AMOUNT / 5) * 4,
                MintKey::USDC,
                &alice,
            )
            .expect("Failed to withdraw remaining initial supply");

        fixture
            .deposit(
                &protocol_interest_free,
                DEFAULT_SUPPLY_AMOUNT,
                MintKey::USDC,
                &alice,
            )
            .expect("Seed deposit should succeed");

        assert_withdrawal_limits(&mut fixture, 0, 0, 0, 0);

        fixture
            .deposit(&protocol, DEFAULT_SUPPLY_AMOUNT, MintKey::USDC, &alice)
            .expect("Deposit of 1 SOL should succeed");
        assert_withdrawal_limits(&mut fixture, lamports("1"), 0, lamports("1"), lamports("1"));

        fixture
            .deposit(&protocol, lamports("4.5"), MintKey::USDC, &alice)
            .expect("Deposit of 4.5 SOL should succeed");
        assert_withdrawal_limits(
            &mut fixture,
            lamports("5.5"),
            lamports("4.4"),
            lamports("1.1"),
            lamports("1.1"),
        );

        fixture
            .deposit(&protocol, lamports("0.5"), MintKey::USDC, &alice)
            .expect("Deposit of 0.5 SOL should succeed");
        assert_withdrawal_limits(
            &mut fixture,
            lamports("6"),
            lamports("4.8"),
            lamports("1.2"),
            lamports("1.2"),
        );

        fixture
            .withdraw(&protocol, lamports("0.01"), MintKey::USDC, &alice)
            .expect("Withdraw of 0.01 SOL should succeed");
        assert_withdrawal_limits(
            &mut fixture,
            lamports("5.99"),
            lamports("4.8"),
            lamports("1.19"),
            lamports("1.19"),
        );

        fixture
            .vm
            .warp_time(LiquidityFixture::DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION as i64);
        assert_withdrawal_limits(
            &mut fixture,
            lamports("5.99"),
            lamports("4.792"),
            lamports("1.198"),
            lamports("1.198"),
        );

        fixture
            .deposit(&protocol, lamports("1.01"), MintKey::USDC, &alice)
            .expect("Deposit of 1.01 SOL should succeed");
        assert_withdrawal_limits(
            &mut fixture,
            lamports("7"),
            lamports("5.6"),
            lamports("1.4"),
            lamports("1.4"),
        );

        fixture
            .withdraw(&protocol, lamports("1.4"), MintKey::USDC, &alice)
            .expect("Withdraw of 1.4 SOL should succeed");
        assert_withdrawal_limits(&mut fixture, lamports("5.6"), lamports("5.6"), 0, 0);

        let warp_20_percent =
            (LiquidityFixture::DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION / 5) as i64;
        fixture.vm.warp_time(warp_20_percent);
        assert_withdrawal_limits(
            &mut fixture,
            lamports("5.6"),
            lamports("5.376"),
            lamports("0.224"),
            lamports("0.224"),
        );

        fixture
            .withdraw(&protocol, lamports("0.1"), MintKey::USDC, &alice)
            .expect("Withdraw of 0.1 SOL should succeed");
        assert_withdrawal_limits(
            &mut fixture,
            lamports("5.5"),
            lamports("5.376"),
            lamports("0.124"),
            lamports("0.124"),
        );

        fixture
            .vm
            .warp_time(LiquidityFixture::DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION as i64);
        assert_withdrawal_limits(
            &mut fixture,
            lamports("5.5"),
            lamports("4.4"),
            lamports("1.1"),
            lamports("1.1"),
        );

        fixture
            .withdraw(&protocol, lamports("0.51"), MintKey::USDC, &alice)
            .expect("Withdraw of 0.51 SOL should succeed");
        assert_withdrawal_limits(
            &mut fixture,
            lamports("4.99"),
            0,
            lamports("4.99"),
            lamports("4.99"),
        );

        fixture
            .withdraw(&protocol, lamports("4.99"), MintKey::USDC, &alice)
            .expect("Final withdraw should succeed");
        assert_withdrawal_limits(&mut fixture, 0, 0, 0, 0);
    }

    fn run_operate_when_withdrawal_limit_expand_percent_increased(with_interest: bool) {
        let mut fixture = setup_fixture_with_withdrawal_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();
        let protocol_pubkey = fixture.mock_protocol.pubkey();

        let additional_deposit = DEFAULT_SUPPLY_AMOUNT * 10;
        fixture
            .deposit(&protocol, additional_deposit, MintKey::USDC, &alice)
            .expect("Additional deposit should succeed");

        assert_withdrawal_limits(
            &mut fixture,
            lamports("11"),
            lamports("8.8"),
            lamports("2.2"),
            lamports("2.2"),
        );

        let supply_config = UserSupplyConfig {
            mode: if with_interest { 1 } else { 0 },
            expand_percent: 30 * 100,
            expand_duration: LiquidityFixture::DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION,
            base_withdrawal_limit: BASE_WITHDRAW_LIMIT as u128,
        };
        fixture
            .update_user_supply_config_with_params(MintKey::USDC, &protocol_pubkey, supply_config)
            .expect("Failed to update supply config with increased percent");

        assert_withdrawal_limits(
            &mut fixture,
            lamports("11"),
            lamports("8.8"),
            lamports("2.2"),
            lamports("2.2"),
        );

        let warp_seconds = (LiquidityFixture::DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION / 10) as i64;
        fixture.vm.warp_time(warp_seconds);
        assert_withdrawal_limits(
            &mut fixture,
            lamports("11"),
            lamports("8.47"),
            lamports("2.53"),
            lamports("2.53"),
        );

        fixture
            .vm
            .warp_time(LiquidityFixture::DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION as i64);
        assert_withdrawal_limits(
            &mut fixture,
            lamports("11"),
            lamports("7.7"),
            lamports("3.3"),
            lamports("3.3"),
        );

        fixture
            .withdraw(&protocol, lamports("2.3"), MintKey::USDC, &alice)
            .expect("Withdraw of 2.3 SOL should succeed");
        assert_withdrawal_limits(
            &mut fixture,
            lamports("8.7"),
            lamports("7.7"),
            lamports("1"),
            lamports("1"),
        );
    }

    fn run_operate_when_withdrawal_limit_expand_percent_decreased(with_interest: bool) {
        let mut fixture = setup_fixture_with_withdrawal_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();
        let protocol_pubkey = fixture.mock_protocol.pubkey();

        let additional_deposit = DEFAULT_SUPPLY_AMOUNT * 10;
        fixture
            .deposit(&protocol, additional_deposit, MintKey::USDC, &alice)
            .expect("Additional deposit should succeed");

        assert_withdrawal_limits(
            &mut fixture,
            lamports("11"),
            lamports("8.8"),
            lamports("2.2"),
            lamports("2.2"),
        );

        let supply_config = UserSupplyConfig {
            mode: if with_interest { 1 } else { 0 },
            expand_percent: 10 * 100,
            expand_duration: LiquidityFixture::DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION,
            base_withdrawal_limit: BASE_WITHDRAW_LIMIT as u128,
        };
        fixture
            .update_user_supply_config_with_params(MintKey::USDC, &protocol_pubkey, supply_config)
            .expect("Failed to update supply config with decreased percent");

        assert_withdrawal_limits(
            &mut fixture,
            lamports("11"),
            lamports("9.9"),
            lamports("1.1"),
            lamports("1.1"),
        );
    }

    fn setup_fixture_with_withdrawal_limits(with_interest: bool) -> LiquidityFixture {
        let mut fixture = LiquidityFixture::new().expect("Failed to create fixture");
        fixture.setup().expect("Failed to setup fixture");

        let protocol_pubkey = fixture.mock_protocol.pubkey();
        let supply_config = UserSupplyConfig {
            mode: if with_interest { 1 } else { 0 },
            expand_percent: LiquidityFixture::DEFAULT_EXPAND_WITHDRAWAL_LIMIT_PERCENT,
            expand_duration: LiquidityFixture::DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION,
            base_withdrawal_limit: BASE_WITHDRAW_LIMIT as u128,
        };
        fixture
            .update_user_supply_config_with_params(MintKey::USDC, &protocol_pubkey, supply_config)
            .expect("Failed to update user supply config");

        let borrow_config = UserBorrowConfig {
            mode: if with_interest { 1 } else { 0 },
            expand_percent: LiquidityFixture::DEFAULT_EXPAND_WITHDRAWAL_LIMIT_PERCENT,
            expand_duration: LiquidityFixture::DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION,
            base_debt_ceiling: BASE_BORROW_LIMIT as u128,
            max_debt_ceiling: MAX_BORROW_LIMIT as u128,
        };
        fixture
            .update_user_borrow_config_with_params(MintKey::USDC, &protocol_pubkey, borrow_config)
            .expect("Failed to update user borrow config");

        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();
        fixture
            .deposit(&protocol, DEFAULT_SUPPLY_AMOUNT, MintKey::USDC, &alice)
            .expect("Initial deposit should succeed");

        fixture
    }

    fn assert_withdrawal_limits(
        fixture: &mut LiquidityFixture,
        expected_supply: u64,
        expected_withdrawal_limit: u64,
        expected_withdrawable_until_limit: u64,
        expected_withdrawable: u64,
    ) {
        let snapshot = get_user_supply_snapshot(fixture);

        assert_eq!(
            snapshot.supply, expected_supply,
            "Unexpected user supply amount"
        );
        assert_eq!(
            snapshot.withdrawal_limit, expected_withdrawal_limit,
            "Unexpected withdrawal limit"
        );
        assert_eq!(
            snapshot.withdrawable_until_limit, expected_withdrawable_until_limit,
            "Unexpected withdrawable until limit"
        );
        assert_eq!(
            snapshot.withdrawable, expected_withdrawable,
            "Unexpected withdrawable amount"
        );

        if snapshot.supply > 0
            && snapshot.withdrawable < snapshot.supply
            && snapshot.withdrawable + 1 > WITHDRAWABLE_REVERT_THRESHOLD
        {
            expect_withdraw_limit_revert(fixture, snapshot.withdrawable + 1);
        }

        if snapshot.withdrawable > 0 {
            withdraw_and_redeposit(fixture, snapshot.withdrawable);
        }
    }

    fn get_user_supply_snapshot(fixture: &LiquidityFixture) -> SupplySnapshot {
        let protocol_pubkey = fixture.mock_protocol.pubkey();
        let position = fixture
            .read_user_supply_position(MintKey::USDC, &protocol_pubkey)
            .expect("Failed to read user supply position");
        let reserve = fixture
            .read_token_reserve(MintKey::USDC)
            .expect("Failed to read token reserve");

        let current_timestamp = fixture.vm.clock().unix_timestamp as u64;
        let (withdrawal_limit_raw, supply_raw) =
            calc_withdrawal_limit_for_position(&position, current_timestamp);

        let (supply, withdrawal_limit) =
            convert_with_exchange_price(&position, &reserve, supply_raw, withdrawal_limit_raw);

        let withdrawable_until_limit = supply.saturating_sub(withdrawal_limit);
        let liquidity_balance = fixture.balance_of(&fixture.get_liquidity(), MintKey::USDC);
        let withdrawable = withdrawable_until_limit.min(liquidity_balance);

        SupplySnapshot {
            supply,
            withdrawal_limit,
            withdrawable_until_limit,
            withdrawable,
        }
    }

    fn calc_withdrawal_limit_for_position(
        position: &UserSupplyPositionData,
        current_timestamp: u64,
    ) -> (u128, u128) {
        let supply = position.supply;
        let last_limit = position.previous_limit;
        if last_limit == 0 {
            return (0, supply);
        }

        let max_withdrawable = supply
            .saturating_mul(position.expand_percent)
            .saturating_div(FOUR_DECIMALS);

        let elapsed = (current_timestamp.saturating_sub(position.last_update_timestamp)) as u128;
        let duration = max(position.expand_duration, 1);
        let withdrawable_amount = max_withdrawable
            .saturating_mul(elapsed)
            .saturating_div(duration);

        let mut current_limit = last_limit.saturating_sub(withdrawable_amount);
        let minimum_limit = supply.saturating_sub(max_withdrawable);
        if minimum_limit > current_limit {
            current_limit = minimum_limit;
        }

        (current_limit, supply)
    }

    fn convert_with_exchange_price(
        position: &UserSupplyPositionData,
        reserve: &TokenReserveData,
        supply_raw: u128,
        withdrawal_limit_raw: u128,
    ) -> (u64, u64) {
        if position.mode == 0 {
            return (supply_raw as u64, withdrawal_limit_raw as u64);
        }

        let exchange_price = reserve.supply_exchange_price as u128;
        let precision = LiquidityFixture::EXCHANGE_PRICES_PRECISION as u128;

        let supply = supply_raw
            .saturating_mul(exchange_price)
            .saturating_div(precision) as u64;
        let withdrawal_limit = withdrawal_limit_raw
            .saturating_mul(exchange_price)
            .saturating_div(precision) as u64;

        (supply, withdrawal_limit)
    }

    fn expect_withdraw_limit_revert(fixture: &mut LiquidityFixture, amount: u64) {
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();
        let err = fixture
            .withdraw(&protocol, amount, MintKey::USDC, &alice)
            .expect_err("Withdrawing above limit should revert");
        assert_withdrawal_limit_error(err);
    }

    fn withdraw_and_redeposit(fixture: &mut LiquidityFixture, amount: u64) {
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();
        fixture
            .withdraw(&protocol, amount, MintKey::USDC, &alice)
            .expect("Withdraw within limit should succeed");
        fixture
            .deposit(&protocol, amount, MintKey::USDC, &alice)
            .expect("Re-deposit should restore state");
    }

    fn lamports(input: &str) -> u64 {
        let trimmed = input.trim();
        if let Some(dot) = trimmed.find('.') {
            let int_part = if dot == 0 { "0" } else { &trimmed[..dot] };
            let frac_part = &trimmed[dot + 1..];
            let int_value: u64 = if int_part.is_empty() {
                0
            } else {
                int_part.parse().expect("Invalid integer part")
            };
            let frac_value: u64 = if frac_part.is_empty() {
                0
            } else {
                frac_part.parse().expect("Invalid fractional part")
            };
            let scale = 10u64.pow(frac_part.len() as u32);
            let lamports_int = LAMPORTS_U128 * int_value as u128;
            let lamports_frac = (LAMPORTS_U128 * frac_value as u128) / scale as u128;
            (lamports_int + lamports_frac) as u64
        } else {
            let int_value: u64 = trimmed.parse().expect("Invalid amount");
            LAMPORTS_PER_SOL * int_value
        }
    }

    fn assert_withdrawal_limit_error<E: Into<VmError>>(err: E) {
        let vm_error: VmError = err.into();
        let err_str = vm_error.to_string();
        assert!(
            err_str.contains("WithdrawalLimitReached")
                || err_str.contains("USER_MODULE_WITHDRAWAL_LIMIT_REACHED")
                || err_str.contains("6026"),
            "Expected WithdrawalLimitReached error, got {err_str}"
        );
    }
}
