//! Liquidity Borrow Limit Tests - Rust port of TypeScript `borrowLimit.test.ts`.
//!
//! This module contains tests for borrow limit functionality.

#[cfg(test)]
mod tests {
    use crate::liquidity::fixture::LiquidityFixture;
    use fluid_test_framework::helpers::MintKey;
    use fluid_test_framework::prelude::*;
    use liquidity::state::{RateDataV1Params, TokenConfig, UserBorrowConfig, UserSupplyConfig};
    use solana_sdk::{pubkey::Pubkey, signature::Keypair};

    const BASE_BORROW_LIMIT: u64 = LAMPORTS_PER_SOL;
    const MAX_BORROW_LIMIT: u64 = 10 * LAMPORTS_PER_SOL;
    const DEFAULT_SUPPLY_AMOUNT: u64 = LAMPORTS_PER_SOL;
    const DEFAULT_BORROW_AMOUNT: u64 = LAMPORTS_PER_SOL / 2;
    const ASSERT_TOLERANCE: u64 = 1_000_000;
    const LARGE_TOLERANCE: u64 = 10_000_000;
    const BORROWABLE_ASSERT_THRESHOLD: u64 = 10;
    const BORROWABLE_EXECUTE_THRESHOLD: u64 = 1_000;
    const DAY: i64 = 24 * 60 * 60;

    #[test]
    fn test_operate_borrow_exact_to_limit() {
        for with_interest in [true, false] {
            run_operate_borrow_exact_to_limit(with_interest);
        }
    }

    #[test]
    fn test_operate_borrow_base_and_max_limit_very_close() {
        for with_interest in [true, false] {
            run_operate_borrow_base_and_max_limit_very_close(with_interest);
        }
    }

    #[test]
    fn test_operate_borrow_exact_to_max_limit_rounded_to_above() {
        for with_interest in [true, false] {
            run_operate_borrow_exact_to_max_limit_rounded_to_above(with_interest);
        }
    }

    #[test]
    fn test_operate_revert_if_borrow_limit_reached() {
        for with_interest in [true, false] {
            run_operate_revert_if_borrow_limit_reached(with_interest);
        }
    }

    #[test]
    fn test_operate_revert_if_borrow_limit_reached_for_supply_and_borrow() {
        for with_interest in [true, false] {
            run_operate_revert_if_borrow_limit_reached_for_supply_and_borrow(with_interest);
        }
    }

    #[test]
    fn test_operate_revert_if_borrow_limit_reached_for_withdraw_and_borrow() {
        for with_interest in [true, false] {
            run_operate_revert_if_borrow_limit_reached_for_withdraw_and_borrow(with_interest);
        }
    }

    #[test]
    fn test_operate_revert_if_borrow_limit_max_utilization_reached() {
        for with_interest in [true, false] {
            run_operate_revert_if_borrow_limit_max_utilization_reached(with_interest);
        }
    }

    #[test]
    fn test_operate_revert_if_borrow_limit_default_max_utilization_reached() {
        for with_interest in [true, false] {
            run_operate_revert_if_borrow_limit_default_max_utilization_reached(with_interest);
        }
    }

    #[test]
    fn test_operate_revert_if_max_utilization_one() {
        for with_interest in [true, false] {
            run_operate_revert_if_max_utilization_one(with_interest);
        }
    }

    #[test]
    fn test_operate_borrow_limit_sequence() {
        for with_interest in [true, false] {
            run_operate_borrow_limit_sequence(with_interest);
        }
    }

    #[test]
    fn test_operate_when_borrow_limit_expand_percent_increased() {
        for with_interest in [true, false] {
            run_operate_when_borrow_limit_expand_percent_increased(with_interest);
        }
    }

    #[test]
    fn test_operate_when_borrow_limit_expand_percent_decreased() {
        for with_interest in [true, false] {
            run_operate_when_borrow_limit_expand_percent_decreased(with_interest);
        }
    }

    fn run_operate_borrow_exact_to_limit(with_interest: bool) {
        let mut fixture = setup_fixture_with_borrow_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let balance_before = fixture.balance_of(&alice.pubkey(), MintKey::USDC);
        fixture
            .borrow(&protocol, BASE_BORROW_LIMIT, MintKey::USDC, &alice)
            .expect("Borrowing to base limit should succeed");
        let balance_after = fixture.balance_of(&alice.pubkey(), MintKey::USDC);

        assert_eq!(
            balance_after - balance_before,
            BASE_BORROW_LIMIT,
            "Borrowing to base limit should credit Alice"
        );
    }

