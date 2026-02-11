//! Vault Combination Tests - Rust port of TypeScript `combination.test.ts`.
//!
//! This module contains tests for vault operations that combine multiple
//! operations like deposit+borrow, withdraw+payback in single transactions.

#[cfg(test)]
mod tests {
    use crate::vaults::fixture::{
        OperateVars, VaultFixture, DEFAULT_ORACLE_PRICE,
    };
    use solana_sdk::signer::Signer;

    fn setup_vault_fixture() -> VaultFixture {
        let mut fixture = VaultFixture::new().expect("Failed to create vault fixture");
        fixture.setup().expect("Failed to setup vault fixture");
        // Set oracle price to be 1e8 for USDC/USDT (1:1 ratio)
        fixture
            .set_oracle_price(DEFAULT_ORACLE_PRICE, true)
            .expect("Failed to set oracle price");
        fixture
    }

    fn create_checked_position(
        fixture: &mut VaultFixture,
        vault_id: u16,
        collateral: i128,
        debt: i128,
        user: &solana_sdk::signature::Keypair,
        position_id: Option<u32>,
    ) -> u32 {
        let pos_id = if let Some(id) = position_id {
            id
        } else {
            let next_id = fixture
                .get_next_position_id(vault_id)
                .expect("Failed to get next position id");
            fixture
                .init_position(vault_id, user)
                .expect("Failed to init position");
            next_id
        };

        let supply_mint = fixture.get_vault_supply_token(vault_id);
        let borrow_mint = fixture.get_vault_borrow_token(vault_id);

        let user_supply_balance_before = fixture.balance_of(&user.pubkey(), supply_mint);
        let user_borrow_balance_before = fixture.balance_of(&user.pubkey(), borrow_mint);

        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id: pos_id,
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
        if collateral > 0 {
            assert_eq!(
                user_supply_balance_before - user_supply_balance_after,
                collateral as u64 + 1, // Allow for 1 lamport difference due to rounding/rent
                "Supply balance difference should equal collateral amount"
            );
        } else if collateral < 0 {
            assert_eq!(
                user_supply_balance_after - user_supply_balance_before,
                collateral.unsigned_abs() as u64,
                "Supply balance increase should equal withdraw amount"
            );
        }

        if debt > 0 {
            assert_eq!(
                user_borrow_balance_after - user_borrow_balance_before,
                debt as u64,
                "Borrow balance increase should equal debt amount"
            );
        } else if debt < 0 {
            assert_eq!(
                user_borrow_balance_before - user_borrow_balance_after,
                debt.unsigned_abs() as u64 + 1, // Allow for 1 lamport difference due to rounding/rent
                "Borrow balance decrease should equal payback amount"
            );
        }

        pos_id
    }

    /// Test: should handle deposit + borrow in single transaction
    #[test]
    fn test_should_handle_deposit_and_borrow_in_single_transaction() {
        let mut fixture = setup_vault_fixture();
        let vault_id = 1u16;
        let alice = fixture.liquidity.alice.insecure_clone();

        let collateral_amount: i128 = 1_000_000_000; // deposit 1000 USDC
        let debt_amount: i128 = 500_000_000; // borrow 500 USDT

        create_checked_position(&mut fixture, vault_id, collateral_amount, debt_amount, &alice, None);

        // Verify vault state
        fixture.assert_state(
            vault_id,
            -462,          // Expected tick for the ratio
            500_333_316,   // Expected debt in tick (with some margin)
            -462,          // topmost tick
            1_000_000_000, // Total collateral
            500_000_000,   // Total debt
        ).expect("Failed to assert state");
    }

    /// Test: should handle withdraw + payback in single transaction
    #[test]
    fn test_should_handle_withdraw_and_payback_in_single_transaction() {
        let mut fixture = setup_vault_fixture();
        let vault_id = 1u16;
        let alice = fixture.liquidity.alice.insecure_clone();

        let collateral: i128 = 1_000_000_000;
        let debt: i128 = 500_000_000;

        let position_id =
            create_checked_position(&mut fixture, vault_id, collateral, debt, &alice, None);

        let withdraw_amount: i128 = -300_000_000; // withdraw 300 USDC
        let payback_amount: i128 = -200_000_000; // payback 200 USDT

        // Perform withdraw + payback in single transaction
        create_checked_position(
            &mut fixture,
            vault_id,
            withdraw_amount,
            payback_amount,
            &alice,
            Some(position_id),
        );

        // Verify remaining position has 700 USDC collateral and 300 USDT debt
        fixture.assert_state(
            vault_id,
            -565,
            300_129_883,
            -565,
            700_000_000,
            300_000_000,
        ).expect("Failed to assert state");
    }

