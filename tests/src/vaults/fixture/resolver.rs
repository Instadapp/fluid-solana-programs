//! Resolver data structures and account reading methods for vaults
//!
//! This module contains data structures for reading on-chain vault state
//! and resolver-style methods similar to TypeScript resolver utilities.

use {
    super::{setup::OperateVars, VaultFixture, MIN_TICK},
    anchor_lang::prelude::*,
    bytemuck,
    fluid_test_framework::prelude::*,
    fluid_test_framework::Result as VmResult,
    library::math::tick::TickMath,
    solana_sdk::signer::Signer as SolSigner,
    vaults::state::{Branch, Position, Tick, TickIdLiquidation, VaultConfig, VaultState},
};

/// Branch state info
#[derive(Debug, Clone)]
pub struct BranchStateInfo {
    pub status: u8,
}

/// Vault state data
#[derive(Debug, Clone)]
pub struct VaultStateData {
    pub vault_id: u16,
    pub topmost_tick: i32,
    pub current_branch: u32,
    pub total_branch_id: u32,
    pub branch_liquidated: u8,
    pub total_supply: u128,
    pub total_borrow: u128,
    pub supply_exchange_price: u64,
    pub borrow_exchange_price: u64,
    pub next_position_id: u32,
    pub current_branch_state: Option<BranchStateInfo>,
}

impl From<VaultState> for VaultStateData {
    fn from(state: VaultState) -> Self {
        Self {
            vault_id: state.vault_id,
            topmost_tick: state.topmost_tick,
            current_branch: state.current_branch_id,
            total_branch_id: state.total_branch_id,
            branch_liquidated: state.branch_liquidated,
            total_supply: state.total_supply as u128,
            total_borrow: state.total_borrow as u128,
            supply_exchange_price: state.vault_supply_exchange_price,
            borrow_exchange_price: state.vault_borrow_exchange_price,
            next_position_id: state.next_position_id,
            current_branch_state: None,
        }
    }
}

/// Vault entire data structure
#[derive(Debug, Clone)]
pub struct VaultEntireData {
    pub vault_state: VaultStateData,
}

/// Vault config data
#[derive(Debug, Clone)]
pub struct VaultConfigData {
    pub vault_id: u16,
    pub supply_rate_magnifier: u16,
    pub borrow_rate_magnifier: u16,
    pub collateral_factor: u16,
    pub liquidation_threshold: u16,
    pub liquidation_max_limit: u16,
    pub withdraw_gap: u16,
    pub liquidation_penalty: u16,
    pub borrow_fee: u16,
    pub oracle: Pubkey,
    pub rebalancer: Pubkey,
    pub supply_token: Pubkey,
    pub borrow_token: Pubkey,
}

impl From<VaultConfig> for VaultConfigData {
    fn from(config: VaultConfig) -> Self {
        Self {
            vault_id: config.vault_id,
            supply_rate_magnifier: config.supply_rate_magnifier as u16,
            borrow_rate_magnifier: config.borrow_rate_magnifier as u16,
            collateral_factor: config.collateral_factor,
            liquidation_threshold: config.liquidation_threshold,
            liquidation_max_limit: config.liquidation_max_limit,
            withdraw_gap: config.withdraw_gap,
            liquidation_penalty: config.liquidation_penalty,
            borrow_fee: config.borrow_fee,
            oracle: config.oracle,
            rebalancer: config.rebalancer,
            supply_token: config.supply_token,
            borrow_token: config.borrow_token,
        }
    }
}

/// Position data
#[derive(Debug, Clone)]
pub struct PositionData {
    pub vault_id: u16,
    pub position_id: u32,
    pub tick: i32,
    pub tick_id: u32,
    pub collateral: u128,
    pub debt: u128,
}

impl From<Position> for PositionData {
    fn from(position: Position) -> Self {
        Self {
            vault_id: position.vault_id,
            position_id: position.nft_id,
            tick: position.tick,
            tick_id: position.tick_id,
            collateral: position.supply_amount as u128,
            debt: position.dust_debt_amount as u128,
        }
    }
}

