use crate::core::{accounts::AccountManager, vm::Vm};
use crate::errors::{Result, VmError};
use crate::internal::anchor_mainnet_rpc_url;
use solana_client::rpc_client::RpcClient;
use spl_token::solana_program::program_pack::Pack;
use solana_sdk::{
    account::Account,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
};
use spl_associated_token_account::get_associated_token_address;
use spl_token::state::{Account as TokenAccount, Mint};

/// Token management trait
pub trait TokenHelper {
    /// Create a new SPL token mint
    fn create_mint(&mut self, authority: &Pubkey, decimals: u8) -> Result<Pubkey>;

    /// Mint tokens to a user (creates ATA if needed)
    fn mint_tokens(&mut self, mint: &Pubkey, owner: &Pubkey, amount: u64) -> Result<()>;

    /// Get token balance for a user
    fn token_balance(&self, owner: &Pubkey, mint: &Pubkey) -> u64;

    /// Get ATA address
    fn get_ata(&self, owner: &Pubkey, mint: &Pubkey) -> Pubkey;

    /// Check if ATA exists
    fn ata_exists(&self, owner: &Pubkey, mint: &Pubkey) -> bool;

    /// Get mint info
    fn get_mint_info(&self, mint: &Pubkey) -> Result<MintInfo>;
}

/// Mint information
pub struct MintInfo {
    pub supply: u64,
    pub decimals: u8,
    pub mint_authority: Option<Pubkey>,
    pub freeze_authority: Option<Pubkey>,
}

impl TokenHelper for Vm {
    fn create_mint(&mut self, authority: &Pubkey, decimals: u8) -> Result<Pubkey> {
        let mint_keypair = Keypair::new();
        let mint_pubkey = mint_keypair.pubkey();

        // Create mint account data
        let mut data = vec![0u8; Mint::LEN];

        // Pack mint data
        let mint = Mint {
            mint_authority: solana_sdk::program_option::COption::Some(*authority),
            supply: 0,
            decimals,
            is_initialized: true,
            freeze_authority: solana_sdk::program_option::COption::None,
        };

        Mint::pack(mint, &mut data).map_err(|e| VmError::TokenError(e.to_string()))?;

        let account = Account {
            lamports: 1_000_000_000, // Rent exempt
            data,
            owner: spl_token::id(),
            executable: false,
            rent_epoch: 0,
        };

        self.set_account(&mint_pubkey, account)?;
        Ok(mint_pubkey)
    }

    fn mint_tokens(&mut self, mint: &Pubkey, owner: &Pubkey, amount: u64) -> Result<()> {
        let ata = get_associated_token_address(owner, mint);

        // Create token account data
        let mut data = vec![0u8; TokenAccount::LEN];

        let token_account = TokenAccount {
            mint: *mint,
            owner: *owner,
            amount,
            delegate: solana_sdk::program_option::COption::None,
            state: spl_token::state::AccountState::Initialized,
            is_native: solana_sdk::program_option::COption::None,
            delegated_amount: 0,
            close_authority: solana_sdk::program_option::COption::None,
        };

        TokenAccount::pack(token_account, &mut data)
            .map_err(|e| VmError::TokenError(e.to_string()))?;

        let account = Account {
            lamports: 1_000_000_000, // Rent exempt
            data,
            owner: spl_token::id(),
            executable: false,
            rent_epoch: 0,
        };

        self.set_account(&ata, account)?;
        Ok(())
    }

    fn token_balance(&self, owner: &Pubkey, mint: &Pubkey) -> u64 {
        let ata = get_associated_token_address(owner, mint);

        self.get_account(&ata)
            .and_then(|account| TokenAccount::unpack(&account.data).ok())
            .map(|ta| ta.amount)
            .unwrap_or(0)
    }

    fn get_ata(&self, owner: &Pubkey, mint: &Pubkey) -> Pubkey {
        get_associated_token_address(owner, mint)
    }

    fn ata_exists(&self, owner: &Pubkey, mint: &Pubkey) -> bool {
        let ata = get_associated_token_address(owner, mint);
        self.account_exists(&ata)
    }

    fn get_mint_info(&self, mint: &Pubkey) -> Result<MintInfo> {
        let account = self
            .get_account(mint)
            .ok_or_else(|| VmError::AccountNotFound(mint.to_string()))?;

        let mint_data: Mint =
            Mint::unpack(&account.data).map_err(|e| VmError::TokenError(e.to_string()))?;

        Ok(MintInfo {
            supply: mint_data.supply,
            decimals: mint_data.decimals,
            mint_authority: mint_data.mint_authority.into(),
            freeze_authority: mint_data.freeze_authority.into(),
        })
    }
}

