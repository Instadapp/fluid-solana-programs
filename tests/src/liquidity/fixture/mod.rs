//! Liquidity test fixture module
//!
//! This module provides the test fixture for the liquidity program,
//! mirroring the TypeScript test utilities structure.

mod resolver;
mod setup;

pub use resolver::*;

use {
    anchor_lang::prelude::*,
    fluid_test_framework::helpers::{BaseFixture, MintKey},
    fluid_test_framework::prelude::*,
    fluid_test_framework::Result as VmResult,
    fluid_test_framework::Vm as LiquidityVm,
    spl_associated_token_account::get_associated_token_address,
};

pub const LIQUIDITY_PROGRAM_ID: Pubkey = liquidity::ID;

/// PDA Seeds
pub mod seeds {
    pub const LIQUIDITY: &[u8] = b"liquidity";
    pub const AUTH_LIST: &[u8] = b"auth_list";
    pub const RESERVE: &[u8] = b"reserve";
    pub const RATE_MODEL: &[u8] = b"rate_model";
    pub const USER_SUPPLY_POSITION: &[u8] = b"user_supply_position";
    pub const USER_BORROW_POSITION: &[u8] = b"user_borrow_position";
    pub const USER_CLAIM: &[u8] = b"user_claim";
}

/// Liquidity test fixture
pub struct LiquidityFixture {
    /// The VM instance for running tests
    pub vm: LiquidityVm,

    pub admin: Keypair,
    pub admin2: Keypair,
    pub alice: Keypair,
    pub bob: Keypair,

    pub mock_protocol: Keypair,
    pub mock_protocol_interest_free: Keypair,
    pub mock_protocol_with_interest: Keypair,
}

impl VmAccess for LiquidityFixture {
    fn vm_mut(&mut self) -> &mut LiquidityVm {
        &mut self.vm
    }
}

impl LiquidityFixture {
    pub const DEFAULT_PERCENT_PRECISION: u128 = 100; // 1e2: 100% = 10_000
    pub const DEFAULT_KINK: u128 = 80 * 100; // 80%
    pub const DEFAULT_RATE_AT_ZERO: u128 = 4 * 100; // 4%
    pub const DEFAULT_RATE_AT_KINK: u128 = 10 * 100; // 10%
    pub const DEFAULT_RATE_AT_MAX: u128 = 150 * 100; // 150%

    pub const DEFAULT_EXPAND_WITHDRAWAL_LIMIT_PERCENT: u128 = 20 * 100; // 20%
    pub const DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION: u128 = 2 * 24 * 60 * 60; // 2 days
    pub const DEFAULT_BASE_WITHDRAWAL_LIMIT: u128 = 10_000 * LAMPORTS_PER_SOL as u128; // 10k SOL

    pub const DEFAULT_EXPAND_DEBT_CEILING_PERCENT: u128 = 20 * 100; // 20%
    pub const DEFAULT_EXPAND_DEBT_CEILING_DURATION: u128 = 2 * 24 * 60 * 60; // 2 days
    pub const MAX_POSSIBLE_BORROW_RATE: u128 = 65535; // u16::MAX

    pub const EXCHANGE_PRICES_PRECISION: u64 = 1_000_000_000_000; // 1e12
}

impl LiquidityFixture {
    pub fn new() -> VmResult<Self> {
        let program_path = BaseFixture::find_program_path("liquidity.so")
            .ok_or(VmError::ProgramNotFound("liquidity.so".to_string()))?;

        let mut vm = VmBuilder::new()
            .with_program(ProgramArtifact::new(
                LIQUIDITY_PROGRAM_ID,
                "Liquidity",
                program_path,
            ))
            .build_blocking()?;

        let admin = vm.make_account(10_000 * LAMPORTS_PER_SOL);
        let admin2 = vm.make_account(10_000 * LAMPORTS_PER_SOL);
        let alice = vm.make_account(10_000 * LAMPORTS_PER_SOL);
        let bob = vm.make_account(10_000 * LAMPORTS_PER_SOL);

        let mock_protocol = vm.make_account(10_000 * LAMPORTS_PER_SOL);
        let mock_protocol_interest_free = vm.make_account(10_000 * LAMPORTS_PER_SOL);
        let mock_protocol_with_interest = vm.make_account(10_000 * LAMPORTS_PER_SOL);

        Ok(Self {
            vm,
            admin,
            admin2,
            alice,
            bob,
            mock_protocol,
            mock_protocol_interest_free,
            mock_protocol_with_interest,
        })
    }

