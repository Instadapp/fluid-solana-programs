use crate::errors::{Result, VmError};
use dashmap::DashMap;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_config::RpcProgramAccountsConfig;
use solana_sdk::{
    account::Account,
    bpf_loader_upgradeable::{self, UpgradeableLoaderState},
    clock::Clock,
    pubkey::Pubkey,
    sysvar,
};

/// Program data from chain
pub struct ProgramData {
    pub program_id: Pubkey,
    pub bytecode: Vec<u8>,
    pub is_upgradeable: bool,
    pub authority: Option<Pubkey>,
}

/// Clone state from RPC endpoints
pub struct ForkProvider {
    client: RpcClient,
    cache: DashMap<Pubkey, Account>,
}

impl ForkProvider {
    pub fn new(rpc_url: &str) -> Self {
        Self {
            client: RpcClient::new(rpc_url.to_string()),
            cache: DashMap::new(),
        }
    }

    /// Clone account from RPC
    pub async fn clone_account(&self, pubkey: &Pubkey) -> Result<Account> {
        // Check cache first
        if let Some(cached) = self.cache.get(pubkey) {
            return Ok(cached.clone());
        }

        let account = self.client.get_account(pubkey).await?;
        self.cache.insert(*pubkey, account.clone());
        Ok(account)
    }

    /// Clone multiple accounts in batch
    pub async fn clone_accounts(&self, pubkeys: &[Pubkey]) -> Result<Vec<(Pubkey, Account)>> {
        let accounts = self.client.get_multiple_accounts(pubkeys).await?;

        let result: Vec<(Pubkey, Account)> = pubkeys
            .iter()
            .zip(accounts.into_iter())
            .filter_map(|(pk, acc)| {
                acc.map(|a| {
                    self.cache.insert(*pk, a.clone());
                    (*pk, a)
                })
            })
            .collect();

        Ok(result)
    }

    /// Clone a program including its data account
    pub async fn clone_program(&self, program_id: &Pubkey) -> Result<ProgramData> {
        let account = self.clone_account(program_id).await?;

        if account.owner == bpf_loader_upgradeable::id() {
            let state: UpgradeableLoaderState = bincode::deserialize(&account.data)?;

            if let UpgradeableLoaderState::Program {
                programdata_address,
            } = state
            {
                let data_account = self.clone_account(&programdata_address).await?;

                // Extract bytecode (skip metadata header - 45 bytes)
                const METADATA_SIZE: usize = 45;
                if data_account.data.len() <= METADATA_SIZE {
                    return Err(VmError::ForkError("Invalid program data size".to_string()));
                }

                let bytecode = data_account.data[METADATA_SIZE..].to_vec();

                // Extract authority from program data header
                let authority = if data_account.data.len() >= 45 {
                    let data_state: UpgradeableLoaderState =
                        bincode::deserialize(&data_account.data)?;
                    if let UpgradeableLoaderState::ProgramData {
                        upgrade_authority_address,
                        ..
                    } = data_state
                    {
                        upgrade_authority_address
                    } else {
                        None
                    }
                } else {
                    None
                };

                return Ok(ProgramData {
                    program_id: *program_id,
                    bytecode,
                    is_upgradeable: true,
                    authority,
                });
            }
        }

        // Non-upgradeable program
        Ok(ProgramData {
            program_id: *program_id,
            bytecode: account.data,
            is_upgradeable: false,
            authority: None,
        })
    }

    /// Clone all accounts owned by a program
    pub async fn clone_program_accounts(
        &self,
        program_id: &Pubkey,
    ) -> Result<Vec<(Pubkey, Account)>> {
        let accounts = self
            .client
            .get_program_accounts(program_id)
            .await
            .map_err(|e| VmError::ForkError(e.to_string()))?;

        for (pubkey, account) in &accounts {
            self.cache.insert(*pubkey, account.clone());
        }

        Ok(accounts)
    }

    /// Clone accounts for a program using an RPC filter
    pub async fn clone_program_accounts_with_config(
        &self,
        program_id: &Pubkey,
        config: RpcProgramAccountsConfig,
    ) -> Result<Vec<(Pubkey, Account)>> {
        let accounts = self
            .client
            .get_program_accounts_with_config(program_id, config)
            .await
            .map_err(|e| VmError::ForkError(e.to_string()))?;

        for (pubkey, account) in &accounts {
            self.cache.insert(*pubkey, account.clone());
        }

        Ok(accounts)
    }

    /// Sync clock sysvar from chain
    pub async fn sync_clock(&self) -> Result<Clock> {
        let clock_account = self.client.get_account(&sysvar::clock::id()).await?;
        let clock: Clock = bincode::deserialize(&clock_account.data)?;
        Ok(clock)
    }

    /// Get current block height
    pub async fn get_block_height(&self) -> Result<u64> {
        let height = self
            .client
            .get_block_height()
            .await
            .map_err(|e| VmError::RpcError(e.to_string()))?;
        Ok(height)
    }

    /// Get slot
    pub async fn get_slot(&self) -> Result<u64> {
        let slot = self
            .client
            .get_slot()
            .await
            .map_err(|e| VmError::RpcError(e.to_string()))?;
        Ok(slot)
    }

    /// Clear the account cache
    pub fn clear_cache(&self) {
        self.cache.clear();
    }

    /// Get RPC client reference
    pub fn client(&self) -> &RpcClient {
        &self.client
    }
}

// /// Builder for setting up fork tests
// pub struct ForkBuilder {
//     accounts: Vec<Pubkey>,
//     programs: Vec<Pubkey>,
//     sync_clock: bool,
// }

// impl ForkBuilder {
//     pub fn new() -> Self {
//         Self {
//             accounts: vec![],
//             programs: vec![],
//             sync_clock: true,
//         }
//     }

//     /// Add accounts to clone
//     pub fn with_accounts(mut self, accounts: Vec<Pubkey>) -> Self {
//         self.accounts.extend(accounts);
//         self
//     }

//     /// Add programs to clone
//     pub fn with_programs(mut self, programs: Vec<Pubkey>) -> Self {
//         self.programs.extend(programs);
//         self
//     }

//     /// Whether to sync clock from chain
//     pub fn sync_clock(mut self, sync: bool) -> Self {
//         self.sync_clock = sync;
//         self
//     }
// }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::anchor_mainnet_rpc_url;

    #[tokio::test]
    async fn test_clone_account() {
        let fork = ForkProvider::new(&anchor_mainnet_rpc_url().unwrap());
        let system_program = solana_sdk::system_program::id();

        let account = fork.clone_account(&system_program).await.unwrap();
        assert!(account.executable);
    }

    #[tokio::test]
    // #[ignore]
    async fn test_sync_clock() {
        let fork = ForkProvider::new(&anchor_mainnet_rpc_url().unwrap());
        let clock = fork.sync_clock().await.unwrap();

        assert!(clock.slot > 0);
        assert!(clock.unix_timestamp > 0);
    }
}
