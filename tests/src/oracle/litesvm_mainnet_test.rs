#[cfg(test)]
mod tests {
    use crate::utils;
    use anchor_lang::prelude::*;
    use anchor_lang::{InstructionData, ToAccountMetas};
    use litesvm::LiteSVM;
    use oracle::state::{Oracle, ORACLE_SEED};
    use serde::Deserialize;
    use solana_client::rpc_client::RpcClient;
    use solana_sdk::{instruction::Instruction, pubkey::Pubkey};
    use std::str::FromStr;

    const ORACLE_DEPLOYMENT_PATH: &str = "deployment/mainnet/oracle.json";

    #[derive(Debug, Deserialize)]
    struct OracleDeployment {
        program: String,
        oracles: Vec<OracleInfo>,
    }

    #[derive(Debug, Deserialize, Clone)]
    struct OracleInfo {
        #[serde(rename = "infoName")]
        info_name: String,
        #[serde(rename = "adress")]
        address: String,
        nonce: u16,
    }

    fn load_oracle_deployment() -> utils::Result<OracleDeployment> {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
        let json_path = std::path::Path::new(&manifest_dir)
            .parent()
            .unwrap()
            .join(ORACLE_DEPLOYMENT_PATH);

        let file = std::fs::File::open(&json_path).map_err(|e| {
            utils::LiteSvmError(format!("Failed to open oracle deployment file: {}", e))
        })?;

        let deployment: OracleDeployment = serde_json::from_reader(file).map_err(|e| {
            utils::LiteSvmError(format!("Failed to parse oracle deployment JSON: {}", e))
        })?;

        Ok(deployment)
    }

