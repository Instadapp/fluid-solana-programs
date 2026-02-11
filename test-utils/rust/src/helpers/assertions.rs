use crate::helpers::tokens::TokenHelper;
use crate::{
    core::{accounts::AccountManager, vm::Vm},
    errors::VmError,
};
use solana_sdk::pubkey::Pubkey;

/// Result of an `expect_revert` check, containing details about the failure
#[derive(Debug, Clone)]
pub struct RevertInfo {
    /// The error that caused the revert
    pub error: String,
    /// The logs captured from the failed transaction
    pub logs: Vec<String>,
}

impl RevertInfo {
    /// Check if the error or logs contain the expected message
    pub fn contains(&self, message: &str) -> bool {
        self.error.contains(message) || self.logs.iter().any(|log| log.contains(message))
    }

    /// Check if the revert matches an Anchor error code
    pub fn has_error_code(&self, code: u32) -> bool {
        let code_str = code.to_string();
        self.contains(&code_str)
    }
}

/// Core assertion trait
pub trait Assertions {
    /// Assert SOL balance equals expected
    fn assert_balance_eq(&self, pubkey: &Pubkey, expected: u64);

    /// Assert SOL balance is greater than minimum
    fn assert_balance_gt(&self, pubkey: &Pubkey, minimum: u64);

    /// Assert SOL balance is less than maximum
    fn assert_balance_lt(&self, pubkey: &Pubkey, maximum: u64);

    /// Assert SOL balance is in range
    fn assert_balance_in_range(&self, pubkey: &Pubkey, min: u64, max: u64);

    /// Assert token balance equals expected
    fn assert_token_balance_eq(&self, owner: &Pubkey, mint: &Pubkey, expected: u64);

    /// Assert approximate equality with absolute delta
    fn assert_approx_eq(&self, actual: u128, expected: u128, delta: u128);

    /// Assert account exists
    fn assert_account_exists(&self, pubkey: &Pubkey);

    /// Assert account does not exist
    fn assert_account_not_exists(&self, pubkey: &Pubkey);
}

impl Assertions for Vm {
    fn assert_balance_eq(&self, pubkey: &Pubkey, expected: u64) {
        let actual = self.balance(pubkey);
        assert_eq!(
            actual, expected,
            "Balance mismatch for {}.\nExpected: {} lamports\nActual:   {} lamports",
            pubkey, expected, actual
        );
    }

    fn assert_balance_gt(&self, pubkey: &Pubkey, minimum: u64) {
        let actual = self.balance(pubkey);
        assert!(
            actual > minimum,
            "Balance {} is not greater than minimum {} for {}",
            actual,
            minimum,
            pubkey
        );
    }

    fn assert_balance_lt(&self, pubkey: &Pubkey, maximum: u64) {
        let actual = self.balance(pubkey);
        assert!(
            actual < maximum,
            "Balance {} is not less than maximum {} for {}",
            actual,
            maximum,
            pubkey
        );
    }

    fn assert_balance_in_range(&self, pubkey: &Pubkey, min: u64, max: u64) {
        let actual = self.balance(pubkey);
        assert!(
            actual >= min && actual <= max,
            "Balance {} is not in range [{}, {}] for {}",
            actual,
            min,
            max,
            pubkey
        );
    }

    fn assert_token_balance_eq(&self, owner: &Pubkey, mint: &Pubkey, expected: u64) {
        let actual = self.token_balance(owner, mint);
        assert_eq!(
            actual, expected,
            "Token balance mismatch for owner {} mint {}.\nExpected: {}\nActual:   {}",
            owner, mint, expected, actual
        );
    }

    fn assert_approx_eq(&self, actual: u128, expected: u128, delta: u128) {
        let diff = if actual > expected {
            actual - expected
        } else {
            expected - actual
        };

        assert!(
            diff <= delta,
            "Values not approximately equal.\nExpected: {}\nActual:   {}\nDiff:     {} (max allowed: {})",
            expected, actual, diff, delta
        );
    }

    fn assert_account_exists(&self, pubkey: &Pubkey) {
        assert!(
            self.account_exists(pubkey),
            "Account {} should exist but does not",
            pubkey
        );
    }

    fn assert_account_not_exists(&self, pubkey: &Pubkey) {
        assert!(
            !self.account_exists(pubkey),
            "Account {} should not exist but does",
            pubkey
        );
    }
}

/// Trait for types that can provide mutable access to an underlying [`Vm`]
pub trait VmAccess {
    fn vm_mut(&mut self) -> &mut Vm;
}

