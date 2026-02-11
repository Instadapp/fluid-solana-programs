//! Time warping, snapshots, and state management

use std::collections::HashMap;

use crate::{
    core::{accounts::AccountManager, vm::Snapshot},
    errors::{Result, VmError},
};

use super::vm::Vm;

/// Trait for managing VM state (time, snapshots, etc.)
pub trait StateManager {
    /// Warp time forward in seconds
    fn warp_time(&mut self, seconds: i64);

    /// Set absolute timestamp
    fn set_timestamp(&mut self, timestamp: i64);

    /// Get current timestamp
    fn timestamp(&self) -> i64;

    /// Warp to specific slot
    fn warp_slot(&mut self, slot: u64);

    /// Warp forward in number of slots
    fn warp_slots(&mut self, slots: u64);

    /// Get current slot
    fn slot(&self) -> u64;

    /// Get current epoch
    fn epoch(&self) -> u64;

    /// Take a snapshot of current state
    fn snapshot(&mut self) -> u64;

    /// Revert to a snapshot state
    fn revert(&mut self, snapshot_id: u64) -> Result<()>;
}

impl StateManager for Vm {
    fn warp_time(&mut self, seconds: i64) {
        let mut clock = self.svm.get_sysvar::<solana_clock::Clock>();
        clock.unix_timestamp += seconds;
        self.svm.set_sysvar::<solana_clock::Clock>(&clock);
    }

    fn set_timestamp(&mut self, timestamp: i64) {
        let mut clock = self.svm.get_sysvar::<solana_clock::Clock>();
        clock.unix_timestamp = timestamp;
        self.svm.set_sysvar::<solana_clock::Clock>(&clock);
    }

    fn timestamp(&self) -> i64 {
        self.svm.get_sysvar::<solana_clock::Clock>().unix_timestamp
    }

    fn warp_slot(&mut self, slot: u64) {
        self.svm.warp_to_slot(slot);
    }

    fn warp_slots(&mut self, slots: u64) {
        let current = self.slot();
        self.warp_slot(current + slots);
    }

    fn slot(&self) -> u64 {
        self.svm.get_sysvar::<solana_clock::Clock>().slot
    }

    fn epoch(&self) -> u64 {
        self.svm.get_sysvar::<solana_clock::Clock>().epoch
    }

    fn snapshot(&mut self) -> u64 {
        let id = self.next_snapshot_id;
        self.next_snapshot_id += 1;

        // Collect all modified accounts
        let mut accounts = HashMap::new();
        for entry in self.modified_accounts.iter() {
            let pubkey = *entry.key();
            if let Some(account) = self.get_account(&pubkey) {
                accounts.insert(pubkey, account);
            }
        }

        let snapshot = Snapshot {
            accounts,
            timestamp: self.timestamp(),
            slot: self.slot(),
        };

        self.snapshots.insert(id, snapshot);
        id
    }

    fn revert(&mut self, snapshot_id: u64) -> Result<()> {
        let snapshot = self
            .snapshots
            .get(&snapshot_id)
            .ok_or(VmError::SnapshotNotFound(snapshot_id))?
            .clone();

        // Restore accounts
        for (pubkey, account) in snapshot.accounts {
            self.set_account(&pubkey, account)?;
        }

        // Restore clock
        self.set_timestamp(snapshot.timestamp);
        self.warp_slot(snapshot.slot);

        Ok(())
    }
}

impl Vm {
    /// Warp time forward by days
    pub fn warp_days(&mut self, days: u64) {
        self.warp_time((days * 24 * 60 * 60) as i64);
    }

    /// Warp time forward by hours
    pub fn warp_hours(&mut self, hours: u64) {
        self.warp_time((hours * 60 * 60) as i64);
    }

    /// Warp time forward by minutes
    pub fn warp_minutes(&mut self, minutes: u64) {
        self.warp_time((minutes * 60) as i64);
    }

    /// Get clock sysvar
    pub fn clock(&self) -> solana_clock::Clock {
        self.svm.get_sysvar::<solana_clock::Clock>()
    }

    /// Delete a snapshot to free memory
    pub fn delete_snapshot(&mut self, snapshot_id: u64) {
        self.snapshots.remove(&snapshot_id);
    }

    /// Clear all snapshots
    pub fn clear_snapshots(&mut self) {
        self.snapshots.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_warp_time() {
        let mut vm = Vm::new();
        let initial = vm.timestamp();

        vm.warp_time(100);
        assert_eq!(vm.timestamp(), initial + 100);
    }

    #[test]
    fn test_set_timestamp() {
        let mut vm = Vm::new();

        vm.set_timestamp(1000000);
        assert_eq!(vm.timestamp(), 1000000);
    }

    #[test]
    fn test_warp_slot() {
        let mut vm = Vm::new();

        vm.warp_slot(5000);
        assert_eq!(vm.slot(), 5000);
    }

    #[test]
    fn test_warp_days() {
        let mut vm = Vm::new();
        let initial = vm.timestamp();

        vm.warp_days(7);
        assert_eq!(vm.timestamp(), initial + 7 * 24 * 60 * 60);
    }
}
