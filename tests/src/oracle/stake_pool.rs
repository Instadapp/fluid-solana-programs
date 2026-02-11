#[cfg(test)]
mod tests {
    use anchor_lang::prelude::borsh::BorshSchema;
    use anchor_lang::prelude::*;
    use solana_program::account_info::AccountInfo;
    #[allow(deprecated)]
    use solana_program::borsh0_10::try_from_slice_unchecked;
    use std::str::FromStr;

    use crate::addresses::addresses::STAKE_POOL_ADDRESS;
    use crate::connection::get_client;

    // Local schema definitions for deserialization (mirrors oracle program's stake_pool schema)
    #[repr(C)]
    #[derive(Clone, Copy, Debug, Default, PartialEq, AnchorSerialize, AnchorDeserialize, BorshSchema)]
    struct Lockup {
        pub unix_timestamp: i64,
        pub epoch: u64,
        pub custodian: Pubkey,
    }
    #[repr(C)]
    #[derive(Clone, Copy, Debug, PartialEq, AnchorSerialize, AnchorDeserialize, BorshSchema)]
    enum FutureEpoch<T> {
        None,
        One(T),
        Two(T),
    }

    impl<T> Default for FutureEpoch<T> {
        fn default() -> Self {
            Self::None
        }
    }

    #[derive(Clone, Debug, Default, PartialEq, AnchorDeserialize, AnchorSerialize, BorshSchema)]
    enum AccountType {
        #[default]
        Uninitialized,
        StakePool,
        ValidatorList,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Debug, Default, AnchorSerialize, AnchorDeserialize, BorshSchema)]
    struct Fee {
        pub denominator: u64,
        pub numerator: u64,
    }

    impl PartialEq for Fee {
        fn eq(&self, other: &Self) -> bool {
            let self_scaled = u128::from(self.numerator) * u128::from(other.denominator);
            let other_scaled = u128::from(other.numerator) * u128::from(self.denominator);
            self_scaled == other_scaled
        }
    }

    impl Eq for Fee {}

    impl PartialOrd for Fee {
        fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
            Some(self.cmp(other))
        }
    }

    impl Ord for Fee {
        fn cmp(&self, other: &Self) -> std::cmp::Ordering {
            let self_scaled = u128::from(self.numerator) * u128::from(other.denominator);
            let other_scaled = u128::from(other.numerator) * u128::from(self.denominator);
            self_scaled.cmp(&other_scaled)
        }
    }

    #[repr(C)]
    #[derive(Clone, Debug, Default, PartialEq, AnchorDeserialize, BorshSchema)]
    struct StakePool {
        pub account_type: AccountType,
        pub manager: Pubkey,
        pub staker: Pubkey,
        pub stake_deposit_authority: Pubkey,
        pub stake_withdraw_bump_seed: u8,
        pub validator_list: Pubkey,
        pub reserve_stake: Pubkey,
        pub pool_mint: Pubkey,
        pub manager_fee_account: Pubkey,
        pub token_program_id: Pubkey,
        pub total_lamports: u64,
        pub pool_token_supply: u64,
        pub last_update_epoch: u64,
        pub lockup: Lockup,
        pub epoch_fee: Fee,
        pub next_epoch_fee: FutureEpoch<Fee>,
        pub preferred_deposit_validator_vote_address: Option<Pubkey>,
        pub preferred_withdraw_validator_vote_address: Option<Pubkey>,
        pub stake_deposit_fee: Fee,
        pub stake_withdrawal_fee: Fee,
        pub next_stake_withdrawal_fee: FutureEpoch<Fee>,
        pub stake_referral_fee: u8,
        pub sol_deposit_authority: Option<Pubkey>,
        pub sol_deposit_fee: Fee,
        pub sol_referral_fee: u8,
        pub sol_withdraw_authority: Option<Pubkey>,
        pub sol_withdrawal_fee: Fee,
        pub next_sol_withdrawal_fee: FutureEpoch<Fee>,
        pub last_epoch_pool_token_supply: u64,
        pub last_epoch_total_lamports: u64,
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_stake_pool_deserialization() -> std::result::Result<(), Box<dyn std::error::Error>>
    {
        let client = get_client();

        let stake_pool_pubkey = Pubkey::from_str(STAKE_POOL_ADDRESS)
            .map_err(|e| format!("Failed to parse stake pool address: {}", e))?;

        let account_data = client
            .get_account_data(&stake_pool_pubkey)
            .map_err(|e| format!("Failed to fetch account data from chain: {}", e))?;

        println!("Account data length: {} bytes", account_data.len());

        #[allow(deprecated)]
        let stake_pool_state: StakePool = try_from_slice_unchecked::<StakePool>(&account_data)
            .map_err(|e| format!("Failed to deserialize stake pool state: {}", e))?;

        print_stake_pool_info(&stake_pool_state);

        Ok(())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_stake_pool_deserialization_with_account_info(
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        let client = get_client();

        let stake_pool_pubkey = Pubkey::from_str(STAKE_POOL_ADDRESS)
            .map_err(|e| format!("Failed to parse stake pool address: {}", e))?;

        let mut account_data = client
            .get_account_data(&stake_pool_pubkey)
            .map_err(|e| format!("Failed to fetch account data from chain: {}", e))?;

        let owner = Pubkey::default();
        let mut lamports: u64 = 0;

        let account_info = AccountInfo::new(
            &stake_pool_pubkey,
            false,
            false,
            &mut lamports,
            account_data.as_mut_slice(),
            &owner,
            false,
            0,
        );

        #[allow(deprecated)]
        let stake_pool = try_from_slice_unchecked::<StakePool>(&account_info.data.borrow())?;

        print_stake_pool_info(&stake_pool);

        Ok(())
    }

    fn print_stake_pool_info(state: &StakePool) {
        println!("\n=== Stake Pool State Information ===");
        println!("Manager: {}", state.manager);
        println!("Staker: {}", state.staker);
        println!("Stake Deposit Authority: {}", state.stake_deposit_authority);
        println!("Validator List: {}", state.validator_list);
        println!("Reserve Stake: {}", state.reserve_stake);
        println!("Pool Mint: {}", state.pool_mint);
        println!("Manager Fee Account: {}", state.manager_fee_account);
        println!("Token Program ID: {}", state.token_program_id);
        println!("Total Lamports: {}", state.total_lamports);
        println!("Pool Token Supply: {}", state.pool_token_supply);
        println!("Last Update Epoch: {}", state.last_update_epoch);
        println!(
            "Stake Deposit Fee: {}/{}",
            state.stake_deposit_fee.numerator, state.stake_deposit_fee.denominator
        );
        println!(
            "Stake Withdrawal Fee: {}/{}",
            state.stake_withdrawal_fee.numerator, state.stake_withdrawal_fee.denominator
        );
        println!(
            "SOL Deposit Fee: {}/{}",
            state.sol_deposit_fee.numerator, state.sol_deposit_fee.denominator
        );
        println!(
            "SOL Withdrawal Fee: {}/{}",
            state.sol_withdrawal_fee.numerator, state.sol_withdrawal_fee.denominator
        );
        println!(
            "Epoch Fee: {}/{}",
            state.epoch_fee.numerator, state.epoch_fee.denominator
        );
        println!("Stake Referral Fee: {}%", state.stake_referral_fee);
        println!("SOL Referral Fee: {}%", state.sol_referral_fee);
        println!(
            "Last Epoch Pool Token Supply: {}",
            state.last_epoch_pool_token_supply
        );
        println!(
            "Last Epoch Total Lamports: {}",
            state.last_epoch_total_lamports
        );
        println!("===================================\n");
    }
}
