//! Liquidity Borrow Tests - Rust port of TypeScript `borrow.test.ts`.
//!
//! This module contains tests for borrow operations in the liquidity program.

#[cfg(test)]
mod tests {
    use crate::liquidity::fixture::LiquidityFixture;
    use fluid_test_framework::helpers::MintKey;
    use fluid_test_framework::prelude::*;
    use liquidity::state::{RateDataV1Params, TokenConfig};

    const DEFAULT_AMOUNT: u64 = LAMPORTS_PER_SOL; // 1 SOL
    const PASS_1YEAR_TIME: i64 = time::YEAR; // 1 year

    fn setup_fixture() -> LiquidityFixture {
        let mut fixture = LiquidityFixture::new().expect("Failed to create fixture");
        fixture.setup().expect("Failed to setup fixture");
        fixture
    }

    fn setup_fixture_with_liquidity() -> LiquidityFixture {
        let mut fixture = setup_fixture();

        // Set user allowances for mock_protocol
        let mock_protocol_pubkey = fixture.mock_protocol.pubkey();
        fixture
            .set_user_allowances_default_with_mode(MintKey::USDC, &mock_protocol_pubkey, true)
            .expect("Failed to set user allowances");

        // Alice supplies liquidity
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();
        fixture
            .deposit(&protocol, DEFAULT_AMOUNT, MintKey::USDC, &alice)
            .expect("Failed to deposit");

        fixture
    }

    /// Test: operate_BorrowWhenUtilizationAbove100Percent
    /// Borrow to 100% utilization, with very high borrow rate APR + some fee
    /// meaning increase in borrow exchange price happens faster than supply exchange price
    /// so utilization will grow above 100%.
    #[test]
    fn test_operate_borrow_when_utilization_above_100_percent() {
        let mut fixture = setup_fixture_with_liquidity();
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        // Set max possible borrow rate at all utilization levels
        fixture
            .update_rate_data_v1_with_params(
                MintKey::USDC,
                RateDataV1Params {
                    kink: LiquidityFixture::DEFAULT_KINK,
                    rate_at_utilization_zero: LiquidityFixture::MAX_POSSIBLE_BORROW_RATE,
                    rate_at_utilization_kink: LiquidityFixture::MAX_POSSIBLE_BORROW_RATE,
                    rate_at_utilization_max: LiquidityFixture::MAX_POSSIBLE_BORROW_RATE,
                },
            )
            .expect("Failed to update rate data");

        // Set fee to 30%
        fixture
            .update_token_config_with_params(
                MintKey::USDC,
                TokenConfig {
                    token: MintKey::USDC.pubkey(),
                    fee: LiquidityFixture::DEFAULT_PERCENT_PRECISION * 30, // 30% fee
                    max_utilization: 10_000,                               // 100%
                },
            )
            .expect("Failed to update token config");

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get overall token data");

        let borrow_amount =
            overall_data.supply_interest_free as u64 + overall_data.supply_raw_interest as u64;

        // Borrow full available supply amount to get to 100% utilization
        fixture
            .borrow(&protocol, borrow_amount, MintKey::USDC, &alice)
            .expect("Failed to borrow");

        // Expect utilization to be 100%
        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get overall token data");
        assert_eq!(
            overall_data.last_stored_utilization, 10_000,
            "Utilization should be 100% (10000)"
        );

        // Warp until utilization grows enough above 100%
        fixture
            .warp_with_exchange_price(MintKey::USDC, PASS_1YEAR_TIME)
            .expect("Failed to warp with exchange price");

        // Expect utilization to be above 100% (approximately 142.54%)
        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get overall token data");
        assert_eq!(
            overall_data.last_stored_utilization, 14254,
            "Utilization should be above 100%: 142.54%"
        );
        assert_eq!(
            overall_data.supply_exchange_price, 134600667245412,
            "Supply exchange price should be 134600667245412"
        );
        assert_eq!(
            overall_data.borrow_exchange_price, 191864066984971,
            "Borrow exchange price should be 191864066984971"
        );

        // execute supply. Raw supply / borrow is still 1 ether (actually DEFAULT_SUPPLY_AMOUNT_AFTER_BIGMATH which also is 1 ether).
        // so total amounts here = DEFAULT_SUPPLY_AMOUNT_AFTER_BIGMATH * exchangepPrices
        // total supply: 1e18 * 134600667245412 / 1e12 = 1.34600667245412 × 10^20
        // total borrow: 1e18 * 191864066984971 / 1e12 = 1.9186406698454 × 10^20
        fixture
            .deposit(&protocol, 50 * LAMPORTS_PER_SOL, MintKey::USDC, &alice)
            .expect("Failed to deposit");

        // total supply now: 1.34600667245412 × 10^20 + 50 ether = 1.84600667245412×10^20

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get overall token data");
        // expect utilization to be down to 1.9186406698454 × 10^20 * 100 / 1.84600667245412×10^20 = 103,93 %
        assert_eq!(
            overall_data.last_stored_utilization, 10393,
            "Utilization should still be above 100% after first deposit: 103.93%"
        );

        // Supplied amount can NOT be borrowed because utilization is above 100%
        fixture.expect_revert_any(&["MaxUtilizationReached", "6024"], |f| {
            f.borrow(&protocol, DEFAULT_AMOUNT, MintKey::USDC, &alice)
        });

        // Supply again to bring utilization further down
        fixture
            .deposit(&protocol, 100 * LAMPORTS_PER_SOL, MintKey::USDC, &alice)
            .expect("Failed to deposit");

        // total supply now: 1.84600667245412×10^20 + 100 ether = 2.84600667245412×10^20
        // total borrow still: 1.9186406698454 × 10^20

        // Utilization should be down now (around 67%)
        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get overall token data");
        assert_eq!(
            overall_data.last_stored_utilization, 6741,
            "Utilization should be below 100% after second deposit: 67.41%"
        );

        // Borrow now should work normally again
        fixture
            .borrow(&protocol, 10 * LAMPORTS_PER_SOL, MintKey::USDC, &alice)
            .expect("Failed to borrow after utilization normalized");

        // total borrow now: 1.9186406698454 × 10^20 + 10 ether = 2.0186406698454 × 10^20

        let overall_data = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get overall token data");
        assert_eq!(
            overall_data.last_stored_utilization, 7092,
            "Utilization should be below 100% after second deposit: 70.92%"
        );
    }

