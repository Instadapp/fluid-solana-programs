//! Address Lookup Table helpers for V0 transactions
//!
//! This module provides utilities for creating, extending, and using
//! Address Lookup Tables (ALTs) in versioned transactions.

use crate::{
    core::{accounts::AccountManager, state::StateManager, vm::Vm},
    errors::{Result, VmError},
};
use solana_sdk::account::Account;
use solana_sdk::{
    address_lookup_table::{
        instruction::{create_lookup_table, extend_lookup_table},
        program::ID as ADDRESS_LOOKUP_TABLE_PROGRAM_ID,
        state::AddressLookupTable,
        AddressLookupTableAccount,
    },
    instruction::Instruction,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
};

/// Trait for managing Address Lookup Tables
pub trait LookupTableManager {
    /// Create a new lookup table
    fn create_lookup_table_ix(&self, authority: &Pubkey, slot: u64) -> (Instruction, Pubkey);

    /// Create instruction to extend a lookup table with new addresses
    fn extend_lookup_table_ix(
        &self,
        table_address: &Pubkey,
        authority: &Pubkey,
        payer: &Pubkey,
        addresses: Vec<Pubkey>,
    ) -> Instruction;

    /// Get addresses stored in a lookup table
    fn get_lookup_table_addresses(&self, table_address: &Pubkey) -> Result<Vec<Pubkey>>;

    /// Get the full lookup table account
    fn get_lookup_table_account(&self, table_address: &Pubkey)
        -> Result<AddressLookupTableAccount>;

    /// Create a lookup table from raw data
    fn set_lookup_table_from_data(
        &mut self,
        table_address: &Pubkey,
        data: Vec<u8>,
        lamports: u64,
    ) -> Result<()>;
}

impl LookupTableManager for Vm {
    fn create_lookup_table_ix(&self, authority: &Pubkey, slot: u64) -> (Instruction, Pubkey) {
        create_lookup_table(*authority, *authority, slot)
    }

    fn extend_lookup_table_ix(
        &self,
        table_address: &Pubkey,
        authority: &Pubkey,
        payer: &Pubkey,
        addresses: Vec<Pubkey>,
    ) -> Instruction {
        extend_lookup_table(*table_address, *authority, Some(*payer), addresses)
    }

    fn get_lookup_table_addresses(&self, table_address: &Pubkey) -> Result<Vec<Pubkey>> {
        let account = self
            .get_account(table_address)
            .ok_or_else(|| VmError::AccountNotFound(table_address.to_string()))?;

        let lookup_table = AddressLookupTable::deserialize(&account.data).map_err(|e| {
            VmError::DeserializeFailed(format!("Failed to deserialize ALT: {:?}", e))
        })?;

        Ok(lookup_table.addresses.to_vec())
    }

    fn get_lookup_table_account(
        &self,
        table_address: &Pubkey,
    ) -> Result<AddressLookupTableAccount> {
        let account = self
            .get_account(table_address)
            .ok_or_else(|| VmError::AccountNotFound(table_address.to_string()))?;

        let lookup_table = AddressLookupTable::deserialize(&account.data).map_err(|e| {
            VmError::DeserializeFailed(format!("Failed to deserialize ALT: {:?}", e))
        })?;

        Ok(AddressLookupTableAccount {
            key: *table_address,
            addresses: lookup_table.addresses.to_vec(),
        })
    }

    fn set_lookup_table_from_data(
        &mut self,
        table_address: &Pubkey,
        data: Vec<u8>,
        lamports: u64,
    ) -> Result<()> {
        let account = Account {
            lamports,
            data,
            owner: ADDRESS_LOOKUP_TABLE_PROGRAM_ID,
            executable: false,
            rent_epoch: u64::MAX, // non-expiring rent epoch
        };

        self.set_account(table_address, account)
    }
}

/// Helper struct for managing multiple lookup tables
pub struct LookupTableHelper {
    /// Authority keypair for creating/extending tables
    pub authority: Keypair,
}

impl LookupTableHelper {
    pub fn new(authority: Keypair) -> Self {
        Self { authority }
    }

    /// Create a new lookup table in the VM
    pub fn create_table(&self, vm: &mut Vm) -> Result<Pubkey> {
        let slot = vm.slot();
        let (ix, table_address) = vm.create_lookup_table_ix(&self.authority.pubkey(), slot);

        vm.prank(self.authority.pubkey());
        vm.execute_as_prank(ix)?;

        Ok(table_address)
    }

    /// Add addresses to an existing lookup table
    pub fn add_addresses(
        &self,
        vm: &mut Vm,
        table_address: &Pubkey,
        addresses: Vec<Pubkey>,
    ) -> Result<()> {
        if addresses.is_empty() {
            return Ok(());
        }

        let ix = vm.extend_lookup_table_ix(
            table_address,
            &self.authority.pubkey(),
            &self.authority.pubkey(),
            addresses,
        );

        vm.prank(self.authority.pubkey());
        vm.execute_as_prank(ix)?;

        Ok(())
    }

