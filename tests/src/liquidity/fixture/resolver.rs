//! Resolver data structures and account reading methods
//!
//! This module contains data structures for reading on-chain state
//! and resolver-style methods similar to TypeScript resolver utilities.

use {
    super::LiquidityFixture,
    anchor_lang::prelude::*,
    bytemuck,
    fluid_test_framework::helpers::MintKey,
    fluid_test_framework::prelude::*,
    fluid_test_framework::Result as VmResult,
    liquidity::{
        constants::FOUR_DECIMALS,
        state::{
            AuthorizationList, TokenReserve, UserBorrowPosition, UserClaim, UserSupplyPosition,
        },
    },
};

/// Token reserve data
#[derive(Debug, Clone)]
pub struct TokenReserveData {
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub borrow_rate: u16,
    pub fee_on_interest: u16,
    pub last_utilization: u16,
    pub last_update_timestamp: u64,
    pub supply_exchange_price: u64,
    pub borrow_exchange_price: u64,
    pub max_utilization: u16,
    pub total_supply_with_interest: u64,
    pub total_supply_interest_free: u64,
    pub total_borrow_with_interest: u64,
    pub total_borrow_interest_free: u64,
}

impl From<&TokenReserve> for TokenReserveData {
    fn from(reserve: &TokenReserve) -> Self {
        Self {
            mint: reserve.mint,
            vault: reserve.vault,
            borrow_rate: reserve.borrow_rate,
            fee_on_interest: reserve.fee_on_interest,
            last_utilization: reserve.last_utilization,
            last_update_timestamp: reserve.last_update_timestamp,
            supply_exchange_price: reserve.supply_exchange_price,
            borrow_exchange_price: reserve.borrow_exchange_price,
            max_utilization: reserve.max_utilization,
            total_supply_with_interest: reserve.total_supply_with_interest,
            total_supply_interest_free: reserve.total_supply_interest_free,
            total_borrow_with_interest: reserve.total_borrow_with_interest,
            total_borrow_interest_free: reserve.total_borrow_interest_free,
        }
    }
}

/// user supply position data
#[derive(Debug, Clone)]
pub struct UserSupplyPositionData {
    pub protocol: Pubkey,
    pub mint: Pubkey,
    pub supply: u128,
    pub previous_limit: u128,
    pub last_update_timestamp: u64,
    pub mode: u8,
    pub is_paused: u8,
    pub expand_percent: u128,
    pub expand_duration: u128,
    pub base_withdrawal_limit: u128,
}

impl From<&UserSupplyPosition> for UserSupplyPositionData {
    fn from(position: &UserSupplyPosition) -> Self {
        Self {
            protocol: position.protocol,
            mint: position.mint,
            supply: position.amount as u128,
            previous_limit: position.withdrawal_limit,
            last_update_timestamp: position.last_update,
            mode: position.with_interest,
            is_paused: position.status,
            expand_percent: position.expand_pct as u128,
            expand_duration: position.expand_duration as u128,
            base_withdrawal_limit: position.base_withdrawal_limit as u128,
        }
    }
}

/// Full user borrow position data
#[derive(Debug, Clone)]
pub struct UserBorrowPositionFull {
    pub protocol: Pubkey,
    pub mint: Pubkey,
    pub borrow: u128,
    pub previous_limit: u128,
    pub last_update_timestamp: u64,
    pub mode: u8,
    pub is_paused: u8,
    pub expand_percent: u128,
    pub expand_duration: u128,
    pub base_debt_ceiling: u128,
    pub max_debt_ceiling: u128,
}

impl From<&UserBorrowPosition> for UserBorrowPositionFull {
    fn from(position: &UserBorrowPosition) -> Self {
        Self {
            protocol: position.protocol,
            mint: position.mint,
            borrow: position.amount as u128,
            previous_limit: position.debt_ceiling as u128,
            last_update_timestamp: position.last_update,
            mode: position.with_interest,
            is_paused: position.status,
            expand_percent: position.expand_pct as u128,
            expand_duration: position.expand_duration as u128,
            base_debt_ceiling: position.base_debt_ceiling as u128,
            max_debt_ceiling: position.max_debt_ceiling as u128,
        }
    }
}

/// Overall token data
#[derive(Debug, Clone)]
pub struct OverallTokenData {
    pub supply_exchange_price: u64,
    pub borrow_exchange_price: u64,
    pub supply_raw_interest: u64,
    pub supply_interest_free: u64,
    pub borrow_raw_interest: u64,
    pub borrow_interest_free: u64,
    pub total_supply: u64,
    pub total_borrow: u64,
    pub borrow_rate: u16,
    pub last_stored_utilization: u16,
    pub supply_rate: u16,
}

