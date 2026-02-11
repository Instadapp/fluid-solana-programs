//! Account operations including airdrop, balance checks, and data management

use crate::{
    errors::{Result, VmError},
    internal::conversions::{from_lite_account, to_lite_account, to_lite_pubkey},
};
use solana_sdk::{account::Account, pubkey::Pubkey, signature::Keypair, signer::Signer};

use super::vm::Vm;

/// Trait for managing accounts in the VM
pub trait AccountManager {
    /// Airdrop SOL to an address
    fn airdrop(&mut self, pubkey: &Pubkey, lamports: u64) -> Result<()>;

    /// Set arbitrary account data
    fn set_account(&mut self, pubkey: &Pubkey, account: Account) -> Result<()>;

    /// Get account data
    fn get_account(&self, pubkey: &Pubkey) -> Option<Account>;

    /// Create and fund a new keypair
    fn make_account(&mut self, lamports: u64) -> Keypair;

    /// Get SOL balance
    fn balance(&self, pubkey: &Pubkey) -> u64;

    /// Check if account exists
    fn account_exists(&self, pubkey: &Pubkey) -> bool;
}

impl AccountManager for Vm {
    fn airdrop(&mut self, pubkey: &Pubkey, lamports: u64) -> Result<()> {
        let lite_pubkey = to_lite_pubkey(pubkey);
        self.svm
            .airdrop(&lite_pubkey, lamports)
            .map_err(|e| VmError::AirdropFailed(format!("{:?}", e)))?;
        self.modified_accounts.insert(*pubkey, ());
        Ok(())
    }

    fn set_account(&mut self, pubkey: &Pubkey, account: Account) -> Result<()> {
        let lite_pubkey = to_lite_pubkey(pubkey);
        let lite_account = to_lite_account(account);
        self.svm
            .set_account(lite_pubkey, lite_account)
            .map_err(|e| VmError::SetAccountFailed(format!("{:?}", e)))?;
        self.modified_accounts.insert(*pubkey, ());
        Ok(())
    }

    fn get_account(&self, pubkey: &Pubkey) -> Option<Account> {
        let lite_pubkey = to_lite_pubkey(pubkey);
        self.svm.get_account(&lite_pubkey).map(from_lite_account)
    }

    fn make_account(&mut self, lamports: u64) -> Keypair {
        let keypair = Keypair::new();
        self.airdrop(&keypair.pubkey(), lamports).unwrap();
        self.register_keypair(&keypair);
        keypair
    }

    fn balance(&self, pubkey: &Pubkey) -> u64 {
        self.get_account(pubkey).map(|a| a.lamports).unwrap_or(0)
    }

    fn account_exists(&self, pubkey: &Pubkey) -> bool {
        self.get_account(pubkey).is_some()
    }
}

impl Vm {
    /// Set account with data from type that implements AnchorSerialize
    pub fn set_account_data<T: anchor_lang::AnchorSerialize>(
        &mut self,
        pubkey: &Pubkey,
        owner: &Pubkey,
        data: &T,
    ) -> Result<()> {
        let mut serialized = vec![];
        data.serialize(&mut serialized)
            .map_err(|e| VmError::SerializeFailed(e.to_string()))?;

        let account = Account {
            lamports: self.rent().minimum_balance(serialized.len()),
            data: serialized,
            owner: *owner,
            executable: false,
            rent_epoch: 0,
        };

        self.set_account(pubkey, account)
    }

    /// Read account data as type that implements AnchorDeserialize
    pub fn read_account_data<T: anchor_lang::AnchorDeserialize>(
        &self,
        pubkey: &Pubkey,
    ) -> Result<T> {
        let account = self
            .get_account(pubkey)
            .ok_or_else(|| VmError::AccountNotFound(pubkey.to_string()))?;

        // Skip anchor discriminator (8 bytes)
        let data = if account.data.len() > 8 {
            &account.data[8..]
        } else {
            &account.data[..]
        };

        T::deserialize(&mut &data[..]).map_err(|e| VmError::DeserializeFailed(e.to_string()))
    }

    /// Read account data with anchor's try_deserialize (includes discriminator check)
    pub fn read_anchor_account<T: anchor_lang::AccountDeserialize>(
        &self,
        pubkey: &Pubkey,
    ) -> Result<T> {
        let account = self
            .get_account(pubkey)
            .ok_or_else(|| VmError::AccountNotFound(pubkey.to_string()))?;

        T::try_deserialize(&mut account.data.as_slice())
            .map_err(|e| VmError::DeserializeFailed(e.to_string()))
    }

    pub fn get_accounts(&self, pubkeys: &[Pubkey]) -> Vec<Option<Account>> {
        pubkeys.iter().map(|pk| self.get_account(pk)).collect()
    }

    pub fn transfer_sol(&mut self, from: &Keypair, to: &Pubkey, lamports: u64) -> Result<()> {
        let from_balance = self.balance(&from.pubkey());
        if from_balance < lamports {
            return Err(VmError::Custom(format!(
                "Insufficient balance: {} < {}",
                from_balance, lamports
            )));
        }

        // Update from account
        if let Some(mut from_account) = self.get_account(&from.pubkey()) {
            from_account.lamports -= lamports;
            self.set_account(&from.pubkey(), from_account)?;
        }

        // Update to account
        if let Some(mut to_account) = self.get_account(to) {
            to_account.lamports += lamports;
            self.set_account(to, to_account)?;
        } else {
            // Create new account
            let account = Account {
                lamports,
                data: vec![],
                owner: solana_sdk::system_program::id(),
                executable: false,
                rent_epoch: 0,
            };
            self.set_account(to, account)?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_airdrop() {
        let mut vm = Vm::new();
        let pubkey = Pubkey::new_unique();

        vm.airdrop(&pubkey, 1_000_000_000).unwrap();
        assert_eq!(vm.balance(&pubkey), 1_000_000_000);
    }

    #[test]
    fn test_make_account() {
        let mut vm = Vm::new();
        let keypair = vm.make_account(5_000_000_000);

        assert_eq!(vm.balance(&keypair.pubkey()), 5_000_000_000);
    }

    #[test]
    fn test_set_get_account() {
        let mut vm = Vm::new();
        let pubkey = Pubkey::new_unique();

        let account = Account {
            lamports: 100,
            data: vec![1, 2, 3],
            owner: Pubkey::new_unique(),
            executable: false,
            rent_epoch: 0,
        };

        vm.set_account(&pubkey, account.clone()).unwrap();

        let retrieved = vm.get_account(&pubkey).unwrap();
        assert_eq!(retrieved.lamports, account.lamports);
        assert_eq!(retrieved.data, account.data);
    }
}
