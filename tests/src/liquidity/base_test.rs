//! Liquidity Base Tests - Rust port of TypeScript `base.test.ts`.
//!
//! This module contains the base tests for the liquidity program,
//! mirroring the TypeScript tests in `__tests__/liquidity/base.test.ts`.

#[cfg(test)]
mod tests {
    use crate::liquidity::fixture::LiquidityFixture;
    use fluid_test_framework::helpers::MintKey;
    use fluid_test_framework::prelude::*;

    fn setup_basic_fixture() -> LiquidityFixture {
        LiquidityFixture::new().expect("Failed to create fixture")
    }

    fn setup_fixture_with_mints() -> (LiquidityFixture, Vec<MintKey>) {
        let mut fixture = setup_basic_fixture();
        let mints = MintKey::all();

        fixture
            .setup_spl_token_mints(&mints)
            .expect("Failed to setup mints");

        (fixture, mints)
    }

    fn setup_fixture_with_liquidity() -> LiquidityFixture {
        let mut fixture = setup_basic_fixture();
        fixture.init_liquidity().expect("Failed to init liquidity");
        fixture
    }

    fn setup_fixture_with_mints_and_liquidity() -> (LiquidityFixture, Vec<MintKey>) {
        let (mut fixture, mints) = setup_fixture_with_mints();
        fixture.init_liquidity().expect("Failed to init liquidity");
        (fixture, mints)
    }

    fn setup_fixture_with_token_reserves() -> (LiquidityFixture, Vec<MintKey>) {
        let (mut fixture, mints) = setup_fixture_with_mints_and_liquidity();
        fixture
            .init_token_reserve(&mints)
            .expect("Failed to init token reserves");
        (fixture, mints)
    }

    fn setup_fixture_with_rate_data() -> (LiquidityFixture, Vec<MintKey>) {
        let (mut fixture, mints) = setup_fixture_with_token_reserves();
        fixture
            .update_rate_data_v1(&mints)
            .expect("Failed to update rate data v1");
        (fixture, mints)
    }

    fn setup_fixture_with_token_configs() -> (LiquidityFixture, Vec<MintKey>) {
        let (mut fixture, mints) = setup_fixture_with_rate_data();
        fixture
            .update_token_configs(&mints)
            .expect("Failed to update token configs");
        (fixture, mints)
    }

    fn setup_fixture_with_protocols() -> (LiquidityFixture, Vec<MintKey>) {
        let (mut fixture, mints) = setup_fixture_with_token_configs();
        let mock_protocol = fixture.mock_protocol.pubkey();

        for mint in &mints {
            fixture
                .init_new_protocol(&[(*mint, *mint, mock_protocol)])
                .expect(&format!("Failed to init protocol for {:?}", mint));
        }

        (fixture, mints)
    }

    /// Test: Should setup mints
    #[test]
    fn test_should_setup_mints() {
        let (fixture, mints) = setup_fixture_with_mints();

        for mint in &mints {
            let mint_info = fixture.vm.get_mint_info(&mint.pubkey());
            assert!(mint_info.is_ok(), "Mint {:?} should exist", mint);
            let mint_info = mint_info.unwrap();
            assert_eq!(mint_info.decimals, mint.decimals());
        }
    }

    /// Test: Should init liquidity
    #[test]
    fn test_should_init_liquidity() {
        let fixture = setup_fixture_with_liquidity();

        let liquidity = fixture.read_liquidity().expect("Failed to read liquidity");

        // False = unlocked
        assert!(
            !liquidity.status,
            "Liquidity should be unlocked (status = false)"
        );
        assert_eq!(
            liquidity.authority,
            fixture.admin.pubkey(),
            "Authority should be admin"
        );
        assert_eq!(
            liquidity.revenue_collector,
            fixture.admin.pubkey(),
            "Revenue collector should be admin"
        );
    }