    /// Add addresses that aren't already in the table
    pub fn add_addresses_if_missing(
        &self,
        vm: &mut Vm,
        table_address: &Pubkey,
        addresses: Vec<Pubkey>,
    ) -> Result<()> {
        let existing = vm.get_lookup_table_addresses(table_address)?;
        let existing_set: std::collections::HashSet<_> = existing.into_iter().collect();

        let new_addresses: Vec<_> = addresses
            .into_iter()
            .filter(|addr| !existing_set.contains(addr))
            .collect();

        if !new_addresses.is_empty() {
            self.add_addresses(vm, table_address, new_addresses)?;
        }

        Ok(())
    }

    pub fn load_lookup_table_from_file<P: AsRef<std::path::Path>>(
        &self,
        vm: &mut Vm,
        table_address: &Pubkey,
        file_path: P,
    ) -> Result<()> {
        let file_content = std::fs::read_to_string(file_path.as_ref()).map_err(|e| {
            VmError::Custom(format!(
                "Failed to read lookup table file '{}': {}",
                file_path.as_ref().display(),
                e
            ))
        })?;

        let json_data: serde_json::Value = serde_json::from_str(&file_content).map_err(|e| {
            VmError::Custom(format!(
                "Failed to parse lookup table JSON from '{}': {}",
                file_path.as_ref().display(),
                e
            ))
        })?;

        Self::load_lookup_table_from_json(vm, table_address, &json_data)?;

        Ok(())
    }

    fn load_lookup_table_from_json(
        vm: &mut Vm,
        table_address: &Pubkey,
        json_data: &serde_json::Value,
    ) -> Result<()> {
        // Extract data array from JSON
        let data_array = json_data
            .get("data")
            .and_then(|d| d.get("data"))
            .and_then(|d| d.as_array())
            .ok_or_else(|| {
                VmError::Custom("Invalid JSON format: missing data array".to_string())
            })?;

        let data: Vec<u8> = data_array
            .iter()
            .filter_map(|v| v.as_u64().map(|n| n as u8))
            .collect();

        let lamports = json_data
            .get("lamports")
            .and_then(|l| l.as_u64())
            .unwrap_or(0); // default lamports

        vm.set_lookup_table_from_data(table_address, data, lamports)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prelude::*;

    const ACCOUNT_INFO_PATH: &str = "tests-utils/accountInfo.json";

    /// Get the path to accountInfo.json from the workspace root
    fn get_account_info_path() -> std::path::PathBuf {
        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            // From crates/test-framework/ directory, go up two levels to fluid-contracts-solana/
            let workspace_root = std::path::Path::new(&manifest_dir)
                .parent()
                .and_then(|p| p.parent());

            if let Some(root) = workspace_root {
                let path = root.join(ACCOUNT_INFO_PATH);
                if path.exists() {
                    return path;
                }
            }
        }
        panic!("Failed to find accountInfo.json in workspace root");
    }

    #[test]
    fn test_load_lookup_table_from_file() {
        let mut vm = Vm::new();
        let table_address = Pubkey::new_unique();
        let file_path = get_account_info_path();

        println!("Loading lookup table from: {}", file_path.display());

        LookupTableHelper::new(Keypair::new())
            .load_lookup_table_from_file(&mut vm, &table_address, &file_path)
            .expect("Failed to load lookup table from file");

        // Verify the account was set
        let account = vm
            .get_account(&table_address)
            .expect("Account should exist");
        assert_eq!(account.owner, ADDRESS_LOOKUP_TABLE_PROGRAM_ID);
        assert!(!account.data.is_empty());

        println!(
            "Successfully loaded lookup table with {} bytes of data",
            account.data.len()
        );
    }

    #[test]
    fn test_get_lookup_table_addresses_from_file() {
        let mut vm = Vm::new();
        let table_address = Pubkey::new_unique();
        let file_path = get_account_info_path();

        LookupTableHelper::new(Keypair::new())
            .load_lookup_table_from_file(&mut vm, &table_address, &file_path)
            .expect("Failed to load lookup table from file");

        let addresses = vm
            .get_lookup_table_addresses(&table_address)
            .expect("Failed to get addresses");

        println!("Lookup table contains {} addresses", addresses.len());

        // Verify we got addresses
        assert!(
            !addresses.is_empty(),
            "Lookup table should contain addresses"
        );

        for (i, addr) in addresses.iter().take(5).enumerate() {
            println!("  Address {}: {}", i, addr);
        }
    }

    #[test]
    fn test_get_lookup_table_account_from_file() {
        let mut vm = Vm::new();
        let table_address = Pubkey::new_unique();
        let file_path = get_account_info_path();

        LookupTableHelper::new(Keypair::new())
            .load_lookup_table_from_file(&mut vm, &table_address, &file_path)
            .expect("Failed to load lookup table from file");

        // Get the full lookup table account
        let alt_account = vm
            .get_lookup_table_account(&table_address)
            .expect("Failed to get ALT account");

        assert_eq!(alt_account.key, table_address);
        assert!(!alt_account.addresses.is_empty());

        println!(
            "ALT account key: {}, addresses: {}",
            alt_account.key,
            alt_account.addresses.len()
        );
    }