/// Tick data
#[derive(Debug, Clone)]
pub struct TickData {
    pub vault_id: u16,
    pub tick: i32,
    pub raw_debt: u128,
    pub raw_collateral: u128,
    pub total_ids: u32,
    pub is_liquidated: bool,
    pub is_fully_liquidated: bool,
    pub liquidation_branch_id: u32,
    pub debt_factor: u64,
}

impl From<Tick> for TickData {
    fn from(tick_data: Tick) -> Self {
        Self {
            vault_id: tick_data.vault_id,
            tick: tick_data.tick,
            raw_debt: tick_data.raw_debt as u128,
            raw_collateral: 0u128, // collateral is at position level
            total_ids: tick_data.total_ids,
            is_liquidated: tick_data.is_liquidated == 1,
            is_fully_liquidated: tick_data.is_fully_liquidated == 1,
            liquidation_branch_id: tick_data.liquidation_branch_id,
            debt_factor: tick_data.debt_factor,
        }
    }
}

/// Branch data
#[derive(Debug, Clone)]
pub struct BranchData {
    pub vault_id: u16,
    pub branch_id: u32,
    pub status: u8,
    pub minima_tick: i32,
    pub minima_tick_partials: u32,
    pub debt_liquidity: u64,
    pub debt_factor: u64,
    pub connected_branch_id: u32,
    pub connected_minima_tick: i32,
}

impl From<Branch> for BranchData {
    fn from(branch: Branch) -> Self {
        Self {
            vault_id: branch.vault_id,
            branch_id: branch.branch_id,
            status: branch.status,
            minima_tick: branch.minima_tick,
            minima_tick_partials: branch.minima_tick_partials,
            debt_liquidity: branch.debt_liquidity,
            debt_factor: branch.debt_factor,
            connected_branch_id: branch.connected_branch_id,
            connected_minima_tick: branch.connected_minima_tick,
        }
    }
}

/// User position data with calculated supply/borrow from resolver
#[derive(Debug, Clone)]
pub struct UserPositionData {
    pub supply: u128,
    pub borrow: u128,
    pub before_dust_borrow: u128,
    pub tick: i32,
}

impl VaultFixture {
    /// Helper to read zero-copy Anchor accounts (after the 8-byte discriminator)
    fn read_zero_copy_account<T: bytemuck::Pod>(
        &self,
        address: Pubkey,
        account_name: &str,
    ) -> VmResult<T> {
        let account = self
            .liquidity
            .vm
            .get_account(&address)
            .ok_or(VmError::AccountNotFound(address.to_string()))?;

        let data = account
            .data
            .get(8..8 + std::mem::size_of::<T>())
            .ok_or(VmError::DeserializeFailed(format!(
                "{account_name} account data too short"
            )))?;

        Ok(*bytemuck::from_bytes::<T>(data))
    }

    /// Read vault state
    pub fn read_vault_state(&self, vault_id: u16) -> VmResult<VaultStateData> {
        let state: VaultState =
            self.read_zero_copy_account(self.get_vault_state(vault_id), "VaultState")?;
        Ok(state.into())
    }

    /// Read vault config
    pub fn read_vault_config(&self, vault_id: u16) -> VmResult<VaultConfigData> {
        let config: VaultConfig =
            self.read_zero_copy_account(self.get_vault_config(vault_id), "VaultConfig")?;
        Ok(config.into())
    }

    /// Read position
    pub fn read_position(&self, vault_id: u16, position_id: u32) -> VmResult<PositionData> {
        let position: Position =
            self.read_zero_copy_account(self.get_position(vault_id, position_id), "Position")?;
        Ok(position.into())
    }

    /// Read tick
    pub fn read_tick(&self, vault_id: u16, tick: i32) -> VmResult<TickData> {
        let tick_data: Tick =
            self.read_zero_copy_account(self.get_tick(vault_id, tick), "Tick")?;
        Ok(tick_data.into())
    }

    /// Read branch
    pub fn read_branch(&self, vault_id: u16, branch_id: u32) -> VmResult<BranchData> {
        let branch: Branch =
            self.read_zero_copy_account(self.get_branch(vault_id, branch_id), "Branch")?;
        Ok(branch.into())
    }

