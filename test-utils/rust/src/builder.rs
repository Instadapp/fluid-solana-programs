use std::path::{Path, PathBuf};

use crate::{
    core::{accounts::AccountManager, state::StateManager, vm::Vm},
    errors::{Result, VmError},
    fork::ForkProvider,
};
use solana_client::rpc_config::RpcProgramAccountsConfig;
use solana_sdk::pubkey::Pubkey;
use tokio::runtime::Runtime;

#[derive(Debug, Clone)]
enum VmMode {
    Local,
    Fork(ForkSettings),
}

#[derive(Debug, Clone)]
struct ForkSettings {
    rpc_url: String,
}

/// Builder for the test environment
#[derive(Debug, Clone)]
pub struct VmBuilder {
    mode: VmMode,
    programs: Vec<ProgramArtifact>,
    overrides: Vec<ProgramArtifact>,
    fork_accounts: Vec<Pubkey>,
    fork_programs: Vec<(Pubkey, Option<RpcProgramAccountsConfig>)>,
    sync_clock: bool,
}

impl Default for VmBuilder {
    fn default() -> Self {
        Self {
            mode: VmMode::Local,
            programs: vec![],
            overrides: vec![],
            fork_accounts: vec![],
            fork_programs: vec![],
            sync_clock: true,
        }
    }
}

impl VmBuilder {
    /// Start local environment.
    pub fn new() -> Self {
        Self::default()
    }

    /// Configure the builder to fork from the provided RPC url.
    pub fn fork(rpc_url: impl Into<String>) -> Self {
        Self {
            mode: VmMode::Fork(ForkSettings {
                rpc_url: rpc_url.into(),
            }),
            ..Self::default()
        }
    }

    /// Deploy a program artifact before running tests.
    pub fn with_program(mut self, artifact: ProgramArtifact) -> Self {
        self.programs.push(artifact);
        self
    }

    /// Override on-chain program code with locally built binaries.
    pub fn override_program(mut self, artifact: ProgramArtifact) -> Self {
        self.overrides.push(artifact);
        self
    }

    /// Pull a specific account from the forked cluster.
    pub fn track_account(mut self, pubkey: Pubkey) -> Self {
        self.fork_accounts.push(pubkey);
        self
    }

    /// Pull a batch of accounts from the forked cluster.
    pub fn track_accounts<I>(mut self, accounts: I) -> Self
    where
        I: IntoIterator<Item = Pubkey>,
    {
        self.fork_accounts.extend(accounts);
        self
    }

    /// Clone every account owned by the provided program id.
    pub fn clone_program_accounts(mut self, program_id: Pubkey) -> Self {
        self.fork_programs.push((program_id, None));
        self
    }

    /// Clone program accounts with an RPC config filter to keep the snapshot smaller.
    pub fn clone_program_accounts_with_config(
        mut self,
        program_id: Pubkey,
        config: RpcProgramAccountsConfig,
    ) -> Self {
        self.fork_programs.push((program_id, Some(config)));
        self
    }

    /// Control the forked clock/slot to be synced into LiteSVM (defaults to true).
    pub fn sync_clock(mut self, sync: bool) -> Self {
        self.sync_clock = sync;
        self
    }

    /// Build the VM asynchronously.
    pub async fn build(self) -> Result<Vm> {
        let mut vm = Vm::new();

        if let VmMode::Fork(settings) = &self.mode {
            let fork = ForkProvider::new(&settings.rpc_url);

            for pubkey in &self.fork_accounts {
                let account = fork.clone_account(pubkey).await?;
                vm.set_account(pubkey, account)?;
            }

            for (program_id, config) in &self.fork_programs {
                let accounts = if let Some(cfg) = config {
                    fork.clone_program_accounts_with_config(program_id, cfg.clone())
                        .await?
                } else {
                    fork.clone_program_accounts(program_id).await?
                };

                for (pubkey, account) in accounts {
                    vm.set_account(&pubkey, account)?;
                }
            }

            if self.sync_clock {
                if let Ok(clock) = fork.sync_clock().await {
                    vm.set_timestamp(clock.unix_timestamp);
                    vm.warp_slot(clock.slot);
                }
            }
        }

        Self::deploy_artifacts(&mut vm, &self.programs)?;
        Self::deploy_artifacts(&mut vm, &self.overrides)?;

        Ok(vm)
    }

    /// Blocking helper for VMs that do not need async setup.
    pub fn build_blocking(self) -> Result<Vm> {
        Runtime::new()
            .map_err(|e| VmError::Custom(format!("Failed to create runtime: {e}")))?
            .block_on(self.build())
    }

    fn deploy_artifacts(vm: &mut Vm, artifacts: &[ProgramArtifact]) -> Result<()> {
        for artifact in artifacts {
            let path = artifact.so_path.to_string_lossy().to_string();
            vm.add_program_from_file(&artifact.program_id, &path)?;
            if let Some(name) = &artifact.name {
                vm.set_program_name(&artifact.program_id, name);
            }
        }
        Ok(())
    }
}

/// Metadata describing a compiled BPF program artifact.
#[derive(Debug, Clone)]
pub struct ProgramArtifact {
    program_id: Pubkey,
    name: Option<String>,
    so_path: PathBuf,
}

impl ProgramArtifact {
    pub fn new(program_id: Pubkey, name: impl Into<String>, so_path: impl Into<PathBuf>) -> Self {
        Self {
            program_id,
            name: Some(name.into()),
            so_path: so_path.into(),
        }
    }

    pub fn unnamed(program_id: Pubkey, so_path: impl Into<PathBuf>) -> Self {
        Self {
            program_id,
            name: None,
            so_path: so_path.into(),
        }
    }

    pub fn program_id(&self) -> Pubkey {
        self.program_id
    }

    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }

    pub fn so_path(&self) -> &Path {
        &self.so_path
    }
}
