//! Core VM functionality including program deployment and pranking

use std::collections::HashMap;

use dashmap::DashMap;
use litesvm::LiteSVM;
use solana_clock::Clock;
use solana_compute_budget::compute_budget::ComputeBudget;
use solana_sdk::{account::Account, pubkey::Pubkey, signature::Keypair, signer::Signer};

use crate::{
    errors::{Result, VmError},
    fork::ForkProvider,
    internal::conversions::to_lite_pubkey,
};

/// Snapshot data of state
#[derive(Clone)]
pub struct Snapshot {
    /// Accounts at snapshot time
    pub(crate) accounts: HashMap<Pubkey, Account>,
    /// Clock state
    pub(crate) timestamp: i64,
    pub(crate) slot: u64,
}

/// Structure for transaction execution and state management
pub struct Vm {
    /// LiteSVM instance for transaction execution
    pub svm: LiteSVM,

    /// Registered keypairs (address -> keypair bytes for cloning)
    keypairs: HashMap<Pubkey, [u8; 64]>,

    /// Active prank address (impersonation)
    prank_address: Option<Pubkey>,

    /// Persistent prank (until `stop_prank` is called)
    persistent_prank: bool,

    /// Snapshot storage for state reverting
    pub(crate) snapshots: HashMap<u64, Snapshot>,

    /// Next snapshot ID
    pub(crate) next_snapshot_id: u64,

    /// Account cache for tracking modified accounts
    pub(crate) modified_accounts: DashMap<Pubkey, ()>,

    /// Program names for debugging
    program_names: HashMap<Pubkey, String>,

    /// Compute budget tracking enabled
    compute_tracking: bool,

    /// Transaction logs
    tx_logs: Vec<Vec<String>>,

    /// Logs emitted by the most recent failed transaction (if any)
    last_error_logs: Option<Vec<String>>,

    /// Automatically refresh blockhash before building a transaction
    auto_refresh_blockhash: bool,
}

impl Vm {
    pub fn new() -> Self {
        let mut compute_budget = ComputeBudget::new_with_defaults(false);
        compute_budget.compute_unit_limit = 1_400_000; // set to solana max compute unit limit
        let mut svm = LiteSVM::new()
            .with_compute_budget(compute_budget)
            .with_transaction_history(50);

        let clock = Clock {
            slot: 1000,
            epoch_start_timestamp: chrono::Utc::now().timestamp(),
            epoch: 100,
            leader_schedule_epoch: 101,
            unix_timestamp: chrono::Utc::now().timestamp(),
        };
        svm.set_sysvar::<Clock>(&clock);

        Self {
            svm,
            keypairs: HashMap::new(),
            prank_address: None,
            persistent_prank: false,
            snapshots: HashMap::new(),
            next_snapshot_id: 0,
            modified_accounts: DashMap::new(),
            program_names: HashMap::new(),
            compute_tracking: true,
            tx_logs: vec![],
            last_error_logs: None,
            auto_refresh_blockhash: true,
        }
    }

    pub async fn with_fork(rpc_url: &str, accounts: Vec<Pubkey>) -> Result<Self> {
        let mut vm = Self::new();
        let fork = ForkProvider::new(rpc_url);

        for pubkey in accounts {
            match fork.clone_account(&pubkey).await {
                Ok(account) => {
                    if account.executable {
                        // Handle program accounts specially
                        let program_data = fork.clone_program(&pubkey).await?;
                        vm.add_program(&pubkey, &program_data.bytecode)?;
                    } else {
                        vm.set_account(&pubkey, account)?;
                    }
                }
                Err(e) => {
                    tracing::warn!("Failed to clone account {}: {}", pubkey, e);
                }
            }
        }

        if let Ok(clock) = fork.sync_clock().await {
            vm.set_timestamp(clock.unix_timestamp);
        }

        Ok(vm)
    }

    /// Register a keypair for use with prank functionality
    pub fn register_keypair(&mut self, keypair: &Keypair) {
        self.keypairs.insert(keypair.pubkey(), keypair.to_bytes());
    }

    /// Get a registered keypair by address
    pub fn get_keypair(&self, address: &Pubkey) -> Option<Keypair> {
        self.keypairs
            .get(address)
            .map(|bytes| Keypair::try_from(bytes.as_slice()).expect("Invalid keypair bytes"))
    }

    /// Set prank address for next transaction only
    pub fn prank(&mut self, address: Pubkey) {
        self.prank_address = Some(address);
        self.persistent_prank = false;
    }