    /// Test: Should update auths
    #[test]
    fn test_should_update_auths() {
        let mut fixture = setup_fixture_with_liquidity();

        fixture.update_auths().expect("Failed to update auths");

        // Verify auth list
        let auth_list = fixture.read_auth_list().expect("Failed to read auth list");

        assert_eq!(auth_list.auth_users.len(), 2, "Should have 2 auth users");
        assert!(
            auth_list.auth_users.contains(&fixture.admin.pubkey()),
            "Admin should be in auth list"
        );
        assert!(
            auth_list.auth_users.contains(&fixture.admin2.pubkey()),
            "Admin2 should be in auth list"
        );
    }

    /// Test: Should update guardians
    #[test]
    fn test_should_update_guardians() {
        let mut fixture = setup_fixture_with_liquidity();

        fixture
            .update_guardians()
            .expect("Failed to update guardians");

        let auth_list = fixture.read_auth_list().expect("Failed to read auth list");

        assert_eq!(auth_list.guardians.len(), 2, "Should have 2 guardians");
        assert!(
            auth_list.guardians.contains(&fixture.admin.pubkey()),
            "Admin should be in guardians list"
        );
        assert!(
            auth_list.guardians.contains(&fixture.admin2.pubkey()),
            "Admin2 should be in guardians list"
        );
    }

    /// Test: Should update revenue collector
    #[test]
    fn test_should_update_revenue_collector() {
        let mut fixture = setup_fixture_with_liquidity();

        fixture
            .update_revenue_collector()
            .expect("Failed to update revenue collector");

        let liquidity = fixture.read_liquidity().expect("Failed to read liquidity");
        assert_eq!(
            liquidity.revenue_collector,
            fixture.admin.pubkey(),
            "Revenue collector should be admin"
        );
    }

    /// Test: Should init token reserve
    #[test]
    fn test_should_init_token_reserve() {
        let (fixture, mints) = setup_fixture_with_token_reserves();

        for mint in &mints {
            let reserve = fixture
                .read_token_reserve(*mint)
                .expect("Failed to read reserve");

            assert_eq!(
                reserve.supply_exchange_price,
                LiquidityFixture::EXCHANGE_PRICES_PRECISION,
                "Supply exchange price should be 1e12"
            );
            assert_eq!(
                reserve.borrow_exchange_price,
                LiquidityFixture::EXCHANGE_PRICES_PRECISION,
                "Borrow exchange price should be 1e12"
            );
            assert!(
                reserve.last_update_timestamp > 0,
                "Last update timestamp should be > 0"
            );
            assert_eq!(
                reserve.total_supply_with_interest, 0,
                "Total supply with interest should be 0"
            );
            assert_eq!(
                reserve.total_supply_interest_free, 0,
                "Total supply interest free should be 0"
            );
            assert_eq!(
                reserve.total_borrow_with_interest, 0,
                "Total borrow with interest should be 0"
            );
            assert_eq!(
                reserve.total_borrow_interest_free, 0,
                "Total borrow interest free should be 0"
            );
        }
    }

    /// Test: Should update rate data v1
    #[test]
    fn test_should_update_rate_data_v1() {
        let (mut fixture, mints) = setup_fixture_with_token_reserves();

        fixture
            .update_rate_data_v1(&mints[0..2].to_vec())
            .expect("Failed to update rate data v1 batch 1");

        fixture
            .update_rate_data_v1(&mints[2..4].to_vec())
            .expect("Failed to update rate data v1 batch 2");
    }

    /// Test: Should update token configs
    #[test]
    fn test_should_update_token_configs() {
        let (fixture, mints) = setup_fixture_with_token_configs();

        // Verify token configs
        for mint in &mints {
            let reserve = fixture
                .read_token_reserve(*mint)
                .expect(&format!("Failed to read reserve for {:?}", mint));

            assert_eq!(reserve.fee_on_interest, 0, "Fee on interest should be 0");
            assert_eq!(reserve.last_utilization, 0, "Last utilization should be 0");
            assert!(
                reserve.last_update_timestamp > 0,
                "Last update timestamp should be set"
            );
        }
    }