impl VmAccess for Vm {
    fn vm_mut(&mut self) -> &mut Vm {
        self
    }
}

/// Extension trait that provides `expect_revert` style assertions, similar to the TS test helpers.
pub trait ExpectRevertExt: VmAccess {
    /// Run `action` and assert that it reverts with one of the provided `expected_messages`.
    fn expect_revert<F, T, E>(&mut self, expected_messages: &[&str], action: F) -> RevertInfo
    where
        F: FnOnce(&mut Self) -> std::result::Result<T, E>,
        E: Into<VmError>,
    {
        self.expect_revert_any(expected_messages, action)
    }

    /// Run `action` and assert that it reverts with the provided `expected_message`.
    /// This is a convenience method for when you only need to check one message.
    fn expect_revert_with<F, T, E>(&mut self, expected_message: &str, action: F) -> RevertInfo
    where
        F: FnOnce(&mut Self) -> std::result::Result<T, E>,
        E: Into<VmError>,
    {
        self.expect_revert(&[expected_message], action)
    }

    /// Run `action` and assert that it reverts with the provided Anchor error code.
    ///
    /// # Example
    /// ```ignore
    /// fixture.expect_revert_code(6001, |f| {
    ///     f.operate(&protocol, 0, 0, MintKey::USDC, &alice)
    /// });
    /// ```
    fn expect_revert_code<F, T, E>(&mut self, error_code: u32, action: F) -> RevertInfo
    where
        F: FnOnce(&mut Self) -> std::result::Result<T, E>,
        E: Into<VmError>,
    {
        let code_str = error_code.to_string();
        self.expect_revert(&[&code_str], action)
    }

    /// Run `action` and assert it reverts with any of the provided `expected_messages`.
    fn expect_revert_any<F, T, E>(&mut self, expected_messages: &[&str], action: F) -> RevertInfo
    where
        F: FnOnce(&mut Self) -> std::result::Result<T, E>,
        E: Into<VmError>,
    {
        {
            let vm = self.vm_mut();
            vm.clear_last_error_logs();
        }

        let result = action(self);

        match result {
            Ok(_) => panic!(
                "Expected revert containing {:?}, but the call succeeded",
                expected_messages
            ),
            Err(err) => {
                let vm_error: VmError = err.into();

                let (matched, logs) = {
                    let vm = self.vm_mut();
                    let logs = vm.last_error_logs().cloned().unwrap_or_default();
                    let matched = expected_messages
                        .iter()
                        .any(|expected| vm.revert_matches(expected, &vm_error));
                    (matched, logs)
                };

                if !matched {
                    panic!(
                        "Expected revert containing {:?}, but got error: {}\nLogs:\n{}",
                        expected_messages,
                        vm_error,
                        logs.join("\n")
                    );
                }

                RevertInfo {
                    error: vm_error.to_string(),
                    logs,
                }
            }
        }
    }

    /// Run `action` and expect it to fail without checking the specific error.
    /// Returns the `RevertInfo` for further inspection.
    fn expect_fail<F, T, E>(&mut self, action: F) -> RevertInfo
    where
        F: FnOnce(&mut Self) -> std::result::Result<T, E>,
        E: Into<VmError>,
    {
        {
            let vm = self.vm_mut();
            vm.clear_last_error_logs();
        }

        let result = action(self);

        match result {
            Ok(_) => panic!("Expected action to fail, but it succeeded"),
            Err(err) => {
                let vm_error: VmError = err.into();
                let logs = {
                    let vm = self.vm_mut();
                    vm.last_error_logs().cloned().unwrap_or_default()
                };

                RevertInfo {
                    error: vm_error.to_string(),
                    logs,
                }
            }
        }
    }
}

impl<T> ExpectRevertExt for T where T: VmAccess {}

/// Extension trait for `Result` types to provide fluent expect_revert style assertions.
///
/// This allows you to call `.expect_revert_with()` directly on a `Result` from a fixture method.
///
/// # Example
/// ```ignore
/// fixture.operate(&protocol, 0, 0, MintKey::USDC, &alice)
///     .expect_revert_containing(&fixture.vm, "USER_MODULE_OPERATE_AMOUNTS_ZERO");
/// ```
pub trait ExpectRevertResultExt<T> {
    /// Assert that the result is an error containing the expected message.
    /// Uses the VM's error logs for matching.
    fn expect_revert_containing(self, vm: &Vm, expected_message: &str) -> RevertInfo;

