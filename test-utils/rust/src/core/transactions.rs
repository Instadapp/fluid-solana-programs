//! Transaction building and execution

use crate::{
    core::vm::Vm,
    errors::{Result, VmError},
    internal::conversions::{
        to_lite_instruction, to_lite_pubkey, to_sdk_address_lookup_table_account,
    },
};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use solana_keypair::Keypair as LiteKeypair;
use solana_message::{v0::Message as V0Message, Message, VersionedMessage};
use solana_sdk::{
    address_lookup_table::AddressLookupTableAccount,
    instruction::Instruction,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
};
use solana_transaction::versioned::VersionedTransaction;
use std::collections::HashSet;
use std::convert::TryFrom;

/// Transaction builder for constructing and executing transactions
pub struct TransactionBuilder<'vm> {
    vm: &'vm mut Vm,
    instructions: Vec<Instruction>,
    signers: Vec<Keypair>,
    /// Track all accounts referenced in this transaction for snapshot support
    referenced_accounts: HashSet<Pubkey>,
    /// Lookup table accounts to be included in the transaction
    lookup_tables: Option<Vec<AddressLookupTableAccount>>,
}

impl<'vm> TransactionBuilder<'vm> {
    pub fn new(vm: &'vm mut Vm) -> Self {
        Self {
            vm,
            instructions: vec![],
            signers: vec![],
            referenced_accounts: HashSet::new(),
            lookup_tables: None,
        }
    }

    pub fn instruction(mut self, ix: Instruction) -> Self {
        // Track all accounts in this instruction for snapshot support
        for account_meta in &ix.accounts {
            self.referenced_accounts.insert(account_meta.pubkey);
        }
        // Also track the program ID
        self.referenced_accounts.insert(ix.program_id);
        self.instructions.push(ix);
        self
    }

    pub fn instructions(mut self, ixs: Vec<Instruction>) -> Self {
        for ix in &ixs {
            // Track all accounts in each instruction
            for account_meta in &ix.accounts {
                self.referenced_accounts.insert(account_meta.pubkey);
            }
            self.referenced_accounts.insert(ix.program_id);
        }
        self.instructions.extend(ixs);
        self
    }

    pub fn signer(mut self, keypair: &Keypair) -> Self {
        self.signers
            .push(Keypair::try_from(&keypair.to_bytes()[..]).unwrap());
        self
    }

    /// Add multiple signers
    pub fn signers(mut self, keypairs: &[&Keypair]) -> Self {
        for kp in keypairs {
            self.signers
                .push(Keypair::try_from(&kp.to_bytes()[..]).unwrap());
        }
        self
    }

    pub fn lookup_table(mut self, alt: AddressLookupTableAccount) -> Self {
        if let Some(ref mut tables) = self.lookup_tables {
            tables.push(alt);
        } else {
            self.lookup_tables = Some(vec![alt]);
        }
        self
    }

    pub fn lookup_tables(mut self, alts: Vec<AddressLookupTableAccount>) -> Self {
        if let Some(ref mut tables) = self.lookup_tables {
            tables.extend(alts);
        } else {
            self.lookup_tables = Some(alts);
        }
        self
    }

    /// Execute the transaction and expect success
    pub fn execute(self) -> Result<TransactionMetadata> {
        let referenced_accounts = self.referenced_accounts.clone();

        let (tx, vm) = self.build_transaction()?;

        vm.clear_single_prank();

        match vm.svm.send_transaction(tx) {
            Ok(metadata) => {
                vm.clear_last_error_logs();
                // Track all referenced accounts for snapshot support
                // This enables proper state reverting for accounts modified by transactions
                for pubkey in referenced_accounts {
                    vm.modified_accounts.insert(pubkey, ());
                }

                if vm.is_compute_tracking() {
                    vm.store_tx_logs(metadata.logs.clone());
                }
                Ok(metadata)
            }
            Err(e) => {
                vm.store_error_logs(e.meta.logs.clone());
                Err(VmError::TransactionFailed(format_failed_transaction(&e)))
            }
        }
    }

    pub fn execute_success(self) -> TransactionMetadata {
        self.execute().expect("Transaction should succeed")
    }