    fn run_operate_borrow_base_and_max_limit_very_close(with_interest: bool) {
        let mut fixture = setup_fixture_with_borrow_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let protocol_pubkey = protocol.pubkey();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(&protocol, lamports("20"), MintKey::USDC, &alice)
            .expect("Depositing 20 SOL should succeed");

        let borrow_config = UserBorrowConfig {
            mode: if with_interest { 1 } else { 0 },
            expand_percent: LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_PERCENT,
            expand_duration: LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION,
            base_debt_ceiling: lamports("9.9") as u128,
            max_debt_ceiling: lamports("10") as u128,
        };
        fixture
            .update_user_borrow_config_with_params(MintKey::USDC, &protocol_pubkey, borrow_config)
            .expect("Failed to update borrow config");

        let err = fixture
            .borrow(&protocol, lamports("10.01"), MintKey::USDC, &alice)
            .expect_err("Borrowing above max limit should revert");
        assert_borrow_limit_error(err);

        let err = fixture
            .borrow(&protocol, lamports("9.91"), MintKey::USDC, &alice)
            .expect_err("Borrowing slightly above base limit should revert");
        assert_borrow_limit_error(err);

        fixture
            .borrow(&protocol, lamports("9.9"), MintKey::USDC, &alice)
            .expect("Borrowing to base limit should succeed");

        let err = fixture
            .borrow(&protocol, lamports("0.03"), MintKey::USDC, &alice)
            .expect_err("Borrowing more before expansion should revert");
        assert_borrow_limit_error(err);

        fixture.vm.warp_time(2 * DAY);

        let err = fixture
            .borrow(&protocol, lamports("0.12"), MintKey::USDC, &alice)
            .expect_err("Borrowing beyond expansion tolerance should revert");
        assert_borrow_limit_error(err);

        fixture
            .borrow(&protocol, lamports("0.1"), MintKey::USDC, &alice)
            .expect("Borrowing remaining allowance should succeed");

        let err = fixture
            .borrow(&protocol, lamports("0.03"), MintKey::USDC, &alice)
            .expect_err("Borrowing above hard cap should revert");
        assert_borrow_limit_error(err);

        fixture.vm.warp_time(2 * DAY);

        let err = fixture
            .borrow(&protocol, lamports("0.03"), MintKey::USDC, &alice)
            .expect_err("Borrowing above hard cap after more time should revert");
        assert_borrow_limit_error(err);
    }

    fn run_operate_borrow_exact_to_max_limit_rounded_to_above(with_interest: bool) {
        let mut fixture = setup_fixture_with_borrow_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let protocol_pubkey = protocol.pubkey();
        let alice = fixture.alice.insecure_clone();

        let borrow_config = UserBorrowConfig {
            mode: if with_interest { 1 } else { 0 },
            expand_percent: LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_PERCENT,
            expand_duration: LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION,
            base_debt_ceiling: BASE_BORROW_LIMIT as u128,
            max_debt_ceiling: BASE_BORROW_LIMIT as u128,
        };
        fixture
            .update_user_borrow_config_with_params(MintKey::USDC, &protocol_pubkey, borrow_config)
            .expect("Failed to update borrow config");

        fixture
            .borrow(&protocol, BASE_BORROW_LIMIT, MintKey::USDC, &alice)
            .expect("Borrowing to capped limit should succeed");

        let snapshot = fixture
            .get_user_borrow_data(MintKey::USDC, &protocol_pubkey)
            .expect("Failed to read borrow data");
        assert_eq!(snapshot.borrow_limit, BASE_BORROW_LIMIT);
        assert_eq!(snapshot.max_borrow_limit, BASE_BORROW_LIMIT);
        assert_eq!(snapshot.borrowable_until_limit, 0);
        assert_eq!(snapshot.borrowable, 0);

        for _ in 0..2 {
            let err = fixture
                .borrow(&protocol, 10, MintKey::USDC, &alice)
                .expect_err("Borrowing anything extra should revert");
            assert_borrow_limit_error(err);
        }
    }

    fn run_operate_revert_if_borrow_limit_reached(with_interest: bool) {
        let mut fixture = setup_fixture_with_borrow_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let err = fixture
            .borrow(&protocol, BASE_BORROW_LIMIT + 1, MintKey::USDC, &alice)
            .expect_err("Borrowing above limit should revert");
        assert_borrow_limit_error(err);
    }

    fn run_operate_revert_if_borrow_limit_reached_for_supply_and_borrow(with_interest: bool) {
        let mut fixture = setup_fixture_with_borrow_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let err = fixture
            .operate(
                &protocol,
                DEFAULT_SUPPLY_AMOUNT as i128,
                (BASE_BORROW_LIMIT + 1) as i128,
                MintKey::USDC,
                &alice,
            )
            .expect_err("Operate supply+borrow above limit should revert");
        assert_borrow_limit_error(err);
    }

