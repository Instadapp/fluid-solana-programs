//! Liquidity Claim Tests - Rust port of TypeScript `claim.test.ts`.
//!
//! This module contains tests for the claim functionality.

#[cfg(test)]
mod tests {
    use crate::liquidity::fixture::LiquidityFixture;
    use fluid_test_framework::helpers::MintKey;
    use fluid_test_framework::prelude::*;
    use liquidity::state::TransferType;

    const DEFAULT_AMOUNT: u64 = 5 * LAMPORTS_PER_SOL;

    fn setup_fixture() -> LiquidityFixture {
        let mut fixture = LiquidityFixture::new().expect("Failed to create fixture");
        fixture.setup().expect("Failed to setup fixture");
        fixture
    }

    /// Test: Borrow with claim transfer type
    #[test]
    fn test_borrow_with_claim_transfer_type() {
        let mut fixture = setup_fixture();
        let protocol = fixture.mock_protocol_with_interest.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(&protocol, DEFAULT_AMOUNT * 10, MintKey::USDC, &alice)
            .expect("Failed to deposit");

        let initial_balance = fixture.balance_of(&alice.pubkey(), MintKey::USDC);

        fixture
            .borrow_with_transfer_type(
                &protocol,
                DEFAULT_AMOUNT,
                MintKey::USDC,
                &alice,
                TransferType::CLAIM,
            )
            .expect("Failed to borrow with claim");

        // Read claim account
        let user_claim = fixture
            .read_user_claim(MintKey::USDC, &alice.pubkey())
            .expect("Failed to read user claim");

        assert_eq!(
            user_claim.amount, DEFAULT_AMOUNT,
            "Claim amount should equal borrow amount"
        );

        let final_balance = fixture.balance_of(&alice.pubkey(), MintKey::USDC);
        assert_eq!(
            final_balance, initial_balance,
            "Balance should not change before claim"
        );

        // perform claim
        fixture
            .claim(MintKey::USDC, &alice, None)
            .expect("Failed to claim");

        let balance_after_claim = fixture.balance_of(&alice.pubkey(), MintKey::USDC);
        assert_eq!(
            balance_after_claim,
            initial_balance + DEFAULT_AMOUNT,
            "Balance should increase by claimed amount"
        );
    }

    /// Test: Withdraw with claim transfer type
    #[test]
    fn test_withdraw_with_claim_transfer_type() {
        let mut fixture = setup_fixture();
        let protocol = fixture.mock_protocol_with_interest.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(&protocol, DEFAULT_AMOUNT * 10, MintKey::USDC, &alice)
            .expect("Failed to deposit");

        let initial_balance = fixture.balance_of(&alice.pubkey(), MintKey::USDC);

        fixture
            .withdraw_with_transfer_type(
                &protocol,
                DEFAULT_AMOUNT,
                MintKey::USDC,
                &alice,
                TransferType::CLAIM,
            )
            .expect("Failed to withdraw with claim");

        let user_claim = fixture
            .read_user_claim(MintKey::USDC, &alice.pubkey())
            .expect("Failed to read user claim");

        assert_eq!(
            user_claim.amount, DEFAULT_AMOUNT,
            "Claim amount should equal withdraw amount"
        );

        // balance should not change
        let final_balance = fixture.balance_of(&alice.pubkey(), MintKey::USDC);
        assert_eq!(
            final_balance, initial_balance,
            "Balance should not change before claim"
        );

        // perform claim
        fixture
            .claim(MintKey::USDC, &alice, None)
            .expect("Failed to claim");

        let balance_after_claim = fixture.balance_of(&alice.pubkey(), MintKey::USDC);
        assert_eq!(
            balance_after_claim,
            initial_balance + DEFAULT_AMOUNT,
            "Balance should increase by claimed amount"
        );
    }

    /// Test: Borrow with claim transfer type to recipient
    #[test]
    fn test_borrow_with_claim_transfer_type_to_recipient() {
        let mut fixture = setup_fixture();
        let protocol = fixture.mock_protocol_with_interest.insecure_clone();
        let alice = fixture.alice.insecure_clone();
        let bob = fixture.bob.insecure_clone();

        fixture
            .deposit(&protocol, DEFAULT_AMOUNT * 10, MintKey::USDC, &alice)
            .expect("Failed to deposit");

        let initial_balance_alice = fixture.balance_of(&alice.pubkey(), MintKey::USDC);

        fixture
            .borrow_with_transfer_type(
                &protocol,
                DEFAULT_AMOUNT,
                MintKey::USDC,
                &alice,
                TransferType::CLAIM,
            )
            .expect("Failed to borrow with claim");

        let final_balance_alice = fixture.balance_of(&alice.pubkey(), MintKey::USDC);
        assert_eq!(
            final_balance_alice, initial_balance_alice,
            "Alice balance should not change before claim"
        );

        let initial_balance_bob = fixture.balance_of(&bob.pubkey(), MintKey::USDC);

        // perform claim
        fixture
            .claim(MintKey::USDC, &alice, Some(&bob.pubkey()))
            .expect("Failed to claim to recipient");

        let final_balance_bob = fixture.balance_of(&bob.pubkey(), MintKey::USDC);
        assert_eq!(
            final_balance_bob,
            initial_balance_bob + DEFAULT_AMOUNT,
            "Bob balance should increase by claimed amount"
        );
    }