    pub fn execute_expect_fail(self) -> FailedTransactionMetadata {
        let (tx, vm) = self
            .build_transaction()
            .expect("Failed to build transaction");

        vm.clear_single_prank();

        match vm.svm.send_transaction(tx) {
            Ok(_) => panic!("Expected transaction to fail"),
            Err(e) => {
                vm.store_error_logs(e.meta.logs.clone());
                e
            }
        }
    }

    /// Simulate transaction
    pub fn simulate(self) -> Result<litesvm::types::SimulatedTransactionInfo> {
        let (tx, vm) = self.build_transaction()?;

        vm.svm
            .simulate_transaction(tx)
            .map_err(|e| VmError::SimulationFailed(format!("{:?}", e)))
    }

    /// Build transaction from instructions and signers
    fn build_transaction(self) -> Result<(VersionedTransaction, &'vm mut Vm)> {
        let has_lookup_tables = self
            .lookup_tables
            .as_ref()
            .map(|t| !t.is_empty())
            .unwrap_or(false);

        if has_lookup_tables {
            self.build_v0_transaction()
        } else {
            self.build_legacy_transaction()
        }
    }

    /// Build legacy transaction
    fn build_legacy_transaction(self) -> Result<(VersionedTransaction, &'vm mut Vm)> {
        let mut signers = self.signers;

        // If no explicit signers were provided, fall back to the active prank signer
        if signers.is_empty() {
            if let Some(prank_signer) = self.vm.get_prank_keypair() {
                signers.push(prank_signer);
            } else {
                return Err(VmError::NoSigners);
            }
        }

        // Refresh blockhash automatically when enabled to keep transactions valid
        if self.vm.auto_refresh_blockhash() {
            self.vm.expire_blockhash();
        }

        let payer = &signers[0];
        let recent_blockhash = self.vm.svm.latest_blockhash();

        let lite_instructions: Vec<_> = self
            .instructions
            .into_iter()
            .map(to_lite_instruction)
            .collect();

        let lite_payer = to_lite_pubkey(&payer.pubkey());

        let message =
            Message::new_with_blockhash(&lite_instructions, Some(&lite_payer), &recent_blockhash);
        let versioned_message = VersionedMessage::Legacy(message);

        let lite_signers: Vec<LiteKeypair> = signers
            .iter()
            .map(|s| LiteKeypair::try_from(&s.to_bytes()[..]).unwrap())
            .collect();

        let lite_signer_refs: Vec<&LiteKeypair> = lite_signers.iter().collect();

        let tx = VersionedTransaction::try_new(versioned_message, &lite_signer_refs)
            .map_err(|e| VmError::TransactionFailed(format!("Failed to create tx: {}", e)))?;

        Ok((tx, self.vm))
    }

    /// Build V0 transaction with lookup tables
    fn build_v0_transaction(self) -> Result<(VersionedTransaction, &'vm mut Vm)> {
        let mut signers = self.signers;

        if signers.is_empty() {
            if let Some(prank_signer) = self.vm.get_prank_keypair() {
                signers.push(prank_signer);
            } else {
                return Err(VmError::NoSigners);
            }
        }

        if self.vm.auto_refresh_blockhash() {
            self.vm.expire_blockhash();
        }

        let payer = &signers[0];
        let recent_blockhash = self.vm.svm.latest_blockhash();

        let lite_instructions: Vec<_> = self
            .instructions
            .into_iter()
            .map(to_lite_instruction)
            .collect();

        let lite_payer = to_lite_pubkey(&payer.pubkey());

        // Convert lookup tables to the format needed for V0 message
        let address_table_lookups: Vec<solana_message::AddressLookupTableAccount> = self
            .lookup_tables
            .unwrap_or_default()
            .iter()
            .map(to_sdk_address_lookup_table_account)
            .collect();

        // Create V0 message
        let message = V0Message::try_compile(
            &lite_payer,
            &lite_instructions,
            &address_table_lookups,
            recent_blockhash,
        )
        .map_err(|e| VmError::TransactionFailed(format!("Failed to compile V0 message: {}", e)))?;

        let versioned_message = VersionedMessage::V0(message);

        let lite_signers: Vec<LiteKeypair> = signers
            .iter()
            .map(|s| LiteKeypair::try_from(&s.to_bytes()[..]).unwrap())
            .collect();

        let lite_signer_refs: Vec<&LiteKeypair> = lite_signers.iter().collect();

        let tx = VersionedTransaction::try_new(versioned_message, &lite_signer_refs)
            .map_err(|e| VmError::TransactionFailed(format!("Failed to create V0 tx: {}", e)))?;

        Ok((tx, self.vm))
    }
}