    /// Get next position ID for a vault
    pub fn get_next_position_id(&self, vault_id: u16) -> VmResult<u32> {
        let state = self.read_vault_state(vault_id)?;
        Ok(state.next_position_id)
    }

    /// Get position tick
    pub fn get_position_tick(&self, vault_id: u16, position_id: u32) -> VmResult<i32> {
        // Try to read position, if it doesn't exist return MIN_TICK
        match self.read_position(vault_id, position_id) {
            Ok(position) => Ok(position.tick),
            Err(_) => Ok(MIN_TICK),
        }
    }

    /// Assert vault state matches expected values
    pub fn assert_state(
        &self,
        vault_id: u16,
        tick: i32,
        expected_tick_debt: u128,
        expected_topmost_tick: i32,
        expected_total_collateral: u128,
        expected_total_debt: u128,
    ) -> VmResult<()> {
        let vault_state = self.read_vault_state(vault_id)?;
        let decimal_scale_factor_borrow =
            self.get_decimal_scale_factor(self.get_vault_borrow_token(vault_id));
        let decimal_scale_factor_supply =
            self.get_decimal_scale_factor(self.get_vault_supply_token(vault_id));

        let topmost_tick = vault_state.topmost_tick;
        let vault_debt = vault_state.total_borrow / decimal_scale_factor_borrow;
        let vault_collateral = vault_state.total_supply / decimal_scale_factor_supply;

        assert_eq!(
            topmost_tick, expected_topmost_tick,
            "Topmost tick mismatch: expected {}, got {}",
            expected_topmost_tick, topmost_tick
        );
        assert_eq!(
            vault_collateral, expected_total_collateral,
            "Total collateral mismatch: expected {}, got {}",
            expected_total_collateral, vault_collateral
        );
        assert_eq!(
            vault_debt, expected_total_debt,
            "Total debt mismatch: expected {}, got {}",
            expected_total_debt, vault_debt
        );

        let tick_data = self.read_tick(vault_id, tick)?;
        let debt_in_tick = tick_data.raw_debt / decimal_scale_factor_borrow;
        assert_eq!(
            debt_in_tick, expected_tick_debt,
            "Tick debt mismatch: expected {}, got {}",
            expected_tick_debt, debt_in_tick
        );

        Ok(())
    }

    /// Transfer position NFT from one user to another
    pub fn transfer_position(
        &mut self,
        vault_id: u16,
        position_id: u32,
        from: &solana_sdk::signature::Keypair,
        to: &solana_sdk::signature::Keypair,
    ) -> VmResult<()> {
        let from_pubkey = from.pubkey();
        let to_pubkey = to.pubkey();

        let position_mint = self.get_position_mint(vault_id, position_id);

        self.liquidity
            .vm
            .mint_tokens(&position_mint, &to_pubkey, 0)?;

        // Transfer 1 NFT
        self.liquidity
            .vm
            .transfer_tokens(&position_mint, &from_pubkey, &to_pubkey, 1)?;

        Ok(())
    }

    /// Expect a transaction to revert with a specific error
    pub fn expect_revert<F, T>(&mut self, expected_error: &str, f: F) -> bool
    where
        F: FnOnce(&mut Self) -> VmResult<T>,
    {
        match f(self) {
            Ok(_) => false,
            Err(e) => {
                let error_str = format!("{:?}", e);
                error_str.contains(expected_error)
            }
        }
    }

    /// Create dummy position for testing
    pub fn create_dummy_position(
        &mut self,
        vault_id: u16,
        user: &solana_sdk::signature::Keypair,
    ) -> VmResult<u32> {
        let position_id = self.init_position(vault_id, user)?;

        let collateral_amount: i128 = 1_000_000_000; // 1e9
        let debt_amount: i128 = 0;

        self.operate_vault(&OperateVars {
            vault_id,
            position_id,
            user,
            position_owner: user,
            collateral_amount,
            debt_amount,
            recipient: user,
        })?;

        let debt_amount: i128 = 400_000_000; // 4e8

        self.operate_vault(&OperateVars {
            vault_id,
            position_id,
            user,
            position_owner: user,
            collateral_amount: 0,
            debt_amount,
            recipient: user,
        })?;

        self.assert_state(
            vault_id,
            -611,
            400_191_013,
            -611,
            1_000_000_000,
            400_000_000,
        )?;

        Ok(position_id)
    }