impl Vm {
    /// Setup token mints by fetching their data from mainnet
    ///
    /// This fetches the actual mint account data from mainnet and saves it to the VM.
    /// Useful for fork testing with real token mints.
    pub fn setup_mints_from_mainnet(&mut self, mint_pubkeys: &[Pubkey]) -> Result<()> {
        if mint_pubkeys.is_empty() {
            return Ok(());
        }

        let rpc_url = anchor_mainnet_rpc_url()?;
        let client = RpcClient::new(rpc_url);

        // Fetch all accounts in a single batch request
        let accounts = client
            .get_multiple_accounts(mint_pubkeys)
            .map_err(|e| VmError::RpcError(e.to_string()))?;

        for (pubkey, maybe_account) in mint_pubkeys.iter().zip(accounts.into_iter()) {
            let account = maybe_account.ok_or_else(|| {
                VmError::AccountNotFound(format!("Mint account {} not found on mainnet", pubkey))
            })?;

            // Verify it's a valid mint account
            if account.owner != spl_token::id() {
                return Err(VmError::TokenError(format!(
                    "Account {} is not owned by SPL Token program",
                    pubkey
                )));
            }

            // Verify we can unpack it as a mint
            Mint::unpack(&account.data).map_err(|e| {
                VmError::TokenError(format!("Failed to unpack mint {}: {}", pubkey, e))
            })?;

            self.set_account(pubkey, account)?;
        }

        Ok(())
    }

    /// Setup a single token mint by fetching its data from mainnet
    pub fn setup_mint_from_mainnet(&mut self, mint_pubkey: &Pubkey) -> Result<()> {
        self.setup_mints_from_mainnet(&[*mint_pubkey])
    }

    /// Transfer tokens between accounts (direct state manipulation)
    pub fn transfer_tokens(
        &mut self,
        mint: &Pubkey,
        from_owner: &Pubkey,
        to_owner: &Pubkey,
        amount: u64,
    ) -> Result<()> {
        // Get source balance
        let from_balance = self.token_balance(from_owner, mint);
        if from_balance < amount {
            return Err(VmError::TokenError(format!(
                "Insufficient balance: {} < {}",
                from_balance, amount
            )));
        }

        // Update source
        self.mint_tokens(mint, from_owner, from_balance - amount)?;

        // Update destination
        let to_balance = self.token_balance(to_owner, mint);
        self.mint_tokens(mint, to_owner, to_balance + amount)?;

        Ok(())
    }

    /// Burn tokens from an account
    pub fn burn_tokens(&mut self, mint: &Pubkey, owner: &Pubkey, amount: u64) -> Result<()> {
        let balance = self.token_balance(owner, mint);
        if balance < amount {
            return Err(VmError::TokenError(format!(
                "Insufficient balance to burn: {} < {}",
                balance, amount
            )));
        }

        self.mint_tokens(mint, owner, balance - amount)
    }

    /// Get token account info
    pub fn get_token_account(&self, owner: &Pubkey, mint: &Pubkey) -> Result<TokenAccount> {
        let ata = get_associated_token_address(owner, mint);
        let account = self
            .get_account(&ata)
            .ok_or_else(|| VmError::AccountNotFound(ata.to_string()))?;

        TokenAccount::unpack(&account.data).map_err(|e| VmError::TokenError(e.to_string()))
    }
}

/// Mainnet token mints
pub mod mints {
    use solana_sdk::pubkey;
    use solana_sdk::pubkey::Pubkey;

    pub const USDC: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    pub const USDT: Pubkey = pubkey!("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
    pub const WSOL: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
    pub const EURC: Pubkey = pubkey!("HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr");
}

/// Token mint enum for easier handling
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MintKey {
    USDC,
    USDT,
    WSOL,
    EURC,
}

impl MintKey {
    pub fn pubkey(&self) -> Pubkey {
        match self {
            MintKey::USDC => mints::USDC,
            MintKey::USDT => mints::USDT,
            MintKey::WSOL => mints::WSOL,
            MintKey::EURC => mints::EURC,
        }
    }

    pub fn decimals(&self) -> u8 {
        match self {
            MintKey::USDC => 6,
            MintKey::USDT => 6,
            MintKey::WSOL => 9,
            MintKey::EURC => 6,
        }
    }

    pub fn all() -> Vec<MintKey> {
        vec![MintKey::USDC, MintKey::USDT, MintKey::WSOL, MintKey::EURC]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_mint() {
        let mut vm = Vm::new();
        let authority = Pubkey::new_unique();

        let mint = vm.create_mint(&authority, 6).unwrap();
        let info = vm.get_mint_info(&mint).unwrap();

        assert_eq!(info.decimals, 6);
        assert_eq!(info.supply, 0);
    }

    #[test]
    fn test_mint_tokens() {
        let mut vm = Vm::new();
        let authority = Pubkey::new_unique();
        let user = Pubkey::new_unique();

        let mint = vm.create_mint(&authority, 6).unwrap();
        vm.mint_tokens(&mint, &user, 1_000_000).unwrap();

        assert_eq!(vm.token_balance(&user, &mint), 1_000_000);
    }

    #[test]
    fn test_transfer_tokens() {
        let mut vm = Vm::new();
        let authority = Pubkey::new_unique();
        let alice = Pubkey::new_unique();
        let bob = Pubkey::new_unique();

        let mint = vm.create_mint(&authority, 6).unwrap();
        vm.mint_tokens(&mint, &alice, 1_000_000).unwrap();

        vm.transfer_tokens(&mint, &alice, &bob, 500_000).unwrap();

        assert_eq!(vm.token_balance(&alice, &mint), 500_000);
        assert_eq!(vm.token_balance(&bob, &mint), 500_000);
    }
}
