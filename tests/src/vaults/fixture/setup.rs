//! Setup functions and instruction builders for vault tests
//!
//! This module contains all instruction builders, setup functions,
//! operations (operate, liquidate, etc.), and default configs.

use {
    super::{
        VaultFixture, DEFAULT_ORACLE_PRICE, MAX_BRANCH_SINGLE_TX, MAX_TICK,
        MAX_TICK_HAS_DEBT_ARRAY_SINGLE_TX, MAX_TICK_ID_LIQUIDATION_SINGLE_TX, MAX_TICK_SINGLE_TX,
        MIN_TICK, ORACLE_PROGRAM_ID, VAULTS_PROGRAM_ID,
    },
    crate::liquidity::fixture::{LiquidityFixture, LIQUIDITY_PROGRAM_ID},
    anchor_lang::{prelude::*, InstructionData, ToAccountMetas},
    base64::engine::general_purpose::STANDARD as BASE64_STANDARD,
    base64::Engine as _,
    fluid_test_framework::anchor_mainnet_rpc_url,
    fluid_test_framework::{helpers::MintKey, prelude::*, Result as VmResult},
    library::math::tick::TickMath,
    liquidity::state::TransferType,
    oracle::state::{SourceType, Sources},
    serde_json::Value,
    solana_client::rpc_client::RpcClient,
    solana_sdk::{
        instruction::Instruction,
        signature::{Keypair as SolKeypair, Signer as SolSigner},
    },
    spl_associated_token_account::get_associated_token_address,
    std::collections::HashMap,
    std::path::PathBuf,
    std::convert::TryFrom,
    std::str::FromStr,
    vaults::{
        accounts::*,
        state::{
            tick_has_debt::{
                get_array_index_for_tick,
                get_first_tick_for_map_in_array, TICK_HAS_DEBT_ARRAY_SIZE, TICK_HAS_DEBT_CHILDREN_SIZE,
            },
            InitVaultConfigParams,
        },
    },
};

pub struct OperateVars<'a> {
    pub vault_id: u16,
    pub position_id: u32,
    pub user: &'a SolKeypair,
    pub position_owner: &'a SolKeypair,
    pub collateral_amount: i128,
    pub debt_amount: i128,
    pub recipient: &'a SolKeypair,
}

pub struct LiquidateVars<'a> {
    pub vault_id: u16,
    pub user: &'a SolKeypair,
    pub to: &'a SolKeypair,
    pub debt_amount: u64,
    pub col_per_unit_debt: u128,
    pub absorb: bool,
}

impl VaultFixture {
    /// Create a new vault fixture
    pub fn new() -> VmResult<Self> {
        let vaults_program_path = BaseFixture::find_program_path("vaults.so")
            .ok_or(VmError::ProgramNotFound("vaults.so".to_string()))?;
        let oracle_program_path = BaseFixture::find_program_path("oracle.so")
            .ok_or(VmError::ProgramNotFound("oracle.so".to_string()))?;
        let liquidity_program_path = BaseFixture::find_program_path("liquidity.so")
            .ok_or(VmError::ProgramNotFound("liquidity.so".to_string()))?;
        let metadata_program_path = ["", "../", "../../", "../../../"]
            .iter()
            .map(|prefix| format!("{}test-utils/typescript/binaries/mpl_token_metadata.so", prefix))
            .find(|path| std::path::Path::new(path).exists())
            .ok_or(VmError::ProgramNotFound(
                "mpl_token_metadata.so".to_string(),
            ))?;

        let mut vm = VmBuilder::new()
            .with_program(ProgramArtifact::new(
                VAULTS_PROGRAM_ID,
                "Vaults",
                vaults_program_path,
            ))
            .with_program(ProgramArtifact::new(
                ORACLE_PROGRAM_ID,
                "Oracle",
                oracle_program_path,
            ))
            .with_program(ProgramArtifact::new(
                LIQUIDITY_PROGRAM_ID,
                "Liquidity",
                liquidity_program_path,
            ))
            .with_program(ProgramArtifact::new(
                mpl_token_metadata::ID,
                "TokenMetadata",
                metadata_program_path,
            ))
            .build_blocking()?;

        let admin = vm.make_account(10_000 * LAMPORTS_PER_SOL);
        let admin2 = vm.make_account(10_000 * LAMPORTS_PER_SOL);
        let alice = vm.make_account(10_000 * LAMPORTS_PER_SOL);
        let bob = vm.make_account(10_000 * LAMPORTS_PER_SOL);

        let mock_protocol = vm.make_account(10_000 * LAMPORTS_PER_SOL);
        let mock_protocol_interest_free = vm.make_account(10_000 * LAMPORTS_PER_SOL);
        let mock_protocol_with_interest = vm.make_account(10_000 * LAMPORTS_PER_SOL);

        // Create authority for lookup table operations (before moving vm)
        let lookup_table_authority = vm.make_account(10_000 * LAMPORTS_PER_SOL);

        let liquidity_fixture = LiquidityFixture {
            vm,
            admin,
            admin2,
            alice,
            bob,
            mock_protocol,
            mock_protocol_interest_free,
            mock_protocol_with_interest,
        };

        Ok(Self {
            liquidity: liquidity_fixture,
            oracle_price: DEFAULT_ORACLE_PRICE,
            oracle_sources: HashMap::new(),
            vault_to_lookup_table_map: HashMap::new(),
            lookup_table_authority,
        })
    }

    /// Complete setup flow for vault tests
    pub fn setup(&mut self) -> VmResult<()> {
        self.liquidity.setup()?;

        self.init_vault_admin()?;

        self.init_oracle_admin()?;

        for vault_id in 1..=4u16 {
            self.deploy_lookup_table(vault_id)?;
        }

        for vault_id in 1..=4u16 {
            self.deploy_oracle(vault_id)?;
        }

        // Initialize vaults 1-4
        for vault_id in 1..=4u16 {
            self.init_vault(vault_id)?;
        }

        // Set default allowances for each vault
        for vault_id in 1..=4u16 {
            let supply_mint = self.get_vault_supply_token(vault_id);
            let borrow_mint = self.get_vault_borrow_token(vault_id);
            let protocol = self.get_vault_config(vault_id);

            self.liquidity
                .init_new_protocol(&[(supply_mint, supply_mint, protocol)])?;
            self.liquidity
                .init_new_protocol(&[(borrow_mint, borrow_mint, protocol)])?;

            self.set_user_allowances_default(supply_mint, &protocol)?;
            self.set_user_allowances_default(borrow_mint, &protocol)?;
        }

        // Initialize claim accounts for vaults
        let mints = [Self::SUPPLY_TOKEN, Self::BORROW_TOKEN, Self::NATIVE_TOKEN];
        for vault_id in 1..=4u16 {
            let vault_config = self.get_vault_config(vault_id);
            for mint in &mints {
                self.liquidity.init_claim_account(*mint, &vault_config)?;
            }
        }

        // Set default allowances for mockProtocol
        let mock_protocol_pubkey = self.liquidity.mock_protocol.pubkey();
        for mint in &mints {
            self.liquidity.set_user_allowances_default_with_mode(
                *mint,
                &mock_protocol_pubkey,
                true,
            )?;
        }

        // Deposit initial liquidity using mock protocol
        let mock_protocol_clone = self.liquidity.mock_protocol.insecure_clone();
        let alice_clone = self.liquidity.alice.insecure_clone();
        self.liquidity.deposit(
            &mock_protocol_clone,
            100_000_000_000_000,
            Self::SUPPLY_TOKEN,
            &alice_clone,
        )?;

        let mock_protocol_clone = self.liquidity.mock_protocol.insecure_clone();
        let alice_clone = self.liquidity.alice.insecure_clone();
        self.liquidity.deposit(
            &mock_protocol_clone,
            100_000_000_000_000,
            Self::BORROW_TOKEN,
            &alice_clone,
        )?;

        let mock_protocol_clone = self.liquidity.mock_protocol.insecure_clone();
        let alice_clone = self.liquidity.alice.insecure_clone();
        self.liquidity.deposit(
            &mock_protocol_clone,
            100_000_000_000_000,
            Self::NATIVE_TOKEN,
            &alice_clone,
        )?;
        Ok(())
    }

    fn set_user_allowances_default(&mut self, mint: MintKey, protocol: &Pubkey) -> VmResult<()> {
        // Use higher borrow limits for vault tests (100k tokens instead of 10k)
        self.liquidity
            .set_user_allowances_for_vault_with_mode(mint, protocol, false)
    }

