#[cfg(test)]
mod tests {
    use anchor_lang::prelude::*;
    use solana_program::account_info::AccountInfo;
    #[allow(deprecated)]
    use solana_program::borsh0_10::try_from_slice_unchecked;
    use std::str::FromStr;

    use crate::addresses::addresses::MSOL_STATE_ADDRESS;
    use crate::connection::get_client;
    use oracle::state::schema::msol_pool::State as MsolPoolState;

    #[tokio::test(flavor = "multi_thread")]
    async fn test_msol_pool_deserialization() -> std::result::Result<(), Box<dyn std::error::Error>>
    {
        let client = get_client();

        let msol_pool_pubkey = Pubkey::from_str(MSOL_STATE_ADDRESS)
            .map_err(|e| format!("Failed to parse MSol pool address: {}", e))?;

        let account_data = client
            .get_account_data(&msol_pool_pubkey)
            .map_err(|e| format!("Failed to fetch account data from chain: {}", e))?;

        println!("Account data length: {} bytes", account_data.len());

        #[allow(deprecated)]
        let msol_pool_state: MsolPoolState =
            try_from_slice_unchecked::<MsolPoolState>(&account_data[8..])
                .map_err(|e| format!("Failed to deserialize MSol pool state: {}", e))?;

        print_msol_pool_info(&msol_pool_state);

        Ok(())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_msol_pool_deserialization_with_account_info(
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        let client = get_client();

        let msol_pool_pubkey = Pubkey::from_str(MSOL_STATE_ADDRESS)
            .map_err(|e| format!("Failed to parse MSol pool address: {}", e))?;

        let mut account_data = client
            .get_account_data(&msol_pool_pubkey)
            .map_err(|e| format!("Failed to fetch account data from chain: {}", e))?;

        let owner = Pubkey::default();
        let mut lamports: u64 = 0;

        let account_info = AccountInfo::new(
            &msol_pool_pubkey,
            false,
            false,
            &mut lamports,
            account_data.as_mut_slice(),
            &owner,
            false,
            0,
        );

        #[allow(deprecated)]
        let stake_pool =
            try_from_slice_unchecked::<MsolPoolState>(&account_info.data.borrow()[8..])?;

        print_msol_pool_info(&stake_pool);

        Ok(())
    }

    fn print_msol_pool_info(state: &MsolPoolState) {
        println!("\n=== MSol Pool State Information ===");
        println!("MSol Mint: {}", state.msol_mint);
        println!("Admin Authority: {}", state.admin_authority);
        println!("MSol Supply: {}", state.msol_supply);
        println!("MSol Price: {}", state.msol_price);
        println!(
            "Available Reserve Balance: {}",
            state.available_reserve_balance
        );
        println!(
            "Total Active Balance: {}",
            state.validator_system.total_active_balance
        );
        println!(
            "Total Validator Score: {}",
            state.validator_system.total_validator_score
        );
        println!("Minimum Stake: {}", state.stake_system.min_stake);
        println!("Minimum Deposit: {}", state.min_deposit);
        println!("Minimum Withdraw: {}", state.min_withdraw);
        println!("Staking SOL Cap: {}", state.staking_sol_cap);
        println!("Emergency Cooling Down: {}", state.emergency_cooling_down);
        println!("LP Supply: {}", state.liq_pool.lp_supply);
        println!(
            "LP Liquidity Target: {}",
            state.liq_pool.lp_liquidity_target
        );
        println!("===================================\n");
    }
}
