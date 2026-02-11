use solana_client::rpc_client::RpcClient;

pub fn get_client() -> RpcClient {
    RpcClient::new(
        dotenv::var("ANCHOR_PROVIDER_MAINNET_URL")
            .unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".to_string()),
    )
}
