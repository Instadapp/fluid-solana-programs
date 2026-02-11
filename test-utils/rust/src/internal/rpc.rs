//! RPC URL helpers

use crate::errors::Result;

pub fn anchor_mainnet_rpc_url() -> Result<String> {
    let rpc_url = dotenv::var("ANCHOR_PROVIDER_MAINNET_URL")
        .unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".to_string());
    // let rpc_url = "https://api.mainnet-beta.solana.com".to_string();
    Ok(rpc_url)
}