    /// Unscale amounts from internal 9 decimal format to token decimals
    pub fn unscale_amounts(&self, amount: u128, vault_id: u16) -> u128 {
        let decimal_scale = self.get_decimal_scale_factor(self.get_vault_supply_token(vault_id));
        amount / decimal_scale
    }

    /// Get position by NFT ID with calculated supply/borrow
    pub fn position_by_nft_id(&self, nft_id: u32, vault_id: u16) -> VmResult<UserPositionData> {
        let position = self.read_position(vault_id, nft_id)?;

        let col_raw = position.collateral;

        let dust_debt_raw = position.debt;

        let debt_raw = if position.tick > MIN_TICK {
            let ratio = TickMath::get_ratio_at_tick(position.tick).unwrap_or(0);
            let collateral_for_debt_calc = col_raw + 1;
            // debt_raw = ratio * collateral / 2^48 + 1
            (ratio * collateral_for_debt_calc >> 48) + 1
        } else {
            0
        };

        // Check if position might be liquidated
        if position.tick > MIN_TICK {
            if let Ok(tick_data) = self.read_tick(vault_id, position.tick) {
                if tick_data.is_liquidated || tick_data.total_ids > position.tick_id {
                    // determines which data source to use
                    let (is_fully_liquidated, branch_id, connection_factor) =
                        self.get_liquidation_status(
                            vault_id,
                            &position,
                            &tick_data,
                        )?;

                    if is_fully_liquidated {
                        return Ok(UserPositionData {
                            supply: 0,
                            borrow: 0,
                            before_dust_borrow: dust_debt_raw,
                            tick: position.tick,
                        });
                    }

                    // Process liquidated position through branches
                    if let Ok((final_col, final_debt)) = self.process_liquidated_position(
                        vault_id,
                        branch_id,
                        connection_factor,
                        debt_raw,
                    ) {
                        let final_borrow = if final_debt > dust_debt_raw {
                            final_debt - dust_debt_raw
                        } else {
                            0
                        };

                        return Ok(UserPositionData {
                            supply: final_col,
                            borrow: final_borrow,
                            before_dust_borrow: dust_debt_raw,
                            tick: position.tick,
                        });
                    }
                }
            }
        }

        // Position is not liquidated, return current state
        let borrow = if debt_raw > dust_debt_raw {
            debt_raw - dust_debt_raw
        } else {
            0
        };

        Ok(UserPositionData {
            supply: col_raw,
            borrow,
            before_dust_borrow: dust_debt_raw,
            tick: position.tick,
        })
    }

    /// Get liquidation status for a position
    fn get_liquidation_status(
        &self,
        vault_id: u16,
        position: &PositionData,
        tick_data: &TickData,
    ) -> VmResult<(bool, u32, u64)> {
        if tick_data.total_ids == position.tick_id {
            return Ok((
                tick_data.is_fully_liquidated,
                tick_data.liquidation_branch_id,
                tick_data.debt_factor,
            ));
        }

        let tick_id_liq_pda =
            self.get_tick_id_liquidation(vault_id, position.tick, position.tick_id);

        if let Ok(tick_id_liq) = self.read_tick_id_liquidation(&tick_id_liq_pda) {
            // Find which slot to use: (tick_id + 2) % 3
            let slot = (position.tick_id + 2) % 3;

            let (is_fully_liquidated, branch_id, debt_factor) = match slot {
                0 => (
                    tick_id_liq.is_fully_liquidated_1 != 0,
                    tick_id_liq.liquidation_branch_id_1,
                    tick_id_liq.debt_factor_1,
                ),
                1 => (
                    tick_id_liq.is_fully_liquidated_2 != 0,
                    tick_id_liq.liquidation_branch_id_2,
                    tick_id_liq.debt_factor_2,
                ),
                _ => (
                    tick_id_liq.is_fully_liquidated_3 != 0,
                    tick_id_liq.liquidation_branch_id_3,
                    tick_id_liq.debt_factor_3,
                ),
            };

            return Ok((is_fully_liquidated, branch_id, debt_factor));
        }

        // Default: not liquidated
        Ok((false, 0, 0))
    }