    fn get_oracle_pda(program_id: &Pubkey, nonce: u16) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[ORACLE_SEED, nonce.to_le_bytes().as_slice()], program_id)
    }

    fn sync_clock_from_mainnet(svm: &mut LiteSVM, client: &RpcClient) -> utils::Result<()> {
        match client.get_latest_blockhash_with_commitment(
            solana_sdk::commitment_config::CommitmentConfig::confirmed(),
        ) {
            Ok((_, slot)) => {
                let clock_account = client.get_account(&solana_sdk::sysvar::clock::id());
                if let Ok(clock_acc) = clock_account {
                    let clock_data =
                        bincode::deserialize::<solana_sdk::clock::Clock>(&clock_acc.data);
                    if let Ok(clock) = clock_data {
                        utils::set_block_timestamp(svm, clock.unix_timestamp);
                        println!(
                            "✓ Synced clock: timestamp={}, slot={}",
                            clock.unix_timestamp, slot
                        );
                        return Ok(());
                    }
                }
            }
            Err(e) => {
                return Err(utils::LiteSvmError(format!("Could not sync clock: {}", e)));
            }
        }
        Err(utils::LiteSvmError("Failed to sync clock".to_string()))
    }

    async fn fetch_oracle_with_sources(
        client: &RpcClient,
        oracle_address: &str,
    ) -> utils::Result<(Pubkey, Oracle, Vec<Pubkey>)> {
        let oracle_pubkey = Pubkey::from_str(oracle_address)
            .map_err(|e| utils::LiteSvmError(format!("Invalid oracle pubkey: {}", e)))?;

        let account_data = client
            .get_account(&oracle_pubkey)
            .map_err(|e| utils::LiteSvmError(format!("Failed to fetch oracle account: {}", e)))?;

        let oracle: Oracle = Oracle::try_deserialize(&mut &account_data.data[..])
            .map_err(|e| utils::LiteSvmError(format!("Failed to deserialize oracle: {}", e)))?;

        let source_pubkeys: Vec<Pubkey> = oracle.sources.iter().map(|s| s.source).collect();

        Ok((oracle_pubkey, oracle, source_pubkeys))
    }

    // #[tokio::test(flavor = "multi_thread")]
    async fn test_all_mainnet_oracles_with_local_binary() -> utils::Result<()> {
        let deployment = load_oracle_deployment()?;
        let program_id = Pubkey::from_str(&deployment.program)
            .map_err(|e| utils::LiteSvmError(format!("Invalid program ID: {}", e)))?;

        let rpc_url = dotenv::var("ANCHOR_PROVIDER_MAINNET_URL")
            .unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".to_string());
        let client = RpcClient::new(rpc_url.clone());

        let mut failed = 0;

        for oracle_info in deployment.oracles.iter() {
            println!(
                "Testing: {} (nonce: {})",
                oracle_info.info_name, oracle_info.nonce
            );

            // Verify PDA derivation
            let (expected_pda, _bump) = get_oracle_pda(&program_id, oracle_info.nonce);
            let actual_pda = Pubkey::from_str(&oracle_info.address)
                .map_err(|e| utils::LiteSvmError(format!("Invalid oracle address: {}", e)))?;

            if expected_pda != actual_pda {
                println!(
                    "  ✗ PDA mismatch! Expected: {}, Got: {}",
                    expected_pda, actual_pda
                );
                failed += 1;
                continue;
            }

            let (oracle_pubkey, _, source_pubkeys) =
                match fetch_oracle_with_sources(&client, &oracle_info.address).await {
                    Ok(data) => data,
                    Err(e) => {
                        println!("  ✗ Failed to fetch oracle: {}", e);
                        failed += 1;
                        continue;
                    }
                };

            let mut accounts_to_clone = vec![oracle_pubkey];
            accounts_to_clone.extend(source_pubkeys.clone());

            let mut svm =
                match utils::setup_with_mainnet_accounts(&rpc_url, accounts_to_clone).await {
                    Ok(svm) => svm,
                    Err(e) => {
                        println!("  ✗ Failed to setup LiteSVM: {}", e);
                        failed += 1;
                        continue;
                    }
                };

            if let Err(e) = utils::load_oracle_program(&mut svm, &program_id) {
                println!("  ✗ Failed to load oracle program: {}", e);
                failed += 1;
                continue;
            }

            if let Err(e) = sync_clock_from_mainnet(&mut svm, &client) {
                println!("  ⚠ Warning: {}", e);
            }

            let payer = match utils::create_funded_keypair(&mut svm, 10_000_000_000) {
                Ok(kp) => kp,
                Err(e) => {
                    println!("  ✗ Failed to create payer: {}", e);
                    failed += 1;
                    continue;
                }
            };

            let accounts = oracle::accounts::GetExchangeRate {
                oracle: oracle_pubkey,
            };

            let mut account_metas = accounts.to_account_metas(None);
            for source_pubkey in source_pubkeys.iter() {
                account_metas.push(AccountMeta {
                    pubkey: *source_pubkey,
                    is_signer: false,
                    is_writable: false,
                });
            }

            let instruction = Instruction {
                program_id,
                accounts: account_metas,
                data: oracle::instruction::GetBothExchangeRate {
                    _nonce: oracle_info.nonce,
                }
                .data(),
            };

            let result = utils::send_transaction(&mut svm, instruction, &payer, &[&payer])?;
            print_return_data(&result);

            println!();
        }

        if failed > 0 {
            return Err(utils::LiteSvmError(format!(
                "{} oracle(s) failed compatibility test",
                failed
            )));
        }

        Ok(())
    }

    // #[tokio::test(flavor = "multi_thread")]
    async fn test_single_oracle_detailed() -> utils::Result<()> {
        let deployment = load_oracle_deployment()?;
        let program_id = Pubkey::from_str(&deployment.program)
            .map_err(|e| utils::LiteSvmError(format!("Invalid program ID: {}", e)))?;

        let rpc_url = dotenv::var("ANCHOR_PROVIDER_MAINNET_URL")
            .unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".to_string());
        println!("RPC URL: {}", rpc_url);
        let client = RpcClient::new(rpc_url.clone());

        let oracle_info = &deployment.oracles[deployment.oracles.len() - 1];

        let (oracle_pubkey, _, source_pubkeys) =
            fetch_oracle_with_sources(&client, &oracle_info.address).await?;

        let mut accounts_to_clone = vec![oracle_pubkey];
        accounts_to_clone.extend(source_pubkeys.clone());

        let mut svm = utils::setup_with_mainnet_accounts(&rpc_url, accounts_to_clone).await?;
        utils::load_oracle_program(&mut svm, &program_id)?;
        sync_clock_from_mainnet(&mut svm, &client)?;

        let payer = utils::create_funded_keypair(&mut svm, 10_000_000_000)?;
        let accounts = oracle::accounts::GetExchangeRate {
            oracle: oracle_pubkey,
        };

        let mut account_metas = accounts.to_account_metas(None);
        for source_pubkey in source_pubkeys.iter() {
            account_metas.push(AccountMeta {
                pubkey: *source_pubkey,
                is_signer: false,
                is_writable: false,
            });
        }

        let instruction = Instruction {
            program_id,
            accounts: account_metas,
            data: oracle::instruction::GetBothExchangeRate {
                _nonce: oracle_info.nonce,
            }
            .data(),
        };

        let result = utils::send_transaction(&mut svm, instruction, &payer, &[&payer])?;
        print_return_data(&result);
        println!("\n✓ Transaction successful!");

        Ok(())
    }

    #[test]
    #[ignore]
    fn test_oracle_pda_derivation() {
        let deployment = load_oracle_deployment().expect("Failed to load oracle deployment");
        let program_id = Pubkey::from_str(&deployment.program).expect("Invalid program ID");

        for oracle_info in deployment.oracles.iter() {
            let (expected_pda, _) = get_oracle_pda(&program_id, oracle_info.nonce);
            let actual_pda = Pubkey::from_str(&oracle_info.address).unwrap();

            assert!(
                expected_pda == actual_pda,
                "PDA mismatch for oracle: {} (nonce: {})",
                oracle_info.info_name,
                oracle_info.nonce
            );
        }
    }

    fn print_return_data(return_data: &litesvm::types::TransactionMetadata) {
        let return_data = return_data.return_data.clone();

        let liquidate_rate = u128::from_le_bytes(return_data.data[0..16].try_into().unwrap());
        let operate_rate = u128::from_le_bytes(return_data.data[16..32].try_into().unwrap());

        println!("\n=== Oracle Exchange Rates ===");
        println!("Liquidate Rate: {}", liquidate_rate as f64 / 1e15);
        println!("Operate Rate:   {}", operate_rate as f64 / 1e15);
    }
}