    /// Test: Withdraw with claim transfer type to recipient
    #[test]
    fn test_withdraw_with_claim_to_recipient() {
        let mut fixture = setup_fixture();
        let protocol = fixture.mock_protocol_with_interest.insecure_clone();
        let alice = fixture.alice.insecure_clone();
        let bob = fixture.bob.insecure_clone();

        fixture
            .deposit(&protocol, DEFAULT_AMOUNT * 10, MintKey::USDC, &alice)
            .expect("Failed to deposit");

        let initial_balance_alice = fixture.balance_of(&alice.pubkey(), MintKey::USDC);

        fixture
            .withdraw_with_transfer_type(
                &protocol,
                DEFAULT_AMOUNT,
                MintKey::USDC,
                &alice,
                TransferType::CLAIM,
            )
            .expect("Failed to withdraw with claim");

        // balance should not change
        let final_balance_alice = fixture.balance_of(&alice.pubkey(), MintKey::USDC);
        assert_eq!(
            final_balance_alice, initial_balance_alice,
            "Alice balance should not change before claim"
        );

        let initial_balance_bob = fixture.balance_of(&bob.pubkey(), MintKey::USDC);

        fixture
            .claim(MintKey::USDC, &alice, Some(&bob.pubkey()))
            .expect("Failed to claim to recipient");

        let final_balance_bob = fixture.balance_of(&bob.pubkey(), MintKey::USDC);
        assert_eq!(
            final_balance_bob,
            initial_balance_bob + DEFAULT_AMOUNT,
            "Bob balance should increase by claimed amount"
        );
    }

    /// Test: Close claim account
    #[test]
    fn test_close_claim_account() {
        let mut fixture = setup_fixture();
        let protocol = fixture.mock_protocol_with_interest.insecure_clone();
        let alice = fixture.alice.insecure_clone();
        let bob = fixture.bob.insecure_clone();

        fixture
            .deposit(&protocol, DEFAULT_AMOUNT * 10, MintKey::USDC, &alice)
            .expect("Failed to deposit");

        let initial_balance_alice = fixture.balance_of(&alice.pubkey(), MintKey::USDC);

        fixture
            .borrow_with_transfer_type(
                &protocol,
                DEFAULT_AMOUNT,
                MintKey::USDC,
                &alice,
                TransferType::CLAIM,
            )
            .expect("Failed to borrow with claim");

        let claim_pubkey = fixture.get_claim_account(MintKey::USDC, &alice.pubkey());

        let user_claim = fixture
            .read_user_claim(MintKey::USDC, &alice.pubkey())
            .expect("Failed to read user claim");
        assert_eq!(
            user_claim.amount, DEFAULT_AMOUNT,
            "Claim should have amount"
        );

        let final_balance_alice = fixture.balance_of(&alice.pubkey(), MintKey::USDC);
        assert_eq!(
            final_balance_alice, initial_balance_alice,
            "Alice balance should not change before claim"
        );

        let initial_balance_bob = fixture.balance_of(&bob.pubkey(), MintKey::USDC);

        fixture
            .claim(MintKey::USDC, &alice, Some(&bob.pubkey()))
            .expect("Failed to claim");

        let final_balance_bob = fixture.balance_of(&bob.pubkey(), MintKey::USDC);
        assert_eq!(
            final_balance_bob,
            initial_balance_bob + DEFAULT_AMOUNT,
            "Bob balance should increase by claimed amount"
        );

        let claim_account = fixture.vm.get_account(&claim_pubkey);
        assert!(claim_account.is_some(), "Claim account should exist");
        assert!(
            claim_account.unwrap().lamports > 0,
            "Claim account should have lamports before close"
        );

        fixture
            .close_claim_account(MintKey::USDC, &alice)
            .expect("Failed to close claim account");

        let claim_account_after = fixture.vm.get_account(&claim_pubkey);
        assert!(
            claim_account_after.is_none() || claim_account_after.unwrap().lamports == 0,
            "Claim account should not exist or have 0 lamports after close"
        );
    }

    /// Test: Close claim account when amount is not 0 should fail
    #[test]
    fn test_close_claim_account_when_amount_not_zero() {
        let mut fixture = setup_fixture();
        let protocol = fixture.mock_protocol_with_interest.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        fixture
            .deposit(&protocol, DEFAULT_AMOUNT * 10, MintKey::USDC, &alice)
            .expect("Failed to deposit");

        fixture
            .borrow_with_transfer_type(
                &protocol,
                DEFAULT_AMOUNT,
                MintKey::USDC,
                &alice,
                TransferType::CLAIM,
            )
            .expect("Failed to borrow with claim");

        let user_claim = fixture
            .read_user_claim(MintKey::USDC, &alice.pubkey())
            .expect("Failed to read user claim");
        assert_eq!(
            user_claim.amount, DEFAULT_AMOUNT,
            "Claim should have amount"
        );

        // Try to close without claiming - should fail
        fixture.expect_fail(|f| f.close_claim_account(MintKey::USDC, &alice));

        let claim_pubkey = fixture.get_claim_account(MintKey::USDC, &alice.pubkey());
        let claim_account = fixture.vm.get_account(&claim_pubkey);
        assert!(claim_account.is_some(), "Claim account should still exist");
        assert!(
            claim_account.unwrap().lamports > 0,
            "Claim account should still have lamports"
        );
    }
}