    /// Test: Should setup ATA for Liquidity
    #[test]
    fn test_should_setup_ata_for_liquidity() {
        let (mut fixture, _) = setup_fixture_with_mints();

        let liquidity_pda = fixture.get_liquidity();

        fixture
            .setup_ata(MintKey::USDC, &liquidity_pda, 0)
            .expect("Failed to setup USDC ATA");
        fixture
            .setup_ata(MintKey::WSOL, &liquidity_pda, 0)
            .expect("Failed to setup WSOL ATA");
        fixture
            .setup_ata(MintKey::EURC, &liquidity_pda, 0)
            .expect("Failed to setup EURC ATA");

        // Verify ATAs exist with 0 balance
        assert!(
            fixture
                .vm
                .ata_exists(&liquidity_pda, &MintKey::USDC.pubkey()),
            "USDC ATA should exist"
        );
        assert!(
            fixture
                .vm
                .ata_exists(&liquidity_pda, &MintKey::WSOL.pubkey()),
            "WSOL ATA should exist"
        );
        assert!(
            fixture
                .vm
                .ata_exists(&liquidity_pda, &MintKey::EURC.pubkey()),
            "EURC ATA should exist"
        );
    }

    /// Test: Should setup ATA for user
    #[test]
    fn test_should_setup_ata_for_user() {
        let (mut fixture, _) = setup_fixture_with_mints();

        let user = fixture.alice.pubkey();

        fixture
            .setup_ata(MintKey::USDC, &user, 10_000_000_000)
            .expect("Failed to setup USDC ATA");
        fixture
            .setup_ata(MintKey::WSOL, &user, 1_000_000_000_000)
            .expect("Failed to setup WSOL ATA");
        fixture
            .setup_ata(MintKey::EURC, &user, 10_000_000_000)
            .expect("Failed to setup EURC ATA");

        // Verify ATAs exist with correct balances
        assert_eq!(
            fixture.vm.token_balance(&user, &MintKey::USDC.pubkey()),
            10_000_000_000,
            "USDC balance should be 1e10"
        );
        assert_eq!(
            fixture.vm.token_balance(&user, &MintKey::WSOL.pubkey()),
            1_000_000_000_000,
            "WSOL balance should be 1e12"
        );
        assert_eq!(
            fixture.vm.token_balance(&user, &MintKey::EURC.pubkey()),
            10_000_000_000,
            "EURC balance should be 1e10"
        );
    }

    /// Test: Should init new protocol
    #[test]
    fn test_should_init_new_protocol() {
        let (fixture, _) = setup_fixture_with_protocols();

        let mock_protocol = fixture.mock_protocol.pubkey();
        let supply_position = fixture
            .read_user_supply_position(MintKey::USDC, &mock_protocol)
            .expect("Failed to read user supply position");

        assert_eq!(
            supply_position.protocol, mock_protocol,
            "Protocol should match"
        );
    }

    /// Test: Should update user supply config
    #[test]
    fn test_should_update_user_supply_config() {
        let (mut fixture, mints) = setup_fixture_with_protocols();

        let mock_protocol = fixture.mock_protocol.pubkey();

        // Update supply configs
        for mint in &mints {
            fixture
                .update_user_supply_config(*mint, &mock_protocol, true)
                .expect(&format!("Failed to update supply config for {:?}", mint));
        }
    }

    /// Test: Should update user borrow config
    #[test]
    fn test_should_update_user_borrow_config() {
        let (mut fixture, _) = setup_fixture_with_protocols();
        let mints = vec![MintKey::USDC, MintKey::EURC];

        let mock_protocol = fixture.mock_protocol.pubkey();

        // Update borrow configs
        for mint in &mints {
            fixture
                .update_user_borrow_config(*mint, &mock_protocol, true)
                .expect(&format!("Failed to update borrow config for {:?}", mint));
        }
    }