/// User supply data
#[derive(Debug, Clone)]
pub struct UserSupplyData {
    pub supply: u64,
    pub withdrawal_limit: u64,
    pub withdrawable_until_limit: u64,
    pub withdrawable: u64,
}

/// User borrow data
#[derive(Debug, Clone)]
pub struct UserBorrowData {
    pub borrow: u64,
    pub borrow_limit: u64,
    pub max_borrow_limit: u64,
    pub borrowable_until_limit: u64,
    pub borrowable: u64,
}

/// User claim data
#[derive(Debug, Clone)]
pub struct UserClaimData {
    pub user: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}

impl From<&UserClaim> for UserClaimData {
    fn from(claim: &UserClaim) -> Self {
        Self {
            user: claim.user,
            mint: claim.mint,
            amount: claim.amount,
        }
    }
}

impl LiquidityFixture {
    pub fn expose_total_amount(
        &mut self,
        mint: MintKey,
        total_supply_with_interest: u64,
        total_supply_interest_free: u64,
        total_borrow_with_interest: u64,
        total_borrow_interest_free: u64,
    ) -> VmResult<()> {
        let reserve_pubkey = self.get_reserve(mint);
        let account = self
            .vm
            .get_account(&reserve_pubkey)
            .ok_or(VmError::AccountNotFound(reserve_pubkey.to_string()))?;

        // Skip discriminator (8 bytes)
        let mut data = account.data.clone();
        let reserve: &mut TokenReserve =
            bytemuck::from_bytes_mut(&mut data[8..8 + std::mem::size_of::<TokenReserve>()]);

        reserve.total_supply_with_interest = total_supply_with_interest;
        reserve.total_supply_interest_free = total_supply_interest_free;
        reserve.total_borrow_with_interest = total_borrow_with_interest;
        reserve.total_borrow_interest_free = total_borrow_interest_free;

        let updated_account = solana_sdk::account::Account {
            lamports: account.lamports,
            data,
            owner: account.owner,
            executable: account.executable,
            rent_epoch: account.rent_epoch,
        };

        self.vm.set_account(&reserve_pubkey, updated_account)?;
        Ok(())
    }

    /// Expose exchange prices with rates for testing
    pub fn expose_exchange_price_with_rates(
        &mut self,
        mint: MintKey,
        supply_exchange_price: u64,
        borrow_exchange_price: u64,
        utilization: u16,
        borrow_rate: u16,
        last_update_timestamp: u64,
    ) -> VmResult<()> {
        let reserve_pubkey = self.get_reserve(mint);
        let account = self
            .vm
            .get_account(&reserve_pubkey)
            .ok_or(VmError::AccountNotFound(reserve_pubkey.to_string()))?;

        // Skip discriminator (8 bytes)
        let mut data = account.data.clone();
        let reserve: &mut TokenReserve =
            bytemuck::from_bytes_mut(&mut data[8..8 + std::mem::size_of::<TokenReserve>()]);

        reserve.supply_exchange_price = supply_exchange_price;
        reserve.borrow_exchange_price = borrow_exchange_price;
        reserve.last_utilization = utilization;
        reserve.borrow_rate = borrow_rate;
        reserve.last_update_timestamp = last_update_timestamp;

        let updated_account = solana_sdk::account::Account {
            lamports: account.lamports,
            data,
            owner: account.owner,
            executable: account.executable,
            rent_epoch: account.rent_epoch,
        };

        self.vm.set_account(&reserve_pubkey, updated_account)?;
        Ok(())
    }

    /// Get current timestamp from VM clock
    pub fn get_timestamp(&self) -> u64 {
        self.vm.clock().unix_timestamp as u64
    }

    pub fn balance_of(&self, owner: &Pubkey, mint: MintKey) -> u64 {
        self.vm.token_balance(owner, &mint.pubkey())
    }