    /// Initialize vault admin
    pub fn init_vault_admin(&mut self) -> VmResult<()> {
        let admin_pubkey = self.liquidity.admin.pubkey();

        let accounts = InitVaultAdmin {
            signer: admin_pubkey,
            vault_admin: self.get_vault_admin(),
            system_program: system_program::ID,
        };

        let ix = Instruction {
            program_id: VAULTS_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: vaults::instruction::InitVaultAdmin {
                liquidity: LIQUIDITY_PROGRAM_ID,
                authority: admin_pubkey,
            }
            .data(),
        };

        self.liquidity.vm.prank(admin_pubkey);
        self.liquidity.vm.execute_as_prank(ix)?;
        Ok(())
    }

    /// Initialize oracle admin
    pub fn init_oracle_admin(&mut self) -> VmResult<()> {
        let admin_pubkey = self.liquidity.admin.pubkey();

        let accounts = oracle::accounts::InitAdmin {
            signer: admin_pubkey,
            oracle_admin: self.get_oracle_admin(),
            system_program: system_program::ID,
        };

        let ix = Instruction {
            program_id: ORACLE_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: oracle::instruction::InitAdmin {
                authority: admin_pubkey,
            }
            .data(),
        };

        self.liquidity.vm.prank(admin_pubkey);
        self.liquidity.vm.execute_as_prank(ix)?;
        Ok(())
    }

    /// Pyth SOL/USDC mainnet feed address
    const SOL_USDC_PYTH_FEED: &'static str = "HT2PLQBcG5EiCcNSaMHAjSgd9F98ecpATbk4Sk5oYuM";

    pub fn deploy_oracle(&mut self, oracle_id: u16) -> VmResult<()> {
        let admin_pubkey = self.liquidity.admin.pubkey();

        let source_pubkey = Pubkey::from_str(Self::SOL_USDC_PYTH_FEED)
            .map_err(|e| VmError::Custom(format!("Invalid Pyth feed address: {}", e)))?;

        self.fetch_pyth_account_from_mainnet(&source_pubkey)?;

        // Store the source for later use in remaining accounts
        self.oracle_sources.insert(oracle_id, source_pubkey);

        let sources = vec![Sources {
            source: source_pubkey,
            invert: false,
            multiplier: 1,
            divisor: 1,
            source_type: SourceType::Pyth,
        }];

        let accounts = oracle::accounts::InitOracleConfig {
            signer: admin_pubkey,
            oracle: self.get_oracle(oracle_id),
            oracle_admin: self.get_oracle_admin(),
            system_program: system_program::ID,
        };

        let ix = Instruction {
            program_id: ORACLE_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: oracle::instruction::InitOracleConfig {
                sources,
                nonce: oracle_id,
            }
            .data(),
        };

        self.liquidity.vm.prank(admin_pubkey);
        self.liquidity.vm.execute_as_prank(ix)?;
        Ok(())
    }

    fn fetch_pyth_account_from_mainnet(&mut self, pubkey: &Pubkey) -> VmResult<()> {
        if self.liquidity.vm.get_account(pubkey).is_some() {
            return Ok(());
        }

        let rpc_url = anchor_mainnet_rpc_url()?;
        let client = RpcClient::new(rpc_url);

        let account = client
            .get_account(pubkey)
            .map_err(|e| VmError::RpcError(format!("Failed to fetch Pyth account: {}", e)))?;

        self.liquidity.vm.set_account(pubkey, account)?;

        Ok(())
    }

    /// Get oracle source pubkey for a vault
    pub fn get_oracle_source(&self, vault_id: u16) -> Pubkey {
        *self
            .oracle_sources
            .get(&vault_id)
            .expect("Oracle source not found")
    }

    /// Get default core settings for a vault
    pub fn get_default_core_settings(&self, _vault_id: u16) -> InitVaultConfigParams {
        let admin_pubkey = self.liquidity.admin.pubkey();
        InitVaultConfigParams {
            supply_rate_magnifier: 0,
            borrow_rate_magnifier: 0,
            collateral_factor: 8000,     // 80%
            liquidation_threshold: 8100, // 81%
            liquidation_max_limit: 9000, // 90%
            withdraw_gap: 500,           // 5%
            liquidation_penalty: 0,
            borrow_fee: 0,
            rebalancer: admin_pubkey,
            liquidity_program: LIQUIDITY_PROGRAM_ID,
            oracle_program: ORACLE_PROGRAM_ID,
        }
    }

    /// Initialize a vault
    pub fn init_vault(&mut self, vault_id: u16) -> VmResult<Pubkey> {
        self.init_vault_config(vault_id)?;

        self.init_vault_state(vault_id)?;

        for branch_id in 0..MAX_BRANCH_SINGLE_TX {
            self.init_branch(vault_id, branch_id)?;
        }

        for tick in MIN_TICK..(MIN_TICK + MAX_TICK_SINGLE_TX) {
            self.init_tick(vault_id, tick)?;
        }
        self.init_tick(vault_id, 0)?; // Also init tick 0

        for index in 0..MAX_TICK_HAS_DEBT_ARRAY_SINGLE_TX {
            self.init_tick_has_debt_array(vault_id, index)?;
        }
        self.init_tick_has_debt_array(vault_id, 15)?; // Also init index 15

        for tick in MIN_TICK..(MIN_TICK + MAX_TICK_ID_LIQUIDATION_SINGLE_TX) {
            self.init_tick_id_liquidation(vault_id, tick)?;
        }

        Ok(self.get_vault_config(vault_id))
    }

    /// Initialize vault config
    fn init_vault_config(&mut self, vault_id: u16) -> VmResult<()> {
        let admin_pubkey = self.liquidity.admin.pubkey();
        let params = self.get_default_core_settings(vault_id);
        let supply_mint = self.get_vault_supply_token(vault_id);
        let borrow_mint = self.get_vault_borrow_token(vault_id);

        let accounts = vaults::accounts::InitVaultConfig {
            authority: admin_pubkey,
            vault_admin: self.get_vault_admin(),
            vault_config: self.get_vault_config(vault_id),
            vault_metadata: self.get_vault_metadata(vault_id),
            oracle: self.get_oracle(vault_id),
            supply_token: supply_mint.pubkey(),
            borrow_token: borrow_mint.pubkey(),
            system_program: system_program::ID,
        };

        let ix = Instruction {
            program_id: VAULTS_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: vaults::instruction::InitVaultConfig { vault_id, params }.data(),
        };

        self.liquidity.vm.prank(admin_pubkey);
        self.liquidity.vm.execute_as_prank(ix)?;
        Ok(())
    }

    /// Initialize vault state
    fn init_vault_state(&mut self, vault_id: u16) -> VmResult<()> {
        let admin_pubkey = self.liquidity.admin.pubkey();
        let supply_mint = self.get_vault_supply_token(vault_id);
        let borrow_mint = self.get_vault_borrow_token(vault_id);

        let accounts = vaults::accounts::InitVaultState {
            authority: admin_pubkey,
            vault_admin: self.get_vault_admin(),
            vault_config: self.get_vault_config(vault_id),
            vault_state: self.get_vault_state(vault_id),
            supply_token_reserves_liquidity: self.liquidity.get_reserve(supply_mint),
            borrow_token_reserves_liquidity: self.liquidity.get_reserve(borrow_mint),
            system_program: system_program::ID,
        };

        let ix = Instruction {
            program_id: VAULTS_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: vaults::instruction::InitVaultState { vault_id }.data(),
        };

        self.liquidity.vm.prank(admin_pubkey);
        self.liquidity.vm.execute_as_prank(ix)?;
        Ok(())
    }

    /// Initialize branch
    fn init_branch(&mut self, vault_id: u16, branch_id: u32) -> VmResult<()> {
        let admin_pubkey = self.liquidity.admin.pubkey();

        let accounts = vaults::accounts::InitBranch {
            signer: admin_pubkey,
            vault_config: self.get_vault_config(vault_id),
            branch: self.get_branch(vault_id, branch_id),
            system_program: system_program::ID,
        };

        let ix = Instruction {
            program_id: VAULTS_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: vaults::instruction::InitBranch {
                vault_id,
                branch_id,
            }
            .data(),
        };

        self.liquidity.vm.prank(admin_pubkey);
        self.liquidity.vm.execute_as_prank(ix)?;
        Ok(())
    }