    /// Test: Complete setup flow (integration test)
    #[test]
    fn test_complete_setup_flow() {
        let mut fixture = LiquidityFixture::new().expect("Failed to create fixture");
        let mints = MintKey::all();

        // 1. Setup mints
        fixture
            .setup_spl_token_mints(&mints)
            .expect("Failed to setup mints");

        // 2. Init liquidity
        fixture.init_liquidity().expect("Failed to init liquidity");

        let liquidity = fixture.read_liquidity().expect("Failed to read liquidity");
        assert!(!liquidity.status, "Should be unlocked");
        assert_eq!(liquidity.authority, fixture.admin.pubkey());

        // 3. Update auths
        fixture.update_auths().expect("Failed to update auths");
        let auth_list = fixture.read_auth_list().expect("Failed to read auth list");
        assert_eq!(auth_list.auth_users.len(), 2);

        // 4. Update guardians
        fixture
            .update_guardians()
            .expect("Failed to update guardians");
        let auth_list = fixture.read_auth_list().expect("Failed to read auth list");
        assert_eq!(auth_list.guardians.len(), 2);

        // 5. Update revenue collector
        fixture
            .update_revenue_collector()
            .expect("Failed to update revenue collector");

        // 6. Init token reserves
        fixture
            .init_token_reserve(&mints)
            .expect("Failed to init token reserves");

        for mint in &mints {
            let reserve = fixture
                .read_token_reserve(*mint)
                .expect("Failed to read reserve");
            assert_eq!(
                reserve.supply_exchange_price,
                LiquidityFixture::EXCHANGE_PRICES_PRECISION
            );
            assert_eq!(
                reserve.borrow_exchange_price,
                LiquidityFixture::EXCHANGE_PRICES_PRECISION
            );
        }

        // 7. Update rate data
        fixture
            .update_rate_data_v1(&mints)
            .expect("Failed to update rate data");

        fixture
            .update_rate_data_v2(&mints)
            .expect("Failed to update rate data v2");

        // 8. Update token configs
        fixture
            .update_token_configs(&mints)
            .expect("Failed to update token configs");

        for mint in &mints {
            let reserve = fixture
                .read_token_reserve(*mint)
                .expect("Failed to read reserve");
            assert_eq!(reserve.fee_on_interest, 0);
        }

        // 9. Setup ATAs for liquidity
        let liquidity_pda = fixture.get_liquidity();
        for mint in &mints {
            fixture
                .setup_ata(*mint, &liquidity_pda, 0)
                .expect("Failed to setup liquidity ATA");
        }

        // 10. Setup ATAs for users
        let alice = fixture.alice.pubkey();
        for mint in &mints {
            fixture
                .setup_ata(*mint, &alice, 10_000_000_000)
                .expect("Failed to setup user ATA");
        }

        // 11. Init protocols
        let mock_protocol = fixture.mock_protocol.pubkey();
        for mint in &mints {
            fixture
                .init_new_protocol(&[(*mint, *mint, mock_protocol)])
                .expect("Failed to init protocol");
        }

        let supply_position = fixture
            .read_user_supply_position(MintKey::USDC, &mock_protocol)
            .expect("Failed to read supply position");
        assert_eq!(supply_position.protocol, mock_protocol);

        // 12. Update user supply configs
        for mint in &mints {
            fixture
                .update_user_supply_config(*mint, &mock_protocol, true)
                .expect("Failed to update supply config");
        }

        // 13. Update user borrow configs
        for mint in &mints {
            fixture
                .update_user_borrow_config(*mint, &mock_protocol, true)
                .expect("Failed to update borrow config");
        }

        println!("Complete setup flow passed successfully!");
    }
}
