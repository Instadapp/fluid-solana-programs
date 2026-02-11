use thiserror::Error;

pub type Result<T> = std::result::Result<T, VmError>;

/// Framework error types
#[derive(Error, Debug)]
pub enum VmError {
    #[error("Account not found: {0}")]
    AccountNotFound(String),

    #[error("Failed to set account: {0}")]
    SetAccountFailed(String),

    #[error("Airdrop failed: {0}")]
    AirdropFailed(String),

    #[error("Transaction failed: {0}")]
    TransactionFailed(String),

    #[error("Transaction simulation failed: {0}")]
    SimulationFailed(String),

    #[error("Program deployment failed: {0}")]
    DeploymentFailed(String),

    #[error("Deserialization failed: {0}")]
    DeserializeFailed(String),

    #[error("Serialization failed: {0}")]
    SerializeFailed(String),

    #[error("Snapshot not found: {0}")]
    SnapshotNotFound(u64),

    #[error("Fork error: {0}")]
    ForkError(String),

    #[error("RPC error: {0}")]
    RpcError(String),

    #[error("No signers provided")]
    NoSigners,

    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),

    #[error("PDA derivation failed: {0}")]
    PdaDerivationFailed(String),

    #[error("Token operation failed: {0}")]
    TokenError(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Anchor error: {0}")]
    AnchorError(String),

    #[error("Custom error: {0}")]
    Custom(String),

    #[error("Program not found: {0}")]
    ProgramNotFound(String),
}

impl From<solana_client::client_error::ClientError> for VmError {
    fn from(err: solana_client::client_error::ClientError) -> Self {
        VmError::RpcError(err.to_string())
    }
}

impl From<anchor_lang::error::Error> for VmError {
    fn from(err: anchor_lang::error::Error) -> Self {
        VmError::AnchorError(err.to_string())
    }
}

impl From<litesvm::types::FailedTransactionMetadata> for VmError {
    fn from(err: litesvm::types::FailedTransactionMetadata) -> Self {
        VmError::TransactionFailed(format!("{:?}", err))
    }
}

impl From<bincode::Error> for VmError {
    fn from(err: bincode::Error) -> Self {
        VmError::DeserializeFailed(err.to_string())
    }
}

pub trait ResultExt<T> {
    fn context(self, msg: &str) -> Result<T>;
}

impl<T, E: std::fmt::Display> ResultExt<T> for std::result::Result<T, E> {
    fn context(self, msg: &str) -> Result<T> {
        self.map_err(|e| VmError::Custom(format!("{}: {}", msg, e)))
    }
}