    /// Initialize tick
    fn init_tick(&mut self, vault_id: u16, tick: i32) -> VmResult<()> {
        let admin_pubkey = self.liquidity.admin.pubkey();

        let accounts = vaults::accounts::InitTick {
            signer: admin_pubkey,
            vault_config: self.get_vault_config(vault_id),
            tick_data: self.get_tick(vault_id, tick),
            system_program: system_program::ID,
        };

        let ix = Instruction {
            program_id: VAULTS_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: vaults::instruction::InitTick { vault_id, tick }.data(),
        };

        self.liquidity.vm.prank(admin_pubkey);
        self.liquidity.vm.execute_as_prank(ix)?;
        Ok(())
    }

    /// Initialize tick has debt array
    fn init_tick_has_debt_array(&mut self, vault_id: u16, index: u8) -> VmResult<()> {
        let admin_pubkey = self.liquidity.admin.pubkey();

        let accounts = vaults::accounts::InitTickHasDebtArray {
            signer: admin_pubkey,
            vault_config: self.get_vault_config(vault_id),
            tick_has_debt_array: self.get_tick_has_debt_array(vault_id, index),
            system_program: system_program::ID,
        };

        let ix = Instruction {
            program_id: VAULTS_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: vaults::instruction::InitTickHasDebtArray { vault_id, index }.data(),
        };

        self.liquidity.vm.prank(admin_pubkey);
        self.liquidity.vm.execute_as_prank(ix)?;
        Ok(())
    }

    /// Initialize tick ID liquidation
    fn init_tick_id_liquidation(&mut self, vault_id: u16, tick: i32) -> VmResult<()> {
        self.init_tick_id_liquidation_with_total_ids(vault_id, tick, 0)
    }

    /// Initialize tick ID liquidation with specific total_ids
    fn init_tick_id_liquidation_with_total_ids(
        &mut self,
        vault_id: u16,
        tick: i32,
        total_ids: u32,
    ) -> VmResult<()> {
        let admin_pubkey = self.liquidity.admin.pubkey();

        let accounts = vaults::accounts::InitTickIdLiquidation {
            signer: admin_pubkey,
            tick_data: self.get_tick(vault_id, tick),
            tick_id_liquidation: self.get_tick_id_liquidation(vault_id, tick, total_ids),
            system_program: system_program::ID,
        };

        let ix = Instruction {
            program_id: VAULTS_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: vaults::instruction::InitTickIdLiquidation {
                vault_id,
                tick,
                total_ids,
            }
            .data(),
        };

        self.liquidity.vm.prank(admin_pubkey);
        self.liquidity.vm.execute_as_prank(ix)?;
        Ok(())
    }

    /// Initialize a position
    pub fn init_position(
        &mut self,
        vault_id: u16,
        user: &solana_sdk::signature::Keypair,
    ) -> VmResult<u32> {
        let user_pubkey = user.pubkey();
        let next_position_id = self.get_next_position_id(vault_id)?;

        let position_mint = self.get_position_mint(vault_id, next_position_id);
        let position_token_account = get_associated_token_address(&user_pubkey, &position_mint);

        // Derive metadata account PDA
        let metadata_account = Pubkey::find_program_address(
            &[
                b"metadata",
                mpl_token_metadata::ID.as_ref(),
                position_mint.as_ref(),
            ],
            &mpl_token_metadata::ID,
        )
        .0;

        let accounts = vaults::accounts::InitPosition {
            signer: user_pubkey,
            vault_admin: self.get_vault_admin(),
            vault_state: self.get_vault_state(vault_id),
            position: self.get_position(vault_id, next_position_id),
            position_mint,
            position_token_account,
            metadata_account,
            token_program: spl_token::ID,
            associated_token_program: spl_associated_token_account::ID,
            system_program: system_program::ID,
            sysvar_instruction: solana_sdk::sysvar::instructions::ID,
            metadata_program: mpl_token_metadata::ID,
            rent: solana_sdk::sysvar::rent::ID,
        };

        let ix = Instruction {
            program_id: VAULTS_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: vaults::instruction::InitPosition {
                vault_id,
                next_position_id,
            }
            .data(),
        };

        self.liquidity.vm.prank(user_pubkey);
        self.liquidity.vm.execute_as_prank(ix)?;

        Ok(next_position_id)
    }

    /// Check if an account exists (not owned by system program)
    fn account_exists(&self, address: &Pubkey) -> bool {
        self.liquidity.vm.get_account(address).is_some()
    }