    #[test]
    fn test_set_lookup_table_from_data() {
        let mut vm = Vm::new();
        let table_address = Pubkey::new_unique();

        // Create minimal lookup table data
        let data: Vec<u8> = vec![
            1, 0, 0, 0, // type discriminator (1 = lookup table)
            255, 255, 255, 255, 255, 255, 255, 255, // deactivation slot (u64::MAX = active)
            100, 0, 0, 0, 0, 0, 0, 0, // last extended slot
            0, // last extended slot start index
            1, // has authority flag
               // 32 bytes of authority pubkey follow
        ];

        let result = vm.set_lookup_table_from_data(&table_address, data.clone(), 1_000_000);
        assert!(result.is_ok());

        let account = vm.get_account(&table_address).unwrap();
        assert_eq!(account.owner, ADDRESS_LOOKUP_TABLE_PROGRAM_ID);
        assert_eq!(account.data, data);
    }

    #[test]
    fn test_lookup_table_helper_without_builtin() {
        let mut vm = Vm::new();
        let authority = vm.make_account(10 * LAMPORTS_PER_SOL);

        let helper = LookupTableHelper::new(authority);

        let slot = vm.slot();
        let (ix, _table_address) = vm.create_lookup_table_ix(&helper.authority.pubkey(), slot);

        assert_eq!(ix.program_id, ADDRESS_LOOKUP_TABLE_PROGRAM_ID);
        assert!(!ix.accounts.is_empty());
    }

    #[test]
    fn test_lookup_table_addresses_content_from_file() {
        let mut vm = Vm::new();
        let table_address = Pubkey::new_unique();
        let file_path = get_account_info_path();

        LookupTableHelper::new(Keypair::new())
            .load_lookup_table_from_file(&mut vm, &table_address, &file_path)
            .expect("Failed to load lookup table from file");

        let addresses = vm
            .get_lookup_table_addresses(&table_address)
            .expect("Failed to get addresses");

        // Verify count
        assert_eq!(addresses.len(), 21, "Expected 21 addresses in lookup table");

        // Verify Wrapped SOL is in the table
        let wsol = solana_sdk::pubkey!("So11111111111111111111111111111111111111112");
        assert!(
            addresses.contains(&wsol),
            "Lookup table should contain Wrapped SOL address"
        );

        // Verify system program is also in the table
        let system_program = solana_sdk::system_program::ID;
        assert!(
            addresses.contains(&system_program),
            "Lookup table should contain System Program ID"
        );

        println!("All {} addresses in lookup table:", addresses.len());
        for (i, addr) in addresses.iter().enumerate() {
            println!("  [{}] {}", i, addr);
        }
    }

    #[test]
    fn test_lookup_table_account_structure_from_file() {
        let mut vm = Vm::new();
        let table_address = Pubkey::new_unique();
        let file_path = get_account_info_path();

        LookupTableHelper::new(Keypair::new())
            .load_lookup_table_from_file(&mut vm, &table_address, &file_path)
            .expect("Failed to load lookup table from file");

        // Get full account structure
        let alt_account = vm
            .get_lookup_table_account(&table_address)
            .expect("Failed to get ALT account");

        assert_eq!(alt_account.key, table_address);
        assert!(!alt_account.addresses.is_empty());

        println!(
            "Lookup table {} is ready for V0 transactions with {} addresses",
            alt_account.key,
            alt_account.addresses.len()
        );

        let wsol = solana_sdk::pubkey!("So11111111111111111111111111111111111111112");
        let token_program = solana_sdk::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
        let ata_program = solana_sdk::pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

        println!("Known programs in lookup table:");
        if alt_account.addresses.contains(&wsol) {
            println!("  ✓ Wrapped SOL");
        }
        if alt_account
            .addresses
            .contains(&solana_sdk::system_program::ID)
        {
            println!("  ✓ System Program");
        }
        if alt_account.addresses.contains(&token_program) {
            println!("  ✓ SPL Token Program");
        }
        if alt_account.addresses.contains(&ata_program) {
            println!("  ✓ Associated Token Program");
        }
    }

    #[test]
    fn test_load_lookup_table_file_not_found() {
        let mut vm = Vm::new();
        let table_address = Pubkey::new_unique();

        let result = LookupTableHelper::new(Keypair::new()).load_lookup_table_from_file(
            &mut vm,
            &table_address,
            "nonexistent_file.json",
        );

        assert!(result.is_err(), "Should fail for nonexistent file");
        let err = result.unwrap_err();
        assert!(
            err.to_string().contains("Failed to read"),
            "Error should mention file read failure"
        );
    }
}