    fn run_operate_revert_if_borrow_limit_reached_for_withdraw_and_borrow(with_interest: bool) {
        let mut fixture = setup_fixture_with_borrow_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let withdraw_amount = -(DEFAULT_SUPPLY_AMOUNT as i128 / 10); // -0.1 SOL
        let err = fixture
            .operate(
                &protocol,
                withdraw_amount,
                (BASE_BORROW_LIMIT + 1) as i128,
                MintKey::USDC,
                &alice,
            )
            .expect_err("Operate withdraw+borrow above limit should revert");
        assert_borrow_limit_error(err);
    }

    fn run_operate_revert_if_borrow_limit_max_utilization_reached(with_interest: bool) {
        let mut fixture = setup_fixture_with_borrow_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let token_config = TokenConfig {
            token: MintKey::USDC.pubkey(),
            fee: 0,
            max_utilization: 1,
        };
        fixture
            .update_token_config_with_params(MintKey::USDC, token_config)
            .expect("Failed to update token config");

        let err = fixture
            .borrow(&protocol, BASE_BORROW_LIMIT - 1_000, MintKey::USDC, &alice)
            .expect_err("Borrow should revert when max utilization reached");
        assert_max_utilization_error(err);
    }

    fn run_operate_revert_if_borrow_limit_default_max_utilization_reached(with_interest: bool) {
        let mut fixture = setup_fixture_with_borrow_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let protocol_pubkey = protocol.pubkey();
        let alice = fixture.alice.insecure_clone();

        let borrow_config = UserBorrowConfig {
            mode: if with_interest { 1 } else { 0 },
            expand_percent: LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_PERCENT,
            expand_duration: LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION,
            base_debt_ceiling: lamports("3") as u128,
            max_debt_ceiling: MAX_BORROW_LIMIT as u128,
        };
        fixture
            .update_user_borrow_config_with_params(MintKey::USDC, &protocol_pubkey, borrow_config)
            .expect("Failed to update borrow config");

        let err = fixture
            .borrow(&protocol, lamports("2"), MintKey::USDC, &alice)
            .expect_err("Borrow should revert when utilization guard triggers");
        assert_max_utilization_error(err);
    }

    fn run_operate_revert_if_max_utilization_one(with_interest: bool) {
        let mut fixture = setup_fixture_with_borrow_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let token_config = TokenConfig {
            token: MintKey::USDC.pubkey(),
            fee: 0,
            max_utilization: 1,
        };
        fixture
            .update_token_config_with_params(MintKey::USDC, token_config)
            .expect("Failed to update token config");

        let err = fixture
            .borrow(&protocol, DEFAULT_SUPPLY_AMOUNT, MintKey::USDC, &alice)
            .expect_err("Borrow should revert when max utilization is 1%");
        assert_max_utilization_error(err);
    }

    fn run_operate_borrow_limit_sequence(with_interest: bool) {
        let mut fixture = setup_fixture_with_borrow_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let protocol_pubkey = protocol.pubkey();
        let protocol_interest_free = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let base_limit = lamports("5");
        let max_limit = lamports("7");
        let half_expanded_limit_with_rounding = 5_500_004_629u64;

        let borrow_config = UserBorrowConfig {
            mode: if with_interest { 1 } else { 0 },
            expand_percent: LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_PERCENT,
            expand_duration: LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION,
            base_debt_ceiling: base_limit as u128,
            max_debt_ceiling: max_limit as u128,
        };
        fixture
            .update_user_borrow_config_with_params(MintKey::USDC, &protocol_pubkey, borrow_config)
            .expect("Failed to update borrow config");

        fixture
            .update_rate_data_v1_with_params(
                MintKey::USDC,
                RateDataV1Params {
                    kink: 9_999,
                    rate_at_utilization_zero: 0,
                    rate_at_utilization_kink: 1,
                    rate_at_utilization_max: 2,
                },
            )
            .expect("Failed to update rate data");

        fixture
            .withdraw(&protocol, DEFAULT_SUPPLY_AMOUNT, MintKey::USDC, &alice)
            .expect("Initial withdraw should reset supply");

        fixture
            .deposit(
                &protocol_interest_free,
                DEFAULT_SUPPLY_AMOUNT,
                MintKey::USDC,
                &alice,
            )
            .expect("Seed deposit on interest-free protocol should succeed");
        fixture
            .borrow(
                &protocol_interest_free,
                DEFAULT_BORROW_AMOUNT,
                MintKey::USDC,
                &alice,
            )
            .expect("Seed borrow on interest-free protocol should succeed");

        fixture
            .deposit(&protocol, lamports("20"), MintKey::USDC, &alice)
            .expect("Alice should deposit 20 SOL");

        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            0,
            base_limit,
            base_limit,
            base_limit,
            0,
        );

