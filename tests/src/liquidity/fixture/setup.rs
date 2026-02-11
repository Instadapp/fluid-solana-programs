//! Setup functions and instruction builders for liquidity tests
//!
//! This module contains all instruction builders, setup functions,
//! operations (deposit, withdraw, borrow, payback), and default configs.

use {
    super::{LiquidityFixture, LIQUIDITY_PROGRAM_ID},
    anchor_lang::prelude::*,
    anchor_lang::InstructionData,
    anchor_lang::ToAccountMetas,
    fluid_test_framework::helpers::MintKey,
    fluid_test_framework::prelude::*,
    fluid_test_framework::Result as VmResult,
    liquidity::accounts::*,
    liquidity::state::{
        RateDataV1Params, RateDataV2Params, TokenConfig, TransferType, UserBorrowConfig,
        UserSupplyConfig,
    },
    solana_sdk::instruction::Instruction,
    solana_sdk::signer::Signer as SolSigner,
    spl_associated_token_account::get_associated_token_address,
};

impl LiquidityFixture {
    pub fn init_liquidity_ix(
        &self,
        signer: &Pubkey,
        authority: &Pubkey,
        revenue_collector: &Pubkey,
    ) -> Instruction {
        let accounts = InitLiquidity {
            signer: *signer,
            liquidity: self.get_liquidity(),
            auth_list: self.get_auth_list(),
            system_program: system_program::ID,
        };

        self.build_liquidity_ix(
            accounts,
            liquidity::instruction::InitLiquidity {
                authority: *authority,
                revenue_collector: *revenue_collector,
            },
        )
    }

    pub fn update_auths_ix(
        &self,
        signer: &Pubkey,
        auth_status: Vec<library::structs::AddressBool>,
    ) -> Instruction {
        let accounts = UpdateAuths {
            authority: *signer,
            liquidity: self.get_liquidity(),
            auth_list: self.get_auth_list(),
        };

        self.build_liquidity_ix(
            accounts,
            liquidity::instruction::UpdateAuths { auth_status },
        )
    }

    pub fn update_guardians_ix(
        &self,
        signer: &Pubkey,
        guardian_status: Vec<library::structs::AddressBool>,
    ) -> Instruction {
        let accounts = UpdateAuths {
            authority: *signer,
            liquidity: self.get_liquidity(),
            auth_list: self.get_auth_list(),
        };

        self.build_liquidity_ix(
            accounts,
            liquidity::instruction::UpdateGuardians { guardian_status },
        )
    }

    pub fn update_revenue_collector_ix(
        &self,
        signer: &Pubkey,
        revenue_collector: &Pubkey,
    ) -> Instruction {
        let accounts = UpdateRevenueCollector {
            authority: *signer,
            liquidity: self.get_liquidity(),
        };

        self.build_liquidity_ix(
            accounts,
            liquidity::instruction::UpdateRevenueCollector {
                revenue_collector: *revenue_collector,
            },
        )
    }

    pub fn init_token_reserve_ix(&self, signer: &Pubkey, mint: MintKey) -> Instruction {
        let accounts = InitTokenReserve {
            authority: *signer,
            liquidity: self.get_liquidity(),
            auth_list: self.get_auth_list(),
            mint: mint.pubkey(),
            vault: self.get_vault(mint),
            rate_model: self.get_rate_model(mint),
            token_reserve: self.get_reserve(mint),
            token_program: spl_token::ID,
            associated_token_program: spl_associated_token_account::ID,
            system_program: system_program::ID,
        };

        self.build_liquidity_ix(accounts, liquidity::instruction::InitTokenReserve {})
    }

    pub fn update_rate_data_v1_ix(
        &self,
        signer: &Pubkey,
        mint: MintKey,
        rate_data: RateDataV1Params,
    ) -> Instruction {
        let accounts = UpdateRateData {
            authority: *signer,
            auth_list: self.get_auth_list(),
            rate_model: self.get_rate_model(mint),
            mint: mint.pubkey(),
            token_reserve: self.get_reserve(mint),
        };

        Instruction {
            program_id: LIQUIDITY_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: liquidity::instruction::UpdateRateDataV1 { rate_data }.data(),
        }
    }

    pub fn update_rate_data_v2_ix(
        &self,
        signer: &Pubkey,
        mint: MintKey,
        rate_data: RateDataV2Params,
    ) -> Instruction {
        let accounts = UpdateRateData {
            authority: *signer,
            auth_list: self.get_auth_list(),
            rate_model: self.get_rate_model(mint),
            mint: mint.pubkey(),
            token_reserve: self.get_reserve(mint),
        };

        Instruction {
            program_id: LIQUIDITY_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: liquidity::instruction::UpdateRateDataV2 { rate_data }.data(),
        }
    }