    /// Operate vault (deposit, withdraw, borrow, payback)
    pub fn operate_vault(&mut self, vars: &OperateVars) -> VmResult<()> {
        let user_pubkey = vars.user.pubkey();
        let recipient_pubkey = vars.recipient.pubkey();
        let position_owner_pubkey = vars.position_owner.pubkey();

        let supply_mint = self.get_vault_supply_token(vars.vault_id);
        let borrow_mint = self.get_vault_borrow_token(vars.vault_id);

        let position_mint = self.get_position_mint(vars.vault_id, vars.position_id);
        let position_token_account =
            get_associated_token_address(&position_owner_pubkey, &position_mint);

        // Get tick from position or use MIN_TICK for new positions
        const COLD_TICK: i32 = i32::MIN;
        let position_tick = self
            .get_position_tick(vars.vault_id, vars.position_id)
            .unwrap_or(COLD_TICK);
        let current_tick = if position_tick == COLD_TICK {
            MIN_TICK
        } else {
            position_tick
        };

        // Calculate final tick based on new debt/collateral ratio
        let (current_col, current_debt_raw, dust_debt_raw) =
            match self.read_position(vars.vault_id, vars.position_id) {
                Ok(pos) => {
                    let col = pos.collateral as u128;
                    let dust_debt = pos.debt as u128;

                    // ratio = getRatioAtTick(tick)
                    // debt = ratio * (collateral + 1) >> 48 + 1
                    let debt = if pos.tick > MIN_TICK {
                        let ratio = TickMath::get_ratio_at_tick(pos.tick).map_err(|e| {
                            VmError::Custom(format!("Failed to get ratio at tick: {:?}", e))
                        })?;
                        let collateral_for_debt_calc = col + 1;
                        // debt_raw = ratio * collateral / 2^48 + 1
                        (ratio * collateral_for_debt_calc >> 48) + 1
                    } else {
                        0
                    };
                    (col as i128, debt as i128, dust_debt as i128)
                }
                Err(_) => (0, 0, 0),
            };

        // match 12 decimal precision used internally (6 -> 9 decimals = 1e3)
        let decimal_scale = 1_000_i128;
        const MIN_I128: i128 = i128::MIN;

        let new_col = if vars.collateral_amount == MIN_I128 {
            0 // Max withdraw - result will be 0 collateral
        } else if vars.collateral_amount > MIN_I128 {
            current_col + (vars.collateral_amount.saturating_mul(decimal_scale))
        } else {
            current_col
        };

        let new_debt_raw = if vars.debt_amount == MIN_I128 {
            0 // Max payback - result will be 0 debt
        } else if vars.debt_amount > MIN_I128 {
            current_debt_raw + (vars.debt_amount.saturating_mul(decimal_scale))
        } else {
            current_debt_raw
        };

        let net_debt = if new_debt_raw > dust_debt_raw {
            new_debt_raw - dust_debt_raw
        } else {
            0
        };

        let final_tick = if net_debt <= 0 || new_col <= 0 {
            MIN_TICK
        } else {
            // margin_adjusted_debt = net_debt * 1000000001 / 1000000000 + 1
            let net_debt_u = net_debt as u128;
            let col = new_col as u128;
            let margin_adjusted_debt = (net_debt_u * 1_000_000_001 / 1_000_000_000) + 1;

            // ratio = margin_adjusted_debt * ZERO_TICK_SCALED_RATIO / colRaw
            let ratio = margin_adjusted_debt * TickMath::ZERO_TICK_SCALED_RATIO / col;

            match TickMath::get_tick_at_ratio(ratio) {
                Ok((base_tick, _)) => {
                    let tick = base_tick + 1;
                    tick.clamp(MIN_TICK, MAX_TICK)
                }
                Err(_) => MIN_TICK,
            }
        };

        let current_tick_pda = self.get_tick(vars.vault_id, current_tick);
        if !self.account_exists(&current_tick_pda) {
            self.init_tick(vars.vault_id, current_tick)?;
        }

        let final_tick_pda = self.get_tick(vars.vault_id, final_tick);
        if final_tick != current_tick && !self.account_exists(&final_tick_pda) {
            self.init_tick(vars.vault_id, final_tick)?;
        }

        // Read tick data to get the current total_ids for TickIdLiquidation PDA derivation
        let current_tick_total_ids = if let Ok(tick_data) =
            self.read_tick(vars.vault_id, current_tick)
        {
            tick_data.total_ids
        } else {
            0
        };

        let final_tick_total_ids =
            if final_tick != current_tick {
                if let Ok(tick_data) = self.read_tick(vars.vault_id, final_tick) {
                    tick_data.total_ids
                } else {
                    0
                }
            } else {
                current_tick_total_ids
            };

        // Initialize tick ID liquidation accounts if they don't exist
        // Note: get_tick_id_liquidation internally applies (total_ids + 2) / 3
        // So we pass the raw total_ids value, not the transformed tick_map
        // When tick's total_ids increases (after positions are created/liquidated),
        // we may need a new TickIdLiquidation account for the new index
        let current_tick_id_pda =
            self.get_tick_id_liquidation(vars.vault_id, current_tick, current_tick_total_ids);
        if !self.account_exists(&current_tick_id_pda) {
            self.init_tick_id_liquidation_with_total_ids(
                vars.vault_id,
                current_tick,
                current_tick_total_ids,
            )?;
        }

        let final_tick_id_pda =
            self.get_tick_id_liquidation(vars.vault_id, final_tick, final_tick_total_ids);
        if final_tick != current_tick && !self.account_exists(&final_tick_id_pda) {
            self.init_tick_id_liquidation_with_total_ids(
                vars.vault_id,
                final_tick,
                final_tick_total_ids,
            )?;
        }


        let vault_state = self.read_vault_state(vars.vault_id)?;
        let new_branch_id = if vault_state.branch_liquidated == 1 {
            let new_id = vault_state.total_branch_id + 1;
            // Init branch if it doesn't exist
            let new_branch_pda = self.get_branch(vars.vault_id, new_id);
            if !self.account_exists(&new_branch_pda) {
                self.init_branch(vars.vault_id, new_id)?;
            }
            new_id
        } else {
            vault_state.current_branch
        };

        let accounts = vaults::accounts::Operate {
            signer: user_pubkey,
            signer_supply_token_account: get_associated_token_address(
                &user_pubkey,
                &supply_mint.pubkey(),
            ),
            signer_borrow_token_account: get_associated_token_address(
                &user_pubkey,
                &borrow_mint.pubkey(),
            ),
            recipient: Some(recipient_pubkey),
            recipient_borrow_token_account: Some(get_associated_token_address(
                &recipient_pubkey,
                &borrow_mint.pubkey(),
            )),
            recipient_supply_token_account: Some(get_associated_token_address(
                &recipient_pubkey,
                &supply_mint.pubkey(),
            )),
            vault_config: self.get_vault_config(vars.vault_id),
            vault_state: self.get_vault_state(vars.vault_id),
            supply_token: supply_mint.pubkey(),
            borrow_token: borrow_mint.pubkey(),
            oracle: self.get_oracle(vars.vault_id),
            position: self.get_position(vars.vault_id, vars.position_id),
            position_token_account,
            current_position_tick: self.get_tick(vars.vault_id, current_tick),
            final_position_tick: self.get_tick(vars.vault_id, final_tick),
            current_position_tick_id: self.get_tick_id_liquidation(
                vars.vault_id,
                current_tick,
                current_tick_total_ids,
            ),
            final_position_tick_id: self.get_tick_id_liquidation(
                vars.vault_id,
                final_tick,
                final_tick_total_ids,
            ),
            // new_branch_id is calculated based on vault state
            new_branch: self.get_branch(vars.vault_id, new_branch_id),
            supply_token_reserves_liquidity: self.liquidity.get_reserve(supply_mint),
            borrow_token_reserves_liquidity: self.liquidity.get_reserve(borrow_mint),
            vault_supply_position_on_liquidity: self
                .get_vault_supply_position_on_liquidity(vars.vault_id),
            vault_borrow_position_on_liquidity: self
                .get_vault_borrow_position_on_liquidity(vars.vault_id),
            supply_rate_model: self.liquidity.get_rate_model(supply_mint),
            borrow_rate_model: self.liquidity.get_rate_model(borrow_mint),
            vault_supply_token_account: self.liquidity.get_vault(supply_mint),
            vault_borrow_token_account: self.liquidity.get_vault(borrow_mint),
            supply_token_claim_account: Some(
                self.liquidity
                    .get_claim_account(supply_mint, &self.get_vault_config(vars.vault_id)),
            ),
            borrow_token_claim_account: Some(
                self.liquidity
                    .get_claim_account(borrow_mint, &self.get_vault_config(vars.vault_id)),
            ),
            liquidity: self.liquidity.get_liquidity(),
            liquidity_program: LIQUIDITY_PROGRAM_ID,
            oracle_program: ORACLE_PROGRAM_ID,
            supply_token_program: spl_token::ID,
            borrow_token_program: spl_token::ID,
            associated_token_program: spl_associated_token_account::ID,
            system_program: system_program::ID,
        };

        // Build remaining accounts:
        // Order: 1. Oracle sources, 2. Branches, 3. Tick has debt arrays
        // remaining_accounts_indices: [num_oracle_sources, num_branches, num_tick_has_debt]
        let oracle_source = self.get_oracle_source(vars.vault_id);
        let mut instruction_accounts = accounts.to_account_metas(None);

        // 1. Add oracle source
        instruction_accounts.push(solana_sdk::instruction::AccountMeta::new_readonly(
            oracle_source,
            false,
        ));

        // 2. Add branch accounts - load all relevant branches
        // This is critical for operations after liquidation
        let mut branch_ids: Vec<u32> = Vec::new();
        let current_branch_id = vault_state.current_branch;

        if current_branch_id > 0 {
            branch_ids.push(current_branch_id);

            // Also add connected branches by traversing branch links
            if let Ok(current_branch) = self.read_branch(vars.vault_id, current_branch_id) {
                let mut connected_id = current_branch.connected_branch_id;
                while connected_id > 0 && !branch_ids.contains(&connected_id) {
                    branch_ids.push(connected_id);
                    if let Ok(connected_branch) = self.read_branch(vars.vault_id, connected_id) {
                        connected_id = connected_branch.connected_branch_id;
                    } else {
                        break;
                    }
                }
            }
        }

        // Always include branch 0 if not already there
        if !branch_ids.contains(&0) {
            branch_ids.push(0);
        }

        // If branch_liquidated, also include the new branch we're passing as new_branch
        if vault_state.branch_liquidated == 1 && !branch_ids.contains(&new_branch_id) {
            branch_ids.push(new_branch_id);
        }

        // Collect minima ticks from all relevant branches
        let mut branch_ticks: Vec<i32> = Vec::new();
        for branch_id in &branch_ids {
            if let Ok(branch) = self.read_branch(vars.vault_id, *branch_id) {
                if branch.minima_tick != i32::MIN {
                    branch_ticks.push(branch.minima_tick);
                }
                if branch.connected_minima_tick != i32::MIN {
                    branch_ticks.push(branch.connected_minima_tick);
                }
            }
        }
        for branch_id in 0..=MAX_BRANCH_SINGLE_TX {
            if let Ok(branch) = self.read_branch(vars.vault_id, branch_id) {
                if branch.minima_tick != i32::MIN {
                    branch_ticks.push(branch.minima_tick);
                }
                if branch.connected_minima_tick != i32::MIN {
                    branch_ticks.push(branch.connected_minima_tick);
                }
            }
        }
        // Include minima ticks from all branches as a fallback
        for branch_id in 0..=MAX_BRANCH_SINGLE_TX {
            if let Ok(branch) = self.read_branch(vars.vault_id, branch_id) {
                if branch.minima_tick != i32::MIN {
                    branch_ticks.push(branch.minima_tick);
                }
                if branch.connected_minima_tick != i32::MIN {
                    branch_ticks.push(branch.connected_minima_tick);
                }
            }
        }

        let mut branch_account_addresses: Vec<Pubkey> = Vec::new();
        for branch_id in &branch_ids {
            let branch_pda = self.get_branch(vars.vault_id, *branch_id);
            if !self.account_exists(&branch_pda) {
                self.init_branch(vars.vault_id, *branch_id)?;
            }
            instruction_accounts.push(solana_sdk::instruction::AccountMeta::new(
                branch_pda,
                false,
            ));
            branch_account_addresses.push(branch_pda);
        }

        // 3. Calculate and add tick_has_debt arrays
        // Each tick_has_debt array covers 2048 ticks (16 arrays total for the full tick range)
        // Index is calculated as: (tick + 16383) / 2048
        // The program may need to traverse all arrays from 0 to topmost to find ticks with debt
        let _get_tick_has_debt_index =
            |tick: i32| -> u8 { ((tick + 16383) / 2048).clamp(0, 15) as u8 };

        // Include all tick_has_debt arrays from 0 to the maximum index needed
        // The program needs to traverse from index 0 up to find ticks with debt
        let mut tick_has_debt_indices: Vec<u8> = Vec::new();

        let mut tick_has_debt_addresses: Vec<Pubkey> = Vec::new();
        for index in (0..=MAX_TICK_HAS_DEBT_ARRAY_SINGLE_TX).rev() {
            let tick_has_debt_pda = self.get_tick_has_debt_array(vars.vault_id, index);
            // Initialize if not exists
            if !self.account_exists(&tick_has_debt_pda) {
                self.init_tick_has_debt_array(vars.vault_id, index)?;
            }
            instruction_accounts.push(solana_sdk::instruction::AccountMeta::new(
                tick_has_debt_pda,
                false,
            ));
            tick_has_debt_indices.push(index);
            tick_has_debt_addresses.push(tick_has_debt_pda);
        }

        if !branch_account_addresses.is_empty() {
            self.add_addresses_to_lookup_table(vars.vault_id, branch_account_addresses)?;
        }

        if !tick_has_debt_addresses.is_empty() {
            self.add_addresses_to_lookup_table(vars.vault_id, tick_has_debt_addresses)?;
        }

        // Remaining accounts indices: [num_oracle_sources, num_branches, num_tick_has_debt]
        let remaining_accounts_indices: Vec<u8> =
            vec![1, branch_ids.len() as u8, tick_has_debt_indices.len() as u8];

        // Add all accounts involved in the instruction to the lookup table
        let lookup_addresses: Vec<Pubkey> =
            instruction_accounts.iter().map(|meta| meta.pubkey).collect();
        self.add_addresses_to_lookup_table(vars.vault_id, lookup_addresses)?;

        let ix = Instruction {
            program_id: VAULTS_PROGRAM_ID,
            accounts: instruction_accounts,
            data: vaults::instruction::Operate {
                new_col: vars.collateral_amount,
                new_debt: vars.debt_amount,
                transfer_type: Some(TransferType::DIRECT),
                remaining_accounts_indices,
            }
            .data(),
        };

        let lookup_table = self.get_lookup_table_account(vars.vault_id)?;
        let user_keypair = SolKeypair::try_from(&vars.user.to_bytes()[..]).unwrap();
        self.liquidity
            .vm
            .execute_v0(vec![ix], vec![lookup_table], &user_keypair)?;
        Ok(())
    }

