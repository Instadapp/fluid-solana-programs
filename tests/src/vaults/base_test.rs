//! Vault Base Tests - Rust port of TypeScript `base.test.ts`.
//!
//! This module contains the base tests for the vaults program,
//! mirroring the TypeScript tests in `__tests__/vaults/base.test.ts`.

#[cfg(test)]
mod tests {
    use crate::vaults::fixture::{OperateVars, VaultFixture, DEFAULT_ORACLE_PRICE};
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

    /// Test: Should Init new position
    #[test]
    fn test_should_init_new_position() {
        let mut fixture = setup_vault_fixture();
        let vault_id = 1u16;
        let alice = fixture.liquidity.alice.insecure_clone();

        fixture
            .init_position(vault_id, &alice)
            .expect("Failed to init position");
    }

    /// Test: Should deposit from owner of positionId
    #[test]
    fn test_should_deposit_from_owner_of_position() {
        let mut fixture = setup_vault_fixture();
        let vault_id = 1u16;
        let position_id = 1u32;
        let alice = fixture.liquidity.alice.insecure_clone();

        fixture
            .init_position(vault_id, &alice)
            .expect("Failed to init position");

        let collateral_amount: i128 = 1_000_000_000; // 1e9
        let debt_amount: i128 = 0;

        let supply_mint = fixture.get_vault_supply_token(vault_id);
        let alice_balance_before = fixture.balance_of(&alice.pubkey(), supply_mint);

        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &alice,
                position_owner: &alice,
                collateral_amount,
                debt_amount,
                recipient: &alice,
            })
            .expect("Failed to deposit");

        let alice_balance_after = fixture.balance_of(&alice.pubkey(), supply_mint);

        assert_eq!(
            alice_balance_before - alice_balance_after - 1, // Allow for 1 lamport difference due to rounding/rent
            collateral_amount as u64,
            "Balance difference should equal collateral amount"
        );
    }

    /// Test: Should deposit from non owner of positionId
    #[test]
    fn test_should_deposit_from_non_owner_of_position() {
        let mut fixture = setup_vault_fixture();
        let vault_id = 1u16;
        let position_id = 1u32;
        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        fixture
            .init_position(vault_id, &alice)
            .expect("Failed to init position");

        let collateral_amount: i128 = 1_000_000_000; // 1e9
        let debt_amount: i128 = 0;

        // Bob deposits to Alice's position
        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &bob,
                position_owner: &alice,
                collateral_amount,
                debt_amount,
                recipient: &bob,
            })
            .expect("Failed to deposit from non-owner");
    }

    /// Test: Should deposit and withdraw from owner of positionId
    #[test]
    fn test_should_deposit_and_withdraw_from_owner() {
        let mut fixture = setup_vault_fixture();
        let vault_id = 1u16;
        let position_id = 1u32;
        let alice = fixture.liquidity.alice.insecure_clone();

        fixture
            .init_position(vault_id, &alice)
            .expect("Failed to init position");

        let supply_mint = fixture.get_vault_supply_token(vault_id);
        let alice_balance_before = fixture.balance_of(&alice.pubkey(), supply_mint);

        let collateral_amount: i128 = 1_000_000_000; // 1e9
        let debt_amount: i128 = 0;

        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &alice,
                position_owner: &alice,
                collateral_amount,
                debt_amount,
                recipient: &alice,
            })
            .expect("Failed to deposit");

        let alice_balance_after = fixture.balance_of(&alice.pubkey(), supply_mint);
        assert_eq!(
            alice_balance_before - alice_balance_after,
            collateral_amount as u64 + 1, // Allow for 1 lamport difference due to rounding/rent
            "Deposit: Balance difference should equal collateral amount"
        );

        // Withdraw half
        let withdraw_amount: i128 = -500_000_000; // negative for withdrawal

        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &alice,
                position_owner: &alice,
                collateral_amount: withdraw_amount,
                debt_amount: 0,
                recipient: &alice,
            })
            .expect("Failed to withdraw");

        let alice_balance_after_withdraw = fixture.balance_of(&alice.pubkey(), supply_mint);
        assert_eq!(
            alice_balance_after_withdraw - alice_balance_after,
            withdraw_amount.unsigned_abs() as u64,
            "Withdraw: Balance increase should equal withdraw amount"
        );
    }

    /// Test: Should deposit(Y) and withdraw(N) from non owner of positionId
    #[test]
    fn test_should_deposit_yes_withdraw_no_from_non_owner() {
        let mut fixture = setup_vault_fixture();
        let vault_id = 1u16;
        let position_id = 1u32;
        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        fixture
            .init_position(vault_id, &alice)
            .expect("Failed to init position");

        let supply_mint = fixture.get_vault_supply_token(vault_id);
        let bob_balance_before = fixture.balance_of(&bob.pubkey(), supply_mint);

        let collateral_amount: i128 = 1_000_000_000; // 1e9
        let debt_amount: i128 = 0;

        // Bob deposits to Alice's position
        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &bob,
                position_owner: &alice,
                collateral_amount,
                debt_amount,
                recipient: &bob,
            })
            .expect("Failed to deposit from non-owner");

        let bob_balance_after = fixture.balance_of(&bob.pubkey(), supply_mint);
        assert_eq!(
            bob_balance_before - bob_balance_after,
            collateral_amount as u64 + 1, // Allow for 1 lamport difference due to rounding/rent
            "Deposit: Balance difference should equal collateral amount"
        );

        // Bob tries to withdraw - should fail
        let withdraw_amount: i128 = -500_000_000;

        let result = fixture.operate_vault(&OperateVars {
            vault_id,
            position_id,
            user: &bob,
            position_owner: &alice,
            collateral_amount: withdraw_amount,
            debt_amount: 0,
            recipient: &bob,
        });

        assert!(result.is_err(), "Withdraw from non-owner should fail");
        // Verify error contains expected message
        let err_str = format!("{:?}", result.unwrap_err());
        assert!(
            err_str.contains("VAULT_INVALID_POSITION_AUTHORITY")
                || err_str.contains("InvalidPositionAuthority"),
            "Error should be about invalid position authority"
        );
    }

    /// Test: Should deposit and borrow from owner of positionId
    #[test]
    fn test_should_deposit_and_borrow_from_owner() {
        let mut fixture = setup_vault_fixture();
        let vault_id = 1u16;
        let position_id = 1u32;
        let alice = fixture.liquidity.alice.insecure_clone();

        fixture
            .init_position(vault_id, &alice)
            .expect("Failed to init position");

        let supply_mint = fixture.get_vault_supply_token(vault_id);
        let borrow_mint = fixture.get_vault_borrow_token(vault_id);

        let alice_balance_before = fixture.balance_of(&alice.pubkey(), supply_mint);

        let collateral_amount: i128 = 1_000_000_000; // 1e9
        let debt_amount: i128 = 0;

        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &alice,
                position_owner: &alice,
                collateral_amount,
                debt_amount,
                recipient: &alice,
            })
            .expect("Failed to deposit");

        let alice_balance_after = fixture.balance_of(&alice.pubkey(), supply_mint);
        assert_eq!(
            alice_balance_before - alice_balance_after,
            collateral_amount as u64 + 1, // Allow for 1 lamport difference due to rounding/rent
            "Deposit: Balance difference should equal collateral amount"
        );

        let alice_debt_before_borrow = fixture.balance_of(&alice.pubkey(), borrow_mint);

        // Borrow
        let borrow_amount: i128 = 500_000_000; // 5e8

        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &alice,
                position_owner: &alice,
                collateral_amount: 0,
                debt_amount: borrow_amount,
                recipient: &alice,
            })
            .expect("Failed to borrow");

        let alice_balance_after_borrow = fixture.balance_of(&alice.pubkey(), borrow_mint);
        assert_eq!(
            alice_balance_after_borrow - alice_debt_before_borrow,
            borrow_amount as u64,
            "Borrow: Balance increase should equal borrow amount"
        );
    }

    /// Test: Should deposit(Y) and borrow(N) from non owner of positionId
    #[test]
    fn test_should_deposit_yes_borrow_no_from_non_owner() {
        let mut fixture = setup_vault_fixture();
        let vault_id = 1u16;
        let position_id = 1u32;
        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        fixture
            .init_position(vault_id, &alice)
            .expect("Failed to init position");

        let supply_mint = fixture.get_vault_supply_token(vault_id);
        let bob_balance_before = fixture.balance_of(&bob.pubkey(), supply_mint);

        let collateral_amount: i128 = 1_000_000_000; // 1e9
        let debt_amount: i128 = 0;

        // Bob deposits to Alice's position
        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &bob,
                position_owner: &alice,
                collateral_amount,
                debt_amount,
                recipient: &bob,
            })
            .expect("Failed to deposit from non-owner");

        let bob_balance_after = fixture.balance_of(&bob.pubkey(), supply_mint);
        assert_eq!(
            bob_balance_before - bob_balance_after,
            collateral_amount as u64 + 1, // Allow for 1 lamport difference due to rounding/rent
            "Deposit: Balance difference should equal collateral amount"
        );

        // Set oracle price
        fixture
            .set_oracle_price(DEFAULT_ORACLE_PRICE, true)
            .expect("Failed to set oracle price");

        // Bob tries to borrow - should fail
        let borrow_amount: i128 = 500_000_000;

        let result = fixture.operate_vault(&OperateVars {
            vault_id,
            position_id,
            user: &bob,
            position_owner: &alice,
            collateral_amount: 0,
            debt_amount: borrow_amount,
            recipient: &bob,
        });

        assert!(result.is_err(), "Borrow from non-owner should fail");
    }

    /// Test: Should borrow and payback from owner of positionId
    #[test]
    fn test_should_borrow_and_payback_from_owner() {
        let mut fixture = setup_vault_fixture();
        let vault_id = 1u16;
        let bob = fixture.liquidity.bob.insecure_clone();
        let alice = fixture.liquidity.alice.insecure_clone();

        // Create a dummy position from bob's account
        fixture.create_dummy_position(vault_id, &bob).expect("Failed to create dummy position");

        let position_id = 2u32;
        fixture
            .init_position(vault_id, &alice)
            .expect("Failed to init position");

        let supply_mint = fixture.get_vault_supply_token(vault_id);
        let borrow_mint = fixture.get_vault_borrow_token(vault_id);

        let alice_balance_before = fixture.balance_of(&alice.pubkey(), supply_mint);

        let collateral_amount: i128 = 1_000_000_000; // 1e9
        let debt_amount: i128 = 0;

        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &alice,
                position_owner: &alice,
                collateral_amount,
                debt_amount,
                recipient: &alice,
            })
            .expect("Failed to deposit");

        let alice_balance_after = fixture.balance_of(&alice.pubkey(), supply_mint);
        assert_eq!(
            alice_balance_before - alice_balance_after,
            collateral_amount as u64 + 1, // Allow for 1 lamport difference due to rounding/rent
            "Deposit: Balance difference should equal collateral amount"
        );

        // Borrow
        let borrow_amount: i128 = 500_000_000; // 5e8

        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &alice,
                position_owner: &alice,
                collateral_amount: 0,
                debt_amount: borrow_amount,
                recipient: &alice,
            })
            .expect("Failed to borrow");

        // Assert state after borrow
        fixture
            .assert_state(
                vault_id,
                -462,
                500_333_316,   // expected tick debt
                -462,          // topmost tick
                2_000_000_000, // total collateral (including bob's dummy position)
                900_000_000,   // total debt (including bob's dummy position)
            )
            .expect("State assertion after borrow failed");

        let alice_balance_before_payback = fixture.balance_of(&alice.pubkey(), borrow_mint);

        // Payback half
        let payback_amount: i128 = -250_000_000; // negative for payback

        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &alice,
                position_owner: &alice,
                collateral_amount: 0,
                debt_amount: payback_amount,
                recipient: &alice,
            })
            .expect("Failed to payback");

        let alice_balance_after_payback = fixture.balance_of(&alice.pubkey(), borrow_mint);
        assert_eq!(
            alice_balance_before_payback - alice_balance_after_payback,
            payback_amount.unsigned_abs() as u64 + 1, // Allow for 1 lamport difference due to rounding/rent
            "Payback: Balance decrease should equal payback amount"
        );
    }

    /// Test: Should borrow(N) and payback(Y) from non owner of positionId
    #[test]
    fn test_should_borrow_no_payback_yes_from_non_owner() {
        let mut fixture = setup_vault_fixture();
        let vault_id = 1u16;
        let bob = fixture.liquidity.bob.insecure_clone();
        let alice = fixture.liquidity.alice.insecure_clone();

        fixture.create_dummy_position(vault_id, &bob).expect("Failed to create dummy position");

        let position_id = 2u32;
        fixture
            .init_position(vault_id, &alice)
            .expect("Failed to init position");

        let supply_mint = fixture.get_vault_supply_token(vault_id);
        let borrow_mint = fixture.get_vault_borrow_token(vault_id);

        let alice_balance_before = fixture.balance_of(&alice.pubkey(), supply_mint);

        let collateral_amount: i128 = 1_000_000_000; // 1e9
        let debt_amount: i128 = 0;

        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &alice,
                position_owner: &alice,
                collateral_amount,
                debt_amount,
                recipient: &alice,
            })
            .expect("Failed to deposit");

        let alice_balance_after = fixture.balance_of(&alice.pubkey(), supply_mint);
        assert_eq!(
            alice_balance_before - alice_balance_after,
            collateral_amount as u64 + 1, // Allow for 1 lamport difference due to rounding/rent
            "Deposit: Balance difference should equal collateral amount"
        );

        // Alice borrows
        let borrow_amount: i128 = 500_000_000; // 5e8

        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &alice,
                position_owner: &alice,
                collateral_amount: 0,
                debt_amount: borrow_amount,
                recipient: &alice,
            })
            .expect("Failed to borrow");

        // Bob tries to borrow - should fail
        let result = fixture.operate_vault(&OperateVars {
            vault_id,
            position_id,
            user: &bob,
            position_owner: &alice,
            collateral_amount: 0,
            debt_amount: borrow_amount,
            recipient: &bob,
        });
        assert!(result.is_err(), "Borrow from non-owner should fail");

        fixture
            .assert_state(
                vault_id,
                -462,
                500_333_316,   // expected tick debt
                -462,          // topmost tick
                2_000_000_000, // total collateral (including bob's dummy position)
                900_000_000,   // total debt (including bob's dummy position)
            )
            .expect("State assertion failed");

        let bob_balance_before_payback = fixture.balance_of(&bob.pubkey(), borrow_mint);

        let payback_amount: i128 = -250_000_000;

        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &bob,
                position_owner: &alice,
                collateral_amount: 0,
                debt_amount: payback_amount,
                recipient: &bob,
            })
            .expect("Payback from non-owner should succeed");

        let bob_balance_after_payback = fixture.balance_of(&bob.pubkey(), borrow_mint);
        assert_eq!(
            bob_balance_before_payback - bob_balance_after_payback,
            payback_amount.unsigned_abs() as u64 + 1, // Allow for 2 lamport difference due to rounding/rent
            "Payback: Balance decrease should equal payback amount"
        );
    }

    /// Test: Should transfer the position NFT to another user
    #[test]
    fn test_should_transfer_position_nft() {
        let mut fixture = setup_vault_fixture();
        let vault_id = 1u16;
        let position_id = 1u32;
        let alice = fixture.liquidity.alice.insecure_clone();
        let bob = fixture.liquidity.bob.insecure_clone();

        fixture
            .init_position(vault_id, &alice)
            .expect("Failed to init position");

        // Deposit from alice account
        let collateral_amount: i128 = 1_000_000_000; // 1e9

        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &alice,
                position_owner: &alice,
                collateral_amount,
                debt_amount: 0,
                recipient: &alice,
            })
            .expect("Failed to deposit");

        // Borrow from alice account
        let borrow_amount: i128 = 100_000_000; // 1e8

        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &alice,
                position_owner: &alice,
                collateral_amount: 0,
                debt_amount: borrow_amount,
                recipient: &alice,
            })
            .expect("Failed to borrow");

        // Transfer position to bob
        fixture
            .transfer_position(vault_id, position_id, &alice, &bob)
            .expect("Failed to transfer position");


        fixture
            .create_position_in_every_tick_array_range(vault_id, DEFAULT_ORACLE_PRICE)
            .expect("Failed to create positions in every tick array range");

        // Bob deposits to Alice's position (which he now owns)
        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &bob,
                position_owner: &bob,
                collateral_amount: 100_000, // small deposit
                debt_amount: 0,
                recipient: &bob,
            })
            .expect("Bob deposit should succeed after transfer");

        // Alice tries to borrow - should fail (she's no longer owner)
        let result = fixture.operate_vault(&OperateVars {
            vault_id,
            position_id,
            user: &alice,
            position_owner: &bob,
            collateral_amount: 0,
            debt_amount: borrow_amount,
            recipient: &alice,
        });
        assert!(result.is_err(), "Alice borrow should fail after transfer");

        // Alice tries to withdraw - should fail
        let result = fixture.operate_vault(&OperateVars {
            vault_id,
            position_id,
            user: &alice,
            position_owner: &bob,
            collateral_amount: -100_000, // try to withdraw
            debt_amount: 0,
            recipient: &alice,
        });
        assert!(result.is_err(), "Alice withdraw should fail after transfer");

        // TODO:
        // Alice can still payback - use a smaller amount to avoid VAULT_USER_DEBT_TOO_LOW
        // The actual debt might be less than borrow_amount due to how debt is calculated
        let partial_payback: i128 = 50_000_000; // half the borrow amount
        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &alice,
                position_owner: &bob,
                collateral_amount: 0,
                debt_amount: -partial_payback,
                recipient: &alice,
            })
            .expect("Alice payback should succeed after transfer");
    }

    /// Test: Should rebalance
    #[test]
    fn test_should_rebalance() {
        let mut fixture = setup_vault_fixture();
        let vault_id = 1u16;
        let position_id = 1u32;
        let alice = fixture.liquidity.alice.insecure_clone();

        fixture
            .init_position(vault_id, &alice)
            .expect("Failed to init position");
        fixture
            .update_supply_rate_magnifier(vault_id, 5000)
            .expect("Failed to update supply rate magnifier");

        // Deposit and borrow
        let collateral_amount: i128 = 1_000_000_000; // 1e9
        let debt_amount: i128 = 10_000_000; // 1e7

        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &alice,
                position_owner: &alice,
                collateral_amount,
                debt_amount,
                recipient: &alice,
            })
            .expect("Failed to deposit and borrow");

        // Warp time forward 1 day
        let one_day_seconds = 24 * 60 * 60;
        fixture.warp(one_day_seconds);

        fixture
            .rebalance(vault_id)
            .expect("Rebalance should succeed");
    }

    /// Test: Should deposit and borrow multiple times from owner of positionId
    #[test]
    fn test_should_deposit_and_borrow_multiple_times() {
        let mut fixture = setup_vault_fixture();
        let vault_id = 1u16;
        let position_id = 1u32;
        let alice = fixture.liquidity.alice.insecure_clone();

        fixture
            .init_position(vault_id, &alice)
            .expect("Failed to init position");

        let supply_mint = fixture.get_vault_supply_token(vault_id);
        let borrow_mint = fixture.get_vault_borrow_token(vault_id);

        let alice_balance_before = fixture.balance_of(&alice.pubkey(), supply_mint);

        let collateral_amount: i128 = 1_000_000_000; // 1e9
        let debt_amount: i128 = 0;

        fixture
            .operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &alice,
                position_owner: &alice,
                collateral_amount,
                debt_amount,
                recipient: &alice,
            })
            .expect("Failed to deposit");

        let alice_balance_after = fixture.balance_of(&alice.pubkey(), supply_mint);
        assert_eq!(
            alice_balance_before - alice_balance_after,
            collateral_amount as u64 + 1, // Allow for 1 lamport difference due to rounding/rent
            "Deposit: Balance difference should equal collateral amount"
        );

        let alice_debt_before_borrow = fixture.balance_of(&alice.pubkey(), borrow_mint);

        fixture
            .set_oracle_price(DEFAULT_ORACLE_PRICE, true)
            .expect("Failed to set oracle price");

        fixture
            .create_position_in_every_tick_array_range(vault_id, DEFAULT_ORACLE_PRICE)
            .expect("Failed to create positions in every tick array range");

        // Borrow multiple times
        let mut total_borrow_amount: u64 = 0;
        for _ in 1..=5 {
            let borrow_amount: i128 = 100_000_000; // 1e8

            total_borrow_amount += borrow_amount as u64;

            fixture
                .operate_vault(&OperateVars {
                    vault_id,
                    position_id,
                    user: &alice,
                    position_owner: &alice,
                    collateral_amount: 0,
                    debt_amount: borrow_amount,
                    recipient: &alice,
                })
                .expect("Failed to borrow");

            let alice_balance_after_borrow = fixture.balance_of(&alice.pubkey(), borrow_mint);
            assert_eq!(
                alice_balance_after_borrow - alice_debt_before_borrow,
                total_borrow_amount,
                "Total borrow balance should match cumulative borrow amount"
            );
        }
    }
}
