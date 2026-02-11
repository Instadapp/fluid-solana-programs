#[cfg(test)]
mod tests {
    use anchor_lang::prelude::*;
    use solana_program::account_info::AccountInfo;
    #[allow(deprecated)]
    use solana_program::borsh0_10::try_from_slice_unchecked;
    use solana_program::stake::state::StakeStateV2;
    use spl_token::solana_program::program_pack::Pack;
    use spl_token::state::Mint;
    use std::str::FromStr;

    use crate::addresses::addresses::{SINGLE_POOL_MINT, SINGLE_POOL_STAKE_ACCOUNT};
    use crate::connection::get_client;

    #[tokio::test(flavor = "multi_thread")]
    async fn test_single_pool_stake_account_deserialization(
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        let client = get_client();

        let stake_account_pubkey = Pubkey::from_str(SINGLE_POOL_STAKE_ACCOUNT)
            .map_err(|e| format!("Failed to parse stake account address: {}", e))?;

        let account_data = client
            .get_account_data(&stake_account_pubkey)
            .map_err(|e| format!("Failed to fetch stake account data from chain: {}", e))?;

        println!("Stake account data length: {} bytes", account_data.len());

        #[allow(deprecated)]
        let stake_state = try_from_slice_unchecked::<StakeStateV2>(&account_data)
            .map_err(|e| format!("Failed to deserialize stake state: {}", e))?;

        print_stake_state_info(&stake_state);

        Ok(())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_single_pool_price_calculation(
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        let client = get_client();

        // Fetch stake account
        let stake_account_pubkey = Pubkey::from_str(SINGLE_POOL_STAKE_ACCOUNT)
            .map_err(|e| format!("Failed to parse stake account address: {}", e))?;

        let mut stake_account_data = client
            .get_account_data(&stake_account_pubkey)
            .map_err(|e| format!("Failed to fetch stake account data: {}", e))?;

        // Fetch mint account
        let mint_pubkey = Pubkey::from_str(SINGLE_POOL_MINT)
            .map_err(|e| format!("Failed to parse mint address: {}", e))?;

        let mut mint_account_data = client
            .get_account_data(&mint_pubkey)
            .map_err(|e| format!("Failed to fetch mint account data: {}", e))?;

        // Create AccountInfo structures
        let stake_program_id = solana_program::stake::program::id();
        let token_program_id = spl_token::id();
        let mut stake_lamports: u64 = 0;
        let mut mint_lamports: u64 = 0;

        let stake_account_info = AccountInfo::new(
            &stake_account_pubkey,
            false,
            false,
            &mut stake_lamports,
            stake_account_data.as_mut_slice(),
            &stake_program_id,
            false,
            0,
        );

        let mint_account_info = AccountInfo::new(
            &mint_pubkey,
            false,
            false,
            &mut mint_lamports,
            mint_account_data.as_mut_slice(),
            &token_program_id,
            false,
            0,
        );

        // Deserialize for inspection
        #[allow(deprecated)]
        let stake_state =
            try_from_slice_unchecked::<StakeStateV2>(&stake_account_info.data.borrow())?;

        #[allow(deprecated)]
        let mint = Mint::unpack_from_slice(&mint_account_info.data.borrow())?;

        println!("\n=== Single Pool Price Calculation ===");

        let delegation_stake = match &stake_state {
            StakeStateV2::Stake(_, stake, _) => {
                println!("Delegation stake: {} lamports", stake.delegation.stake);
                stake.delegation.stake
            }
            _ => {
                println!("Stake account is not in delegated state");
                0
            }
        };

        println!("Token supply: {}", mint.supply);

        if mint.supply > 0 {
            // Simulate the price calculation logic
            const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
            const FACTOR: u128 = 10u128.pow(15); // RATE_OUTPUT_DECIMALS = 15

            // Note: In actual implementation, minimum_delegation is fetched via CPI
            // For this test, we'll use a conservative estimate
            let minimum_delegation = LAMPORTS_PER_SOL; // Conservative fallback
            let minimum_pool_balance = core::cmp::max(minimum_delegation, LAMPORTS_PER_SOL);

            let active_stake = delegation_stake.saturating_sub(minimum_pool_balance);

            let price = (active_stake as u128)
                .saturating_mul(FACTOR)
                .checked_div(mint.supply as u128)
                .ok_or("Division overflow")?;

            println!("Minimum pool balance: {} lamports", minimum_pool_balance);
            println!("Active stake: {} lamports", active_stake);
            println!("Calculated price: {} (scaled by 10^15)", price);

            // Convert to readable format
            let price_in_sol = price as f64 / FACTOR as f64;
            println!("Price in SOL per token: {:.6}", price_in_sol);
        } else {
            println!("Token supply is 0, price would be 1:1 (FACTOR)");
        }

        println!("====================================\n");

        Ok(())
    }

    fn print_stake_state_info(state: &StakeStateV2) {
        println!("\n=== Stake Account State Information ===");
        match state {
            StakeStateV2::Uninitialized => {
                println!("State: Uninitialized");
            }
            StakeStateV2::Initialized(meta) => {
                println!("State: Initialized");
                println!("Rent Exempt Reserve: {}", meta.rent_exempt_reserve);
                println!("Authorized Staker: {}", meta.authorized.staker);
                println!("Authorized Withdrawer: {}", meta.authorized.withdrawer);
            }
            StakeStateV2::Stake(meta, stake, _flags) => {
                println!("State: Stake");
                println!("Rent Exempt Reserve: {}", meta.rent_exempt_reserve);
                println!("Authorized Staker: {}", meta.authorized.staker);
                println!("Authorized Withdrawer: {}", meta.authorized.withdrawer);
                println!("Delegation Voter Pubkey: {}", stake.delegation.voter_pubkey);
                println!("Delegation Stake: {} lamports", stake.delegation.stake);
                println!(
                    "Delegation Activation Epoch: {}",
                    stake.delegation.activation_epoch
                );
                println!(
                    "Delegation Deactivation Epoch: {}",
                    stake.delegation.deactivation_epoch
                );
                println!("Credits Observed: {}", stake.credits_observed);
            }
            StakeStateV2::RewardsPool => {
                println!("State: RewardsPool");
            }
        }
        println!("=====================================\n");
    }
}