    /// Get overall token data for a mint
    pub fn get_overall_token_data(&self, mint: MintKey) -> VmResult<OverallTokenData> {
        let reserve = self.read_token_reserve(mint)?;

        let supply_raw_interest = reserve.total_supply_with_interest;
        let supply_interest_free = reserve.total_supply_interest_free;
        let borrow_raw_interest = reserve.total_borrow_with_interest;
        let borrow_interest_free = reserve.total_borrow_interest_free;

        // Use wider arithmetic to avoid overflow when multiplying large
        // exchange prices and interest-bearing amounts.
        let total_supply = (supply_raw_interest as u128 * reserve.supply_exchange_price as u128)
            / Self::EXCHANGE_PRICES_PRECISION as u128
            + supply_interest_free as u128;

        let total_borrow = (borrow_raw_interest as u128 * reserve.borrow_exchange_price as u128)
            / Self::EXCHANGE_PRICES_PRECISION as u128
            + borrow_interest_free as u128;

        Ok(OverallTokenData {
            supply_exchange_price: reserve.supply_exchange_price,
            borrow_exchange_price: reserve.borrow_exchange_price,
            supply_raw_interest,
            supply_interest_free,
            borrow_raw_interest,
            borrow_interest_free,
            total_supply: total_supply as u64,
            total_borrow: total_borrow as u64,
            borrow_rate: reserve.borrow_rate,
            last_stored_utilization: reserve.last_utilization,
            supply_rate: 0, // TODO: Implement supply rate calculation
        })
    }

    /// Get user supply data
    pub fn get_user_supply_data(
        &self,
        mint: MintKey,
        protocol: &Pubkey,
    ) -> VmResult<UserSupplyData> {
        let reserve = self.read_token_reserve(mint)?;
        let position = self.read_user_supply_position(mint, protocol)?;

        let supply = if position.mode == 0 {
            // Interest free
            position.supply as u64
        } else {
            // With interest
            ((position.supply * reserve.supply_exchange_price as u128)
                / Self::EXCHANGE_PRICES_PRECISION as u128) as u64
        };

        let withdrawal_limit =
            self.calc_withdrawal_limit_before_operate(&position, supply, self.get_timestamp());
        let withdrawable_until_limit = supply.saturating_sub(withdrawal_limit);

        Ok(UserSupplyData {
            supply,
            withdrawal_limit,
            withdrawable_until_limit,
            withdrawable: withdrawable_until_limit,
        })
    }

    /// Get user borrow data
    pub fn get_user_borrow_data(
        &self,
        mint: MintKey,
        protocol: &Pubkey,
    ) -> VmResult<UserBorrowData> {
        let reserve = self.read_token_reserve(mint)?;
        let position = self.read_user_borrow_position(mint, protocol)?;

        let borrow_limit_raw = self.calc_borrow_limit_before_operate(&position);
        let borrow_raw = position.borrow;
        let borrowable_raw = borrow_limit_raw.saturating_sub(borrow_raw);

        let (borrow, borrow_limit, borrowable_until_limit) = if position.mode == 0 {
            (
                Self::clamp_u128_to_u64(borrow_raw),
                Self::clamp_u128_to_u64(borrow_limit_raw),
                Self::clamp_u128_to_u64(borrowable_raw),
            )
        } else {
            (
                Self::convert_with_exchange(borrow_raw, reserve.borrow_exchange_price),
                Self::convert_with_exchange(borrow_limit_raw, reserve.borrow_exchange_price),
                Self::convert_with_exchange(borrowable_raw, reserve.borrow_exchange_price),
            )
        };

        let max_borrow_limit = if position.mode == 0 {
            Self::clamp_u128_to_u64(position.max_debt_ceiling)
        } else {
            Self::convert_with_exchange(position.max_debt_ceiling, reserve.borrow_exchange_price)
        };

        Ok(UserBorrowData {
            borrow,
            borrow_limit,
            max_borrow_limit,
            borrowable_until_limit,
            borrowable: borrowable_until_limit,
        })
    }

    /// Read full user supply position
    pub fn read_user_supply_position(
        &self,
        mint: MintKey,
        protocol: &Pubkey,
    ) -> VmResult<UserSupplyPositionData> {
        let position: UserSupplyPosition = self.read_zero_copy_account(
            self.get_user_supply_position(mint, protocol),
            "UserSupplyPosition",
        )?;
        Ok(UserSupplyPositionData::from(&position))
    }

    /// Read full user borrow position
    pub fn read_user_borrow_position(
        &self,
        mint: MintKey,
        protocol: &Pubkey,
    ) -> VmResult<UserBorrowPositionFull> {
        let position: UserBorrowPosition = self.read_zero_copy_account(
            self.get_user_borrow_position(mint, protocol),
            "UserBorrowPosition",
        )?;
        Ok(UserBorrowPositionFull::from(&position))
    }