    /// Test: should handle deposit + payback in single transaction
    #[test]
    fn test_should_handle_deposit_and_payback_in_single_transaction() {
        let mut fixture = setup_vault_fixture();
        let vault_id = 1u16;
        let alice = fixture.liquidity.alice.insecure_clone();

        let collateral_amount: i128 = 1_000_000_000;
        let debt_amount: i128 = 500_000_000;

        // First create a position with collateral and debt
        let position_id = create_checked_position(
            &mut fixture,
            vault_id,
            collateral_amount,
            debt_amount,
            &alice,
            None,
        );

        let additional_collateral: i128 = 500_000_000; // deposit 500 more USDC
        let payback_amount: i128 = 200_000_000; // payback 200 USDT

        let supply_scale_factor =
            fixture.get_decimal_scale_factor(fixture.get_vault_supply_token(vault_id));
        let borrow_scale_factor =
            fixture.get_decimal_scale_factor(fixture.get_vault_borrow_token(vault_id));
        fixture
            .create_position_in_every_tick_array_range(vault_id, DEFAULT_ORACLE_PRICE)
            .expect("Failed to create positions in every tick array range");
        let state_after_helper = fixture.read_vault_state(vault_id).unwrap();
        let collateral_after_helper = state_after_helper.total_supply / supply_scale_factor;
        let debt_after_helper = state_after_helper.total_borrow / borrow_scale_factor;

        create_checked_position(
            &mut fixture,
            vault_id,
            additional_collateral,
            -payback_amount,
            &alice,
            Some(position_id),
        );

        let expected_total_collateral =
            collateral_after_helper + additional_collateral as u128;
        let expected_total_debt = debt_after_helper - payback_amount as u128;
        fixture
            .assert_state(
                vault_id,
                -1073,
                300_343_345,
                -1073,
                expected_total_collateral,
                expected_total_debt,
            )
            .expect("Failed to assert state");
    }

    /// Test: should handle withdraw + borrow in single transaction (if valid)
    #[test]
    fn test_should_handle_withdraw_and_borrow_in_single_transaction() {
        let mut fixture = setup_vault_fixture();
        let vault_id = 1u16;
        let alice = fixture.liquidity.alice.insecure_clone();

        let supply_amount: i128 = 2_000_000_000;
        let debt_amount: i128 = 0;

        let position_id =
            create_checked_position(&mut fixture, vault_id, supply_amount, debt_amount, &alice, None);

        let withdraw_amount: i128 = -500_000_000; // withdraw 500 USDC
        let borrow_amount: i128 = 400_000_000; // borrow 400 USDT

        create_checked_position(
            &mut fixture,
            vault_id,
            withdraw_amount,
            borrow_amount,
            &alice,
            Some(position_id),
        );

        // Verify position now has 1500 USDC collateral and 400 USDT debt
        fixture.assert_state(
            vault_id,
            -881,
            400_498_700,
            -881,
            1_500_000_000,
            400_000_000,
        ).expect("Failed to assert state");
    }

    /// Test: should reject withdraw + borrow if it makes position unsafe
    #[test]
    fn test_should_reject_withdraw_borrow_if_unsafe() {
        let mut fixture = setup_vault_fixture();
        let vault_id = 1u16;
        let alice = fixture.liquidity.alice.insecure_clone();

        let supply_amount: i128 = 1_000_000_000;
        let debt_amount: i128 = 0;

        let position_id =
            create_checked_position(&mut fixture, vault_id, supply_amount, debt_amount, &alice, None);

        // Try to withdraw too much while borrowing (should exceed collateral factor)
        let withdraw_amount: i128 = -800_000_000; // withdraw 800 USDC
        let borrow_amount: i128 = 700_000_000; // borrow 700 USDT

        let result = fixture.operate_vault(&OperateVars {
            vault_id,
            position_id,
            user: &alice,
            position_owner: &alice,
            collateral_amount: withdraw_amount,
            debt_amount: borrow_amount,
            recipient: &alice,
        });

        assert!(result.is_err(), "Should fail: VAULT_POSITION_ABOVE_CF");
        let err_str = format!("{:?}", result.unwrap_err());
        assert!(
            err_str.contains("VAULT_POSITION_ABOVE_CF") || err_str.contains("PositionAboveCF"),
            "Error should indicate position above collateral factor"
        );
    }

