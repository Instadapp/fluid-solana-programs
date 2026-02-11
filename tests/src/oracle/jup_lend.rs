#[cfg(test)]
mod tests {
    use crate::lending::fixture::LendingFixture;
    use anchor_lang::prelude::*;
    use anchor_lang::{InstructionData, ToAccountMetas};
    use fluid_test_framework::helpers::MintKey;
    use fluid_test_framework::prelude::*;
    use fluid_test_framework::Result as VmResult;
    use oracle::state::{SourceType, Sources, ORACLE_ADMIN_SEED, ORACLE_SEED};
    use solana_client::rpc_client::RpcClient;
    use solana_sdk::{instruction::Instruction, pubkey::Pubkey, signer::Signer};

    const LRRM_PROGRAM_ID: &str = "jup7TthsMgcR9Y3L277b8Eo9uboVSmu1utkuXHNUKar";

    fn get_oracle_pda(program_id: &Pubkey, nonce: u16) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[ORACLE_SEED, nonce.to_le_bytes().as_slice()], program_id)
    }

    fn get_oracle_admin_pda(program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[ORACLE_ADMIN_SEED], program_id)
    }

    fn init_lending_rewards_admin(
        vm: &mut Vm,
        payer: &Pubkey,
        lrrm_program_id: &Pubkey,
    ) -> VmResult<Pubkey> {
        let (lending_rewards_admin_pda, _) =
            Pubkey::find_program_address(&[b"lending_rewards_admin"], lrrm_program_id);
        let accounts = lending_reward_rate_model::accounts::InitLendingRewardsAdmin {
            signer: *payer,
            lending_rewards_admin: lending_rewards_admin_pda,
            system_program: solana_sdk::system_program::id(),
        };
        let ix = Instruction {
            program_id: *lrrm_program_id,
            accounts: accounts.to_account_metas(None),
            data: lending_reward_rate_model::instruction::InitLendingRewardsAdmin {
                authority: *payer,
                lending_program: crate::lending::fixture::LENDING_PROGRAM_ID,
            }
            .data(),
        };
        vm.prank(*payer);
        vm.execute_as_prank(ix)?;
        Ok(lending_rewards_admin_pda)
    }

    fn init_lending_rewards_rate_model(
        vm: &mut Vm,
        payer: &Pubkey,
        lrrm_program_id: &Pubkey,
        lending_rewards_admin: &Pubkey,
        mint: Pubkey,
    ) -> VmResult<Pubkey> {
        let (lending_reward_rate_model_pda, _) = Pubkey::find_program_address(
            &[b"lending_rewards_rate_model", mint.as_ref()],
            lrrm_program_id,
        );
        let accounts = lending_reward_rate_model::accounts::InitLendingRewardsRateModel {
            authority: *payer,
            lending_rewards_admin: *lending_rewards_admin,
            mint,
            lending_rewards_rate_model: lending_reward_rate_model_pda,
            system_program: solana_sdk::system_program::id(),
        };
        let ix = Instruction {
            program_id: *lrrm_program_id,
            accounts: accounts.to_account_metas(None),
            data: lending_reward_rate_model::instruction::InitLendingRewardsRateModel {}.data(),
        };
        vm.prank(*payer);
        vm.execute_as_prank(ix)?;
        Ok(lending_reward_rate_model_pda)
    }

    fn load_lrrm_program(vm: &mut Vm) -> VmResult<Pubkey> {
        let lrrm_program_id = Pubkey::from_str_const(LRRM_PROGRAM_ID);
        let lrrm_program_path = fluid_test_framework::helpers::BaseFixture::find_program_path(
            "lending_reward_rate_model.so",
        )
        .ok_or(fluid_test_framework::errors::VmError::ProgramNotFound(
            "lending_reward_rate_model.so".to_string(),
        ))?;
        vm.add_program_from_file(&lrrm_program_id, &lrrm_program_path)?;
        Ok(lrrm_program_id)
    }

    fn load_oracle_program(vm: &mut Vm) -> VmResult<Pubkey> {
        let oracle_program_id = oracle::ID;
        let program_path =
            fluid_test_framework::helpers::BaseFixture::find_program_path("oracle.so").ok_or(
                fluid_test_framework::errors::VmError::ProgramNotFound("oracle.so".to_string()),
            )?;
        vm.add_program_from_file(&oracle_program_id, &program_path)?;
        Ok(oracle_program_id)
    }

    #[test]
    fn test_juplend_oracle_with_mock_accounts() -> VmResult<()> {
        let underlying_mint_key = MintKey::USDC;
        let underlying_mint = underlying_mint_key.pubkey();

        let mut lending_fixture = LendingFixture::new()?;

        lending_fixture
            .liquidity
            .setup_spl_token_mints(&[underlying_mint_key])?;

        let lrrm_program_id = load_lrrm_program(lending_fixture.vm())?;
        let oracle_program_id = load_oracle_program(lending_fixture.vm())?;

        let payer = lending_fixture.admin.pubkey();

        lending_fixture.liquidity.init_liquidity()?;
        lending_fixture
            .liquidity
            .init_token_reserve(&[underlying_mint_key])?;

        let lending_rewards_admin =
            init_lending_rewards_admin(lending_fixture.vm(), &payer, &lrrm_program_id)?;
        let lending_reward_rate_model_pda = init_lending_rewards_rate_model(
            lending_fixture.vm(),
            &payer,
            &lrrm_program_id,
            &lending_rewards_admin,
            underlying_mint,
        )?;

        lending_fixture.init_lending_admin()?;
        lending_fixture.init_lending(underlying_mint_key, "JUPUSD".to_string())?;
        lending_fixture
            .set_rewards_rate_model(underlying_mint_key, lending_reward_rate_model_pda)?;

        let lending_pda = lending_fixture.get_lending(underlying_mint_key);
        let f_token_mint = lending_fixture.get_f_token_mint(underlying_mint_key);
        let token_reserve_pda = lending_fixture.liquidity.get_reserve(underlying_mint_key);

        let (oracle_admin_pda, _admin_bump) = get_oracle_admin_pda(&oracle_program_id);
        let init_admin_accounts = oracle::accounts::InitAdmin {
            signer: payer,
            oracle_admin: oracle_admin_pda,
            system_program: solana_sdk::system_program::id(),
        };
        let init_admin_ix = Instruction {
            program_id: oracle_program_id,
            accounts: init_admin_accounts.to_account_metas(None),
            data: oracle::instruction::InitAdmin { authority: payer }.data(),
        };
        lending_fixture.vm().prank(payer);
        lending_fixture.vm().execute_as_prank(init_admin_ix)?;

        let oracle_nonce: u16 = 100;
        let (oracle_pda, _bump) = get_oracle_pda(&oracle_program_id, oracle_nonce);

        let sources = vec![
            Sources {
                source: lending_pda,
                source_type: SourceType::JupLend,
                invert: false,
                multiplier: 1,
                divisor: 1,
            },
            Sources {
                source: token_reserve_pda,
                source_type: SourceType::JupLend,
                invert: false,
                multiplier: 1,
                divisor: 1,
            },
            Sources {
                source: lending_reward_rate_model_pda,
                source_type: SourceType::JupLend,
                invert: false,
                multiplier: 1,
                divisor: 1,
            },
            Sources {
                source: f_token_mint,
                source_type: SourceType::JupLend,
                invert: false,
                multiplier: 1,
                divisor: 1,
            },
        ];

        let init_accounts = oracle::accounts::InitOracleConfig {
            signer: payer,
            oracle_admin: oracle_admin_pda,
            oracle: oracle_pda,
            system_program: solana_sdk::system_program::id(),
        };

        let init_ix = Instruction {
            program_id: oracle_program_id,
            accounts: init_accounts.to_account_metas(None),
            data: oracle::instruction::InitOracleConfig {
                nonce: oracle_nonce,
                sources: sources.clone(),
            }
            .data(),
        };

        lending_fixture.vm().prank(payer);
        lending_fixture.vm().execute_as_prank(init_ix)?;

        let get_rate_accounts = oracle::accounts::GetExchangeRate { oracle: oracle_pda };
        let mut account_metas = get_rate_accounts.to_account_metas(None);
        for source in &sources {
            account_metas.push(AccountMeta {
                pubkey: source.source,
                is_signer: false,
                is_writable: false,
            });
        }

        let get_rate_ix = Instruction {
            program_id: oracle_program_id,
            accounts: account_metas,
            data: oracle::instruction::GetExchangeRateOperate {
                _nonce: oracle_nonce,
            }
            .data(),
        };

        lending_fixture.vm().prank(payer);
        let result = lending_fixture.vm().execute_as_prank(get_rate_ix)?;

        let return_data = result.return_data;
        let oracle_price = u128::from_le_bytes(return_data.data[0..16].try_into().unwrap());

        assert!(
            oracle_price >= 1_000_000_000_000_000,
            "Oracle price should be >= 1.0"
        );

        println!("Fresh Oracle created for JupLend!");
        println!("Exchange Price:- {}", oracle_price);

        Ok(())
    }

    fn fetch_account_from_mainnet(vm: &mut Vm, pubkey: &Pubkey) -> VmResult<()> {
        use fluid_test_framework::errors::VmError;

        if vm.get_account(pubkey).is_some() {
            return Ok(());
        }

        let rpc_url = dotenv::var("ANCHOR_PROVIDER_MAINNET_URL")
            .unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".to_string());
        let client = RpcClient::new(rpc_url);

        let account = client
            .get_account(pubkey)
            .map_err(|e| VmError::RpcError(format!("Failed to fetch account {}: {}", pubkey, e)))?;

        vm.set_account(pubkey, account)?;

        Ok(())
    }

    #[test]
    fn test_juplend_oracle_from_mainnet() -> VmResult<()> {
        const USDC_LENDING: &str = "2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ";
        const USDC_F_TOKEN_MINT: &str = "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D";
        const USDC_TOKEN_RESERVE: &str = "94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu";
        const USDC_RATE_MODEL: &str = "5xSPBiD3TibamAnwHDhZABdB4z4F9dcj5PnbteroBTTd";

        let usdc_lending = Pubkey::from_str_const(USDC_LENDING);
        let usdc_f_token_mint = Pubkey::from_str_const(USDC_F_TOKEN_MINT);
        let usdc_token_reserve = Pubkey::from_str_const(USDC_TOKEN_RESERVE);
        let usdc_rate_model = Pubkey::from_str_const(USDC_RATE_MODEL);

        let mut lending_fixture = LendingFixture::new()?;
        let oracle_program_id = load_oracle_program(lending_fixture.vm())?;

        fetch_account_from_mainnet(lending_fixture.vm(), &usdc_lending)?;
        fetch_account_from_mainnet(lending_fixture.vm(), &usdc_f_token_mint)?;
        fetch_account_from_mainnet(lending_fixture.vm(), &usdc_token_reserve)?;
        fetch_account_from_mainnet(lending_fixture.vm(), &usdc_rate_model)?;

        let payer = lending_fixture.admin.pubkey();

        let (oracle_admin_pda, _admin_bump) = get_oracle_admin_pda(&oracle_program_id);
        let init_admin_accounts = oracle::accounts::InitAdmin {
            signer: payer,
            oracle_admin: oracle_admin_pda,
            system_program: solana_sdk::system_program::id(),
        };
        let init_admin_ix = Instruction {
            program_id: oracle_program_id,
            accounts: init_admin_accounts.to_account_metas(None),
            data: oracle::instruction::InitAdmin { authority: payer }.data(),
        };
        lending_fixture.vm().prank(payer);
        lending_fixture.vm().execute_as_prank(init_admin_ix)?;

        let oracle_nonce: u16 = 100;
        let (oracle_pda, _bump) = get_oracle_pda(&oracle_program_id, oracle_nonce);

        let sources = vec![
            Sources {
                source: usdc_lending,
                source_type: SourceType::JupLend,
                invert: false,
                multiplier: 1,
                divisor: 1,
            },
            Sources {
                source: usdc_token_reserve,
                source_type: SourceType::JupLend,
                invert: false,
                multiplier: 1,
                divisor: 1,
            },
            Sources {
                source: usdc_rate_model,
                source_type: SourceType::JupLend,
                invert: false,
                multiplier: 1,
                divisor: 1,
            },
            Sources {
                source: usdc_f_token_mint,
                source_type: SourceType::JupLend,
                invert: false,
                multiplier: 1,
                divisor: 1,
            },
        ];

        let init_accounts = oracle::accounts::InitOracleConfig {
            signer: payer,
            oracle_admin: oracle_admin_pda,
            oracle: oracle_pda,
            system_program: solana_sdk::system_program::id(),
        };

        let init_ix = Instruction {
            program_id: oracle_program_id,
            accounts: init_accounts.to_account_metas(None),
            data: oracle::instruction::InitOracleConfig {
                nonce: oracle_nonce,
                sources: sources.clone(),
            }
            .data(),
        };

        lending_fixture.vm().prank(payer);
        lending_fixture.vm().execute_as_prank(init_ix)?;
        println!("Initialized oracle with USDC JupLend sources");

        let get_rate_accounts = oracle::accounts::GetExchangeRate { oracle: oracle_pda };
        let mut account_metas = get_rate_accounts.to_account_metas(None);
        for source in &sources {
            account_metas.push(AccountMeta {
                pubkey: source.source,
                is_signer: false,
                is_writable: false,
            });
        }

        let get_rate_ix = Instruction {
            program_id: oracle_program_id,
            accounts: account_metas,
            data: oracle::instruction::GetExchangeRateOperate {
                _nonce: oracle_nonce,
            }
            .data(),
        };

        lending_fixture.vm().prank(payer);
        let result = lending_fixture.vm().execute_as_prank(get_rate_ix)?;

        let return_data = result.return_data;
        let oracle_price = u128::from_le_bytes(return_data.data[0..16].try_into().unwrap());

        println!("\n=== Custom Oracle PDA with onchain USDC Lending Exchange Price ===");
        println!("Oracle Address: {}", oracle_pda);
        println!("USDC Lending: {}", USDC_LENDING);
        println!("USDC F Token Mint: {}", USDC_F_TOKEN_MINT);
        println!("USDC Token Reserve: {}", USDC_TOKEN_RESERVE);
        println!("USDC Rate Model: {}", USDC_RATE_MODEL);
        println!("Price (raw): {}", oracle_price);
        println!("Price (with 15 decimals): {}", oracle_price as f64 / 1e15);

        assert!(oracle_price > 0, "Oracle price should be greater than 0");
        Ok(())
    }
}