        let mut user_borrow = lamports("4.18");
        fixture
            .borrow(&protocol, user_borrow, MintKey::USDC, &alice)
            .expect("Borrow of 4.18 SOL should succeed");
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            user_borrow,
            base_limit,
            base_limit - user_borrow,
            base_limit - user_borrow,
            user_borrow,
        );

        fixture.vm.warp_time(2 * DAY);
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            user_borrow,
            lamports("5.016"),
            lamports("5.016") - user_borrow,
            lamports("5.016") - user_borrow,
            user_borrow,
        );

        let borrow_amount = lamports("0.82");
        fixture
            .borrow(&protocol, borrow_amount, MintKey::USDC, &alice)
            .expect("Borrow to total 5 SOL should succeed");
        user_borrow += borrow_amount;
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            user_borrow,
            lamports("5.016"),
            lamports("5.016") - user_borrow,
            lamports("5.016") - user_borrow,
            lamports("5"),
        );

        let half_duration =
            (LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION / 2) as i64 - 2_764;
        fixture.vm.warp_time(half_duration);
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            user_borrow,
            lamports("5.5"),
            lamports("5.5") - user_borrow,
            lamports("5.5") - user_borrow,
            lamports("5"),
        );

        let borrow_amount = lamports("0.5");
        fixture
            .borrow(&protocol, borrow_amount, MintKey::USDC, &alice)
            .expect("Borrow to 5.5 SOL should succeed");
        user_borrow += borrow_amount;
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            user_borrow,
            lamports("5.5"),
            half_expanded_limit_with_rounding - user_borrow,
            half_expanded_limit_with_rounding - user_borrow,
            lamports("5.5"),
        );

        fixture
            .payback(&protocol, lamports("0.01"), MintKey::USDC, &alice)
            .expect("Payback 0.01 SOL should succeed");
        user_borrow -= lamports("0.01");
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            user_borrow,
            lamports("5.5"),
            half_expanded_limit_with_rounding - user_borrow,
            half_expanded_limit_with_rounding - user_borrow,
            lamports("5.49"),
        );

        fixture.vm.warp_time(2 * DAY);
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            user_borrow,
            lamports("6.588"),
            lamports("6.588") - user_borrow,
            lamports("6.588") - user_borrow,
            lamports("5.49"),
        );

        let borrow_amount = lamports("1.01");
        fixture
            .borrow(&protocol, borrow_amount, MintKey::USDC, &alice)
            .expect("Borrow to 6.5 SOL should succeed");
        user_borrow += borrow_amount;
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            user_borrow,
            lamports("6.588"),
            lamports("6.588") - user_borrow,
            lamports("6.588") - user_borrow,
            lamports("6.5"),
        );

        fixture.vm.warp_time(2 * DAY);
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            user_borrow,
            max_limit,
            max_limit - user_borrow,
            max_limit - user_borrow,
            lamports("6.5"),
        );

        let borrow_amount = max_limit.saturating_sub(user_borrow).saturating_sub(5);
        fixture
            .borrow(&protocol, borrow_amount, MintKey::USDC, &alice)
            .expect("Borrowing to exact max should succeed");
        user_borrow = max_limit;
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            user_borrow,
            max_limit,
            0,
            0,
            max_limit,
        );

        fixture.vm.warp_time(2 * DAY);
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            user_borrow,
            max_limit,
            0,
            0,
            max_limit,
        );

        let err = fixture
            .borrow(&protocol, 1_000, MintKey::USDC, &alice)
            .expect_err("Borrow beyond hard cap should revert");
        assert_borrow_limit_error(err);

        let payback_to = lamports("5.5");
        fixture
            .payback(&protocol, user_borrow - payback_to, MintKey::USDC, &alice)
            .expect("Payback down to 5.5 SOL should succeed");
        user_borrow = payback_to;
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            user_borrow,
            lamports("6.6"),
            lamports("1.1"),
            lamports("1.1"),
            lamports("5.5"),
        );

        fixture
            .payback(&protocol, user_borrow, MintKey::USDC, &alice)
            .expect("Final payback should succeed");
        user_borrow = 0;
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            user_borrow,
            base_limit,
            base_limit,
            base_limit,
            0,
        );
    }

    fn run_operate_when_borrow_limit_expand_percent_increased(with_interest: bool) {
        let mut fixture = setup_fixture_with_borrow_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let protocol_pubkey = protocol.pubkey();
        let alice = fixture.alice.insecure_clone();

        fixture
            .update_rate_data_v1_with_params(
                MintKey::USDC,
                RateDataV1Params {
                    kink: 8_000,
                    rate_at_utilization_zero: 50,
                    rate_at_utilization_kink: 80,
                    rate_at_utilization_max: 100,
                },
            )
            .expect("Failed to update rate data");

        fixture
            .deposit(&protocol, DEFAULT_SUPPLY_AMOUNT * 10, MintKey::USDC, &alice)
            .expect("Additional deposit should succeed");

        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            0,
            BASE_BORROW_LIMIT,
            BASE_BORROW_LIMIT,
            BASE_BORROW_LIMIT,
            0,
        );

        fixture
            .borrow(&protocol, lamports("0.95"), MintKey::USDC, &alice)
            .expect("Borrow to 0.95 SOL should succeed");
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            lamports("0.95"),
            BASE_BORROW_LIMIT,
            raw_lamports("49799117"),
            raw_lamports("49799117"),
            lamports("0.95"),
        );

        let half_duration = (LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION / 2) as i64;
        fixture.vm.warp_time(half_duration);
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            raw_lamports("950013794"),
            raw_lamports("1094815015"),
            raw_lamports("144817524"),
            raw_lamports("144817524"),
            raw_lamports("950013794"),
        );

        let borrow_config = UserBorrowConfig {
            mode: if with_interest { 1 } else { 0 },
            expand_percent: 30 * LiquidityFixture::DEFAULT_PERCENT_PRECISION,
            expand_duration: LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION,
            base_debt_ceiling: BASE_BORROW_LIMIT as u128,
            max_debt_ceiling: MAX_BORROW_LIMIT as u128,
        };
        fixture
            .update_user_borrow_config_with_params(MintKey::USDC, &protocol_pubkey, borrow_config)
            .expect("Failed to update borrow config");

        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            raw_lamports("950013794"),
            raw_lamports("1094815015"),
            raw_lamports("144817524"),
            raw_lamports("144817524"),
            raw_lamports("950013794"),
        );

        let quarter_duration = (LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION / 4) as i64;
        fixture.vm.warp_time(quarter_duration);
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            raw_lamports("950013794"),
            raw_lamports("1166073480"),
            raw_lamports("216053823"),
            raw_lamports("216053823"),
            raw_lamports("950013794"),
        );

        let snapshot = fixture
            .get_user_borrow_data(MintKey::USDC, &protocol_pubkey)
            .expect("Failed to read borrow data");
        let borrow_amount = snapshot.borrowable.saturating_sub(1);
        fixture
            .borrow(&protocol, borrow_amount, MintKey::USDC, &alice)
            .expect("Borrowing to limit should succeed");
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            raw_lamports("1166074514"),
            raw_lamports("1166074514"),
            0,
            0,
            raw_lamports("1166074514"),
        );

        fixture
            .vm
            .warp_time((LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION + 1) as i64);
        let snapshot = fixture
            .get_user_borrow_data(MintKey::USDC, &protocol_pubkey)
            .expect("Failed to read snapshot after warp");
        assert_close(
            snapshot.borrow,
            raw_lamports("1166074514"),
            LARGE_TOLERANCE,
            "borrow",
        );
        assert_close(
            snapshot.borrow_limit,
            raw_lamports("1515896869"),
            LARGE_TOLERANCE,
            "borrow_limit",
        );
        assert_close(
            snapshot.borrowable,
            raw_lamports("349815045"),
            LARGE_TOLERANCE,
            "borrowable",
        );

        let borrow_config = UserBorrowConfig {
            mode: if with_interest { 1 } else { 0 },
            expand_percent: 50 * LiquidityFixture::DEFAULT_PERCENT_PRECISION,
            expand_duration: LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION,
            base_debt_ceiling: BASE_BORROW_LIMIT as u128,
            max_debt_ceiling: MAX_BORROW_LIMIT as u128,
        };
        fixture
            .update_user_borrow_config_with_params(MintKey::USDC, &protocol_pubkey, borrow_config)
            .expect("Failed to update borrow config to 50%");
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            raw_lamports("1166074514"),
            raw_lamports("1749111772"),
            raw_lamports("583054189"),
            raw_lamports("583054189"),
            raw_lamports("1166074514"),
        );

        let borrow_config = UserBorrowConfig {
            mode: if with_interest { 1 } else { 0 },
            expand_percent: 80 * LiquidityFixture::DEFAULT_PERCENT_PRECISION,
            expand_duration: LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION,
            base_debt_ceiling: BASE_BORROW_LIMIT as u128,
            max_debt_ceiling: lamports("1.8") as u128,
        };
        fixture
            .update_user_borrow_config_with_params(MintKey::USDC, &protocol_pubkey, borrow_config)
            .expect("Failed to update borrow config to 80%");

        fixture
            .vm
            .warp_time((LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION + 1) as i64);
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            raw_lamports("1166074514"),
            raw_lamports("1799231744"),
            raw_lamports("633183365"),
            raw_lamports("633183365"),
            raw_lamports("1166074514"),
        );
    }

    fn run_operate_when_borrow_limit_expand_percent_decreased(with_interest: bool) {
        let mut fixture = setup_fixture_with_borrow_limits(with_interest);
        let protocol = fixture.mock_protocol.insecure_clone();
        let protocol_pubkey = protocol.pubkey();
        let alice = fixture.alice.insecure_clone();

        fixture
            .update_rate_data_v1_with_params(
                MintKey::USDC,
                RateDataV1Params {
                    kink: 8_000,
                    rate_at_utilization_zero: 50,
                    rate_at_utilization_kink: 80,
                    rate_at_utilization_max: 100,
                },
            )
            .expect("Failed to update rate data");

        fixture
            .deposit(&protocol, DEFAULT_SUPPLY_AMOUNT * 10, MintKey::USDC, &alice)
            .expect("Additional deposit should succeed");

        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            0,
            BASE_BORROW_LIMIT,
            BASE_BORROW_LIMIT,
            BASE_BORROW_LIMIT,
            0,
        );

        fixture
            .borrow(&protocol, lamports("0.95"), MintKey::USDC, &alice)
            .expect("Borrow to 0.95 SOL should succeed");
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            lamports("0.95"),
            BASE_BORROW_LIMIT,
            raw_lamports("49799117"),
            raw_lamports("49799117"),
            lamports("0.95"),
        );

        let half_duration = (LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION / 2) as i64;
        fixture.vm.warp_time(half_duration);
        let snapshot = fixture
            .get_user_borrow_data(MintKey::USDC, &protocol_pubkey)
            .expect("Failed to read half expansion snapshot");
        assert_close(snapshot.borrow, lamports("0.95"), LARGE_TOLERANCE, "borrow");
        assert_close(
            snapshot.borrow_limit,
            raw_lamports("1094815014"),
            LARGE_TOLERANCE,
            "borrow_limit",
        );
        assert_close(
            snapshot.borrowable,
            raw_lamports("144817524"),
            LARGE_TOLERANCE,
            "borrowable",
        );

        let borrow_config = UserBorrowConfig {
            mode: if with_interest { 1 } else { 0 },
            expand_percent: 15 * LiquidityFixture::DEFAULT_PERCENT_PRECISION,
            expand_duration: LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION,
            base_debt_ceiling: BASE_BORROW_LIMIT as u128,
            max_debt_ceiling: MAX_BORROW_LIMIT as u128,
        };
        fixture
            .update_user_borrow_config_with_params(MintKey::USDC, &protocol_pubkey, borrow_config)
            .expect("Failed to update borrow config to 15%");

        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            lamports("0.95"),
            raw_lamports("1071049117"),
            raw_lamports("121049117"),
            raw_lamports("121049117"),
            lamports("0.95"),
        );

        let tenth_duration = (LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION / 10) as i64;
        fixture.vm.warp_time(tenth_duration);
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            raw_lamports("950013794"),
            raw_lamports("1085299117"),
            raw_lamports("135315062"),
            raw_lamports("135315062"),
            raw_lamports("950013794"),
        );

        let snapshot = fixture
            .get_user_borrow_data(MintKey::USDC, &protocol_pubkey)
            .expect("Failed to read borrow data");
        fixture
            .borrow(&protocol, snapshot.borrowable, MintKey::USDC, &alice)
            .expect("Borrowing to decreased limit should succeed");
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            raw_lamports("1085299117"),
            raw_lamports("1085299117"),
            0,
            0,
            raw_lamports("1085299117"),
        );

        fixture
            .vm
            .warp_time((LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION + 1) as i64);
        let snapshot = fixture
            .get_user_borrow_data(MintKey::USDC, &protocol_pubkey)
            .expect("Failed to read snapshot after warp");
        assert_close(
            snapshot.borrow,
            raw_lamports("1085299117"),
            LARGE_TOLERANCE,
            "borrow",
        );
        assert_close(
            snapshot.borrow_limit,
            raw_lamports("1248093985"),
            LARGE_TOLERANCE,
            "borrow_limit",
        );
        assert_close(
            snapshot.borrowable,
            raw_lamports("162794868"),
            LARGE_TOLERANCE,
            "borrowable",
        );

        let borrow_config = UserBorrowConfig {
            mode: if with_interest { 1 } else { 0 },
            expand_percent: 10 * LiquidityFixture::DEFAULT_PERCENT_PRECISION,
            expand_duration: LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION,
            base_debt_ceiling: BASE_BORROW_LIMIT as u128,
            max_debt_ceiling: MAX_BORROW_LIMIT as u128,
        };
        fixture
            .update_user_borrow_config_with_params(MintKey::USDC, &protocol_pubkey, borrow_config)
            .expect("Failed to update borrow config to 10%");
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            raw_lamports("1085299117"),
            raw_lamports("1193829029"),
            raw_lamports("108529912"),
            raw_lamports("108529912"),
            raw_lamports("1085299117"),
        );

        let borrow_config = UserBorrowConfig {
            mode: if with_interest { 1 } else { 0 },
            expand_percent: 10 * LiquidityFixture::DEFAULT_PERCENT_PRECISION,
            expand_duration: LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION,
            base_debt_ceiling: BASE_BORROW_LIMIT as u128,
            max_debt_ceiling: raw_lamports("1153829029") as u128,
        };
        fixture
            .update_user_borrow_config_with_params(MintKey::USDC, &protocol_pubkey, borrow_config)
            .expect("Failed to update borrow config with hard cap");
        assert_borrow_limits(
            &mut fixture,
            &protocol,
            &alice,
            &protocol_pubkey,
            raw_lamports("1085299117"),
            raw_lamports("1152975077"),
            raw_lamports("67675960"),
            raw_lamports("67675960"),
            raw_lamports("1085299117"),
        );
    }

    fn setup_fixture_with_borrow_limits(with_interest: bool) -> LiquidityFixture {
        let mut fixture = LiquidityFixture::new().expect("Failed to create fixture");
        fixture.setup().expect("Failed to setup fixture");

        let protocol_pubkey = fixture.mock_protocol.pubkey();
        let mode = if with_interest { 1 } else { 0 };

        let supply_config = UserSupplyConfig {
            mode,
            expand_percent: LiquidityFixture::DEFAULT_EXPAND_WITHDRAWAL_LIMIT_PERCENT,
            expand_duration: LiquidityFixture::DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION,
            base_withdrawal_limit: LiquidityFixture::DEFAULT_BASE_WITHDRAWAL_LIMIT,
        };
        fixture
            .update_user_supply_config_with_params(MintKey::USDC, &protocol_pubkey, supply_config)
            .expect("Failed to update supply config");

        let borrow_config = UserBorrowConfig {
            mode,
            expand_percent: LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_PERCENT,
            expand_duration: LiquidityFixture::DEFAULT_EXPAND_DEBT_CEILING_DURATION,
            base_debt_ceiling: BASE_BORROW_LIMIT as u128,
            max_debt_ceiling: MAX_BORROW_LIMIT as u128,
        };
        fixture
            .update_user_borrow_config_with_params(MintKey::USDC, &protocol_pubkey, borrow_config)
            .expect("Failed to update borrow config");

        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();
        fixture
            .deposit(&protocol, DEFAULT_SUPPLY_AMOUNT, MintKey::USDC, &alice)
            .expect("Initial deposit should succeed");

        fixture
    }

    #[allow(clippy::too_many_arguments)]
    fn assert_borrow_limits(
        fixture: &mut LiquidityFixture,
        protocol: &Keypair,
        alice: &Keypair,
        protocol_pubkey: &Pubkey,
        expected_borrow: u64,
        expected_borrow_limit: u64,
        expected_borrowable_until_limit: u64,
        expected_borrowable: u64,
        reset_to_borrow_amount: u64,
    ) {
        let snapshot = fixture
            .get_user_borrow_data(MintKey::USDC, protocol_pubkey)
            .expect("Failed to fetch user borrow data");

        assert_close(snapshot.borrow, expected_borrow, ASSERT_TOLERANCE, "borrow");
        assert_close(
            snapshot.borrow_limit,
            expected_borrow_limit,
            ASSERT_TOLERANCE,
            "borrow_limit",
        );
        assert_close(
            snapshot.borrowable_until_limit,
            expected_borrowable_until_limit,
            ASSERT_TOLERANCE,
            "borrowable_until_limit",
        );
        assert_close(
            snapshot.borrowable,
            expected_borrowable,
            ASSERT_TOLERANCE,
            "borrowable",
        );

        if snapshot.borrowable > BORROWABLE_ASSERT_THRESHOLD {
            let actual_borrowable = measure_actual_borrowable(
                fixture,
                protocol,
                alice,
                MintKey::USDC,
                snapshot
                    .borrow_limit
                    .saturating_sub(snapshot.borrow)
                    .saturating_add(ASSERT_TOLERANCE),
            );
            assert_close(
                actual_borrowable,
                expected_borrowable,
                ASSERT_TOLERANCE,
                "actual_borrowable",
            );

            let attempt = actual_borrowable.saturating_add(5);
            let revert_snapshot = fixture.vm.snapshot();
            let result = fixture.borrow(protocol, attempt, MintKey::USDC, alice);
            fixture
                .vm
                .revert(revert_snapshot)
                .expect("failed to revert borrow attempt snapshot");
            fixture.vm.delete_snapshot(revert_snapshot);

            if result.is_ok() {
                panic!("Borrowing above borrowable unexpectedly succeeded");
            } else {
                assert_borrow_limit_error(result.err().unwrap());
            }
        }

        if snapshot.borrowable > BORROWABLE_EXECUTE_THRESHOLD {
            let borrow_amount = snapshot.borrowable;
            if fixture
                .borrow(protocol, borrow_amount, MintKey::USDC, alice)
                .is_err()
            {
                let reduced = borrow_amount.saturating_sub(1);
                fixture
                    .borrow(protocol, reduced, MintKey::USDC, alice)
                    .expect("Borrowing borrowable - 1 should succeed");
            }

            let updated_snapshot = fixture
                .get_user_borrow_data(MintKey::USDC, protocol_pubkey)
                .expect("Failed to fetch snapshot after borrow");
            let repay_amount = updated_snapshot
                .borrow
                .saturating_sub(reset_to_borrow_amount);
            if repay_amount > 0 {
                fixture
                    .payback(protocol, repay_amount, MintKey::USDC, alice)
                    .expect("Payback should succeed");
            }
        }
    }

    const LAMPORTS_U128: u128 = LAMPORTS_PER_SOL as u128;

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

    fn raw_lamports(input: &str) -> u64 {
        input
            .parse::<u64>()
            .unwrap_or_else(|_| panic!("Invalid lamports string: {input}"))
    }

    fn assert_close(actual: u64, expected: u64, tolerance: u64, label: &str) {
        let diff = if actual > expected {
            actual - expected
        } else {
            expected - actual
        };
        assert!(
            diff <= tolerance,
            "{label} mismatch. expected {expected}, got {actual}, diff {diff} > tol {tolerance}"
        );
    }

    fn assert_borrow_limit_error<E: Into<VmError>>(err: E) {
        let vm_error: VmError = err.into();
        let err_str = vm_error.to_string();
        assert!(
            err_str.contains("BorrowLimitReached")
                || err_str.contains("USER_MODULE_BORROW_LIMIT_REACHED")
                || err_str.contains("6025"),
            "Expected borrow limit error, got {err_str}"
        );
    }

    fn assert_max_utilization_error<E: Into<VmError>>(err: E) {
        let vm_error: VmError = err.into();
        let err_str = vm_error.to_string();
        assert!(
            err_str.contains("MaxUtilizationReached")
                || err_str.contains("USER_MODULE_MAX_UTILIZATION_REACHED")
                || err_str.contains("6024"),
            "Expected max utilization error, got {err_str}"
        );
    }

    fn measure_actual_borrowable(
        fixture: &mut LiquidityFixture,
        protocol: &Keypair,
        alice: &Keypair,
        mint: MintKey,
        upper_bound: u64,
    ) -> u64 {
        let base_snapshot = fixture.vm.snapshot();
        let mut low = 0u64;
        let mut high = upper_bound;
        let mut best = 0u64;

        while low <= high {
            let mid = low + (high - low) / 2;
            let attempt_snapshot = fixture.vm.snapshot();
            let success = fixture.borrow(protocol, mid, mint, alice).is_ok();
            fixture
                .vm
                .revert(attempt_snapshot)
                .expect("failed to revert attempt snapshot");
            fixture.vm.delete_snapshot(attempt_snapshot);

            if success {
                best = mid;
                if mid == u64::MAX {
                    break;
                }
                low = mid.saturating_add(1);
            } else {
                if mid == 0 {
                    break;
                }
                high = mid - 1;
            }
        }

        fixture
            .vm
            .revert(base_snapshot)
            .expect("failed to revert measurement snapshot");
        fixture.vm.delete_snapshot(base_snapshot);
        best
    }
}