    /// Update supply rate magnifier for a vault
    pub fn update_supply_rate_magnifier(
        &mut self,
        vault_id: u16,
        supply_rate_magnifier: i16,
    ) -> VmResult<()> {
        let admin_pubkey = self.liquidity.admin.pubkey();

        let supply_mint = self.get_vault_supply_token(vault_id);
        let borrow_mint = self.get_vault_borrow_token(vault_id);

        let accounts = vaults::accounts::Admin {
            authority: admin_pubkey,
            vault_admin: self.get_vault_admin(),
            vault_state: self.get_vault_state(vault_id),
            vault_config: self.get_vault_config(vault_id),
            supply_token_reserves_liquidity: self.liquidity.get_reserve(supply_mint),
            borrow_token_reserves_liquidity: self.liquidity.get_reserve(borrow_mint),
        };

        let ix = Instruction {
            program_id: VAULTS_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: vaults::instruction::UpdateSupplyRateMagnifier {
                vault_id,
                supply_rate_magnifier,
            }
            .data(),
        };

        self.liquidity.vm.prank(admin_pubkey);
        self.liquidity.vm.execute_as_prank(ix)?;
        Ok(())
    }

    /// Rebalance vault
    pub fn rebalance(&mut self, vault_id: u16) -> VmResult<()> {
        let admin_pubkey = self.liquidity.admin.pubkey();

        let supply_mint = self.get_vault_supply_token(vault_id);
        let borrow_mint = self.get_vault_borrow_token(vault_id);

        let accounts = vaults::accounts::Rebalance {
            rebalancer: admin_pubkey,
            rebalancer_supply_token_account: get_associated_token_address(
                &admin_pubkey,
                &supply_mint.pubkey(),
            ),
            rebalancer_borrow_token_account: get_associated_token_address(
                &admin_pubkey,
                &borrow_mint.pubkey(),
            ),
            vault_config: self.get_vault_config(vault_id),
            vault_state: self.get_vault_state(vault_id),
            supply_token: supply_mint.pubkey(),
            borrow_token: borrow_mint.pubkey(),
            supply_token_reserves_liquidity: self.liquidity.get_reserve(supply_mint),
            borrow_token_reserves_liquidity: self.liquidity.get_reserve(borrow_mint),
            vault_supply_position_on_liquidity: self
                .get_vault_supply_position_on_liquidity(vault_id),
            vault_borrow_position_on_liquidity: self
                .get_vault_borrow_position_on_liquidity(vault_id),
            supply_rate_model: self.liquidity.get_rate_model(supply_mint),
            borrow_rate_model: self.liquidity.get_rate_model(borrow_mint),
            liquidity: self.liquidity.get_liquidity(),
            liquidity_program: LIQUIDITY_PROGRAM_ID,
            vault_supply_token_account: self.liquidity.get_vault(supply_mint),
            vault_borrow_token_account: self.liquidity.get_vault(borrow_mint),
            system_program: system_program::ID,
            supply_token_program: spl_token::ID,
            borrow_token_program: spl_token::ID,
            associated_token_program: spl_associated_token_account::ID,
        };

        let ix = Instruction {
            program_id: VAULTS_PROGRAM_ID,
            accounts: accounts.to_account_metas(None),
            data: vaults::instruction::Rebalance {}.data(),
        };

        self.liquidity.vm.prank(admin_pubkey);
        self.liquidity.vm.execute_as_prank(ix)?;
        Ok(())
    }

    /// Set oracle price by updating the Pyth account data
    pub fn set_oracle_price(&mut self, price: u128, _no_inverse: bool) -> VmResult<()> {
        self.oracle_price = price;

        if let Some(&source_pubkey) = self.oracle_sources.get(&1) {
            self.update_pyth_price(&source_pubkey, price as i64)?;
        }

        Ok(())
    }

    /// Update the price in a Pyth PriceUpdateV2 account
    fn update_pyth_price(&mut self, source: &Pubkey, price: i64) -> VmResult<()> {
        let account = self
            .liquidity
            .vm
            .get_account(source)
            .ok_or_else(|| VmError::AccountNotFound(source.to_string()))?;

        let mut data = account.data.clone();

        // PythV2 PriceUpdateV2 structure offsets:
        // BASE_OFFSET = 8 (discriminator)
        // PRICE_MESSAGE_OFFSET = 33 + 8 = 41
        // PRICE_OFFSET within message = 32
        // So total price offset = 41 + 32 = 73
        const PRICE_OFFSET: usize = 41 + 32;
        const PUBLISH_TIME_OFFSET: usize = 41 + 52;
        const POSTED_SLOT_OFFSET: usize = 41 + 84;

        if data.len() > POSTED_SLOT_OFFSET + 8 {
            // Update price
            data[PRICE_OFFSET..PRICE_OFFSET + 8].copy_from_slice(&price.to_le_bytes());

            // Update publish time to current timestamp
            let clock = self.liquidity.vm.clock();
            let current_time = clock.unix_timestamp;
            data[PUBLISH_TIME_OFFSET..PUBLISH_TIME_OFFSET + 8]
                .copy_from_slice(&current_time.to_le_bytes());

            // Increment posted slot
            let current_slot = u64::from_le_bytes(
                data[POSTED_SLOT_OFFSET..POSTED_SLOT_OFFSET + 8]
                    .try_into()
                    .unwrap(),
            );
            data[POSTED_SLOT_OFFSET..POSTED_SLOT_OFFSET + 8]
                .copy_from_slice(&(current_slot + 1).to_le_bytes());

            // Set the updated account
            let updated_account = solana_sdk::account::Account {
                lamports: account.lamports,
                data,
                owner: account.owner,
                executable: account.executable,
                rent_epoch: account.rent_epoch,
            };

            self.liquidity.vm.set_account(source, updated_account)?;
        }

        Ok(())
    }