    /// Read user claim account
    pub fn read_user_claim(&self, mint: MintKey, user: &Pubkey) -> VmResult<UserClaimData> {
        let claim: UserClaim =
            self.read_zero_copy_account(self.get_claim_account(mint, user), "UserClaim")?;
        Ok(UserClaimData::from(&claim))
    }

    pub fn read_liquidity(&self) -> VmResult<liquidity::state::Liquidity> {
        self.vm.read_anchor_account(&self.get_liquidity())
    }

    pub fn read_auth_list(&self) -> VmResult<AuthorizationList> {
        self.vm.read_anchor_account(&self.get_auth_list())
    }

    pub fn read_token_reserve(&self, mint: MintKey) -> VmResult<TokenReserveData> {
        let reserve: TokenReserve =
            self.read_zero_copy_account(self.get_reserve(mint), "TokenReserve")?;
        Ok(TokenReserveData::from(&reserve))
    }

    /// Helper to read zero-copy Anchor accounts (after the 8-byte discriminator)
    fn read_zero_copy_account<T: bytemuck::Pod>(
        &self,
        address: Pubkey,
        account_name: &str,
    ) -> VmResult<T> {
        let account = self
            .vm
            .get_account(&address)
            .ok_or(VmError::AccountNotFound(address.to_string()))?;

        let data =
            account
                .data
                .get(8..8 + std::mem::size_of::<T>())
                .ok_or(VmError::DeserializeFailed(format!(
                    "{account_name} account data too short"
                )))?;

        Ok(*bytemuck::from_bytes::<T>(data))
    }

    fn calc_borrow_limit_before_operate(&self, position: &UserBorrowPositionFull) -> u128 {
        let borrow_amount = position.borrow;
        let expand_percent = position.expand_percent;
        let four_decimals = FOUR_DECIMALS as u128;

        let max_expansion_limit = borrow_amount.saturating_mul(expand_percent) / four_decimals;
        let max_expanded_borrow_limit = borrow_amount.saturating_add(max_expansion_limit);
        let base_borrow_limit = position.base_debt_ceiling;

        if max_expanded_borrow_limit < base_borrow_limit {
            return base_borrow_limit;
        }

        let expand_duration = position.expand_duration;
        if expand_duration == 0 {
            return base_borrow_limit;
        }

        let current_timestamp = self.vm.timestamp() as i128;
        let last_update_timestamp = position.last_update_timestamp as i128;
        let time_elapsed = if current_timestamp <= last_update_timestamp {
            0
        } else {
            (current_timestamp - last_update_timestamp) as u128
        };

        let previous_borrow_limit = position.previous_limit;
        let mut current_borrow_limit = max_expansion_limit
            .saturating_mul(time_elapsed)
            .saturating_div(expand_duration)
            .saturating_add(previous_borrow_limit);

        if current_borrow_limit > max_expanded_borrow_limit {
            current_borrow_limit = max_expanded_borrow_limit;
        }

        let max_borrow_limit = position.max_debt_ceiling;
        if current_borrow_limit > max_borrow_limit {
            current_borrow_limit = max_borrow_limit;
        }

        current_borrow_limit
    }

    fn calc_withdrawal_limit_before_operate(
        &self,
        position: &UserSupplyPositionData,
        current_supply: u64,
        current_timestamp: u64,
    ) -> u64 {
        if position.previous_limit == 0 {
            return 0;
        }

        let four_decimals = FOUR_DECIMALS as u128;
        let supply = current_supply as u128;

        let max_withdrawable_limit = supply
            .saturating_mul(position.expand_percent)
            .saturating_div(four_decimals);

        let elapsed =
            (current_timestamp as u128).saturating_sub(position.last_update_timestamp as u128);
        let duration = position.expand_duration.max(1);
        let withdrawable_amount = max_withdrawable_limit
            .saturating_mul(elapsed)
            .saturating_div(duration as u128);

        let mut current_limit = position.previous_limit.saturating_sub(withdrawable_amount);

        let minimum_limit = supply.saturating_sub(max_withdrawable_limit);
        if minimum_limit > current_limit {
            current_limit = minimum_limit;
        }

        current_limit as u64
    }

    fn convert_with_exchange(amount: u128, exchange_price: u64) -> u64 {
        let precision = Self::EXCHANGE_PRICES_PRECISION as u128;
        let converted = amount.saturating_mul(exchange_price as u128) / precision;
        Self::clamp_u128_to_u64(converted)
    }

    fn clamp_u128_to_u64(value: u128) -> u64 {
        if value > u64::MAX as u128 {
            u64::MAX
        } else {
            value as u64
        }
    }
}
