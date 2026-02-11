//! Setup functions and instruction builders for lending tests
//!
//! This module contains all instruction builders and setup functions for lending operations.

use {
    super::{LendingFixture, LENDING_PROGRAM_ID},
    anchor_lang::prelude::*,
    anchor_lang::InstructionData,
    anchor_lang::ToAccountMetas,
    fluid_test_framework::helpers::MintKey,
    fluid_test_framework::prelude::*,
    fluid_test_framework::Result as VmResult,
    lending::accounts::*,
    mpl_token_metadata::ID as TOKEN_METADATA_PROGRAM_ID,
    solana_sdk::instruction::Instruction,
    solana_sdk::signer::Signer as SolSigner,
};

impl LendingFixture {
    /// Build a lending instruction
    fn build_lending_ix<A: ToAccountMetas, I: InstructionData>(
        &self,
        accounts: A,
        instruction: I,
    ) -> Instruction {
        Instruction {
            program_id: LENDING_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: instruction.data(),
        }
    }

    /// Initialize LendingAdmin instruction
    pub fn init_lending_admin_ix(
        &self,
        signer: &Pubkey,
        authority: &Pubkey,
        rebalancer: &Pubkey,
    ) -> Instruction {
        let accounts = InitLendingAdmin {
            authority: *signer,
            lending_admin: self.get_lending_admin(),
            system_program: system_program::ID,
        };

        self.build_lending_ix(
            accounts,
            lending::instruction::InitLendingAdmin {
                liquidity_program: crate::liquidity::fixture::LIQUIDITY_PROGRAM_ID,
                rebalancer: *rebalancer,
                authority: *authority,
            },
        )
    }

    /// Initialize Lending instruction
    pub fn init_lending_ix(&self, signer: &Pubkey, mint: MintKey, symbol: String) -> Instruction {
        let f_token_mint = self.get_f_token_mint(mint);
        let (metadata_account_pda, _) = Pubkey::find_program_address(
            &[
                b"metadata",
                TOKEN_METADATA_PROGRAM_ID.as_ref(),
                f_token_mint.as_ref(),
            ],
            &TOKEN_METADATA_PROGRAM_ID,
        );

        let accounts = InitLending {
            signer: *signer,
            lending_admin: self.get_lending_admin(),
            mint: mint.pubkey(),
            f_token_mint,
            metadata_account: metadata_account_pda,
            lending: self.get_lending(mint),
            token_reserves_liquidity: self.liquidity.get_reserve(mint),
            token_program: spl_token::ID,
            system_program: system_program::ID,
            sysvar_instruction: anchor_lang::solana_program::sysvar::instructions::id(),
            metadata_program: TOKEN_METADATA_PROGRAM_ID,
            rent: anchor_lang::solana_program::sysvar::rent::id(),
        };

        self.build_lending_ix(
            accounts,
            lending::instruction::InitLending {
                symbol,
                liquidity_program: crate::liquidity::fixture::LIQUIDITY_PROGRAM_ID,
            },
        )
    }

    /// Set rewards rate model instruction
    ///
    /// Note: `rewards_rate_model` PDA should be provided from test setup (LRRM module)
    pub fn set_rewards_rate_model_ix(
        &self,
        signer: &Pubkey,
        mint: MintKey,
        rewards_rate_model: Pubkey,
    ) -> Instruction {
        let accounts = SetRewardsRateModel {
            signer: *signer,
            lending_admin: self.get_lending_admin(),
            lending: self.get_lending(mint),
            f_token_mint: self.get_f_token_mint(mint),
            new_rewards_rate_model: rewards_rate_model,
            supply_token_reserves_liquidity: self.liquidity.get_reserve(mint),
        };

        self.build_lending_ix(
            accounts,
            lending::instruction::SetRewardsRateModel {
                mint: mint.pubkey(),
            },
        )
    }

    /// Initialize LendingAdmin (executes the instruction)
    pub fn init_lending_admin(&mut self) -> VmResult<()> {
        let admin_pubkey = self.admin.pubkey();
        let ix = self.init_lending_admin_ix(&admin_pubkey, &admin_pubkey, &admin_pubkey);
        self.vm().prank(admin_pubkey);
        self.vm().execute_as_prank(ix)?;
        Ok(())
    }

    /// Initialize Lending (executes the instruction)
    pub fn init_lending(&mut self, mint: MintKey, symbol: String) -> VmResult<()> {
        let admin_pubkey = self.admin.pubkey();
        let ix = self.init_lending_ix(&admin_pubkey, mint, symbol);
        self.vm().prank(admin_pubkey);
        self.vm().execute_as_prank(ix)?;
        Ok(())
    }

    /// Set rewards rate model (executes the instruction)
    ///
    /// Note: `rewards_rate_model` PDA should be provided from test setup (LRRM module)
    pub fn set_rewards_rate_model(
        &mut self,
        mint: MintKey,
        rewards_rate_model: Pubkey,
    ) -> VmResult<()> {
        let admin_pubkey = self.admin.pubkey();
        let ix = self.set_rewards_rate_model_ix(&admin_pubkey, mint, rewards_rate_model);
        self.vm().prank(admin_pubkey);
        self.vm().execute_as_prank(ix)?;
        Ok(())
    }
}