    pub fn warp(&mut self, seconds: i64) {
        self.liquidity.vm.warp_time(seconds);
    }

    pub fn balance_of(&self, owner: &Pubkey, mint: MintKey) -> u64 {
        self.liquidity.vm.token_balance(owner, &mint.pubkey())
    }

    pub fn balance(&self, owner: &Pubkey) -> u64 {
        self.liquidity.vm.balance(owner)
    }
    /// Deploy a lookup table for a vault by loading from JSON file
    pub fn deploy_lookup_table(&mut self, vault_id: u16) -> VmResult<()> {
        let table_address = Pubkey::new_unique();

        let account_info_path = Self::get_account_info_path()?;
        let file_content = std::fs::read_to_string(&account_info_path).map_err(|e| {
            VmError::Custom(format!(
                "Failed to read lookup table file '{}': {}",
                account_info_path.display(),
                e
            ))
        })?;

        let json_data: Value = serde_json::from_str(&file_content).map_err(|e| {
            VmError::Custom(format!(
                "Failed to parse lookup table JSON '{}': {}",
                account_info_path.display(),
                e
            ))
        })?;

        let data_array = json_data
            .get("data")
            .and_then(|d| d.get("data"))
            .and_then(|d| d.as_array())
            .ok_or_else(|| {
                VmError::Custom("Invalid lookup table JSON format: missing data array".into())
            })?;

        let mut lookup_table_data: Vec<u8> = data_array
            .iter()
            .filter_map(|v| v.as_u64().map(|n| n as u8))
            .collect();

        // Replace the authority bytes with our custom authority (offset 22, length 32)
        const AUTHORITY_OFFSET: usize = 22;
        let authority_bytes = self.lookup_table_authority.pubkey().to_bytes();
        if AUTHORITY_OFFSET + authority_bytes.len() > lookup_table_data.len() {
            return Err(VmError::Custom(
                "Lookup table data too small to patch authority".into(),
            ));
        }
        lookup_table_data[AUTHORITY_OFFSET..AUTHORITY_OFFSET + authority_bytes.len()]
            .copy_from_slice(&authority_bytes);

        let lamports = json_data
            .get("lamports")
            .and_then(|l| l.as_u64())
            .unwrap_or(0);

        self
            .liquidity
            .vm
            .set_lookup_table_from_data(&table_address, lookup_table_data, lamports)?;

        self.vault_to_lookup_table_map.insert(vault_id, table_address);

        Ok(())
    }

    fn get_account_info_path() -> VmResult<PathBuf> {
        // Try multiple paths relative to the workspace
        let paths_to_try = [
            // "accountInfo.json",
            // "../accountInfo.json",
            // "../../accountInfo.json",
            "test-utils/typescript/accountInfo.json",
            // "../test-utils/typescript/accountInfo.json",
            // "../../test-utils/typescript/accountInfo.json",
        ];

        for path in &paths_to_try {
            let p = std::path::Path::new(path);
            if p.exists() {
                return Ok(p.to_path_buf());
            }
        }

        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            // From tests/ directory, go up one level to fluid-contracts-solana/
            let workspace_root = std::path::Path::new(&manifest_dir).parent();

            if let Some(root) = workspace_root {
                let path = root.join("test-utils/typescript/accountInfo.json");
                if path.exists() {
                    return Ok(path);
                }
            }
        }