    /// Process liquidated position through branch chain
    fn process_liquidated_position(
        &self,
        vault_id: u16,
        start_branch_id: u32,
        initial_connection_factor: u64,
        initial_debt_raw: u128,
    ) -> VmResult<(u128, u128)> {
        const MAX_MASK_DEBT_FACTOR: u128 = (1 << 50) - 1; // 1125899906842623
        const X30: u128 = 0x3FFFFFFF;
        const TICK_SPACING: u128 = 10015;

        let mut current_branch_id = start_branch_id;
        let mut connection_factor = initial_connection_factor as u128;

        // Traverse merged branches
        loop {
            let branch = match self.read_branch(vault_id, current_branch_id) {
                Ok(b) => b,
                Err(_) => break,
            };

            if branch.status != 2 {
                // Not merged, stop traversal
                break;
            }

            // Multiply connection factors using BigNumber math
            connection_factor = Self::mul_big_number(connection_factor, branch.debt_factor as u128);

            if connection_factor >= MAX_MASK_DEBT_FACTOR {
                return Ok((0, 0)); // Fully liquidated
            }

            current_branch_id = branch.connected_branch_id;
        }

        let branch = self.read_branch(vault_id, current_branch_id)?;

        // If branch is closed or fully liquidated
        if branch.status == 3 || connection_factor >= MAX_MASK_DEBT_FACTOR {
            return Ok((0, 0));
        }

        // position_debt = initial_debt * branch.debt_factor / connection_factor
        let position_debt_raw = Self::mul_div_normal(
            initial_debt_raw,
            branch.debt_factor as u128,
            connection_factor,
        );

        let position_debt_raw = if position_debt_raw > initial_debt_raw / 100 {
            position_debt_raw * 9999 / 10000
        } else {
            0
        };

        if position_debt_raw == 0 {
            return Ok((0, 0));
        }

        let minima_tick = branch.minima_tick;
        let ratio_at_tick = TickMath::get_ratio_at_tick(minima_tick).unwrap_or(1);

        let ratio_one_less = ratio_at_tick * 10000 / TICK_SPACING;
        let ratio_length = ratio_at_tick - ratio_one_less;

        let partials = branch.minima_tick_partials as u128;
        let final_ratio = ratio_one_less + (ratio_length * partials / X30);

        // col_raw = debt * ZERO_TICK_SCALED_RATIO / final_ratio
        let final_col_raw = if final_ratio > 0 {
            (position_debt_raw << 48) / final_ratio
        } else {
            0
        };

        Ok((final_col_raw, position_debt_raw))
    }

    fn mul_big_number(big_number1: u128, big_number2: u128) -> u128 {
        const EXPONENT_SIZE: u32 = 15;
        const COEFFICIENT_SIZE: u32 = 35;
        const EXPONENT_MAX: u128 = (1 << EXPONENT_SIZE) - 1;
        const DECIMALS: u128 = 16384;
        const MAX_MASK: u128 = (1 << (COEFFICIENT_SIZE + EXPONENT_SIZE)) - 1;
        const TWO_POWER_69_MINUS_1: u128 = (1 << 69) - 1;

        let coefficient1 = big_number1 >> EXPONENT_SIZE;
        let coefficient2 = big_number2 >> EXPONENT_SIZE;
        let exponent1 = big_number1 & EXPONENT_MAX;
        let exponent2 = big_number2 & EXPONENT_MAX;

        let res_coefficient = coefficient1 * coefficient2;

        let overflow_len = if res_coefficient > TWO_POWER_69_MINUS_1 {
            COEFFICIENT_SIZE
        } else {
            COEFFICIENT_SIZE - 1
        };

        let adjusted_coefficient = res_coefficient >> overflow_len;

        let res_exponent = exponent1 + exponent2 + overflow_len as u128;

        if res_exponent < DECIMALS {
            return 0; // Underflow
        }

        let final_exponent = res_exponent - DECIMALS;

        if final_exponent > EXPONENT_MAX {
            return MAX_MASK; // Fully liquidated
        }

        // Combine coefficient and exponent
        (adjusted_coefficient << EXPONENT_SIZE) | final_exponent
    }

