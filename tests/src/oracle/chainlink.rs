#[cfg(test)]
mod tests {
    use anchor_lang::prelude::*;
    #[allow(deprecated)]
    use std::str::FromStr;

    use chainlink_solana::v2::read_feed_v2;
    use std::cell::RefCell;

    use crate::addresses::addresses::CHAINLINK_FEED_ADDRESS;
    use crate::connection::get_client;

    #[tokio::test(flavor = "multi_thread")]
    async fn test_chainlink_sdk() -> std::result::Result<(), Box<dyn std::error::Error>> {
        let client = get_client();

        let chainlink_feed_pubkey = Pubkey::from_str(CHAINLINK_FEED_ADDRESS)
            .map_err(|e| format!("Failed to parse Chainlink feed address: {}", e))?;

        let mut account_data = client
            .get_account_data(&chainlink_feed_pubkey)
            .map_err(|e| format!("Failed to fetch account data from chain: {}", e))?;

        let owner: Pubkey = pubkey!("HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny");

        println!("Account data length: {} bytes", account_data.len());
        println!("Account data: {:?}", account_data);

        let cell = RefCell::new(&mut account_data[..]);
        let chainlink_feed = read_feed_v2(cell.borrow(), owner.to_bytes())
            .map_err(|e| format!("Failed to read Chainlink feed: {}", e))?;

        println!("chainlink_feed: {:?}", chainlink_feed.decimals());

        let latest_round_data = chainlink_feed.latest_round_data().unwrap();

        println!("price: {:?}", latest_round_data.answer);
        println!("timestamp: {:?}", latest_round_data.timestamp);
        println!("slot: {:?}", latest_round_data.slot);
        println!("round id: {:?}", latest_round_data.round_id);

        Ok(())
    }
}