    pub fn update_token_config_ix(
        &self,
        signer: &Pubkey,
        mint: MintKey,
        config: TokenConfig,
    ) -> Instruction {
        let accounts = UpdateTokenConfig {
            authority: *signer,
            auth_list: self.get_auth_list(),
            rate_model: self.get_rate_model(mint),
            mint: mint.pubkey(),
            token_reserve: self.get_reserve(mint),
        };

        Instruction {
            program_id: LIQUIDITY_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: liquidity::instruction::UpdateTokenConfig {
                token_config: config,
            }
            .data(),
        }
    }

    pub fn init_new_protocol_ix(
        &self,
        signer: &Pubkey,
        protocol: &Pubkey,
        supply_mint: MintKey,
        borrow_mint: MintKey,
    ) -> Instruction {
        let accounts = InitNewProtocol {
            authority: *signer,
            auth_list: self.get_auth_list(),
            user_supply_position: self.get_user_supply_position(supply_mint, protocol),
            user_borrow_position: self.get_user_borrow_position(borrow_mint, protocol),
            system_program: system_program::ID,
        };

        Instruction {
            program_id: LIQUIDITY_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: liquidity::instruction::InitNewProtocol {
                supply_mint: supply_mint.pubkey(),
                borrow_mint: borrow_mint.pubkey(),
                protocol: *protocol,
            }
            .data(),
        }
    }

    pub fn update_user_supply_config_ix(
        &self,
        signer: &Pubkey,
        mint: MintKey,
        protocol: &Pubkey,
        config: UserSupplyConfig,
    ) -> Instruction {
        let accounts = UpdateUserSupplyConfig {
            authority: *signer,
            protocol: *protocol,
            auth_list: self.get_auth_list(),
            rate_model: self.get_rate_model(mint),
            mint: mint.pubkey(),
            token_reserve: self.get_reserve(mint),
            user_supply_position: self.get_user_supply_position(mint, protocol),
        };

        Instruction {
            program_id: LIQUIDITY_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: liquidity::instruction::UpdateUserSupplyConfig {
                user_supply_config: config,
            }
            .data(),
        }
    }

    pub fn update_user_borrow_config_ix(
        &self,
        signer: &Pubkey,
        mint: MintKey,
        protocol: &Pubkey,
        config: UserBorrowConfig,
    ) -> Instruction {
        let accounts = UpdateUserBorrowConfig {
            authority: *signer,
            protocol: *protocol,
            auth_list: self.get_auth_list(),
            rate_model: self.get_rate_model(mint),
            mint: mint.pubkey(),
            token_reserve: self.get_reserve(mint),
            user_borrow_position: self.get_user_borrow_position(mint, protocol),
        };

        Instruction {
            program_id: LIQUIDITY_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: liquidity::instruction::UpdateUserBorrowConfig {
                user_borrow_config: config,
            }
            .data(),
        }
    }