    /// Assert that the result is an error containing any of the expected messages.
    fn expect_revert_containing_any(self, vm: &Vm, expected_messages: &[&str]) -> RevertInfo;

    /// Assert that the result is an error with the specified Anchor error code.
    fn expect_revert_with_code(self, vm: &Vm, error_code: u32) -> RevertInfo;

    /// Assert that the result is an error, returning the `RevertInfo` for further inspection.
    fn expect_failure(self, vm: &Vm) -> RevertInfo;
}

impl<T, E> ExpectRevertResultExt<T> for std::result::Result<T, E>
where
    E: Into<VmError>,
{
    fn expect_revert_containing(self, vm: &Vm, expected_message: &str) -> RevertInfo {
        self.expect_revert_containing_any(vm, &[expected_message])
    }

    fn expect_revert_containing_any(self, vm: &Vm, expected_messages: &[&str]) -> RevertInfo {
        match self {
            Ok(_) => panic!(
                "Expected revert containing {:?}, but the call succeeded",
                expected_messages
            ),
            Err(err) => {
                let vm_error: VmError = err.into();
                let logs = vm.last_error_logs().cloned().unwrap_or_default();

                let matched = expected_messages
                    .iter()
                    .any(|expected| vm.revert_matches(expected, &vm_error));

                if !matched {
                    panic!(
                        "Expected revert containing {:?}, but got error: {}\nLogs:\n{}",
                        expected_messages,
                        vm_error,
                        logs.join("\n")
                    );
                }

                RevertInfo {
                    error: vm_error.to_string(),
                    logs,
                }
            }
        }
    }

    fn expect_revert_with_code(self, vm: &Vm, error_code: u32) -> RevertInfo {
        self.expect_revert_containing(vm, &error_code.to_string())
    }

    fn expect_failure(self, vm: &Vm) -> RevertInfo {
        match self {
            Ok(_) => panic!("Expected action to fail, but it succeeded"),
            Err(err) => {
                let vm_error: VmError = err.into();
                let logs = vm.last_error_logs().cloned().unwrap_or_default();

                RevertInfo {
                    error: vm_error.to_string(),
                    logs,
                }
            }
        }
    }
}

impl Vm {
    pub fn assert_account_data_eq<
        T: anchor_lang::AnchorDeserialize + PartialEq + std::fmt::Debug,
    >(
        &self,
        pubkey: &Pubkey,
        expected: &T,
    ) {
        let actual: T = self
            .read_account_data(pubkey)
            .expect("Failed to read account data");
        assert_eq!(actual, *expected, "Account data mismatch for {}", pubkey);
    }

    pub fn assert_account_owner(&self, pubkey: &Pubkey, expected_owner: &Pubkey) {
        let account = self
            .get_account(pubkey)
            .expect(&format!("Account {} not found", pubkey));
        assert_eq!(
            account.owner, *expected_owner,
            "Account owner mismatch for {}.\nExpected: {}\nActual:   {}",
            pubkey, expected_owner, account.owner
        );
    }

    pub fn assert_token_balance_changed(
        &self,
        owner: &Pubkey,
        mint: &Pubkey,
        before: u64,
        expected_change: i64,
    ) {
        let after = self.token_balance(owner, mint);
        let expected = if expected_change >= 0 {
            before + expected_change as u64
        } else {
            before - (-expected_change) as u64
        };

        assert_eq!(
            after, expected,
            "Token balance change mismatch.\nBefore:    {}\nAfter:     {}\nExpected change: {}\nActual change:   {}",
            before,
            after,
            expected_change,
            after as i64 - before as i64
        );
    }

    pub fn assert_balance_changed(&self, pubkey: &Pubkey, before: u64, expected_change: i64) {
        let after = self.balance(pubkey);
        let expected = if expected_change >= 0 {
            before + expected_change as u64
        } else {
            before - (-expected_change) as u64
        };

        assert_eq!(
            after, expected,
            "SOL balance change mismatch for {}.\nBefore:    {}\nAfter:     {}\nExpected change: {}\nActual change:   {}",
            pubkey,
            before,
            after,
            expected_change,
            after as i64 - before as i64
        );
    }

    pub fn assert_logs_contain(&self, expected: &str) {
        let logs = self.last_tx_logs().expect("No transaction logs found");
        let found = logs.iter().any(|log| log.contains(expected));
        assert!(
            found,
            "Expected logs to contain '{}' but they didn't.\nLogs: {:?}",
            expected, logs
        );
    }

