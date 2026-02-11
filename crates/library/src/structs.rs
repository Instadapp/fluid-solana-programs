use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AddressBool {
    pub addr: Pubkey,
    pub value: bool,
}

pub struct TokenTransferParams<'a, 'info> {
    /// The source account
    pub source: AccountInfo<'info>,
    /// The destination account
    pub destination: AccountInfo<'info>,
    /// The authority/owner of the source account
    pub authority: AccountInfo<'info>,
    /// The amount to transfer
    pub amount: u64,
    /// The token program
    pub token_program: AccountInfo<'info>,
    /// Optional signer seeds for PDA transfers
    pub signer_seeds: Option<&'a [&'a [&'a [u8]]]>,

    /// The mint account
    pub mint: InterfaceAccount<'info, Mint>,
}