        Err(VmError::Custom(
            "Could not find accountInfo.json".to_string(),
        ))
    }

    /// Add addresses to a vault's lookup table
    pub fn add_addresses_to_lookup_table(
        &mut self,
        vault_id: u16,
        addresses: Vec<Pubkey>,
    ) -> VmResult<()> {
        use fluid_test_framework::helpers::LookupTableManager;

        let table_address = self
            .vault_to_lookup_table_map
            .get(&vault_id)
            .ok_or_else(|| {
                VmError::Custom(format!("No lookup table for vault {}", vault_id))
            })?;

        let existing_addresses = self.liquidity.vm.get_lookup_table_addresses(table_address)?;
        let existing_set: std::collections::HashSet<_> = existing_addresses.into_iter().collect();

        let new_addresses: Vec<_> = addresses
            .into_iter()
            .filter(|addr| !existing_set.contains(addr))
            .collect();

        if new_addresses.is_empty() {
            return Ok(());
        }

        let ix = self.liquidity.vm.extend_lookup_table_ix(
            table_address,
            &self.lookup_table_authority.pubkey(),
            &self.lookup_table_authority.pubkey(),
            new_addresses,
        );

        self.liquidity.vm.prank(self.lookup_table_authority.pubkey());
        self.liquidity.vm.execute_as_prank(ix)?;
        self.liquidity.vm.warp_slots(1);

        Ok(())
    }

    /// Get the lookup table account for a vault
    pub fn get_lookup_table_account(
        &self,
        vault_id: u16,
    ) -> VmResult<solana_sdk::address_lookup_table::AddressLookupTableAccount> {
        use fluid_test_framework::helpers::LookupTableManager;

        let table_address = self
            .vault_to_lookup_table_map
            .get(&vault_id)
            .ok_or_else(|| {
                VmError::Custom(format!("No lookup table for vault {}", vault_id))
            })?;

        self.liquidity.vm.get_lookup_table_account(table_address)
    }

    fn read_tick_has_debt_bitmaps(
        &self,
        vault_id: u16,
        index: u8,
    ) -> VmResult<[[u8; TICK_HAS_DEBT_CHILDREN_SIZE]; TICK_HAS_DEBT_ARRAY_SIZE]> {
        let address = self.get_tick_has_debt_array(vault_id, index);
        let account = self
            .liquidity
            .vm
            .get_account(&address)
            .ok_or_else(|| VmError::AccountNotFound(address.to_string()))?;
        eprintln!(
            "tick_has_debt array {} data len {}, header bytes {:?}",
            index,
            account.data.len(),
            &account.data[0..8.min(account.data.len())]
        );

        let mut cursor = 8usize; // header uses 8 bytes (u16 + u8 + padding)
        let mut result = [[0u8; TICK_HAS_DEBT_CHILDREN_SIZE]; TICK_HAS_DEBT_ARRAY_SIZE];
        for map_idx in 0..TICK_HAS_DEBT_ARRAY_SIZE {
            let end = cursor + TICK_HAS_DEBT_CHILDREN_SIZE;
            if end > account.data.len() {
                return Err(VmError::Custom(
                    "TickHasDebtArray account shorter than expected".to_string(),
                ));
            }
            result[map_idx].copy_from_slice(&account.data[cursor..end]);
            cursor = end;
        }
        Ok(result)
    }

    fn collect_bitmap_ticks(
        &self,
        vault_id: u16,
        start_tick: i32,
        liquidation_tick: i32,
        max_count: usize,
    ) -> VmResult<Vec<i32>> {
        if max_count == 0 || start_tick == i32::MIN {
            return Ok(Vec::new());
        }

        let mut ticks = Vec::new();
        let mut current_top = start_tick;
        let mut array_index = match get_array_index_for_tick(start_tick) {
            Ok(idx) => idx,
            Err(_) => return Ok(ticks),
        };

        while ticks.len() < max_count {
            let bitmaps = self.read_tick_has_debt_bitmaps(vault_id, array_index)?;
            for map_idx in (0..TICK_HAS_DEBT_ARRAY_SIZE).rev() {
                let map_first_tick =
                    match get_first_tick_for_map_in_array(array_index, map_idx as u8) {
                        Ok(tick) => tick,
                        Err(_) => continue,
                    };
                for byte_idx in (0..TICK_HAS_DEBT_CHILDREN_SIZE).rev() {
                    let byte_val = bitmaps[map_idx][byte_idx];
                    if byte_val == 0 {
                        continue;
                    }
                    for bit in (0..8).rev() {
                        if byte_val & (1 << bit) == 0 {
                            continue;
                        }
                        let tick_value = map_first_tick + (byte_idx * 8 + bit) as i32;
                        if tick_value >= current_top {
                            continue;
                        }
                         if tick_value < liquidation_tick {
                            return Ok(ticks);
                        }
                        if !ticks.contains(&tick_value) {
                            ticks.push(tick_value);
                            current_top = tick_value;
                            if ticks.len() >= max_count {
                                return Ok(ticks);
                            }
                        }
                    }
                }
            }

            if array_index == 0 {
                break;
            }
            array_index -= 1;
        }

        Ok(ticks)
    }

    /// Set oracle price with percent decrease
    pub fn set_oracle_price_percent_decrease(
        &mut self,
        price: u128,
        positive_tick: bool,
        percent: u128,
    ) -> VmResult<()> {
        let new_price = if positive_tick {
            // newPrice = price * (10000 - percent) / 10000
            price * (10000 - percent) / 10000
        } else {
            // For inverse: newPrice = 1e16 / price, then apply percent decrease
            let inverse_price = 10_u128.pow(16) / price;
            inverse_price * (10000 - percent) / 10000
        };
        self.set_oracle_price(new_price, positive_tick)
    }

    /// Liquidate vault positions
    pub fn liquidate_vault(&mut self, vars: &LiquidateVars) -> VmResult<(u128, u128)> {
        let user_pubkey = vars.user.pubkey();
        let to_pubkey = vars.to.pubkey();

        let supply_mint = self.get_vault_supply_token(vars.vault_id);
        let borrow_mint = self.get_vault_borrow_token(vars.vault_id);
        let vault_state = self.read_vault_state(vars.vault_id)?;

        // Calculate liquidation tick from oracle price
        // liquidation_ratio = oracle_price * 2^48 / 1e8
        let liquidation_ratio = self.oracle_price * 281_474_976_710_656 / 100_000_000;

        let vault_config = self.read_vault_config(vars.vault_id)?;
        let liquidation_threshold = vault_config.liquidation_threshold as u128;

        // liquidation_threshold_ratio = liquidation_ratio * threshold / 1000
        let liquidation_threshold_ratio = liquidation_ratio * liquidation_threshold / 1000;

        let liquidation_tick = TickMath::get_tick_at_ratio(liquidation_threshold_ratio)
            .map(|(tick, _)| tick)
            .unwrap_or(MIN_TICK);

        // Build accounts for liquidate instruction
        let accounts = vaults::accounts::Liquidate {
            signer: user_pubkey,
            signer_token_account: get_associated_token_address(&user_pubkey, &borrow_mint.pubkey()),
            to: to_pubkey,
            to_token_account: get_associated_token_address(&to_pubkey, &supply_mint.pubkey()),
            vault_config: self.get_vault_config(vars.vault_id),
            vault_state: self.get_vault_state(vars.vault_id),
            supply_token: supply_mint.pubkey(),
            borrow_token: borrow_mint.pubkey(),
            oracle: self.get_oracle(vars.vault_id),
            new_branch: self.get_branch(vars.vault_id, vault_state.current_branch + 1),
            supply_token_reserves_liquidity: self.liquidity.get_reserve(supply_mint),
            borrow_token_reserves_liquidity: self.liquidity.get_reserve(borrow_mint),
            vault_supply_position_on_liquidity: self
                .get_vault_supply_position_on_liquidity(vars.vault_id),
            vault_borrow_position_on_liquidity: self
                .get_vault_borrow_position_on_liquidity(vars.vault_id),
            supply_rate_model: self.liquidity.get_rate_model(supply_mint),
            borrow_rate_model: self.liquidity.get_rate_model(borrow_mint),
            supply_token_claim_account: Some(
                self.liquidity
                    .get_claim_account(supply_mint, &self.get_vault_config(vars.vault_id)),
            ),
            liquidity: self.liquidity.get_liquidity(),
            liquidity_program: LIQUIDITY_PROGRAM_ID,
            vault_supply_token_account: self.liquidity.get_vault(supply_mint),
            vault_borrow_token_account: self.liquidity.get_vault(borrow_mint),
            supply_token_program: spl_token::ID,
            borrow_token_program: spl_token::ID,
            system_program: system_program::ID,
            associated_token_program: spl_associated_token_account::ID,
            oracle_program: ORACLE_PROGRAM_ID,
        };

        // Initialize new branch if needed
        let new_branch_id = vault_state.current_branch + 1;
        let new_branch_pda = self.get_branch(vars.vault_id, new_branch_id);
        if !self.account_exists(&new_branch_pda) {
            self.init_branch(vars.vault_id, new_branch_id)?;
        }

        let mut remaining_account_metas = accounts.to_account_metas(None);

        // 1. Oracle source
        let oracle_source = self.get_oracle_source(vars.vault_id);
        remaining_account_metas.push(solana_sdk::instruction::AccountMeta::new_readonly(
            oracle_source,
            false,
        ));

        // 2. Branch accounts - collect all relevant branches
        let mut branch_ids: Vec<u32> = Vec::new();
        let current_branch_id = vault_state.current_branch;

        if current_branch_id > 0 {
            branch_ids.push(current_branch_id);
        }

        let mut connected_id = current_branch_id;
        for _ in 0..5 {
            // Limit iterations
            if let Ok(branch_data) = self.read_branch(vars.vault_id, connected_id) {
                if branch_data.connected_branch_id != connected_id
                    && !branch_ids.contains(&branch_data.connected_branch_id)
                {
                    branch_ids.push(branch_data.connected_branch_id);
                    connected_id = branch_data.connected_branch_id;
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        if !branch_ids.contains(&0) {
            branch_ids.push(0);
        }

        let mut branch_ticks: Vec<i32> = Vec::new();
        for branch_id in &branch_ids {
            if let Ok(branch) = self.read_branch(vars.vault_id, *branch_id) {
                if branch.minima_tick != i32::MIN {
                    branch_ticks.push(branch.minima_tick);
                }
                if branch.connected_minima_tick != i32::MIN {
                    branch_ticks.push(branch.connected_minima_tick);
                }
            }
        }

        for branch_id in &branch_ids {
            let branch_pda = self.get_branch(vars.vault_id, *branch_id);
            if !self.account_exists(&branch_pda) {
                self.init_branch(vars.vault_id, *branch_id)?;
            }
            remaining_account_metas.push(solana_sdk::instruction::AccountMeta::new(
                branch_pda,
                false,
            ));
        }

        // 3. Tick accounts - from topmost to liquidation tick
        const MAX_TICK_ACCOUNTS_PER_LIQUIDATE: usize = 32;
        let mut tick_accounts: Vec<i32> = Vec::new();
        let topmost_tick = vault_state.topmost_tick;

        if topmost_tick != i32::MIN {
            // Add topmost tick
            tick_accounts.push(topmost_tick);

            let _min_tick = liquidation_tick.max(topmost_tick - 100);
            let mut tick = topmost_tick - 1;
            while tick >= liquidation_tick && tick_accounts.len() < MAX_TICK_ACCOUNTS_PER_LIQUIDATE {
                tick_accounts.push(tick);
                tick -= 1;
            }
        }
        eprintln!(
            "topmost {} liquidation {} initial ticks {:?}",
            topmost_tick, liquidation_tick, tick_accounts
        );

        for &tick in &branch_ticks {
            if tick != i32::MIN && !tick_accounts.contains(&tick) {
                tick_accounts.push(tick);
            }
        }

        if tick_accounts.len() < MAX_TICK_ACCOUNTS_PER_LIQUIDATE && topmost_tick != i32::MIN {
            if let Ok(extra_ticks) = self.collect_bitmap_ticks(
                vars.vault_id,
                topmost_tick,
                liquidation_tick,
                MAX_TICK_ACCOUNTS_PER_LIQUIDATE - tick_accounts.len(),
            ) {
                eprintln!("extra ticks for vault {}: {:?}", vars.vault_id, extra_ticks);
                for tick in extra_ticks {
                    if !tick_accounts.contains(&tick) {
                        tick_accounts.push(tick);
                    }
                }
            }
        }

        if liquidation_tick != i32::MIN && !tick_accounts.contains(&liquidation_tick) {
            tick_accounts.push(liquidation_tick);
        }

        for tick in &tick_accounts {
            let tick_pda = self.get_tick(vars.vault_id, *tick);
            if !self.account_exists(&tick_pda) {
                self.init_tick(vars.vault_id, *tick)?;
            }
            remaining_account_metas.push(solana_sdk::instruction::AccountMeta::new(
                tick_pda,
                false,
            ));
        }

        // 4. Tick has debt arrays
        let _get_tick_has_debt_index =
            |tick: i32| -> u8 { ((tick + 16383) / 2048).clamp(0, 15) as u8 };

        // Include all tick_has_debt arrays (0..=15) to cover every possible index
        let mut tick_has_debt_indices: Vec<u8> = Vec::new();
        let mut tick_has_debt_addresses: Vec<Pubkey> = Vec::new();

        for index in (0..=MAX_TICK_HAS_DEBT_ARRAY_SINGLE_TX).rev() {
            let tick_has_debt_pda = self.get_tick_has_debt_array(vars.vault_id, index);
            if !self.account_exists(&tick_has_debt_pda) {
                self.init_tick_has_debt_array(vars.vault_id, index)?;
            }
            remaining_account_metas.push(solana_sdk::instruction::AccountMeta::new(
                tick_has_debt_pda,
                false,
            ));
            tick_has_debt_indices.push(index);
            tick_has_debt_addresses.push(tick_has_debt_pda);
        }

        // remaining_accounts_indices: [sources, branches, ticks, tick_has_debt]
        let remaining_accounts_indices: Vec<u8> = vec![
            1, // 1 oracle source
            branch_ids.len() as u8,
            tick_accounts.len() as u8,
            tick_has_debt_indices.len() as u8,
        ];

        let ix = Instruction {
            program_id: VAULTS_PROGRAM_ID,
            accounts: remaining_account_metas.clone(),
            data: vaults::instruction::Liquidate {
                debt_amt: vars.debt_amount,
                col_per_unit_debt: vars.col_per_unit_debt,
                absorb: vars.absorb,
                transfer_type: Some(TransferType::DIRECT),
                remaining_accounts_indices,
            }
            .data(),
        };

        let branch_addresses: Vec<Pubkey> = branch_ids
            .iter()
            .map(|id| self.get_branch(vars.vault_id, *id))
            .collect();
        
        let tick_addresses: Vec<Pubkey> = tick_accounts
            .iter()
            .map(|tick| self.get_tick(vars.vault_id, *tick))
            .collect();

        if !branch_addresses.is_empty() {
            self.add_addresses_to_lookup_table(vars.vault_id, branch_addresses)?;
        }
        if !tick_addresses.is_empty() {
            self.add_addresses_to_lookup_table(vars.vault_id, tick_addresses)?;
        }
        if !tick_has_debt_addresses.is_empty() {
            self.add_addresses_to_lookup_table(vars.vault_id, tick_has_debt_addresses)?;
        }

        // Use V0 transaction with lookup table for complex liquidations
        let lookup_table = self.get_lookup_table_account(vars.vault_id)?;
        
        let user_keypair = SolKeypair::try_from(&vars.user.to_bytes()[..]).unwrap();
        let metadata = self.liquidity.vm.execute_v0(
            vec![ix],
            vec![lookup_table],
            &user_keypair,
        )?;

        // The liquidate function returns (u128, u128) for (actual_col_amt, actual_debt_amt)
        let (col_amt, debt_amt) = self.parse_liquidate_return(&metadata.logs)?;

        Ok((col_amt, debt_amt))
    }

    /// Parse the liquidate return values from transaction logs
    fn parse_liquidate_return(&self, logs: &[String]) -> VmResult<(u128, u128)> {
        // LogLiquidate discriminator: sha256("event:LogLiquidate")[0..8] = 0x9a80ca9341e9c349
        const LOG_LIQUIDATE_DISCRIMINATOR: [u8; 8] = [0x9a, 0x80, 0xca, 0x93, 0x41, 0xe9, 0xc3, 0x49];

        for log in logs {
            if log.contains("Program data:") {
                // Decode base64 event data
                if let Some(data_str) = log.strip_prefix("Program data: ") {
                    if let Ok(decoded) = BASE64_STANDARD.decode(data_str.trim()) {
                        // LogLiquidate event: discriminator (8 bytes) + signer (32) + col_amount (8) + debt_amount (8) + to (32) = 88 bytes
                        if decoded.len() >= 88 && decoded[0..8] == LOG_LIQUIDATE_DISCRIMINATOR {
                            let col_amount = u64::from_le_bytes(
                                decoded[40..48]
                                    .try_into()
                                    .map_err(|_| VmError::Custom("Parse error".to_string()))?,
                            ) as u128;
                            let debt_amount = u64::from_le_bytes(
                                decoded[48..56]
                                    .try_into()
                                    .map_err(|_| VmError::Custom("Parse error".to_string()))?,
                            ) as u128;
                            return Ok((col_amount, debt_amount));
                        }
                    }
                }
            }
        }

        Ok((0, 0))
    }

    /// Calculate debt from collateral at a given tick using exact fixed-point math
    pub fn calculate_debt_from_collateral(&self, tick: i32, col_raw: u128) -> VmResult<u128> {
        let ratio_at_tick = TickMath::get_ratio_at_tick(tick)
            .map_err(|e| VmError::Custom(format!("Failed to get ratio at tick: {:?}", e)))?;

        // adjustedRatio = ratioAtTick * TICK_SPACING / 10000
        let adjusted_ratio = ratio_at_tick * TickMath::TICK_SPACING / 10000;

        // marginAdjustedDebt = adjustedRatio * colRaw / ZERO_TICK_SCALED_RATIO
        let margin_adjusted_debt = adjusted_ratio * col_raw / TickMath::ZERO_TICK_SCALED_RATIO;

        // netDebtRaw = (marginAdjustedDebt - 1) * 1_000_000_000 / 1_000_000_001
        if margin_adjusted_debt <= 1 {
            return Ok(0);
        }

        let net_debt_raw = (margin_adjusted_debt - 1) * 1_000_000_000 / 1_000_000_001;
        Ok(net_debt_raw)
    }

    /// Create positions in every tick array range to fill up the vault
    /// This is used to ensure tick arrays are initialized for testing operations
    /// that cross multiple tick ranges.
    pub fn create_position_in_every_tick_array_range(
        &mut self,
        vault_id: u16,
        oracle_price: u128,
    ) -> VmResult<u128> {
        let vault_config = self.read_vault_config(vault_id)?;
        let collateral_factor = vault_config.collateral_factor as u128;

        // Calculate max raw collateral factor adjusted by oracle price
        // Formula: maxRawCollateralFactor = collateralFactor * 1e8 / oraclePrice
        let max_raw_collateral_factor = collateral_factor * 100_000_000 / oracle_price;

        // Calculate max possible tick
        // tick = log(ratio) / log(1.0015)
        // where ratio = maxRawCollateralFactor / 1000
        let max_possible_tick =
            (((max_raw_collateral_factor as f64) / 1000.0).ln() / 1.0015_f64.ln()) as i32;

        let mut total_collateral_amount: u128 = 0;

        let bob = Keypair::try_from(self.liquidity.bob.to_bytes().as_slice()).unwrap();

        // Hop 2048 ticks, and create a position in every tick array range minimum tick
        let mut tick = MIN_TICK + 2048;
        while tick < max_possible_tick {
            let collateral: u128 = 1_000_000_000_000; // 1e12

            let debt = self.calculate_debt_from_collateral(tick, collateral)?;

            if debt <= 10_000 {
                tick += 2048;
                continue;
            }

            total_collateral_amount += collateral;

            let position_id = self.get_next_position_id(vault_id)?;
            let bob_clone = Keypair::try_from(bob.to_bytes().as_slice()).unwrap();
            self.init_position(vault_id, &bob_clone)?;

            let unscaled_collateral = (collateral / 1000) as i128;
            let unscaled_debt = (debt / 1000) as i128;

            let bob_clone = Keypair::try_from(bob.to_bytes().as_slice()).unwrap();
            let result = self.operate_vault(&OperateVars {
                vault_id,
                position_id,
                user: &bob_clone,
                position_owner: &bob_clone,
                collateral_amount: unscaled_collateral,
                debt_amount: unscaled_debt,
                recipient: &bob_clone,
            });

            if let Err(e) = result {
                eprintln!(
                    "Warning: Failed to create position at tick {}: {:?}",
                    tick, e
                );
            }

            tick += 2048;
        }

        Ok(total_collateral_amount)
    }
}