    /// Test: should allow non-owner to deposit + payback in single transaction
    #[test]
    fn test_should_allow_non_owner_deposit_and_payback() {
        let mut fixture = setup_vault_fixture();
        let vault_id = 1u16;
        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        let collateral: i128 = 1_000_000_000;
        let debt: i128 = 500_000_000;

        let position_id =
            create_checked_position(&mut fixture, vault_id, collateral, debt, &alice, None);

        let additional_collateral: i128 = 300_000_000; // Bob deposits 300 USDC
        let payback_amount: i128 = 200_000_000; // Bob pays back 200 USDT

        let supply_mint = fixture.get_vault_supply_token(vault_id);
        let borrow_mint = fixture.get_vault_borrow_token(vault_id);
        let supply_scale_factor = fixture.get_decimal_scale_factor(supply_mint);
        let borrow_scale_factor = fixture.get_decimal_scale_factor(borrow_mint);
        fixture
            .create_position_in_every_tick_array_range(vault_id, DEFAULT_ORACLE_PRICE)
            .expect("Failed to create positions in every tick array range");
        let state_after_helper = fixture.read_vault_state(vault_id).unwrap();
        let collateral_after_helper = state_after_helper.total_supply / supply_scale_factor;
        let debt_after_helper = state_after_helper.total_borrow / borrow_scale_factor;
        let expected_total_collateral =
            collateral_after_helper + additional_collateral as u128;

        let bob_supply_before = fixture.balance_of(&bob.pubkey(), supply_mint);
        let bob_borrow_before = fixture.balance_of(&bob.pubkey(), borrow_mint);

        // Bob can deposit + payback on Alice's position
        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &bob,
                position_owner: &alice,
                collateral_amount: additional_collateral,
                debt_amount: -payback_amount,
                recipient: &bob,
            })
            .expect("Bob should be able to deposit + payback on Alice's position");

        let bob_supply_after = fixture.balance_of(&bob.pubkey(), supply_mint);
        let bob_borrow_after = fixture.balance_of(&bob.pubkey(), borrow_mint);

        // Check Bob's token balances changed correctly
        assert_eq!(
            bob_supply_before - bob_supply_after,
            additional_collateral as u64 + 1, // Allow for 1 lamport difference due to rounding/rent
            "Bob's supply balance should decrease by deposit amount"
        );
        assert_eq!(
            bob_borrow_before - bob_borrow_after,
            payback_amount as u64 + 1, // Allow for 1 lamport difference due to rounding/rent
            "Bob's borrow balance should decrease by payback amount"
        );
        let expected_total_debt = debt_after_helper - payback_amount as u128;
        fixture
            .assert_state(
                vault_id,
                -978,
                300_130_894,
                -978,
                expected_total_collateral,
                expected_total_debt,
            )
            .expect("Failed to assert state");
    }

    /// Test: should reject non-owner trying withdraw + borrow
    #[test]
    fn test_should_reject_non_owner_withdraw_borrow() {
        let mut fixture = setup_vault_fixture();
        let vault_id = 1u16;
        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        let collateral: i128 = 2_000_000_000;
        let debt: i128 = 0;

        // Alice creates a position
        let position_id =
            create_checked_position(&mut fixture, vault_id, collateral, debt, &alice, None);

        // Bob tries to withdraw + borrow from Alice's position (should fail)
        let result = fixture.operate_vault(&OperateVars {
            vault_id,
            position_id,
            user: &bob,
            position_owner: &alice,
            collateral_amount: -500_000_000, // withdraw
            debt_amount: 300_000_000,        // borrow
            recipient: &bob,
        });

        assert!(result.is_err(), "Should fail: VAULT_INVALID_POSITION_AUTHORITY");
        let err_str = format!("{:?}", result.unwrap_err());
        assert!(
            err_str.contains("VAULT_INVALID_POSITION_AUTHORITY")
                || err_str.contains("InvalidPositionAuthority"),
            "Error should indicate invalid position authority"
        );
    }
}