    pub fn get_liquidity(&self) -> Pubkey {
        Pubkey::find_program_address(&[seeds::LIQUIDITY], &LIQUIDITY_PROGRAM_ID).0
    }

    pub fn get_auth_list(&self) -> Pubkey {
        Pubkey::find_program_address(&[seeds::AUTH_LIST], &LIQUIDITY_PROGRAM_ID).0
    }

    pub fn get_reserve(&self, mint: MintKey) -> Pubkey {
        Pubkey::find_program_address(
            &[seeds::RESERVE, mint.pubkey().as_ref()],
            &LIQUIDITY_PROGRAM_ID,
        )
        .0
    }

    pub fn get_rate_model(&self, mint: MintKey) -> Pubkey {
        Pubkey::find_program_address(
            &[seeds::RATE_MODEL, mint.pubkey().as_ref()],
            &LIQUIDITY_PROGRAM_ID,
        )
        .0
    }

    pub fn get_user_supply_position(&self, mint: MintKey, protocol: &Pubkey) -> Pubkey {
        Pubkey::find_program_address(
            &[
                seeds::USER_SUPPLY_POSITION,
                mint.pubkey().as_ref(),
                protocol.as_ref(),
            ],
            &LIQUIDITY_PROGRAM_ID,
        )
        .0
    }

    pub fn get_user_borrow_position(&self, mint: MintKey, protocol: &Pubkey) -> Pubkey {
        Pubkey::find_program_address(
            &[
                seeds::USER_BORROW_POSITION,
                mint.pubkey().as_ref(),
                protocol.as_ref(),
            ],
            &LIQUIDITY_PROGRAM_ID,
        )
        .0
    }

    pub fn get_claim_account(&self, mint: MintKey, user: &Pubkey) -> Pubkey {
        Pubkey::find_program_address(
            &[seeds::USER_CLAIM, user.as_ref(), mint.pubkey().as_ref()],
            &LIQUIDITY_PROGRAM_ID,
        )
        .0
    }

    pub fn get_vault(&self, mint: MintKey) -> Pubkey {
        get_associated_token_address(&self.get_liquidity(), &mint.pubkey())
    }

    /// Setup SPL token mints by fetching data from mainnet
    pub fn setup_spl_token_mints(&mut self, mints: &[MintKey]) -> VmResult<()> {
        let mint_pubkeys: Vec<_> = mints.iter().map(|mint| mint.pubkey()).collect();
        self.vm.setup_mints_from_mainnet(&mint_pubkeys)?;
        Ok(())
    }

    /// Mint tokens to a user (creates ATA if needed)
    pub fn mint_to(&mut self, mint: MintKey, owner: &Pubkey, amount: u64) -> VmResult<()> {
        self.vm.mint_tokens(&mint.pubkey(), owner, amount)
    }

    /// Setup ATA for a user with initial balance
    pub fn setup_ata(&mut self, mint: MintKey, owner: &Pubkey, amount: u64) -> VmResult<Pubkey> {
        self.mint_to(mint, owner, amount)?;
        Ok(get_associated_token_address(owner, &mint.pubkey()))
    }
}

impl Default for LiquidityFixture {
    fn default() -> Self {
        Self::new().expect("Failed to create LiquidityFixture")
    }
}
