pub mod builder;
pub mod core;
pub mod errors;
pub mod fork;
pub mod helpers;

mod internal;

pub mod prelude {
    pub use crate::builder::{ProgramArtifact, VmBuilder};
    pub use crate::core::{AccountManager, Snapshot, StateManager, TransactionBuilder, Vm};
    pub use crate::errors::*;
    pub use crate::fork::ForkProvider;
    pub use crate::helpers::{
        Assertions, BaseFixture, ExpectRevertExt, ExpectRevertResultExt, LookupTableHelper,
        LookupTableManager, ProgramFixture, RevertInfo, TokenHelper, VmAccess,
    };
    pub use crate::internal::{anchor_mainnet_rpc_url, get_compute_units};

    pub use solana_sdk::{
        address_lookup_table::program::ID as ADDRESS_LOOKUP_TABLE_PROGRAM_ID,
        pubkey::Pubkey,
        signature::{Keypair, Signer},
        system_program,
    };

    pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

    /// Time constants for convenience
    pub mod time {
        pub const SECOND: i64 = 1;
        pub const MINUTE: i64 = 60;
        pub const HOUR: i64 = 3600;
        pub const DAY: i64 = 86400;
        pub const WEEK: i64 = 604800;
        pub const YEAR: i64 = 31536000;
    }
}

pub use core::{AccountManager, StateManager, TransactionBuilder, Vm};
pub use errors::{Result, VmError};
pub use fork::ForkProvider;
pub use helpers::{BaseFixture, LookupTableHelper, LookupTableManager, ProgramFixture};
pub use internal::{anchor_mainnet_rpc_url, get_compute_units};
