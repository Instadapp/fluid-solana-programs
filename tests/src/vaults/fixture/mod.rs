//! Vault test fixture module
//!
//! This module provides the test fixture for the vaults program,
//! mirroring the TypeScript test utilities structure.

mod resolver;
mod setup;

pub use resolver::*;
pub use setup::{LiquidateVars, OperateVars};

use {
    crate::liquidity::fixture::LiquidityFixture, anchor_lang::prelude::*,
    fluid_test_framework::helpers::MintKey,
};

pub const VAULTS_PROGRAM_ID: Pubkey = vaults::ID;
pub const ORACLE_PROGRAM_ID: Pubkey = oracle::ID;

pub mod seeds {
    pub const VAULT_ADMIN: &[u8] = b"vault_admin";
    pub const VAULT_CONFIG: &[u8] = b"vault_config";
    pub const VAULT_METADATA: &[u8] = b"vault_metadata";
    pub const VAULT_STATE: &[u8] = b"vault_state";
    pub const BRANCH: &[u8] = b"branch";
    pub const TICK_HAS_DEBT: &[u8] = b"tick_has_debt";
    pub const TICK: &[u8] = b"tick";
    pub const TICK_ID_LIQUIDATION: &[u8] = b"tick_id_liquidation";
    pub const POSITION: &[u8] = b"position";
    pub const POSITION_MINT: &[u8] = b"position_mint";
}

pub mod oracle_seeds {
    pub const ORACLE: &[u8] = b"oracle";
    pub const ORACLE_ADMIN: &[u8] = b"oracle_admin";
}

/// Constants for vault operations
pub const MIN_TICK: i32 = -16383;
pub const MAX_TICK: i32 = 16383;
pub const MAX_BRANCH_SINGLE_TX: u32 = 15;
pub const MAX_TICK_SINGLE_TX: i32 = 15;
pub const MAX_TICK_HAS_DEBT_ARRAY_SINGLE_TX: u8 = 15;
pub const MAX_TICK_ID_LIQUIDATION_SINGLE_TX: i32 = 8;

/// Default oracle price (1e8 = 1.0 price ratio)
pub const DEFAULT_ORACLE_PRICE: u128 = 100_000_000; // 1e8

pub struct VaultFixture {
    /// The underlying liquidity fixture
    pub liquidity: LiquidityFixture,
    /// Current oracle price
    pub oracle_price: u128,
    /// Oracle source pubkeys for each vault
    pub oracle_sources: std::collections::HashMap<u16, Pubkey>,
    /// Lookup table addresses per vault (like TS vaultToLookUpTableMap)
    pub vault_to_lookup_table_map: std::collections::HashMap<u16, Pubkey>,
    /// Authority keypair for lookup table operations
    pub lookup_table_authority: solana_sdk::signature::Keypair,
}

impl VaultFixture {
    /// Supply token for vaults (USDC)
    pub const SUPPLY_TOKEN: MintKey = MintKey::USDC;
    /// Borrow token for vaults (USDT)
    pub const BORROW_TOKEN: MintKey = MintKey::USDT;
    /// Native token for vaults (WSOL)
    pub const NATIVE_TOKEN: MintKey = MintKey::WSOL;

    /// Supply token decimals
    pub const SUPPLY_TOKEN_DECIMALS: u8 = 6;
    /// Borrow token decimals
    pub const BORROW_TOKEN_DECIMALS: u8 = 6;
    /// Native token decimals
    pub const NATIVE_TOKEN_DECIMALS: u8 = 9;
}

impl std::ops::Deref for VaultFixture {
    type Target = LiquidityFixture;

    fn deref(&self) -> &Self::Target {
        &self.liquidity
    }
}

impl std::ops::DerefMut for VaultFixture {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.liquidity
    }
}

impl VaultFixture {
    /// Get vault admin PDA
    pub fn get_vault_admin(&self) -> Pubkey {
        Pubkey::find_program_address(&[seeds::VAULT_ADMIN], &VAULTS_PROGRAM_ID).0
    }

    /// Get vault config PDA for a vault ID
    pub fn get_vault_config(&self, vault_id: u16) -> Pubkey {
        Pubkey::find_program_address(
            &[seeds::VAULT_CONFIG, &vault_id.to_le_bytes()],
            &VAULTS_PROGRAM_ID,
        )
        .0
    }

    /// Get vault metadata PDA for a vault ID
    pub fn get_vault_metadata(&self, vault_id: u16) -> Pubkey {
        Pubkey::find_program_address(
            &[seeds::VAULT_METADATA, &vault_id.to_le_bytes()],
            &VAULTS_PROGRAM_ID,
        )
        .0
    }

    /// Get vault state PDA for a vault ID
    pub fn get_vault_state(&self, vault_id: u16) -> Pubkey {
        Pubkey::find_program_address(
            &[seeds::VAULT_STATE, &vault_id.to_le_bytes()],
            &VAULTS_PROGRAM_ID,
        )
        .0
    }

    /// Get branch PDA for a vault ID and branch ID
    pub fn get_branch(&self, vault_id: u16, branch_id: u32) -> Pubkey {
        Pubkey::find_program_address(
            &[
                seeds::BRANCH,
                &vault_id.to_le_bytes(),
                &branch_id.to_le_bytes(),
            ],
            &VAULTS_PROGRAM_ID,
        )
        .0
    }