    pub fn init_liquidity(&mut self) -> VmResult<()> {
        let admin_pubkey = self.admin.pubkey();
        let ix = self.init_liquidity_ix(&admin_pubkey, &admin_pubkey, &admin_pubkey);
        self.vm.prank(admin_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    pub fn update_auths(&mut self) -> VmResult<()> {
        let admin2_pubkey = self.admin2.pubkey();
        let auth_status = vec![library::structs::AddressBool {
            addr: admin2_pubkey,
            value: true,
        }];

        let admin_pubkey = self.admin.pubkey();
        let ix = self.update_auths_ix(&admin_pubkey, auth_status);
        self.vm.prank(admin_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    pub fn update_guardians(&mut self) -> VmResult<()> {
        let admin2_pubkey = self.admin2.pubkey();
        let guardian_status = vec![library::structs::AddressBool {
            addr: admin2_pubkey,
            value: true,
        }];

        let admin_pubkey = self.admin.pubkey();
        let ix = self.update_guardians_ix(&admin_pubkey, guardian_status);
        self.vm.prank(admin_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    pub fn update_revenue_collector(&mut self) -> VmResult<()> {
        let admin_pubkey = self.admin.pubkey();
        let ix = self.update_revenue_collector_ix(&admin_pubkey, &admin_pubkey);
        self.vm.prank(admin_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    pub fn init_token_reserve(&mut self, mints: &[MintKey]) -> VmResult<()> {
        let admin_pubkey = self.admin.pubkey();
        self.vm.start_prank(admin_pubkey);

        for mint in mints {
            let ix = self.init_token_reserve_ix(&admin_pubkey, *mint);
            self.vm.execute_as_prank(ix)?;
        }

        self.vm.stop_prank();
        Ok(())
    }

    pub fn update_rate_data_v1(&mut self, mints: &[MintKey]) -> VmResult<()> {
        let admin_pubkey = self.admin.pubkey();
        self.vm.start_prank(admin_pubkey);

        for mint in mints {
            let rate_data = self.get_default_rate_data_v1(*mint);
            let ix = self.update_rate_data_v1_ix(&admin_pubkey, *mint, rate_data);
            self.vm.execute_as_prank(ix)?;
        }

        self.vm.stop_prank();
        Ok(())
    }

    pub fn update_rate_data_v2(&mut self, mints: &[MintKey]) -> VmResult<()> {
        let admin_pubkey = self.admin.pubkey();
        self.vm.start_prank(admin_pubkey);

        for mint in mints {
            let rate_data = self.get_default_rate_data_v2(*mint);
            let ix = self.update_rate_data_v2_ix(&admin_pubkey, *mint, rate_data);
            self.vm.execute_as_prank(ix)?;
        }

        self.vm.stop_prank();
        Ok(())
    }

    pub fn update_token_configs(&mut self, mints: &[MintKey]) -> VmResult<()> {
        let admin_pubkey = self.admin.pubkey();
        self.vm.start_prank(admin_pubkey);

        for mint in mints {
            let config = self.get_default_token_config(*mint);
            let ix = self.update_token_config_ix(&admin_pubkey, *mint, config);
            self.vm.execute_as_prank(ix)?;
        }

        self.vm.stop_prank();
        Ok(())
    }

    pub fn init_new_protocol(&mut self, configs: &[(MintKey, MintKey, Pubkey)]) -> VmResult<()> {
        let admin_pubkey = self.admin.pubkey();
        self.vm.start_prank(admin_pubkey);

        for (supply_mint, borrow_mint, protocol) in configs {
            let ix = self.init_new_protocol_ix(&admin_pubkey, protocol, *supply_mint, *borrow_mint);
            self.vm.execute_as_prank(ix)?;
        }

        self.vm.stop_prank();
        Ok(())
    }

    pub fn update_user_supply_config(
        &mut self,
        mint: MintKey,
        protocol: &Pubkey,
        with_interest: bool,
    ) -> VmResult<()> {
        let config = self.get_default_supply_config(with_interest);
        let admin_pubkey = self.admin.pubkey();
        let ix = self.update_user_supply_config_ix(&admin_pubkey, mint, protocol, config);
        self.vm.prank(admin_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    pub fn update_user_borrow_config(
        &mut self,
        mint: MintKey,
        protocol: &Pubkey,
        with_interest: bool,
    ) -> VmResult<()> {
        let config = self.get_default_borrow_config(mint, with_interest);
        let admin_pubkey = self.admin.pubkey();
        let ix = self.update_user_borrow_config_ix(&admin_pubkey, mint, protocol, config);
        self.vm.prank(admin_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    pub fn update_user_supply_config_with_params(
        &mut self,
        mint: MintKey,
        protocol: &Pubkey,
        config: UserSupplyConfig,
    ) -> VmResult<()> {
        let admin_pubkey = self.admin.pubkey();
        let ix = self.update_user_supply_config_ix(&admin_pubkey, mint, protocol, config);
        self.vm.prank(admin_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    pub fn update_user_borrow_config_with_params(
        &mut self,
        mint: MintKey,
        protocol: &Pubkey,
        config: UserBorrowConfig,
    ) -> VmResult<()> {
        let admin_pubkey = self.admin.pubkey();
        let ix = self.update_user_borrow_config_ix(&admin_pubkey, mint, protocol, config);
        self.vm.prank(admin_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    /// Pre-operate instruction builder
    pub fn pre_operate_ix(
        &self,
        _signer: &Pubkey,
        mint: MintKey,
        protocol: &Pubkey,
    ) -> Instruction {
        let accounts = PreOperate {
            protocol: *protocol,
            liquidity: self.get_liquidity(),
            user_supply_position: Some(self.get_user_supply_position(mint, protocol)),
            user_borrow_position: Some(self.get_user_borrow_position(mint, protocol)),
            vault: self.get_vault(mint),
            token_reserve: self.get_reserve(mint),
            associated_token_program: spl_associated_token_account::ID,
            token_program: spl_token::ID,
        };

        Instruction {
            program_id: LIQUIDITY_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: liquidity::instruction::PreOperate {
                mint: mint.pubkey(),
            }
            .data(),
        }
    }

    /// Operate instruction builder
    pub fn operate_ix(
        &self,
        protocol: &Pubkey,
        mint: MintKey,
        supply_amount: i128,
        borrow_amount: i128,
        withdraw_to: &Pubkey,
        borrow_to: &Pubkey,
        transfer_type: TransferType,
    ) -> Instruction {
        let accounts = Operate {
            protocol: *protocol,
            liquidity: self.get_liquidity(),
            token_reserve: self.get_reserve(mint),
            mint: mint.pubkey(),
            vault: self.get_vault(mint),
            user_supply_position: Some(self.get_user_supply_position(mint, protocol)),
            user_borrow_position: Some(self.get_user_borrow_position(mint, protocol)),
            rate_model: self.get_rate_model(mint),
            withdraw_to_account: Some(get_associated_token_address(withdraw_to, &mint.pubkey())),
            borrow_to_account: Some(get_associated_token_address(borrow_to, &mint.pubkey())),
            borrow_claim_account: Some(self.get_claim_account(mint, borrow_to)),
            withdraw_claim_account: Some(self.get_claim_account(mint, withdraw_to)),
            token_program: spl_token::ID,
            associated_token_program: spl_associated_token_account::ID,
        };

        Instruction {
            program_id: LIQUIDITY_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: liquidity::instruction::Operate {
                supply_amount,
                borrow_amount,
                withdraw_to: *withdraw_to,
                borrow_to: *borrow_to,
                transfer_type,
            }
            .data(),
        }
    }

    /// Perform a pre-operate call
    pub fn pre_operate(&mut self, mint: MintKey, protocol: &Keypair) -> VmResult<()> {
        // refreshing block hash as pre-operate is a common entry point for many operations
        self.vm.expire_blockhash();

        let protocol_pubkey = protocol.pubkey();
        let ix = self.pre_operate_ix(&protocol_pubkey, mint, &protocol_pubkey);
        self.vm.prank(protocol_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    pub fn deposit(
        &mut self,
        protocol: &Keypair,
        amount: u64,
        mint: MintKey,
        user: &Keypair,
    ) -> VmResult<()> {
        self.deposit_with_transfer_type(protocol, amount, mint, user, TransferType::DIRECT)
    }

    /// Deposit tokens into liquidity with specific transfer type
    pub fn deposit_with_transfer_type(
        &mut self,
        protocol: &Keypair,
        amount: u64,
        mint: MintKey,
        user: &Keypair,
        _transfer_type: TransferType,
    ) -> VmResult<()> {
        let protocol_pubkey = protocol.pubkey();
        let user_pubkey = user.pubkey();
        let liquidity_pda = self.get_liquidity();

        self.pre_operate(mint, protocol)?;

        self.vm
            .transfer_tokens(&mint.pubkey(), &user_pubkey, &protocol_pubkey, amount)?;

        // Transfer tokens from protocol ATA to vault (liquidity PDA's ATA)
        self.vm
            .transfer_tokens(&mint.pubkey(), &protocol_pubkey, &liquidity_pda, amount)?;

        let ix = self.operate_ix(
            &protocol_pubkey,
            mint,
            amount as i128,
            0,
            &user_pubkey,
            &user_pubkey,
            TransferType::DIRECT,
        );

        self.vm.prank(protocol_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    /// Withdraw tokens from liquidity
    pub fn withdraw(
        &mut self,
        protocol: &Keypair,
        amount: u64,
        mint: MintKey,
        user: &Keypair,
    ) -> VmResult<()> {
        self.withdraw_with_transfer_type(protocol, amount, mint, user, TransferType::DIRECT)
    }

    pub fn withdraw_with_transfer_type(
        &mut self,
        protocol: &Keypair,
        amount: u64,
        mint: MintKey,
        user: &Keypair,
        transfer_type: TransferType,
    ) -> VmResult<()> {
        let protocol_pubkey = protocol.pubkey();
        let user_pubkey = user.pubkey();
        self.vm.expire_blockhash();

        // call operate with negative supply amount
        let ix = self.operate_ix(
            &protocol_pubkey,
            mint,
            -(amount as i128),
            0,
            &user_pubkey,
            &user_pubkey,
            transfer_type,
        );

        self.vm.prank(protocol_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    /// Borrow tokens from liquidity
    pub fn borrow(
        &mut self,
        protocol: &Keypair,
        amount: u64,
        mint: MintKey,
        user: &Keypair,
    ) -> VmResult<()> {
        self.borrow_with_transfer_type(protocol, amount, mint, user, TransferType::DIRECT)
    }

    pub fn borrow_with_transfer_type(
        &mut self,
        protocol: &Keypair,
        amount: u64,
        mint: MintKey,
        user: &Keypair,
        transfer_type: TransferType,
    ) -> VmResult<()> {
        let protocol_pubkey = protocol.pubkey();
        let user_pubkey = user.pubkey();

        self.vm.expire_blockhash();

        // Call operate with positive borrow amount
        let ix = self.operate_ix(
            &protocol_pubkey,
            mint,
            0,
            amount as i128,
            &user_pubkey,
            &user_pubkey,
            transfer_type,
        );

        self.vm.prank(protocol_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    /// Payback tokens to liquidity
    pub fn payback(
        &mut self,
        protocol: &Keypair,
        amount: u64,
        mint: MintKey,
        user: &Keypair,
    ) -> VmResult<()> {
        let protocol_pubkey = protocol.pubkey();
        let user_pubkey = user.pubkey();

        self.pre_operate(mint, protocol)?;

        // transfer token from user to mock protocol ATA
        self.vm
            .transfer_tokens(&mint.pubkey(), &user_pubkey, &protocol_pubkey, amount)?;

        // transfer token from mock protocol ATA to liquidity vault
        let liquidity_pda = self.get_liquidity();
        self.vm
            .transfer_tokens(&mint.pubkey(), &protocol_pubkey, &liquidity_pda, amount)?;

        // call operate with negative borrow amount
        let ix = self.operate_ix(
            &protocol_pubkey,
            mint,
            0,
            -(amount as i128),
            &user_pubkey,
            &user_pubkey,
            TransferType::DIRECT,
        );

        self.vm.prank(protocol_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    /// Operate with supply and borrow amounts
    pub fn operate(
        &mut self,
        protocol: &Keypair,
        supply_amount: i128,
        borrow_amount: i128,
        mint: MintKey,
        user: &Keypair,
    ) -> VmResult<()> {
        let protocol_pubkey = protocol.pubkey();
        let user_pubkey = user.pubkey();
        let liquidity_pda = self.get_liquidity();

        self.vm.expire_blockhash();

        let deposit_amount: u128 = supply_amount.max(0) as u128 + (-borrow_amount).max(0) as u128;

        if deposit_amount > 0 {
            self.pre_operate(mint, protocol)?;

            self.vm.transfer_tokens(
                &mint.pubkey(),
                &user_pubkey,
                &protocol_pubkey,
                deposit_amount as u64,
            )?;

            self.vm.transfer_tokens(
                &mint.pubkey(),
                &protocol_pubkey,
                &liquidity_pda,
                deposit_amount as u64,
            )?;
        }

        // Call operate
        let ix = self.operate_ix(
            &protocol_pubkey,
            mint,
            supply_amount,
            borrow_amount,
            &user_pubkey,
            &user_pubkey,
            TransferType::DIRECT,
        );

        self.vm.prank(protocol_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    pub fn init_claim_account_ix(
        &self,
        signer: &Pubkey,
        mint: MintKey,
        user: &Pubkey,
    ) -> Instruction {
        let accounts = InitClaimAccount {
            signer: *signer,
            claim_account: self.get_claim_account(mint, user),
            system_program: system_program::ID,
        };

        Instruction {
            program_id: LIQUIDITY_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: liquidity::instruction::InitClaimAccount {
                mint: mint.pubkey(),
                user: *user,
            }
            .data(),
        }
    }

    pub fn init_claim_account(&mut self, mint: MintKey, user: &Pubkey) -> VmResult<()> {
        let admin_pubkey = self.admin.pubkey();
        let ix = self.init_claim_account_ix(&admin_pubkey, mint, user);
        self.vm.prank(admin_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    pub fn claim_ix(&self, mint: MintKey, user: &Pubkey, recipient: &Pubkey) -> Instruction {
        let accounts = Claim {
            user: *user,
            liquidity: self.get_liquidity(),
            token_reserve: self.get_reserve(mint),
            mint: mint.pubkey(),
            recipient_token_account: get_associated_token_address(recipient, &mint.pubkey()),
            vault: self.get_vault(mint),
            claim_account: self.get_claim_account(mint, user),
            token_program: spl_token::ID,
            associated_token_program: spl_associated_token_account::ID,
        };

        Instruction {
            program_id: LIQUIDITY_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: liquidity::instruction::Claim {
                recipient: *recipient,
            }
            .data(),
        }
    }

    pub fn claim(
        &mut self,
        mint: MintKey,
        user: &Keypair,
        recipient: Option<&Pubkey>,
    ) -> VmResult<()> {
        let user_pubkey = user.pubkey();
        let recipient_pubkey = recipient.unwrap_or(&user_pubkey);
        let ix = self.claim_ix(mint, &user_pubkey, recipient_pubkey);
        self.vm.prank(user_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    pub fn close_claim_account_ix(&self, mint: MintKey, user: &Pubkey) -> Instruction {
        let accounts = CloseClaimAccount {
            user: *user,
            claim_account: self.get_claim_account(mint, user),
            system_program: system_program::ID,
        };

        Instruction {
            program_id: LIQUIDITY_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: liquidity::instruction::CloseClaimAccount {
                _mint: mint.pubkey(),
            }
            .data(),
        }
    }

    pub fn close_claim_account(&mut self, mint: MintKey, user: &Keypair) -> VmResult<()> {
        let user_pubkey = user.pubkey();
        let ix = self.close_claim_account_ix(mint, &user_pubkey);
        self.vm.prank(user_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    pub fn pause_user_ix(
        &self,
        signer: &Pubkey,
        supply_mint: MintKey,
        borrow_mint: MintKey,
        protocol: &Pubkey,
        supply_status: Option<u8>,
        borrow_status: Option<u8>,
    ) -> Instruction {
        let accounts = PauseUser {
            authority: *signer,
            auth_list: self.get_auth_list(),
            user_supply_position: self.get_user_supply_position(supply_mint, protocol),
            user_borrow_position: self.get_user_borrow_position(borrow_mint, protocol),
        };

        Instruction {
            program_id: LIQUIDITY_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: liquidity::instruction::PauseUser {
                protocol: *protocol,
                supply_mint: supply_mint.pubkey(),
                borrow_mint: borrow_mint.pubkey(),
                supply_status,
                borrow_status,
            }
            .data(),
        }
    }

    pub fn pause_user(
        &mut self,
        supply_mint: MintKey,
        borrow_mint: MintKey,
        protocol: &Pubkey,
        supply_status: u8,
        borrow_status: u8,
    ) -> VmResult<()> {
        let admin_pubkey = self.admin.pubkey();
        let ix = self.pause_user_ix(
            &admin_pubkey,
            supply_mint,
            borrow_mint,
            protocol,
            Some(supply_status),
            Some(borrow_status),
        );
        self.vm.prank(admin_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    pub fn unpause_user_ix(
        &self,
        signer: &Pubkey,
        supply_mint: MintKey,
        borrow_mint: MintKey,
        protocol: &Pubkey,
        supply_status: Option<u8>,
        borrow_status: Option<u8>,
    ) -> Instruction {
        let accounts = PauseUser {
            authority: *signer,
            auth_list: self.get_auth_list(),
            user_supply_position: self.get_user_supply_position(supply_mint, protocol),
            user_borrow_position: self.get_user_borrow_position(borrow_mint, protocol),
        };

        Instruction {
            program_id: LIQUIDITY_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: liquidity::instruction::UnpauseUser {
                protocol: *protocol,
                supply_mint: supply_mint.pubkey(),
                borrow_mint: borrow_mint.pubkey(),
                supply_status,
                borrow_status,
            }
            .data(),
        }
    }

    pub fn unpause_user(
        &mut self,
        supply_mint: MintKey,
        borrow_mint: MintKey,
        protocol: &Pubkey,
        supply_status: u8,
        borrow_status: u8,
    ) -> VmResult<()> {
        let admin_pubkey = self.admin.pubkey();
        let ix = self.unpause_user_ix(
            &admin_pubkey,
            supply_mint,
            borrow_mint,
            protocol,
            Some(supply_status),
            Some(borrow_status),
        );
        self.vm.prank(admin_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    pub fn update_rate_data_v1_with_params(
        &mut self,
        mint: MintKey,
        rate_data: RateDataV1Params,
    ) -> VmResult<()> {
        let admin_pubkey = self.admin.pubkey();
        let ix = self.update_rate_data_v1_ix(&admin_pubkey, mint, rate_data);
        self.vm.prank(admin_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    pub fn update_rate_data_v2_with_params(
        &mut self,
        mint: MintKey,
        rate_data: RateDataV2Params,
    ) -> VmResult<()> {
        let admin_pubkey = self.admin.pubkey();
        let ix = self.update_rate_data_v2_ix(&admin_pubkey, mint, rate_data);
        self.vm.prank(admin_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    pub fn update_token_config_with_params(
        &mut self,
        mint: MintKey,
        config: TokenConfig,
    ) -> VmResult<()> {
        let admin_pubkey = self.admin.pubkey();
        let ix = self.update_token_config_ix(&admin_pubkey, mint, config);
        self.vm.prank(admin_pubkey);
        self.vm.execute_as_prank(ix)?;
        Ok(())
    }

    pub fn update_exchange_price_ix(&self, mint: MintKey) -> Instruction {
        let accounts = UpdateExchangePrice {
            token_reserve: self.get_reserve(mint),
            rate_model: self.get_rate_model(mint),
        };

        Instruction {
            program_id: LIQUIDITY_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: liquidity::instruction::UpdateExchangePrice {
                _mint: mint.pubkey(),
            }
            .data(),
        }
    }

    pub fn update_exchange_price(&mut self, mint: MintKey) -> VmResult<()> {
        self.vm.expire_blockhash();
        let ix = self.update_exchange_price_ix(mint);
        self.vm.execute_instruction(ix, &self.admin)?;
        Ok(())
    }

    pub fn warp_with_exchange_price(&mut self, mint: MintKey, warp_seconds: i64) -> VmResult<()> {
        let warp_per_cycle: i64 = 30 * time::DAY; // 30 days
        let mut warped_seconds: i64 = 0;

        while warped_seconds < warp_seconds {
            if warped_seconds + warp_per_cycle > warp_seconds {
                // last warp -> only warp difference
                self.vm.warp_time(warp_seconds - warped_seconds);
            } else {
                self.vm.warp_time(warp_per_cycle);
            }
            self.update_exchange_price(mint)?;
            warped_seconds += warp_per_cycle;
        }

        Ok(())
    }

    /// Advance slot only (useful between transactions that need unique signatures)
    pub fn advance_slot(&mut self) {
        self.vm.warp_slots(1);
    }

    pub fn set_user_allowances_default_interest_free(
        &mut self,
        mint: MintKey,
        protocol: &Keypair,
    ) -> VmResult<()> {
        self.set_user_allowances_default_with_mode(mint, &protocol.pubkey(), false)
    }

    pub fn set_user_allowances_default(
        &mut self,
        mint: MintKey,
        protocol: &Keypair,
    ) -> VmResult<()> {
        self.set_user_allowances_default_with_mode(mint, &protocol.pubkey(), true)
    }

    pub fn set_user_allowances_default_with_mode(
        &mut self,
        mint: MintKey,
        protocol: &Pubkey,
        with_interest: bool,
    ) -> VmResult<()> {
        // Update supply config
        let supply_config = self.get_default_supply_config(with_interest);
        self.update_user_supply_config_with_params(mint, protocol, supply_config)?;

        // Update borrow config
        let borrow_config = self.get_default_borrow_config(mint, with_interest);
        self.update_user_borrow_config_with_params(mint, protocol, borrow_config)?;

        Ok(())
    }

    /// Complete setup flow
    pub fn setup(&mut self) -> VmResult<()> {
        let mints = MintKey::all();

        self.setup_spl_token_mints(&mints)?;

        self.init_liquidity()?;

        self.update_auths()?;

        self.update_guardians()?;

        self.update_revenue_collector()?;

        self.init_token_reserve(&mints)?;

        self.update_rate_data_v1(&mints)?;

        self.update_token_configs(&mints)?;

        let liquidity_pda = self.get_liquidity();
        for mint in &mints {
            self.setup_ata(*mint, &liquidity_pda, 0)?;
        }

        let u64_max = u64::MAX;
        let u64_less = u64::MAX / 10;

        let mock_protocol = self.mock_protocol.pubkey();
        let mock_protocol_interest_free = self.mock_protocol_interest_free.pubkey();
        let mock_protocol_with_interest = self.mock_protocol_with_interest.pubkey();
        let alice = self.alice.pubkey();
        let bob = self.bob.pubkey();
        let admin = self.admin.pubkey();

        for mint in &mints {
            // Protocol ATAs
            self.setup_ata(*mint, &mock_protocol, 0)?;
            self.setup_ata(*mint, &mock_protocol_interest_free, 0)?;
            self.setup_ata(*mint, &mock_protocol_with_interest, 0)?;

            // User ATAs with funds
            self.setup_ata(*mint, &alice, u64_max)?;
            self.setup_ata(*mint, &bob, u64_less)?;
            self.setup_ata(*mint, &admin, u64_max)?;
        }

        // Init protocols
        for mint in &mints {
            self.init_new_protocol(&[
                (*mint, *mint, mock_protocol),
                (*mint, *mint, mock_protocol_interest_free),
                (*mint, *mint, mock_protocol_with_interest),
            ])?;
        }

        // Init claim accounts
        for mint in &mints {
            self.init_claim_account(*mint, &mock_protocol)?;
            self.init_claim_account(*mint, &mock_protocol_interest_free)?;
            self.init_claim_account(*mint, &mock_protocol_with_interest)?;
            self.init_claim_account(*mint, &alice)?;
            self.init_claim_account(*mint, &bob)?;
            self.init_claim_account(*mint, &admin)?;
        }

        // Set user allowances
        for mint in &mints {
            self.set_user_allowances_default_with_mode(*mint, &mock_protocol_interest_free, false)?;
            self.set_user_allowances_default_with_mode(*mint, &mock_protocol_with_interest, true)?;
        }

        Ok(())
    }

    pub fn get_default_rate_data_v1(&self, _mint: MintKey) -> RateDataV1Params {
        RateDataV1Params {
            kink: Self::DEFAULT_KINK,
            rate_at_utilization_zero: Self::DEFAULT_RATE_AT_ZERO,
            rate_at_utilization_kink: Self::DEFAULT_RATE_AT_KINK,
            rate_at_utilization_max: Self::DEFAULT_RATE_AT_MAX,
        }
    }

    pub fn get_default_rate_data_v2(&self, _mint: MintKey) -> RateDataV2Params {
        RateDataV2Params {
            kink1: 50 * 100,
            kink2: Self::DEFAULT_KINK,
            rate_at_utilization_zero: Self::DEFAULT_RATE_AT_ZERO,
            rate_at_utilization_kink1: 7 * 100,
            rate_at_utilization_kink2: Self::DEFAULT_RATE_AT_KINK,
            rate_at_utilization_max: Self::DEFAULT_RATE_AT_MAX,
        }
    }

    /// helper to assemble an instruction with the common program id
    fn build_liquidity_ix<A, D>(&self, accounts: A, data: D) -> Instruction
    where
        A: ToAccountMetas,
        D: InstructionData,
    {
        Instruction {
            program_id: LIQUIDITY_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: data.data(),
        }
    }

    pub fn get_default_token_config(&self, mint: MintKey) -> TokenConfig {
        TokenConfig {
            token: mint.pubkey(),
            fee: 0,
            max_utilization: 10_000,
        }
    }

    pub fn get_default_supply_config(&self, with_interest: bool) -> UserSupplyConfig {
        UserSupplyConfig {
            mode: if with_interest { 1 } else { 0 },
            expand_percent: Self::DEFAULT_EXPAND_WITHDRAWAL_LIMIT_PERCENT,
            expand_duration: Self::DEFAULT_EXPAND_WITHDRAWAL_LIMIT_DURATION,
            base_withdrawal_limit: Self::DEFAULT_BASE_WITHDRAWAL_LIMIT,
        }
    }

    pub fn get_default_borrow_config(
        &self,
        mint: MintKey,
        with_interest: bool,
    ) -> UserBorrowConfig {
        // Use token-specific debt ceiling based on decimals
        // For 6 decimal tokens (USDC, EURC): 1M tokens = 1e6 * 1e6 = 1e12
        // For 9 decimal tokens (WSOL): 1M tokens = 1e6 * 1e9 = 1e15
        let token_unit = 10u128.pow(mint.decimals() as u32);
        let base_debt_ceiling = 10_000 * token_unit; // 10k tokens
        let max_debt_ceiling = 1_000_000 * token_unit; // 1M tokens

        UserBorrowConfig {
            mode: if with_interest { 1 } else { 0 },
            expand_percent: Self::DEFAULT_EXPAND_DEBT_CEILING_PERCENT,
            expand_duration: Self::DEFAULT_EXPAND_DEBT_CEILING_DURATION,
            base_debt_ceiling,
            max_debt_ceiling,
        }
    }

    /// Higher borrow limits for vault tests that need multiple positions
    pub fn get_vault_borrow_config(&self, mint: MintKey, with_interest: bool) -> UserBorrowConfig {
        let token_unit = 10u128.pow(mint.decimals() as u32);
        let base_debt_ceiling = 1_000_000 * token_unit; // 1M tokens (much higher for vault tests)
        let max_debt_ceiling = 10_000_000 * token_unit; // 10M tokens

        UserBorrowConfig {
            mode: if with_interest { 1 } else { 0 },
            expand_percent: Self::DEFAULT_EXPAND_DEBT_CEILING_PERCENT,
            expand_duration: Self::DEFAULT_EXPAND_DEBT_CEILING_DURATION,
            base_debt_ceiling,
            max_debt_ceiling,
        }
    }

    /// Set user allowances with higher limits for vault tests
    pub fn set_user_allowances_for_vault_with_mode(
        &mut self,
        mint: MintKey,
        protocol: &Pubkey,
        with_interest: bool,
    ) -> VmResult<()> {
        // Update supply config
        let supply_config = self.get_default_supply_config(with_interest);
        self.update_user_supply_config_with_params(mint, protocol, supply_config)?;

        // Update borrow config with higher limits for vaults
        let borrow_config = self.get_vault_borrow_config(mint, with_interest);
        self.update_user_borrow_config_with_params(mint, protocol, borrow_config)?;

        Ok(())
    }
}