fn format_failed_transaction(err: &FailedTransactionMetadata) -> String {
    if err.meta.logs.is_empty() {
        format!("{:?}", err.err)
    } else {
        format!("{:?}\nProgram logs:\n{}", err.err, err.meta.logs.join("\n"))
    }
}

impl Vm {
    pub fn tx(&mut self) -> TransactionBuilder<'_> {
        TransactionBuilder::new(self)
    }

    /// Execute single instruction
    pub fn execute_instruction(
        &mut self,
        ix: Instruction,
        signer: &Keypair,
    ) -> Result<TransactionMetadata> {
        TransactionBuilder::new(self)
            .instruction(ix)
            .signer(signer)
            .execute()
    }

    /// Execute single instruction using the prank signer if set.
    /// Falls back to explicit signers if provided on the builder, otherwise errors when no prank is active.
    pub fn execute_instruction_auto(&mut self, ix: Instruction) -> Result<TransactionMetadata> {
        TransactionBuilder::new(self).instruction(ix).execute()
    }

    /// Execute multiple instructions
    pub fn execute_instructions(
        &mut self,
        ixs: Vec<Instruction>,
        signer: &Keypair,
    ) -> Result<TransactionMetadata> {
        TransactionBuilder::new(self)
            .instructions(ixs)
            .signer(signer)
            .execute()
    }

    /// Execute multiple instructions using the prank signer if set.
    /// Falls back to explicit signers if provided on the builder, otherwise errors when no prank is active.
    pub fn execute_instructions_auto(
        &mut self,
        ixs: Vec<Instruction>,
    ) -> Result<TransactionMetadata> {
        TransactionBuilder::new(self).instructions(ixs).execute()
    }

    /// Execute single instruction using the currently pranked keypair
    /// Requires `prank()` or `start_prank()` to be called first
    pub fn execute_as_prank(&mut self, ix: Instruction) -> Result<TransactionMetadata> {
        let signer = self.get_prank_keypair().ok_or_else(|| {
            VmError::Custom("No prank address set or keypair not registered".to_string())
        })?;
        TransactionBuilder::new(self)
            .instruction(ix)
            .signer(&signer)
            .execute()
    }

    /// Execute multiple instructions using the currently pranked keypair
    /// Requires `prank()` or `start_prank()` to be called first
    pub fn execute_instructions_as_prank(
        &mut self,
        ixs: Vec<Instruction>,
    ) -> Result<TransactionMetadata> {
        let signer = self.get_prank_keypair().ok_or_else(|| {
            VmError::Custom("No prank address set or keypair not registered".to_string())
        })?;
        TransactionBuilder::new(self)
            .instructions(ixs)
            .signer(&signer)
            .execute()
    }

    /// Execute instructions with lookup tables using V0 transaction format
    pub fn execute_v0(
        &mut self,
        ixs: Vec<Instruction>,
        lookup_tables: Vec<AddressLookupTableAccount>,
        signer: &Keypair,
    ) -> Result<TransactionMetadata> {
        TransactionBuilder::new(self)
            .instructions(ixs)
            .lookup_tables(lookup_tables)
            .signer(signer)
            .execute()
    }

    /// Execute instructions with lookup tables using V0 transaction
    pub fn execute_v0_as_prank(
        &mut self,
        ixs: Vec<Instruction>,
        lookup_tables: Vec<AddressLookupTableAccount>,
    ) -> Result<TransactionMetadata> {
        let signer = self.get_prank_keypair().ok_or_else(|| {
            VmError::Custom("No prank address set or keypair not registered".to_string())
        })?;
        TransactionBuilder::new(self)
            .instructions(ixs)
            .lookup_tables(lookup_tables)
            .signer(&signer)
            .execute()
    }
}
