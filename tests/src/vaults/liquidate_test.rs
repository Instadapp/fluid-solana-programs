//! Vault Liquidation Tests - Rust port of TypeScript `liquidate.test.ts`.
//!
//! This module contains comprehensive tests for vault liquidation scenarios
//! including single tick liquidation, multiple tick liquidation, branch handling,
//! and absorption mechanisms.

#[cfg(test)]
mod tests {
    use crate::vaults::fixture::{LiquidateVars, OperateVars, VaultFixture, DEFAULT_ORACLE_PRICE};
    use solana_sdk::signer::Signer;

    const MIN_I128: i128 = i128::MIN;

    fn setup_vault_fixture() -> VaultFixture {
        let mut fixture = VaultFixture::new().expect("Failed to create vault fixture");
        fixture.setup().expect("Failed to setup vault fixture");
        fixture
    }

    fn create_checked_position(
        fixture: &mut VaultFixture,
        vault_id: u16,
        collateral: i128,
        debt: i128,
        user: &solana_sdk::signature::Keypair,
    ) -> u32 {
        let next_id = fixture
            .get_next_position_id(vault_id)
            .expect("Failed to get next position id");
        fixture
            .init_position(vault_id, user)
            .expect("Failed to init position");

        let supply_mint = fixture.get_vault_supply_token(vault_id);
        let borrow_mint = fixture.get_vault_borrow_token(vault_id);

        let user_supply_balance_before = fixture.balance_of(&user.pubkey(), supply_mint);
        let user_borrow_balance_before = fixture.balance_of(&user.pubkey(), borrow_mint);

        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id: next_id,
                user,
                position_owner: user,
                collateral_amount: collateral,
                debt_amount: debt,
                recipient: user,
            })
            .expect("Failed to operate vault");

        let user_supply_balance_after = fixture.balance_of(&user.pubkey(), supply_mint);
        let user_borrow_balance_after = fixture.balance_of(&user.pubkey(), borrow_mint);

        // Verify balance changes
        assert_eq!(
            user_supply_balance_before - user_supply_balance_after,
            collateral as u64 + 1, // Allow for 1 lamport difference due to rounding/rent
            "Supply balance difference should equal collateral amount"
        );
        assert_eq!(
            user_borrow_balance_after - user_borrow_balance_before,
            debt as u64,
            "Borrow balance increase should equal debt amount"
        );

        next_id
    }

    /// Perform checked liquidate and return actual amounts
    fn perform_checked_liquidate(
        fixture: &mut VaultFixture,
        vault_id: u16,
        liquidate_amt: u64,
        liquidator: &solana_sdk::signature::Keypair,
        absorb: bool,
    ) -> (u128, u128) {
        let supply_mint = fixture.get_vault_supply_token(vault_id);
        let borrow_mint = fixture.get_vault_borrow_token(vault_id);

        let liquidator_supply_before = fixture.balance_of(&liquidator.pubkey(), supply_mint);
        let liquidator_borrow_before = fixture.balance_of(&liquidator.pubkey(), borrow_mint);

        let (actual_col_amt, actual_debt_amt) = fixture
            .liquidate_vault(&LiquidateVars {
                vault_id,
                user: liquidator,
                to: liquidator,
                debt_amount: liquidate_amt,
                col_per_unit_debt: 0, // No slippage protection for test
                absorb,
            })
            .expect("Failed to liquidate vault");

        let liquidator_supply_after = fixture.balance_of(&liquidator.pubkey(), supply_mint);
        let liquidator_borrow_after = fixture.balance_of(&liquidator.pubkey(), borrow_mint);

        if liquidate_amt > 0 {
            // As we withdraw collateral, we expect the balance to increase
            let col_received = liquidator_supply_after - liquidator_supply_before;
            let debt_paid = liquidator_borrow_before - liquidator_borrow_after;

            assert!(col_received > 0, "Liquidator should receive collateral");
            assert!(debt_paid > 0, "Liquidator should pay back debt");

            // The amounts received should match the event data
            assert_eq!(
                col_received as u128, actual_col_amt,
                "Collateral received should match event"
            );
            assert_eq!(
                debt_paid as u128, actual_debt_amt,
                "Debt paid should match event"
            );
        }

        (actual_col_amt, actual_debt_amt)
    }

    /// Verify liquidation results by checking all positions
    fn verify_liquidation(
        fixture: &VaultFixture,
        total_positions: u32,
        vault_id: u16,
        expected_total_final_col: u128,
        expected_total_final_debt: u128,
    ) {
        let mut total_user_col: u128 = 0;
        let mut total_user_debt: u128 = 0;
        let mut total_user_dust_debt: u128 = 0;

        for i in 0..total_positions {
            let nft_id = i + 1;

            let user_position = fixture
                .position_by_nft_id(nft_id, vault_id)
                .expect("Failed to get position");

            total_user_col += fixture.unscale_amounts(user_position.supply, vault_id);
            total_user_debt += fixture.unscale_amounts(user_position.borrow, vault_id);
            total_user_dust_debt +=
                fixture.unscale_amounts(user_position.before_dust_borrow, vault_id);
        }

        // expected_total_final_col > total_user_col
        assert!(
            expected_total_final_col > total_user_col,
            "Collateral expected {} should be greater than actual {}",
            expected_total_final_col,
            total_user_col
        );

        // expected_total_final_debt > total_user_debt
        assert!(
            expected_total_final_debt > total_user_debt,
            "Debt expected {} should be greater than actual {}",
            expected_total_final_debt,
            total_user_debt
        );

        // Precision check: 99.99% tolerance
        let precision: u128 = 10_000_000; // 1e7
        let percent_99_99: u128 = 9999;
        let percent_100: u128 = 10000;

        let expected_col_adjusted = expected_total_final_col * percent_99_99 / percent_100;
        fixture.assert_approx_eq_rel(expected_col_adjusted, total_user_col, precision);

        let expected_debt_with_dust = expected_total_final_debt + total_user_dust_debt;
        let expected_debt_adjusted = expected_debt_with_dust * percent_99_99 / percent_100;
        let expected_debt_final = if expected_debt_adjusted > total_user_dust_debt {
            expected_debt_adjusted - total_user_dust_debt
        } else {
            0
        };

        fixture.assert_approx_eq_rel(expected_debt_final, total_user_debt, precision);
    }

    /// Verify that two positions have approximately equal supply/borrow
    fn verify_position(fixture: &VaultFixture, vault_id: u16) {
        let user_position1 = fixture
            .position_by_nft_id(1, vault_id)
            .expect("Failed to get position 1");
        let user_position2 = fixture
            .position_by_nft_id(2, vault_id)
            .expect("Failed to get position 2");

        let precision: u128 = 10_000; // 1e4

        fixture.assert_approx_eq_rel(user_position1.supply, user_position2.supply, precision);
        fixture.assert_approx_eq_rel(user_position1.borrow, user_position2.borrow, precision);
    }

    // ========================================================================
    // liquidateFromSinglePerfectTickTillLiquidationThreshold Tests
    // ========================================================================

    fn liquidate_from_single_perfect_tick_till_liquidation_threshold(positive_tick: bool) {
        let mut fixture = setup_vault_fixture();
        let vault_id = if positive_tick { 1u16 } else { 2u16 };

        let supply_decimals = fixture.get_vault_supply_token_decimals(vault_id);
        let borrow_decimals = fixture.get_vault_borrow_token_decimals(vault_id);

        let collateral = 10000_i128 * 10_i128.pow(supply_decimals as u32);
        let debt = 7990_i128 * 10_i128.pow(borrow_decimals as u32);

        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        // Set oracle price (1e8)
        let oracle_price = DEFAULT_ORACLE_PRICE;
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        // Create position with alice
        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);

        // Decrease oracle price by 200% (crash scenario)
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 200)
            .expect("Failed to decrease oracle price");

        // Liquidate with larger amount
        let liquidate_amt = 3000_u64 * 10_u64.pow(borrow_decimals as u32);

        let (actual_col_amt, actual_debt_amt) =
            perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, false);

        let expected_final_collateral = (collateral as u128) - actual_col_amt;
        let expected_final_debt = (debt as u128) - actual_debt_amt;

        verify_liquidation(
            &fixture,
            1,
            vault_id,
            expected_final_collateral,
            expected_final_debt,
        );
    }

    #[test]
    fn test_liquidate_from_single_perfect_tick_till_liquidation_threshold_positive() {
        liquidate_from_single_perfect_tick_till_liquidation_threshold(true);
    }

    #[test]
    fn test_liquidate_from_single_perfect_tick_till_liquidation_threshold_negative() {
        liquidate_from_single_perfect_tick_till_liquidation_threshold(false);
    }

    // ========================================================================
    // liquidateSingleFromPerfectTickTillBetween Tests
    // ========================================================================

    fn liquidate_from_single_perfect_tick_till_between(positive_tick: bool) {
        let mut fixture = setup_vault_fixture();
        let vault_id = if positive_tick { 1u16 } else { 2u16 };

        let supply_decimals = fixture.get_vault_supply_token_decimals(vault_id);
        let borrow_decimals = fixture.get_vault_borrow_token_decimals(vault_id);

        let collateral = 10000_i128 * 10_i128.pow(supply_decimals as u32);
        let debt = 7990_i128 * 10_i128.pow(borrow_decimals as u32);

        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        // Set oracle price
        let oracle_price = DEFAULT_ORACLE_PRICE;
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        // Create position with alice
        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);

        // Decrease oracle price by 200%
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 200)
            .expect("Failed to decrease oracle price");

        let liquidate_amt = 100_u64 * 10_u64.pow(borrow_decimals as u32);

        let (actual_col_amt, actual_debt_amt) =
            perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, false);

        let expected_final_collateral = (collateral as u128) - actual_col_amt;
        let expected_final_debt = (debt as u128) - actual_debt_amt;

        verify_liquidation(
            &fixture,
            1,
            vault_id,
            expected_final_collateral,
            expected_final_debt,
        );
    }

    #[test]
    fn test_liquidate_from_single_perfect_tick_till_between_positive() {
        liquidate_from_single_perfect_tick_till_between(true);
    }

    #[test]
    fn test_liquidate_from_single_perfect_tick_till_between_negative() {
        liquidate_from_single_perfect_tick_till_between(false);
    }

    // ========================================================================
    // liquidateFromBranch Tests
    // ========================================================================

    fn liquidate_from_branch(positive_tick: bool) {
        let mut fixture = setup_vault_fixture();
        let vault_id = if positive_tick { 1u16 } else { 2u16 };

        let supply_decimals = fixture.get_vault_supply_token_decimals(vault_id);
        let borrow_decimals = fixture.get_vault_borrow_token_decimals(vault_id);

        let collateral = 10000_i128 * 10_i128.pow(supply_decimals as u32);
        let debt = 7990_i128 * 10_i128.pow(borrow_decimals as u32);

        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        // Set oracle price
        let oracle_price = DEFAULT_ORACLE_PRICE;
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        // Create position with alice
        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);

        // Decrease oracle price by 200%
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 200)
            .expect("Failed to decrease oracle price");

        let mut total_col_liquidated: u128 = 0;
        let mut total_debt_liquidated: u128 = 0;

        // First liquidation
        let liquidate_amt = 100_u64 * 10_u64.pow(borrow_decimals as u32);
        let (actual_col_amt, actual_debt_amt) =
            perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, false);
        total_col_liquidated += actual_col_amt;
        total_debt_liquidated += actual_debt_amt;

        // Second liquidation
        let liquidate_amt = 200_u64 * 10_u64.pow(borrow_decimals as u32);
        let (actual_col_amt, actual_debt_amt) =
            perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, false);
        total_col_liquidated += actual_col_amt;
        total_debt_liquidated += actual_debt_amt;

        let expected_final_collateral = (collateral as u128) - total_col_liquidated;
        let expected_final_debt = (debt as u128) - total_debt_liquidated;

        verify_liquidation(
            &fixture,
            1,
            vault_id,
            expected_final_collateral,
            expected_final_debt,
        );
    }

    #[test]
    fn test_liquidate_from_branch_positive() {
        liquidate_from_branch(true);
    }

    #[test]
    fn test_liquidate_from_branch_negative() {
        liquidate_from_branch(false);
    }

    // ========================================================================
    // multiplePerfectTickLiquidation Tests
    // ========================================================================

    fn liquidate_from_multiple_perfect_tick(positive_tick: bool) {
        let mut fixture = setup_vault_fixture();
        let vault_id = if positive_tick { 1u16 } else { 2u16 };

        let supply_decimals = fixture.get_vault_supply_token_decimals(vault_id);
        let borrow_decimals = fixture.get_vault_borrow_token_decimals(vault_id);

        let collateral = 10000_i128 * 10_i128.pow(supply_decimals as u32);
        let debt = 7990_i128 * 10_i128.pow(borrow_decimals as u32);
        let debt_two = debt * 994 / 1000; // 0.4% less will result in a different tick

        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        // Set oracle price
        let oracle_price = DEFAULT_ORACLE_PRICE;
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        // Create position with alice
        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);

        // Create a similar position with bob
        create_checked_position(&mut fixture, vault_id, collateral, debt, &bob);

        // Create a similar position with alice (different debt = different tick)
        create_checked_position(&mut fixture, vault_id, collateral, debt_two, &alice);

        // Decrease oracle price by 200% (crash scenario)
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 200)
            .expect("Failed to decrease oracle price");

        let liquidate_amt = 1000_u64 * 10_u64.pow(borrow_decimals as u32);

        let (actual_col_amt, actual_debt_amt) =
            perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, false);

        let expected_final_collateral =
            (collateral as u128) * 3 - actual_col_amt;
        let expected_final_debt =
            (debt as u128) + (debt as u128) + (debt_two as u128) - actual_debt_amt;

        verify_liquidation(
            &fixture,
            3,
            vault_id,
            expected_final_collateral,
            expected_final_debt,
        );
    }

    #[test]
    fn test_liquidate_from_multiple_perfect_tick_positive() {
        liquidate_from_multiple_perfect_tick(true);
    }

    #[test]
    fn test_liquidate_from_multiple_perfect_tick_negative() {
        liquidate_from_multiple_perfect_tick(false);
    }

    // ========================================================================
    // perfectTickAndBranchLiquidation Tests
    // - Initializing a tick
    // - Liquidating a tick
    // - Initializing another tick exactly same as before
    // - Liquidating another tick exactly same as before
    // - Liquidating again. Final position of both position should be same
    // ========================================================================

    fn liquidate_from_perfect_tick_and_branch(positive_tick: bool) {
        let mut fixture = setup_vault_fixture();
        let vault_id = if positive_tick { 1u16 } else { 2u16 };

        let supply_decimals = fixture.get_vault_supply_token_decimals(vault_id);
        let borrow_decimals = fixture.get_vault_borrow_token_decimals(vault_id);

        let collateral = 10000_i128 * 10_i128.pow(supply_decimals as u32);
        let debt = 7990_i128 * 10_i128.pow(borrow_decimals as u32);

        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        let oracle_price = DEFAULT_ORACLE_PRICE;
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);

        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 200)
            .expect("Failed to decrease oracle price");

        let mut total_debt_liquidated: u128 = 0;
        let mut total_col_liquidated: u128 = 0;

        let liquidate_amt = 50_u64 * 10_u64.pow(borrow_decimals as u32);
        let (actual_col_amt, actual_debt_amt) =
            perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, false);
        total_debt_liquidated += actual_debt_amt;
        total_col_liquidated += actual_col_amt;

        // Reset oracle price
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        // Create another position with alice (same tick)
        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);

        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 200)
            .expect("Failed to decrease oracle price");

        let liquidate_amt = 49_u64 * 10_u64.pow(borrow_decimals as u32);
        let (actual_col_amt, actual_debt_amt) =
            perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, false);
        total_debt_liquidated += actual_debt_amt;
        total_col_liquidated += actual_col_amt;

        let liquidate_amt = 50_u64 * 10_u64.pow(borrow_decimals as u32);
        let (actual_col_amt, actual_debt_amt) =
            perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, false);
        total_debt_liquidated += actual_debt_amt;
        total_col_liquidated += actual_col_amt;

        let expected_final_collateral = (collateral as u128) * 2 - total_col_liquidated;
        let expected_final_debt = (debt as u128) * 2 - total_debt_liquidated;

        verify_liquidation(
            &fixture,
            2,
            vault_id,
            expected_final_collateral,
            expected_final_debt,
        );

        verify_position(&fixture, vault_id);
    }

    #[test]
    fn test_liquidate_from_perfect_tick_and_branch_positive() {
        liquidate_from_perfect_tick_and_branch(true);
    }

    #[test]
    fn test_liquidate_from_perfect_tick_and_branch_negative() {
        liquidate_from_perfect_tick_and_branch(false);
    }

    // ========================================================================
    // perfectTickAndMultipleBranchesLiquidation Tests
    // initialize a tick
    // liquidate
    // inititalize again at the exact same tick
    // liquidate a bit less such that the branch doesn't merge with other branch
    // inititalize again at the exact same tick
    // liquidate everything together
    // 3rd branch will merge into 2nd branch will merge into 1st branch
    // ========================================================================

    fn perfect_tick_and_multiple_branches_liquidation(positive_tick: bool) {
        let mut fixture = setup_vault_fixture();
        let vault_id = if positive_tick { 1u16 } else { 2u16 };

        let supply_decimals = fixture.get_vault_supply_token_decimals(vault_id);
        let borrow_decimals = fixture.get_vault_borrow_token_decimals(vault_id);

        let collateral = 10000_i128 * 10_i128.pow(supply_decimals as u32);
        let debt = 7990_i128 * 10_i128.pow(borrow_decimals as u32);

        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        // Set oracle price
        let oracle_price = DEFAULT_ORACLE_PRICE;
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        // Create position with alice
        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);

        // Decrease oracle price by 200% (crash scenario)
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 200)
            .expect("Failed to decrease oracle price");

        let mut total_debt_liquidated: u128 = 0;
        let mut total_col_liquidated: u128 = 0;

        // First liquidation
        let liquidate_amt = 100_u64 * 10_u64.pow(borrow_decimals as u32);
        let (actual_col_amt, actual_debt_amt) =
            perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, false);
        total_debt_liquidated += actual_debt_amt;
        total_col_liquidated += actual_col_amt;

        // Reset oracle price
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        // Create another position with alice
        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);

        // Decrease oracle price by 200%
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 200)
            .expect("Failed to decrease oracle price");

        // Second liquidation (smaller)
        let liquidate_amt = 50_u64 * 10_u64.pow(borrow_decimals as u32);
        let (actual_col_amt, actual_debt_amt) =
            perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, false);
        total_debt_liquidated += actual_debt_amt;
        total_col_liquidated += actual_col_amt;

        // Reset oracle price
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        // Create third position with alice
        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);

        // Decrease oracle price by 200%
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 200)
            .expect("Failed to decrease oracle price");

        // Third liquidation (larger to merge branches)
        let liquidate_amt = 500_u64 * 10_u64.pow(borrow_decimals as u32);
        let (actual_col_amt, actual_debt_amt) =
            perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, false);
        total_debt_liquidated += actual_debt_amt;
        total_col_liquidated += actual_col_amt;

        let expected_final_collateral = (collateral as u128) * 3 - total_col_liquidated;
        let expected_final_debt = (debt as u128) * 3 - total_debt_liquidated;

        verify_liquidation(
            &fixture,
            3,
            vault_id,
            expected_final_collateral,
            expected_final_debt,
        );

        verify_position(&fixture, vault_id);
    }

    #[test]
    fn test_perfect_tick_and_multiple_branches_liquidation_positive() {
        perfect_tick_and_multiple_branches_liquidation(true);
    }

    #[test]
    fn test_perfect_tick_and_multiple_branches_liquidation_negative() {
        perfect_tick_and_multiple_branches_liquidation(false);
    }

    // ========================================================================
    // tickBranchTickBranchLiquidation Tests
    // ========================================================================

    fn tick_branch_tick_branch_liquidation(positive_tick: bool) {
        let mut fixture = setup_vault_fixture();
        let vault_id = if positive_tick { 1u16 } else { 2u16 };

        let supply_decimals = fixture.get_vault_supply_token_decimals(vault_id);
        let borrow_decimals = fixture.get_vault_borrow_token_decimals(vault_id);

        // Set up collateral and debt amounts (5 positions with different amounts)
        let collaterals = [
            10000_i128 * 10_i128.pow(supply_decimals as u32),
            9000_i128 * 10_i128.pow(supply_decimals as u32),
            10000_i128 * 10_i128.pow(supply_decimals as u32),
            10000_i128 * 10_i128.pow(supply_decimals as u32),
            10000_i128 * 10_i128.pow(supply_decimals as u32),
        ];

        let debts = [
            7990_i128 * 10_i128.pow(borrow_decimals as u32),
            6800_i128 * 10_i128.pow(borrow_decimals as u32),
            7990_i128 * 10_i128.pow(borrow_decimals as u32),
            7990_i128 * 10_i128.pow(borrow_decimals as u32),
            7840_i128 * 10_i128.pow(borrow_decimals as u32),
        ];

        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        let mut total_col_liquidated: u128 = 0;
        let mut total_debt_liquidated: u128 = 0;

        // Set initial oracle price
        let oracle_price = DEFAULT_ORACLE_PRICE;
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        // First position and liquidation
        create_checked_position(&mut fixture, vault_id, collaterals[0], debts[0], &alice);

        // Decrease oracle price by 500% (severe crash)
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 500)
            .expect("Failed to decrease oracle price");

        let liquidate_amt = 1000_u64 * 10_u64.pow(borrow_decimals as u32);
        let (actual_col_amt, actual_debt_amt) =
            perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, false);
        total_col_liquidated += actual_col_amt;
        total_debt_liquidated += actual_debt_amt;

        create_checked_position(&mut fixture, vault_id, collaterals[1], debts[1], &alice);

        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        create_checked_position(&mut fixture, vault_id, collaterals[2], debts[2], &alice);

        // Decrease oracle price by 500% again
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 500)
            .expect("Failed to decrease oracle price");

        let liquidate_amt = 500_u64 * 10_u64.pow(borrow_decimals as u32);
        let (actual_col_amt, actual_debt_amt) =
            perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, false);
        total_col_liquidated += actual_col_amt;
        total_debt_liquidated += actual_debt_amt;

        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        create_checked_position(&mut fixture, vault_id, collaterals[3], debts[3], &alice);
        create_checked_position(&mut fixture, vault_id, collaterals[4], debts[4], &alice);

        // Final massive price decrease (1000%)
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 1000)
            .expect("Failed to decrease oracle price");

        // TODO: This is a temporary fix to avoid hitting Solana transaction memory limits when including many tick accounts.
        // Split the large liquidation into smaller chunks to avoid hitting
        // Solana transaction memory limits when including many tick accounts
        let liquidate_chunks = [2000_u64, 2000_u64, 2000_u64, 2000_u64, 2000_u64];
        for &chunk_amt in &liquidate_chunks {
            let liquidate_amt = chunk_amt * 10_u64.pow(borrow_decimals as u32);
            let (actual_col_amt, actual_debt_amt) =
                perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, false);
            total_col_liquidated += actual_col_amt;
            total_debt_liquidated += actual_debt_amt;
        }

        // Calculate expected final amounts
        let mut expected_final_collateral: u128 = 0;
        let mut expected_final_debt: u128 = 0;

        for i in 0..5 {
            expected_final_collateral += collaterals[i] as u128;
            expected_final_debt += debts[i] as u128;
        }

        expected_final_collateral -= total_col_liquidated;
        expected_final_debt -= total_debt_liquidated;

        verify_liquidation(
            &fixture,
            5,
            vault_id,
            expected_final_collateral,
            expected_final_debt,
        );
    }

    #[test]
    fn test_tick_branch_tick_branch_liquidation_positive() {
        tick_branch_tick_branch_liquidation(true);
    }

    #[test]
    fn test_tick_branch_tick_branch_liquidation_negative() {
        tick_branch_tick_branch_liquidation(false);
    }

    // ========================================================================
    // unitializeFirstPosition Tests
    // 1. Initializing a position
    // 2. Unitializing by making debt 0 aka supply only position
    // 3. Initializing another position
    // 4. Liquidating.
    // ========================================================================

    fn unitialize_first_position(positive_tick: bool) {
        let mut fixture = setup_vault_fixture();
        let vault_id = if positive_tick { 1u16 } else { 2u16 };

        let supply_decimals = fixture.get_vault_supply_token_decimals(vault_id);
        let borrow_decimals = fixture.get_vault_borrow_token_decimals(vault_id);

        let collateral = 10000_i128 * 10_i128.pow(supply_decimals as u32);
        let debt = 7990_i128 * 10_i128.pow(borrow_decimals as u32);

        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        // Set initial oracle price
        let oracle_price = DEFAULT_ORACLE_PRICE;
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        let pos_id = create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);

        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);

        // Uninitialize the first position by paying back all debt
        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id: pos_id,
                user: &alice,
                position_owner: &alice,
                collateral_amount: 0,
                debt_amount: MIN_I128,
                recipient: &alice,
            })
            .expect("Failed to operate vault");

        let vault_data = fixture
            .get_vault_entire_data(vault_id)
            .expect("Failed to get vault data");

        // not MIN_TICK as we created a second position before uninitializing first
        assert_eq!(
            vault_data.vault_state.topmost_tick, -149,
            "Top tick should be -149"
        );

        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 200)
            .expect("Failed to decrease oracle price");

        let liquidate_amt = 200_u64 * 10_u64.pow(borrow_decimals as u32);

        let (actual_col_amt, actual_debt_amt) =
            perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, false);

        // Total collateral = collateral + collateral (from both positions)
        // Total debt = debt (only from the second position since first was repaid)
        let expected_final_collateral = (collateral as u128) * 2 - actual_col_amt;
        let expected_final_debt = (debt as u128) - actual_debt_amt;

        verify_liquidation(
            &fixture,
            2,
            vault_id,
            expected_final_collateral,
            expected_final_debt,
        );
    }

    #[test]
    fn test_unitialize_first_position_positive() {
        unitialize_first_position(true);
    }

    #[test]
    fn test_unitialize_first_position_negative() {
        unitialize_first_position(false);
    }

    // ========================================================================
    // liquidateInitializeAndUnitialize Tests
    // 1. Creating a position
    // 2. Partial liquidating it
    // 3. Creating another position above last liquidation point by changing oracle
    // 4. Removing new position entirely
    // 5. Liquidating old position again by partial liquidating
    // ========================================================================

    fn liquidate_initialize_and_unitialize(positive_tick: bool) {
        let mut fixture = setup_vault_fixture();
        let vault_id = if positive_tick { 1u16 } else { 2u16 };

        let supply_decimals = fixture.get_vault_supply_token_decimals(vault_id);
        let borrow_decimals = fixture.get_vault_borrow_token_decimals(vault_id);

        let collateral = 10000_i128 * 10_i128.pow(supply_decimals as u32);
        let debt = 7990_i128 * 10_i128.pow(borrow_decimals as u32);

        let mut total_col_liquidated: u128 = 0;
        let mut total_debt_liquidated: u128 = 0;

        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        // Set initial oracle price
        let oracle_price = DEFAULT_ORACLE_PRICE;
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);

        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 200)
            .expect("Failed to decrease oracle price");

        let liquidate_amt = 100_u64 * 10_u64.pow(borrow_decimals as u32);

        let (actual_col_amt, actual_debt_amt) =
            perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, false);
        total_col_liquidated += actual_col_amt;
        total_debt_liquidated += actual_debt_amt;

        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        let pos_id = create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);

        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id: pos_id,
                user: &alice,
                position_owner: &alice,
                collateral_amount: MIN_I128,
                debt_amount: MIN_I128,
                recipient: &alice,
            })
            .expect("Failed to operate vault");

        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 200)
            .expect("Failed to decrease oracle price");

        // Second liquidation on the original position
        let (actual_col_amt, actual_debt_amt) =
            perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, false);
        total_col_liquidated += actual_col_amt;
        total_debt_liquidated += actual_debt_amt;

        let expected_final_collateral = (collateral as u128) - total_col_liquidated;
        let expected_final_debt = (debt as u128) - total_debt_liquidated;

        verify_liquidation(
            &fixture,
            2,
            vault_id,
            expected_final_collateral,
            expected_final_debt,
        );
    }

    #[test]
    fn test_liquidate_initialize_and_unitialize_positive() {
        liquidate_initialize_and_unitialize(true);
    }

    #[test]
    fn test_liquidate_initialize_and_unitialize_negative() {
        liquidate_initialize_and_unitialize(false);
    }

    // ========================================================================
    // absorbMultiplePerfectTickOne Tests
    // ========================================================================

    fn absorb_multiple_perfect_tick_one(positive_tick: bool) {
        let mut fixture = setup_vault_fixture();
        let vault_id = if positive_tick { 1u16 } else { 2u16 };

        let supply_decimals = fixture.get_vault_supply_token_decimals(vault_id);
        let borrow_decimals = fixture.get_vault_borrow_token_decimals(vault_id);

        let collateral = 10000_i128 * 10_i128.pow(supply_decimals as u32);
        let debt = 7990_i128 * 10_i128.pow(borrow_decimals as u32);
        let debt_two = 990_i128 * 10_i128.pow(borrow_decimals as u32);

        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        // Set initial oracle price
        let oracle_price = DEFAULT_ORACLE_PRICE;
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        // Create three identical positions at the same tick
        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);
        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);
        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);

        for i in 0..3 {
            let position_id = i + 1;
            let user_position = fixture
                .position_by_nft_id(position_id, vault_id)
                .expect("Failed to get position");

            // decimals delta multiplier (6 -> 9 = 1000)
            assert_eq!(
                user_position.supply,
                (collateral as u128) * 1000,
                "Supply should match"
            );
            // debt must be greater due to rounding
            assert!(
                user_position.borrow > (debt as u128) * 1000,
                "Borrow should be greater than debt"
            );
        }

        // Extreme price crash (1500% decrease) to trigger absorption
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 1500)
            .expect("Failed to decrease oracle price");

        perform_checked_liquidate(&mut fixture, vault_id, 0, &bob, false);

        // Reset price to a less extreme crash (200% decrease)
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 200)
            .expect("Failed to decrease oracle price");

        // Verify that all three positions were absorbed (supply and borrow should be 0)
        for i in 0..3 {
            let position_id = i + 1;
            let user_position = fixture
                .position_by_nft_id(position_id, vault_id)
                .expect("Failed to get position");

            assert_eq!(
                user_position.supply, 0,
                "Position {} supply should be 0",
                position_id
            );
            assert_eq!(
                user_position.borrow, 0,
                "Position {} borrow should be 0",
                position_id
            );
        }

        let vault_data = fixture
            .get_vault_entire_data(vault_id)
            .expect("Failed to get vault data");
        assert_eq!(
            vault_data.vault_state.topmost_tick, i32::MIN,
            "Top tick should be MIN_TICK after absorption"
        );

        let pos_id =
            create_checked_position(&mut fixture, vault_id, collateral, debt_two, &alice);

        let user_position = fixture
            .position_by_nft_id(pos_id, vault_id)
            .expect("Failed to get position");
        let vault_data = fixture
            .get_vault_entire_data(vault_id)
            .expect("Failed to get vault data");

        assert_eq!(
            user_position.tick, vault_data.vault_state.topmost_tick,
            "New position tick should be top tick"
        );
    }

    #[test]
    fn test_absorb_multiple_perfect_tick_one_positive() {
        absorb_multiple_perfect_tick_one(true);
    }

    #[test]
    fn test_absorb_multiple_perfect_tick_one_negative() {
        absorb_multiple_perfect_tick_one(false);
    }

    // ========================================================================
    // absorbMultiplePerfectTickTwo Tests
    // ========================================================================

    fn absorb_multiple_perfect_tick_two(positive_tick: bool) {
        let mut fixture = setup_vault_fixture();
        let vault_id = if positive_tick { 1u16 } else { 2u16 };

        let supply_decimals = fixture.get_vault_supply_token_decimals(vault_id);
        let borrow_decimals = fixture.get_vault_borrow_token_decimals(vault_id);

        let collateral = 10000_i128 * 10_i128.pow(supply_decimals as u32);
        let debt = 7990_i128 * 10_i128.pow(borrow_decimals as u32);
        let debt_two = 990_i128 * 10_i128.pow(borrow_decimals as u32);

        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        // Set initial oracle price
        let oracle_price = DEFAULT_ORACLE_PRICE;
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);
        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);
        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);

        // Create fourth position with different debt amount (different tick)
        create_checked_position(&mut fixture, vault_id, collateral, debt_two, &alice);

        // Extreme price crash (1500% decrease) to trigger absorption
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 1500)
            .expect("Failed to decrease oracle price");

        // Perform absorption liquidation
        perform_checked_liquidate(&mut fixture, vault_id, 0, &bob, false);

        // Reset price to a less extreme crash (200% decrease)
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 200)
            .expect("Failed to decrease oracle price");

        // Perform regular liquidation on remaining position
        let liquidate_amt = 10000_u64 * 10_u64.pow(borrow_decimals as u32);

        let (actual_col_amt, actual_debt_amt) =
            perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, true);

        // Verify that the first three positions were absorbed
        for i in 0..3 {
            let position_id = i + 1;
            let user_position = fixture
                .position_by_nft_id(position_id, vault_id)
                .expect("Failed to get position");

            assert_eq!(
                user_position.supply, 0,
                "Position {} supply should be 0",
                position_id
            );
            assert_eq!(
                user_position.borrow, 0,
                "Position {} borrow should be 0",
                position_id
            );
        }

        // Check the 4th position and vault state
        let user_position = fixture.position_by_nft_id(4, vault_id).expect("Failed to get position");
        let vault_data = fixture
            .get_vault_entire_data(vault_id)
            .expect("Failed to get vault data");

        // Verify that the 4th position is the top tick
        assert_eq!(
            user_position.tick, vault_data.vault_state.topmost_tick,
            "Position 4 tick should be top tick"
        );

        // Verify branch state
        assert_eq!(
            vault_data.vault_state.current_branch, 1,
            "Current branch should be 1"
        );

        // Verify total supply (4 collaterals minus liquidated amount)
        let expected_total_supply = (collateral as u128) * 4 - actual_col_amt;
        fixture.assert_approx_eq_rel(
            fixture.unscale_amounts(vault_data.vault_state.total_supply, vault_id),
            expected_total_supply,
            10_000_000,
        );

        // Verify total borrow (3 debt + 1 debt_two minus liquidated debt)
        let expected_total_borrow =
            (debt as u128) * 3 + (debt_two as u128) - actual_debt_amt;
        fixture.assert_approx_eq_rel(
            fixture.unscale_amounts(vault_data.vault_state.total_borrow, vault_id),
            expected_total_borrow,
            10_000_000,
        );
    }

    #[test]
    fn test_absorb_multiple_perfect_tick_two_positive() {
        absorb_multiple_perfect_tick_two(true);
    }

    #[test]
    fn test_absorb_multiple_perfect_tick_two_negative() {
        absorb_multiple_perfect_tick_two(false);
    }

    // ========================================================================
    // absorbMultiplePerfectTickAndBranches Tests
    // ========================================================================

    fn absorb_multiple_perfect_tick_and_branches(positive_tick: bool) {
        let mut fixture = setup_vault_fixture();
        let vault_id = if positive_tick { 1u16 } else { 2u16 };

        let supply_decimals = fixture.get_vault_supply_token_decimals(vault_id);
        let borrow_decimals = fixture.get_vault_borrow_token_decimals(vault_id);

        let collateral = 10000_i128 * 10_i128.pow(supply_decimals as u32);
        let debt = 7990_i128 * 10_i128.pow(borrow_decimals as u32);
        let debt_two = 7800_i128 * 10_i128.pow(borrow_decimals as u32);
        let debt_three = 900_i128 * 10_i128.pow(borrow_decimals as u32);

        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        // Set initial oracle price
        let oracle_price = DEFAULT_ORACLE_PRICE;
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        // Create three positions with different debt amounts (different ticks)
        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);
        create_checked_position(&mut fixture, vault_id, collateral, debt_two, &alice);
        create_checked_position(&mut fixture, vault_id, collateral, debt_three, &alice);

        // Moderate price crash (200% decrease) and partial liquidation
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 200)
            .expect("Failed to decrease oracle price");

        let liquidate_amt = 200_u64 * 10_u64.pow(borrow_decimals as u32);

        // First liquidation with absorb = true
        perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, true);

        // Reset oracle price to original
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        // Create fourth position (this should create a new branch)
        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);

        // Extreme price crash (1500% decrease) to trigger absorption
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 1500)
            .expect("Failed to decrease oracle price");

        // Perform absorption liquidation
        perform_checked_liquidate(&mut fixture, vault_id, 0, &bob, false);

        let vault_data = fixture
            .get_vault_entire_data(vault_id)
            .expect("Failed to get vault data");

        assert_eq!(
            vault_data.vault_state.current_branch, 2,
            "Current branch should be 2"
        );

        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        let large_liquidate_amt = 10000_u64 * 10_u64.pow(borrow_decimals as u32);

        perform_checked_liquidate(&mut fixture, vault_id, large_liquidate_amt, &bob, true);

        let vault_data = fixture
            .get_vault_entire_data(vault_id)
            .expect("Failed to get vault data");

        // Verify that positions 1, 2, and 4 were absorbed (supply and borrow should be 0)
        // Position 3 should remain active
        for i in 0..4 {
            let position_id = i + 1;
            if position_id != 3 {
                let user_position = fixture
                    .position_by_nft_id(position_id, vault_id)
                    .expect("Failed to get position");

                assert_eq!(
                    user_position.supply, 0,
                    "Position {} supply should be 0",
                    position_id
                );
                assert_eq!(
                    user_position.borrow, 0,
                    "Position {} borrow should be 0",
                    position_id
                );
            }
        }

        // Verify we're still on branch 2
        assert_eq!(
            vault_data.vault_state.current_branch, 2,
            "Current branch should still be 2"
        );

        // Verify that position 3 is the top tick
        let position3 = fixture.position_by_nft_id(3, vault_id).expect("Failed to get position");
        assert_eq!(
            vault_data.vault_state.topmost_tick, position3.tick,
            "Position 3 should be top tick"
        );
    }

    #[test]
    fn test_absorb_multiple_perfect_tick_and_branches_positive() {
        absorb_multiple_perfect_tick_and_branches(true);
    }

    #[test]
    fn test_absorb_multiple_perfect_tick_and_branches_negative() {
        absorb_multiple_perfect_tick_and_branches(false);
    }

    // ========================================================================
    // absorbBranch Tests
    // ========================================================================

    fn absorb_branch(positive_tick: bool) {
        let mut fixture = setup_vault_fixture();
        let vault_id = if positive_tick { 1u16 } else { 2u16 };

        let supply_decimals = fixture.get_vault_supply_token_decimals(vault_id);
        let borrow_decimals = fixture.get_vault_borrow_token_decimals(vault_id);

        let collateral = 10000_i128 * 10_i128.pow(supply_decimals as u32);
        let debt = 7990_i128 * 10_i128.pow(borrow_decimals as u32);
        let debt_two = 800_i128 * 10_i128.pow(borrow_decimals as u32);

        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        // Set initial oracle price
        let oracle_price = DEFAULT_ORACLE_PRICE;
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        // Create two positions with different debt amounts (different ticks)
        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);
        create_checked_position(&mut fixture, vault_id, collateral, debt_two, &alice);

        // Moderate price crash (200% decrease) and partial liquidation
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 200)
            .expect("Failed to decrease oracle price");

        let liquidate_amt = 200_u64 * 10_u64.pow(borrow_decimals as u32);

        // First liquidation with absorb = true
        perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, true);

        // Reset oracle price to original
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        // Extreme price crash (1500% decrease) to trigger absorption
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 1500)
            .expect("Failed to decrease oracle price");

        // Perform absorption liquidation
        perform_checked_liquidate(&mut fixture, vault_id, 0, &bob, false);

        // Get vault data after absorption
        let vault_data = fixture
            .get_vault_entire_data(vault_id)
            .expect("Failed to get vault data");

        // Verify that the first branch got closed and we're on branch 2
        assert_eq!(
            vault_data.vault_state.current_branch, 2,
            "Current branch should be 2"
        );

        // Reset oracle price again
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        // Final liquidation with larger amount
        let large_liquidate_amt = 5000_u64 * 10_u64.pow(borrow_decimals as u32);

        perform_checked_liquidate(&mut fixture, vault_id, large_liquidate_amt, &bob, true);

        // Get final vault data
        let vault_data = fixture
            .get_vault_entire_data(vault_id)
            .expect("Failed to get vault data");

        // Verify that position 1 was absorbed
        let position1 = fixture.position_by_nft_id(1, vault_id).expect("Failed to get position");
        assert_eq!(position1.supply, 0, "Position 1 supply should be 0");
        assert_eq!(position1.borrow, 0, "Position 1 borrow should be 0");

        // Verify we're still on branch 2
        assert_eq!(
            vault_data.vault_state.current_branch, 2,
            "Current branch should still be 2"
        );

        // Verify that position 2 is the top tick
        let position2 = fixture.position_by_nft_id(2, vault_id).expect("Failed to get position");
        assert_eq!(
            vault_data.vault_state.topmost_tick, position2.tick,
            "Position 2 should be top tick"
        );
    }

    #[test]
    fn test_absorb_branch_positive() {
        absorb_branch(true);
    }

    #[test]
    fn test_absorb_branch_negative() {
        absorb_branch(false);
    }

    // ========================================================================
    // absorbMultipleBranches Tests
    // ========================================================================

    fn absorb_multiple_branches(positive_tick: bool) {
        let mut fixture = setup_vault_fixture();
        let vault_id = if positive_tick { 1u16 } else { 2u16 };

        let supply_decimals = fixture.get_vault_supply_token_decimals(vault_id);
        let borrow_decimals = fixture.get_vault_borrow_token_decimals(vault_id);

        let collateral = 10000_i128 * 10_i128.pow(supply_decimals as u32);
        let debt = 7990_i128 * 10_i128.pow(borrow_decimals as u32);
        let debt_two = 800_i128 * 10_i128.pow(borrow_decimals as u32);

        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        // Set initial oracle price
        let oracle_price = DEFAULT_ORACLE_PRICE;
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        // Create first two positions
        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);
        create_checked_position(&mut fixture, vault_id, collateral, debt_two, &alice);

        // First liquidation: 500% price crash
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 500)
            .expect("Failed to decrease oracle price");

        let liquidate_amt = 500_u64 * 10_u64.pow(borrow_decimals as u32);

        // First liquidation with absorb = true (creates branch 2)
        perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, true);

        // Reset oracle price to original
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        // Create third position
        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);

        // Second liquidation: 200% price crash
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 200)
            .expect("Failed to decrease oracle price");

        let liquidate_amt = 200_u64 * 10_u64.pow(borrow_decimals as u32);

        // Second liquidation with absorb = true (creates branch 3)
        perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, true);

        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 1500)
            .expect("Failed to decrease oracle price");

        // Perform absorption liquidation
        perform_checked_liquidate(&mut fixture, vault_id, 0, &bob, false);

        // Get vault data after absorption
        let vault_data = fixture
            .get_vault_entire_data(vault_id)
            .expect("Failed to get vault data");

        // Verify that we're now on branch 3
        assert_eq!(
            vault_data.vault_state.current_branch, 3,
            "Current branch should be 3"
        );

        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        // Final liquidation with larger amount
        let large_liquidate_amt = 5000_u64 * 10_u64.pow(borrow_decimals as u32);

        perform_checked_liquidate(&mut fixture, vault_id, large_liquidate_amt, &bob, true);

        // Get final vault data
        let vault_data = fixture
            .get_vault_entire_data(vault_id)
            .expect("Failed to get vault data");

        // Verify that positions 1 and 3 were absorbed
        let position1 = fixture.position_by_nft_id(1, vault_id).expect("Failed to get position");
        assert_eq!(position1.supply, 0, "Position 1 supply should be 0");
        assert_eq!(position1.borrow, 0, "Position 1 borrow should be 0");

        let position3 = fixture.position_by_nft_id(3, vault_id).expect("Failed to get position");
        assert_eq!(position3.supply, 0, "Position 3 supply should be 0");
        assert_eq!(position3.borrow, 0, "Position 3 borrow should be 0");

        // Verify we're still on branch 3
        assert_eq!(
            vault_data.vault_state.current_branch, 3,
            "Current branch should still be 3"
        );

        // Verify that position 2 is the top tick (the survivor)
        let position2 = fixture.position_by_nft_id(2, vault_id).expect("Failed to get position");
        assert_eq!(
            vault_data.vault_state.topmost_tick, position2.tick,
            "Position 2 should be top tick"
        );
    }

    #[test]
    fn test_absorb_multiple_branches_positive() {
        absorb_multiple_branches(true);
    }

    #[test]
    fn test_absorb_multiple_branches_negative() {
        absorb_multiple_branches(false);
    }

    // ========================================================================
    // absorbTickWhileBranchAsNextTopTick Tests
    // ========================================================================

    fn absorb_tick_while_branch_as_next_top_tick(positive_tick: bool) {
        let mut fixture = setup_vault_fixture();
        let vault_id = if positive_tick { 1u16 } else { 2u16 };

        let supply_decimals = fixture.get_vault_supply_token_decimals(vault_id);
        let borrow_decimals = fixture.get_vault_borrow_token_decimals(vault_id);

        let collateral = 10000_i128 * 10_i128.pow(supply_decimals as u32);
        let debt = 7990_i128 * 10_i128.pow(borrow_decimals as u32);

        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        // Set initial oracle price
        let oracle_price = DEFAULT_ORACLE_PRICE;
        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        // Create initial position
        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);

        // First liquidation: 200% price crash
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 200)
            .expect("Failed to decrease oracle price");

        let liquidate_amt = 500_u64 * 10_u64.pow(borrow_decimals as u32);

        // First liquidation with absorb = true
        perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, true);

        // Second liquidation: increase crash to 400% with larger liquidation amount
        let liquidate_amt = 1000_u64 * 10_u64.pow(borrow_decimals as u32);

        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 400)
            .expect("Failed to decrease oracle price");

        // Second liquidation with absorb = true
        perform_checked_liquidate(&mut fixture, vault_id, liquidate_amt, &bob, true);

        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        create_checked_position(&mut fixture, vault_id, collateral, debt, &alice);

        let vault_data = fixture
            .get_vault_entire_data(vault_id)
            .expect("Failed to get vault data");
        assert_eq!(
            vault_data.vault_state.current_branch, 2,
            "Current branch should be 2"
        );

        // Extreme price crash (1300% decrease) to trigger absorption
        fixture
            .set_oracle_price_percent_decrease(oracle_price, positive_tick, 1300)
            .expect("Failed to decrease oracle price");

        perform_checked_liquidate(&mut fixture, vault_id, 0, &bob, false);

        fixture
            .set_oracle_price(oracle_price, positive_tick)
            .expect("Failed to set oracle price");

        let vault_data = fixture
            .get_vault_entire_data(vault_id)
            .expect("Failed to get vault data");

        // Verify that we're back to branch 1 (branch 2 got absorbed)
        assert_eq!(
            vault_data.vault_state.current_branch, 1,
            "Current branch should be 1 after absorption"
        );

        // Verify that the first branch is in liquidated state
        if let Some(branch_state) = &vault_data.vault_state.current_branch_state {
            assert_eq!(branch_state.status, 1, "Branch should be in liquidated state");
        }
    }

    #[test]
    fn test_absorb_tick_while_branch_as_next_top_tick_positive() {
        absorb_tick_while_branch_as_next_top_tick(true);
    }

    #[test]
    fn test_absorb_tick_while_branch_as_next_top_tick_negative() {
        absorb_tick_while_branch_as_next_top_tick(false);
    }
}
