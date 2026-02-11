mod setup;

pub use setup::*;

use {
    crate::liquidity::fixture::LiquidityFixture, anchor_lang::prelude::*,
    fluid_test_framework::errors::VmError, fluid_test_framework::helpers::MintKey,
    fluid_test_framework::prelude::*, fluid_test_framework::Result as VmResult,
    fluid_test_framework::Vm as LendingVm, mpl_token_metadata::ID as TOKEN_METADATA_PROGRAM_ID,
};

pub const LENDING_PROGRAM_ID: Pubkey = lending::ID;

/// PDA Seeds
pub mod seeds {
    pub const LENDING_ADMIN: &[u8] = b"lending_admin";
    pub const LENDING: &[u8] = b"lending";
    pub const F_TOKEN_MINT: &[u8] = b"f_token_mint";
}

/// Lending test fixture
///
/// Extends LiquidityFixture since lending depends on liquidity
pub struct LendingFixture {
    /// The underlying liquidity fixture
    pub liquidity: LiquidityFixture,

    pub admin: Keypair,
    pub alice: Keypair,
    pub bob: Keypair,
}

impl LendingFixture {
    pub fn new() -> VmResult<Self> {
        // load liquidity first before lending
        let mut liquidity = LiquidityFixture::new()?;

        let lending_program_path =
            fluid_test_framework::helpers::BaseFixture::find_program_path("lending.so")
                .ok_or(VmError::ProgramNotFound("lending.so".to_string()))?;
        let metadata_program_path = ["", "../", "../../", "../../../"]
            .iter()
            .map(|prefix| {
                format!(
                    "{}test-utils/typescript/binaries/mpl_token_metadata.so",
                    prefix
                )
            })
            .find(|path| std::path::Path::new(path).exists())
            .ok_or(VmError::ProgramNotFound(
                "mpl_token_metadata.so".to_string(),
            ))?;

        liquidity
            .vm
            .add_program_from_file(&LENDING_PROGRAM_ID, &lending_program_path)?;
        liquidity
            .vm
            .add_program_from_file(&TOKEN_METADATA_PROGRAM_ID, &metadata_program_path)?;

        let admin = liquidity.vm.make_account(10_000 * LAMPORTS_PER_SOL);
        let alice = liquidity.vm.make_account(10_000 * LAMPORTS_PER_SOL);
        let bob = liquidity.vm.make_account(10_000 * LAMPORTS_PER_SOL);

        Ok(Self {
            liquidity,
            admin,
            alice,
            bob,
        })
    }

    /// Get the VM instance
    pub fn vm(&mut self) -> &mut LendingVm {
        &mut self.liquidity.vm
    }

    /// Get lending admin PDA
    pub fn get_lending_admin(&self) -> Pubkey {
        Pubkey::find_program_address(&[seeds::LENDING_ADMIN], &LENDING_PROGRAM_ID).0
    }

    /// Get f_token_mint PDA for a mint
    pub fn get_f_token_mint(&self, mint: MintKey) -> Pubkey {
        Pubkey::find_program_address(
            &[seeds::F_TOKEN_MINT, mint.pubkey().as_ref()],
            &LENDING_PROGRAM_ID,
        )
        .0
    }

    /// Get lending PDA for a mint
    pub fn get_lending(&self, mint: MintKey) -> Pubkey {
        let f_token_mint = self.get_f_token_mint(mint);
        Pubkey::find_program_address(
            &[
                seeds::LENDING,
                mint.pubkey().as_ref(),
                f_token_mint.as_ref(),
            ],
            &LENDING_PROGRAM_ID,
        )
        .0
    }
}

impl Default for LendingFixture {
    fn default() -> Self {
        Self::new().expect("Failed to create LendingFixture")
    }
}