    /// BigNumber division: normal * big1 / big2
    fn mul_div_normal(normal: u128, big_number1: u128, big_number2: u128) -> u128 {
        const EXPONENT_SIZE: u32 = 15;
        const EXPONENT_MAX: u128 = (1 << EXPONENT_SIZE) - 1;

        if big_number1 == 0 || big_number2 == 0 {
            return 0;
        }

        // Extract exponents
        let exponent1 = big_number1 & EXPONENT_MAX;
        let exponent2 = big_number2 & EXPONENT_MAX;

        if exponent2 < exponent1 {
            return 0;
        }

        let net_exponent = exponent2 - exponent1;

        if net_exponent < 129 {
            // Extract coefficients
            let coefficient1 = big_number1 >> EXPONENT_SIZE;
            let coefficient2 = big_number2 >> EXPONENT_SIZE;

            let numerator = normal * coefficient1;
            let denominator = coefficient2 << net_exponent;

            if denominator == 0 {
                return 0;
            }

            numerator / denominator
        } else {
            // If net_exponent >= 129, result is 0
            0
        }
    }

    /// Read tick id liquidation account
    fn read_tick_id_liquidation(&self, address: &Pubkey) -> VmResult<TickIdLiquidationData> {
        let tick_id_liq: TickIdLiquidation =
            self.read_zero_copy_account(*address, "TickIdLiquidation")?;
        Ok(tick_id_liq.into())
    }

    /// Get vault entire data including branch state
    pub fn get_vault_entire_data(&self, vault_id: u16) -> VmResult<VaultEntireData> {
        let mut vault_state = self.read_vault_state(vault_id)?;

        if vault_state.current_branch > 0 {
            if let Ok(branch) = self.read_branch(vault_id, vault_state.current_branch) {
                vault_state.current_branch_state = Some(BranchStateInfo {
                    status: branch.status,
                });
            }
        }

        Ok(VaultEntireData { vault_state })
    }

    /// Assert approximate equality with relative precision
    pub fn assert_approx_eq_rel(&self, expected: u128, actual: u128, max_percent_delta: u128) {
        let diff = if expected > actual {
            expected - actual
        } else {
            actual - expected
        };

        let relative_diff = if expected > 0 {
            diff * 1_000_000_000 / expected
        } else if diff == 0 {
            0
        } else {
            u128::MAX // Infinite relative diff when expected is 0 but actual isn't
        };
        assert!(
            relative_diff <= max_percent_delta,
            "Values not approximately equal: expected {}, actual {}, diff {}, relative_diff {}, max_allowed {}",
            expected,
            actual,
            diff,
            relative_diff,
            max_percent_delta
        );
    }
}

/// Tick ID Liquidation data
#[derive(Debug, Clone)]
pub struct TickIdLiquidationData {
    pub vault_id: u16,
    pub tick: i32,
    pub tick_map: u32,
    pub is_fully_liquidated_1: u8,
    pub liquidation_branch_id_1: u32,
    pub debt_factor_1: u64,
    pub is_fully_liquidated_2: u8,
    pub liquidation_branch_id_2: u32,
    pub debt_factor_2: u64,
    pub is_fully_liquidated_3: u8,
    pub liquidation_branch_id_3: u32,
    pub debt_factor_3: u64,
}

impl From<TickIdLiquidation> for TickIdLiquidationData {
    fn from(data: TickIdLiquidation) -> Self {
        Self {
            vault_id: data.vault_id,
            tick: data.tick,
            tick_map: data.tick_map,
            is_fully_liquidated_1: data.is_fully_liquidated_1,
            liquidation_branch_id_1: data.liquidation_branch_id_1,
            debt_factor_1: data.debt_factor_1,
            is_fully_liquidated_2: data.is_fully_liquidated_2,
            liquidation_branch_id_2: data.liquidation_branch_id_2,
            debt_factor_2: data.debt_factor_2,
            is_fully_liquidated_3: data.is_fully_liquidated_3,
            liquidation_branch_id_3: data.liquidation_branch_id_3,
            debt_factor_3: data.debt_factor_3,
        }
    }
}