    /// Get tick has debt array PDA for a vault ID and index
    pub fn get_tick_has_debt_array(&self, vault_id: u16, index: u8) -> Pubkey {
        Pubkey::find_program_address(
            &[seeds::TICK_HAS_DEBT, &vault_id.to_le_bytes(), &[index]],
            &VAULTS_PROGRAM_ID,
        )
        .0
    }

    /// Get tick PDA for a vault ID and tick value
    pub fn get_tick(&self, vault_id: u16, tick: i32) -> Pubkey {
        let normalized_tick = (tick - MIN_TICK) as u32;
        Pubkey::find_program_address(
            &[
                seeds::TICK,
                &vault_id.to_le_bytes(),
                &normalized_tick.to_le_bytes(),
            ],
            &VAULTS_PROGRAM_ID,
        )
        .0
    }

    /// Get tick ID liquidation PDA
    pub fn get_tick_id_liquidation(&self, vault_id: u16, tick: i32, total_ids: u32) -> Pubkey {
        let normalized_tick = (tick - MIN_TICK) as u32;
        let index = (total_ids + 2) / 3;
        Pubkey::find_program_address(
            &[
                seeds::TICK_ID_LIQUIDATION,
                &vault_id.to_le_bytes(),
                &normalized_tick.to_le_bytes(),
                &index.to_le_bytes(),
            ],
            &VAULTS_PROGRAM_ID,
        )
        .0
    }

    /// Get position PDA for a vault ID and position ID
    pub fn get_position(&self, vault_id: u16, position_id: u32) -> Pubkey {
        Pubkey::find_program_address(
            &[
                seeds::POSITION,
                &vault_id.to_le_bytes(),
                &position_id.to_le_bytes(),
            ],
            &VAULTS_PROGRAM_ID,
        )
        .0
    }

    /// Get position mint PDA for a vault ID and position ID
    pub fn get_position_mint(&self, vault_id: u16, position_id: u32) -> Pubkey {
        Pubkey::find_program_address(
            &[
                seeds::POSITION_MINT,
                &vault_id.to_le_bytes(),
                &position_id.to_le_bytes(),
            ],
            &VAULTS_PROGRAM_ID,
        )
        .0
    }

    /// Get oracle PDA for an oracle ID
    pub fn get_oracle(&self, oracle_id: u16) -> Pubkey {
        Pubkey::find_program_address(
            &[oracle_seeds::ORACLE, &oracle_id.to_le_bytes()],
            &ORACLE_PROGRAM_ID,
        )
        .0
    }

    /// Get oracle admin PDA
    pub fn get_oracle_admin(&self) -> Pubkey {
        Pubkey::find_program_address(&[oracle_seeds::ORACLE_ADMIN], &ORACLE_PROGRAM_ID).0
    }

    /// Get supply token for a vault ID
    pub fn get_vault_supply_token(&self, vault_id: u16) -> MintKey {
        match vault_id {
            1 => Self::SUPPLY_TOKEN,
            2 => Self::BORROW_TOKEN,
            3 => Self::NATIVE_TOKEN,
            4 => Self::SUPPLY_TOKEN,
            _ => panic!("Invalid vault_id"),
        }
    }

    /// Get borrow token for a vault ID
    pub fn get_vault_borrow_token(&self, vault_id: u16) -> MintKey {
        match vault_id {
            1 => Self::BORROW_TOKEN,
            2 => Self::SUPPLY_TOKEN,
            3 => Self::BORROW_TOKEN,
            4 => Self::NATIVE_TOKEN,
            _ => panic!("Invalid vault_id"),
        }
    }

    /// Get decimal scale factor for a token (to normalize to 9 decimals)
    pub fn get_decimal_scale_factor(&self, token: MintKey) -> u128 {
        let decimals = token.decimals();
        if decimals < 9 {
            10u128.pow((9 - decimals) as u32)
        } else {
            1
        }
    }

    /// Get supply token decimals for a vault ID
    pub fn get_vault_supply_token_decimals(&self, vault_id: u16) -> u8 {
        match vault_id {
            1 => Self::SUPPLY_TOKEN_DECIMALS,
            2 => Self::BORROW_TOKEN_DECIMALS,
            3 => Self::NATIVE_TOKEN_DECIMALS,
            4 => Self::SUPPLY_TOKEN_DECIMALS,
            _ => panic!("Invalid vault_id"),
        }
    }

    /// Get borrow token decimals for a vault ID
    pub fn get_vault_borrow_token_decimals(&self, vault_id: u16) -> u8 {
        match vault_id {
            1 => Self::BORROW_TOKEN_DECIMALS,
            2 => Self::SUPPLY_TOKEN_DECIMALS,
            3 => Self::BORROW_TOKEN_DECIMALS,
            4 => Self::NATIVE_TOKEN_DECIMALS,
            _ => panic!("Invalid vault_id"),
        }
    }

    /// Get user supply position PDA on liquidity for vault
    pub fn get_vault_supply_position_on_liquidity(&self, vault_id: u16) -> Pubkey {
        let mint = self.get_vault_supply_token(vault_id);
        let protocol = self.get_vault_config(vault_id);
        self.liquidity.get_user_supply_position(mint, &protocol)
    }

    /// Get user borrow position PDA on liquidity for vault
    pub fn get_vault_borrow_position_on_liquidity(&self, vault_id: u16) -> Pubkey {
        let mint = self.get_vault_borrow_token(vault_id);
        let protocol = self.get_vault_config(vault_id);
        self.liquidity.get_user_borrow_position(mint, &protocol)
    }
}