    /// Set persistent impersonation until stop_prank is called
    pub fn start_prank(&mut self, address: Pubkey) {
        self.prank_address = Some(address);
        self.persistent_prank = true;
    }

    /// Clear impersonation
    pub fn stop_prank(&mut self) {
        self.prank_address = None;
        self.persistent_prank = false;
    }

    /// Get current prank address
    pub fn get_prank(&self) -> Option<Pubkey> {
        self.prank_address
    }

    /// Get the keypair for the current prank address
    pub fn get_prank_keypair(&self) -> Option<Keypair> {
        self.prank_address.and_then(|addr| self.get_keypair(&addr))
    }

    /// Clear prank after single use (internally used by transaction builder)
    pub(crate) fn clear_single_prank(&mut self) {
        if !self.persistent_prank {
            self.prank_address = None;
        }
    }

    /// Add program from bytecode
    pub fn add_program(&mut self, program_id: &Pubkey, bytecode: &[u8]) -> Result<()> {
        let lite_program_id = to_lite_pubkey(program_id);
        self.svm
            .add_program(lite_program_id, bytecode)
            .map_err(|e| VmError::DeploymentFailed(format!("{:?}", e)))?;
        Ok(())
    }

    /// Add program from .so file
    pub fn add_program_from_file(&mut self, program_id: &Pubkey, file_path: &str) -> Result<()> {
        let bytecode = std::fs::read(file_path)?;
        self.add_program(program_id, &bytecode)?;
        self.program_names
            .insert(*program_id, file_path.to_string());
        Ok(())
    }

    /// Set a name for a program (for debugging)
    pub fn set_program_name(&mut self, program_id: &Pubkey, name: &str) {
        self.program_names.insert(*program_id, name.to_string());
    }

    /// Get latest blockhash
    pub fn latest_blockhash(&self) -> solana_sdk::hash::Hash {
        let lite_hash = self.svm.latest_blockhash();
        solana_sdk::hash::Hash::from(lite_hash.to_bytes())
    }

    /// Expire current blockhash (force new one)
    pub fn expire_blockhash(&mut self) {
        self.svm.expire_blockhash();
    }

    /// Toggle automatic blockhash refresh before every transaction build
    pub fn set_auto_refresh_blockhash(&mut self, enabled: bool) {
        self.auto_refresh_blockhash = enabled;
    }

    /// Check whether auto blockhash refresh is enabled
    pub fn auto_refresh_blockhash(&self) -> bool {
        self.auto_refresh_blockhash
    }

    /// Get rent sysvar
    pub fn rent(&self) -> solana_sdk::rent::Rent {
        solana_sdk::rent::Rent::default()
    }

    /// Check if compute tracking is enabled
    pub fn is_compute_tracking(&self) -> bool {
        self.compute_tracking
    }

    pub fn set_compute_tracking(&mut self, enabled: bool) {
        self.compute_tracking = enabled;
    }

    pub fn last_tx_logs(&self) -> Option<&Vec<String>> {
        self.tx_logs.last()
    }

    /// Store transaction logs
    pub(crate) fn store_tx_logs(&mut self, logs: Vec<String>) {
        self.tx_logs.push(logs);
    }

    /// Store logs from a failed transaction
    pub(crate) fn store_error_logs(&mut self, logs: Vec<String>) {
        if logs.is_empty() {
            self.last_error_logs = None;
        } else {
            self.last_error_logs = Some(logs);
        }
    }

    /// Clear logs captured from the last failed transaction
    pub fn clear_last_error_logs(&mut self) {
        self.last_error_logs = None;
    }

    /// Get logs from the last failed transaction, if any
    pub fn last_error_logs(&self) -> Option<&Vec<String>> {
        self.last_error_logs.as_ref()
    }

    /// Check whether the last failure matches the expected message via error string or logs
    pub fn revert_matches(&self, expected_message: &str, err: &VmError) -> bool {
        err.to_string().contains(expected_message)
            || self
                .last_error_logs
                .as_ref()
                .map(|logs| logs.iter().any(|log| log.contains(expected_message)))
                .unwrap_or(false)
    }
}

impl Default for Vm {
    fn default() -> Self {
        Self::new()
    }
}

use super::accounts::AccountManager;
use super::state::StateManager;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_environment() {
        let vm = Vm::new();
        assert!(vm.timestamp() > 0);
    }

    #[test]
    fn test_prank() {
        let mut vm = Vm::new();
        let address = Pubkey::new_unique();

        vm.prank(address);
        assert_eq!(vm.get_prank(), Some(address));

        vm.stop_prank();
        assert_eq!(vm.get_prank(), None);
    }
}
