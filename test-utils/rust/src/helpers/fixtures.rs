use super::assertions::VmAccess;
use crate::{
    builder::ProgramArtifact,
    core::{accounts::AccountManager, vm::Vm},
    errors::Result,
};
use solana_sdk::{pubkey::Pubkey, signature::Keypair};

/// Boilerplate state shared by all program fixtures.
pub struct BaseFixture<'vm> {
    vm: &'vm mut Vm,
    payer: Keypair,
    program_id: Pubkey,
    deployed: bool,
}

impl<'vm> BaseFixture<'vm> {
    pub fn new(vm: &'vm mut Vm, program_id: Pubkey) -> Self {
        let payer = vm.make_account(10_000_000_000);
        Self {
            vm,
            payer,
            program_id,
            deployed: false,
        }
    }

    pub fn with_payer(vm: &'vm mut Vm, program_id: Pubkey, payer: Keypair) -> Self {
        Self {
            vm,
            payer,
            program_id,
            deployed: false,
        }
    }

    /// Mutable access to the VM.
    pub fn vm(&mut self) -> &mut Vm {
        &mut *self.vm
    }

    pub fn payer(&self) -> &Keypair {
        &self.payer
    }

    /// Replace the payer keypair and return the previous one.
    pub fn replace_payer(&mut self, new_payer: Keypair) -> Keypair {
        let old = std::mem::replace(&mut self.payer, new_payer);
        old
    }

    pub fn program_id(&self) -> Pubkey {
        self.program_id
    }

    pub fn set_program_id(&mut self, program_id: Pubkey) {
        self.program_id = program_id;
    }

    /// Deploy a compiled artifact and optionally annotate it with a friendly name.
    pub fn deploy(&mut self, artifact: &ProgramArtifact) -> Result<()> {
        let so_path = artifact.so_path().to_string_lossy().to_string();
        self.vm
            .add_program_from_file(&artifact.program_id(), &so_path)?;

        if let Some(name) = artifact.name() {
            self.vm.set_program_name(&artifact.program_id(), name);
        }

        self.deployed = true;
        Ok(())
    }

    /// Whether a program artifact has been deployed.
    pub fn is_deployed(&self) -> bool {
        self.deployed
    }

    // Helper function to find program .so file
    pub fn find_program_path(program_name: &str) -> Option<String> {
        ["../", "", "../../", "./"]
            .iter()
            .map(|prefix| format!("{}target/deploy/{}", prefix, program_name))
            .find(|path| std::path::Path::new(path).exists())
    }
}

impl<'vm> VmAccess for BaseFixture<'vm> {
    fn vm_mut(&mut self) -> &mut Vm {
        self.vm()
    }
}

/// Trait that program fixtures can implement to gain convenience methods for accessing the [`BaseFixture`].
pub trait ProgramFixture<'vm> {
    /// Immutable access to the shared base fixture.
    fn base_ref(&self) -> &BaseFixture<'vm>;

    /// Mutable access to the shared base fixture.
    fn base_mut(&mut self) -> &mut BaseFixture<'vm>;

    /// Borrow the underlying VM.
    fn vm<'a>(&'a mut self) -> &'a mut Vm
    where
        'vm: 'a,
    {
        self.base_mut().vm()
    }

    /// Payer that signs most transactions during tests.
    fn payer<'a>(&'a self) -> &'a Keypair
    where
        'vm: 'a,
    {
        self.base_ref().payer()
    }

    /// Program id targeted by the fixture.
    fn program_id(&self) -> Pubkey {
        self.base_ref().program_id()
    }

    /// Deploy a compiled artifact via the base fixture.
    fn deploy(&mut self, artifact: &ProgramArtifact) -> Result<()> {
        self.base_mut().deploy(artifact)
    }

    /// Whether `deploy` has been called.
    fn is_deployed(&self) -> bool {
        self.base_ref().is_deployed()
    }
}
