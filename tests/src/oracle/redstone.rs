#[cfg(test)]
mod tests {
    use anchor_lang::prelude::*;
    use solana_program::account_info::AccountInfo;
    #[allow(deprecated)]
    use solana_program::borsh0_10::try_from_slice_unchecked;
    use std::str::FromStr;

    use crate::addresses::addresses::REDSTONE_FEED_ADDRESS;
    use crate::connection::get_client;
    use oracle::state::schema::{RedstoneFeed, U256_BYTE_SIZE, U64_START_INDEX};

    #[tokio::test(flavor = "multi_thread")]
    async fn test_redstone_feed_deserialization(
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        let client = get_client();

        let redstone_feed_pubkey = Pubkey::from_str(REDSTONE_FEED_ADDRESS)
            .map_err(|e| format!("Failed to parse Redstone feed address: {}", e))?;

        let account_data = client
            .get_account_data(&redstone_feed_pubkey)
            .map_err(|e| format!("Failed to fetch account data from chain: {}", e))?;

        println!("Account data length: {} bytes", account_data.len());

        #[allow(deprecated)]
        let redstone_feed: RedstoneFeed =
            try_from_slice_unchecked::<RedstoneFeed>(&account_data[8..])
                .map_err(|e| format!("Failed to deserialize Redstone feed state: {}", e))?;

        print_redstone_feed_info(&redstone_feed);

        Ok(())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_redstone_feed_deserialization_with_account_info(
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        let client = get_client();

        let redstone_feed_pubkey = Pubkey::from_str(REDSTONE_FEED_ADDRESS)
            .map_err(|e| format!("Failed to parse Redstone feed address: {}", e))?;

        let mut account_data = client
            .get_account_data(&redstone_feed_pubkey)
            .map_err(|e| format!("Failed to fetch account data from chain: {}", e))?;

        let owner = Pubkey::default();
        let mut lamports: u64 = 0;

        let account_info = AccountInfo::new(
            &redstone_feed_pubkey,
            false,
            false,
            &mut lamports,
            account_data.as_mut_slice(),
            &owner,
            false,
            0,
        );

        #[allow(deprecated)]
        let redstone_feed =
            try_from_slice_unchecked::<RedstoneFeed>(&account_info.data.borrow()[8..])?;

        print_redstone_feed_info(&redstone_feed);

        Ok(())
    }

    fn print_redstone_feed_info(feed: &RedstoneFeed) {
        println!("\n=== Redstone Feed Information ===");
        println!("Feed ID: {:?}", feed.feed_id);
        println!("Value (raw bytes): {:?}", feed.value);

        if let Ok(price) = get_price(&feed.value) {
            println!("Parsed Price Value: {}", price);
        } else {
            println!("Failed to parse price value");
        }

        println!("Timestamp: {}", feed.timestamp);
        println!("Write Timestamp: {:?}", feed.write_timestamp);
        println!("Write Slot Number: {}", feed.write_slot_number);
        println!("Decimals: {}", feed.decimals);
        println!("=================================\n");
    }

    fn get_price(raw_be_value: &[u8; U256_BYTE_SIZE]) -> std::result::Result<u128, String> {
        if !raw_be_value.iter().take(U64_START_INDEX).all(|&v| v == 0) {
            return Err("Price value overflow - non-zero bytes in upper portion".to_string());
        }

        let value = u64::from_be_bytes(raw_be_value[U64_START_INDEX..].try_into().unwrap());

        Ok(value as u128)
    }
}
