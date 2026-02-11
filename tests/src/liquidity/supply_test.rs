//! Liquidity Supply Tests - Rust port of TypeScript `supply.test.ts`.
//!
//! This module contains tests for supply/deposit operations in the liquidity program.

#[cfg(test)]
mod tests {
    use crate::liquidity::fixture::LiquidityFixture;
    use fluid_test_framework::helpers::MintKey;
    use fluid_test_framework::prelude::*;

    const DEFAULT_AMOUNT: u64 = 5 * LAMPORTS_PER_SOL;

    fn setup_fixture() -> LiquidityFixture {
        let mut fixture = LiquidityFixture::new().expect("Failed to create fixture");
        fixture.setup().expect("Failed to setup fixture");
        fixture
    }

    /// Test: operate_RevertOperateAmountsNearlyZero
    #[test]
    fn test_operate_revert_operate_amounts_nearly_zero() {
        let mut fixture = setup_fixture();
        let protocol = fixture.mock_protocol_with_interest.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        // Try to deposit with amount 9 (< MIN_OPERATE_AMOUNT = 10)
        fixture.expect_revert_any(&["OperateAmountsNearlyZero", "6001"], |f| {
            f.deposit(&protocol, 9, MintKey::USDC, &alice)
        });
    }

    /// Test: operate_RevertDepositExpected
    #[test]
    fn test_operate_revert_deposit_expected() {
        let mut fixture = setup_fixture();
        let protocol = fixture.mock_protocol_with_interest.insecure_clone();
        let alice = fixture.alice.insecure_clone();
        let protocol_pubkey = protocol.pubkey();

        // Pre-operate
        fixture.pre_operate(MintKey::USDC, &protocol).unwrap();

        // just call operate
        let ix = fixture.operate_ix(
            &protocol_pubkey,
            MintKey::USDC,
            (DEFAULT_AMOUNT * 10) as i128,
            0,
            &alice.pubkey(),
            &alice.pubkey(),
            liquidity::state::TransferType::DIRECT,
        );

        fixture.vm.prank(protocol_pubkey);
        fixture
            .vm
            .execute_as_prank(ix)
            .expect_revert_containing_any(
                &fixture.vm,
                &["DepositExpected", "TransferAmountOutOfBounds"],
            );
    }

    /// Test: Should successfully deposit
    #[test]
    fn test_deposit() {
        let mut fixture = setup_fixture();
        let protocol = fixture.mock_protocol_with_interest.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let deposit_amount = DEFAULT_AMOUNT * 10;

        let balance_before = fixture.balance_of(&alice.pubkey(), MintKey::USDC);

        fixture
            .deposit(&protocol, deposit_amount, MintKey::USDC, &alice)
            .expect("Failed to deposit");

        let balance_after = fixture.balance_of(&alice.pubkey(), MintKey::USDC);

        assert_eq!(
            balance_before - balance_after,
            deposit_amount,
            "User balance should decrease by deposit amount"
        );

        // Verify supply position was created
        let user_supply = fixture
            .get_user_supply_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user supply data");

        assert!(
            user_supply.supply > 0,
            "Supply should be greater than 0 after deposit"
        );
    }

    /// Test: Should deposit with interest free mode
    #[test]
    fn test_deposit_interest_free() {
        let mut fixture = setup_fixture();
        let protocol = fixture.mock_protocol_interest_free.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let deposit_amount = DEFAULT_AMOUNT * 10;

        fixture
            .deposit(&protocol, deposit_amount, MintKey::USDC, &alice)
            .expect("Failed to deposit");

        let user_supply = fixture
            .get_user_supply_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user supply data");

        assert_eq!(
            user_supply.supply, deposit_amount,
            "Interest-free supply should equal deposit amount"
        );
    }

    /// Test: Multiple deposits accumulate
    #[test]
    fn test_multiple_deposits() {
        let mut fixture = setup_fixture();
        let protocol = fixture.mock_protocol_with_interest.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let deposit_amount = DEFAULT_AMOUNT;

        // First deposit
        fixture
            .deposit(&protocol, deposit_amount, MintKey::USDC, &alice)
            .expect("Failed to first deposit");

        let supply_after_first = fixture
            .get_user_supply_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user supply data")
            .supply;

        fixture.advance_slot();

        // Second deposit
        fixture
            .deposit(&protocol, deposit_amount, MintKey::USDC, &alice)
            .expect("Failed to second deposit");

        let supply_after_second = fixture
            .get_user_supply_data(MintKey::USDC, &protocol.pubkey())
            .expect("Failed to get user supply data")
            .supply;

        assert!(
            supply_after_second > supply_after_first,
            "Supply should increase after second deposit"
        );
    }

    /// Test: Deposit should update token reserve
    #[test]
    fn test_deposit_updates_token_reserve() {
        let mut fixture = setup_fixture();
        let protocol = fixture.mock_protocol_with_interest.insecure_clone();
        let alice = fixture.alice.insecure_clone();

        let deposit_amount = DEFAULT_AMOUNT * 10;

        let reserve_before = fixture
            .read_token_reserve(MintKey::USDC)
            .expect("Failed to read reserve");

        fixture
            .deposit(&protocol, deposit_amount, MintKey::USDC, &alice)
            .expect("Failed to deposit");

        let reserve_after = fixture
            .read_token_reserve(MintKey::USDC)
            .expect("Failed to read reserve");

        assert!(
            reserve_after.total_supply_with_interest > reserve_before.total_supply_with_interest,
            "Total supply with interest should increase"
        );
    }
}
