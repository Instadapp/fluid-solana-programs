//! Type conversions between solana-sdk and litesvm

use solana_account::Account as LiteAccount;
use solana_instruction::{AccountMeta as LiteInstructionMeta, Instruction as LiteInstruction};
use solana_message::AddressLookupTableAccount as SdkAddressLookupTableAccount;
use solana_pubkey::Pubkey as LitePubkey;
use solana_sdk::{
    account::Account, address_lookup_table::AddressLookupTableAccount,
    instruction::Instruction as SdkInstruction, pubkey::Pubkey,
};

pub fn to_lite_pubkey(pubkey: &Pubkey) -> LitePubkey {
    LitePubkey::from(pubkey.to_bytes())
}

pub fn from_lite_pubkey(pubkey: &LitePubkey) -> Pubkey {
    Pubkey::from(pubkey.to_bytes())
}

pub fn to_lite_account(account: Account) -> LiteAccount {
    LiteAccount {
        lamports: account.lamports,
        data: account.data,
        owner: to_lite_pubkey(&account.owner),
        executable: account.executable,
        rent_epoch: account.rent_epoch,
    }
}

pub fn from_lite_account(account: LiteAccount) -> Account {
    Account {
        lamports: account.lamports,
        data: account.data,
        owner: from_lite_pubkey(&account.owner),
        executable: account.executable,
        rent_epoch: account.rent_epoch,
    }
}

pub fn to_lite_instruction(ix: SdkInstruction) -> LiteInstruction {
    LiteInstruction {
        program_id: to_lite_pubkey(&ix.program_id),
        accounts: ix
            .accounts
            .into_iter()
            .map(|acc| LiteInstructionMeta {
                pubkey: to_lite_pubkey(&acc.pubkey),
                is_signer: acc.is_signer,
                is_writable: acc.is_writable,
            })
            .collect(),
        data: ix.data,
    }
}

/// Convert SDK AddressLookupTableAccount to the solana_message version
pub fn to_sdk_address_lookup_table_account(
    alt: &AddressLookupTableAccount,
) -> SdkAddressLookupTableAccount {
    SdkAddressLookupTableAccount {
        key: to_lite_pubkey(&alt.key),
        addresses: alt.addresses.iter().map(|p| to_lite_pubkey(p)).collect(),
    }
}