    /// Test: Simple borrow operation
    #[test]
    fn test_simple_borrow() {
        let mut fixture = setup_fixture_with_liquidity();
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let balance_before = fixture.balance_of(&alice.pubkey(), MintKey::USDC);

        let borrow_amount = DEFAULT_AMOUNT / 2;
        fixture
            .borrow(&protocol, borrow_amount, MintKey::USDC, &alice)
            .expect("Failed to borrow");

        let balance_after = fixture.balance_of(&alice.pubkey(), MintKey::USDC);

        // User should have received the borrow amount
        assert_eq!(
            balance_after - balance_before,
            borrow_amount,
            "User balance should increase by borrow amount"
        );

        // Verify borrow position was created
        let user_borrow = fixture
            .get_user_borrow_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user borrow data");

        assert!(
            user_borrow.borrow > 0,
            "Borrow should be greater than 0 after borrowing"
        );
    }

    /// Test: Borrow updates token reserve
    #[test]
    fn test_borrow_updates_token_reserve() {
        let mut fixture = setup_fixture_with_liquidity();
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let reserve_before = fixture
            .read_token_reserve(MintKey::USDC)
            .expect("Failed to read reserve");

        let borrow_amount = DEFAULT_AMOUNT / 2;
        fixture
            .borrow(&protocol, borrow_amount, MintKey::USDC, &alice)
            .expect("Failed to borrow");

        let reserve_after = fixture
            .read_token_reserve(MintKey::USDC)
            .expect("Failed to read reserve");

        assert!(
            reserve_after.total_borrow_with_interest > reserve_before.total_borrow_with_interest,
            "Total borrow with interest should increase"
        );

        assert!(
            reserve_after.borrow_rate > 0,
            "Borrow rate should be positive after borrow"
        );
    }

    /// Test: Borrow interest-free mode
    #[test]
    fn test_borrow_interest_free() {
        let mut fixture = setup_fixture();

        // Setup with interest-free protocol
        let protocol = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        // Deposit first to have liquidity
        fixture
            .deposit(&protocol, DEFAULT_AMOUNT * 2, MintKey::USDC, &alice)
            .expect("Failed to deposit");

        let borrow_amount = DEFAULT_AMOUNT;
        fixture
            .borrow(&protocol, borrow_amount, MintKey::USDC, &alice)
            .expect("Failed to borrow");

        let user_borrow = fixture
            .get_user_borrow_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user borrow data");

        // In interest-free mode, borrow should equal borrow amount exactly
        assert_eq!(
            user_borrow.borrow, borrow_amount,
            "Interest-free borrow should equal borrow amount"
        );
    }

    /// Test: Borrow increases utilization
    #[test]
    fn test_borrow_increases_utilization() {
        let mut fixture = setup_fixture_with_liquidity();
        let protocol = fixture.mock_protocol.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let overall_before = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get overall token data");

        let borrow_amount = DEFAULT_AMOUNT / 2;
        fixture
            .borrow(&protocol, borrow_amount, MintKey::USDC, &alice)
            .expect("Failed to borrow");

        let overall_after = fixture
            .get_overall_token_data(MintKey::USDC)
            .expect("Failed to get overall token data");

        assert!(
            overall_after.last_stored_utilization > overall_before.last_stored_utilization,
            "Utilization should increase after borrow"
        );
    }
}