    pub fn assert_logs_not_contain(&self, unexpected: &str) {
        if let Some(logs) = self.last_tx_logs() {
            let found = logs.iter().any(|log| log.contains(unexpected));
            assert!(
                !found,
                "Expected logs NOT to contain '{}' but they did.\nLogs: {:?}",
                unexpected, logs
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_assert_balance() {
        let mut vm = Vm::new();
        let pubkey = Pubkey::new_unique();

        vm.airdrop(&pubkey, 1_000_000_000).unwrap();
        vm.assert_balance_eq(&pubkey, 1_000_000_000);
    }

    #[test]
    fn test_assert_approx_eq() {
        let vm = Vm::new();

        // Should pass - within delta
        vm.assert_approx_eq(1000, 1005, 10);

        // Should pass - exact match
        vm.assert_approx_eq(1000, 1000, 0);
    }

    #[test]
    #[should_panic(expected = "not approximately equal")]
    fn test_assert_approx_eq_fails() {
        let vm = Vm::new();
        vm.assert_approx_eq(1000, 1020, 10);
    }

    #[test]
    fn test_assert_account_exists() {
        let mut vm = Vm::new();
        let pubkey = Pubkey::new_unique();

        vm.airdrop(&pubkey, 1000).unwrap();
        vm.assert_account_exists(&pubkey);
    }

    #[test]
    fn test_expect_revert_on_vm() {
        let mut vm = Vm::new();
        let revert_info = vm.expect_revert(&["boom"], |_vm| -> std::result::Result<(), VmError> {
            Err(VmError::Custom("boom".into()))
        });
        assert!(revert_info.contains("boom"));
    }

    #[test]
    fn test_expect_revert_with() {
        let mut vm = Vm::new();
        let revert_info =
            vm.expect_revert_with("custom_error", |_vm| -> std::result::Result<(), VmError> {
                Err(VmError::Custom("custom_error: something went wrong".into()))
            });
        assert!(revert_info.contains("custom_error"));
    }

    #[test]
    fn test_expect_revert_code() {
        let mut vm = Vm::new();
        // Simulating an Anchor-style error code in the error message
        let revert_info = vm.expect_revert_code(6001, |_vm| -> std::result::Result<(), VmError> {
            Err(VmError::Custom("Error Code: 6001".into()))
        });
        assert!(revert_info.has_error_code(6001));
    }

    #[test]
    fn test_expect_fail() {
        let mut vm = Vm::new();
        let revert_info = vm.expect_fail(|_vm| -> std::result::Result<(), VmError> {
            Err(VmError::Custom("any error".into()))
        });
        assert!(revert_info.contains("any error"));
    }

    #[test]
    #[should_panic(expected = "Expected action to fail, but it succeeded")]
    fn test_expect_fail_panics_on_success() {
        let mut vm = Vm::new();
        vm.expect_fail(|_vm| -> std::result::Result<(), VmError> { Ok(()) });
    }

    #[test]
    fn test_expect_revert_result_ext() {
        let vm = Vm::new();
        let result: std::result::Result<(), VmError> =
            Err(VmError::Custom("USER_MODULE_PAUSED".into()));
        let revert_info = result.expect_revert_containing(&vm, "USER_MODULE_PAUSED");
        assert!(revert_info.contains("USER_MODULE_PAUSED"));
    }

    #[test]
    fn test_expect_revert_result_ext_with_code() {
        let vm = Vm::new();
        let result: std::result::Result<(), VmError> =
            Err(VmError::Custom("Error Code: 6027".into()));
        let revert_info = result.expect_revert_with_code(&vm, 6027);
        assert!(revert_info.has_error_code(6027));
    }

    #[test]
    #[should_panic(expected = "Expected revert containing")]
    fn test_expect_revert_wrong_message() {
        let mut vm = Vm::new();
        vm.expect_revert_with(
            "expected_error",
            |_vm| -> std::result::Result<(), VmError> {
                Err(VmError::Custom("different_error".into()))
            },
        );
    }

    #[test]
    fn test_revert_info_methods() {
        let revert_info = RevertInfo {
            error: "Custom error: 6001 happened".to_string(),
            logs: vec![
                "Program log: Processing instruction".to_string(),
                "Program log: Error: USER_MODULE_PAUSED".to_string(),
            ],
        };

        assert!(revert_info.contains("6001"));
        assert!(revert_info.contains("USER_MODULE_PAUSED"));
        assert!(revert_info.has_error_code(6001));
        assert!(!revert_info.contains("NOT_PRESENT"));
    }
}
