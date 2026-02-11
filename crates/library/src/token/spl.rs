use anchor_lang::prelude::*;

use crate::{errors::ErrorCodes, structs::TokenTransferParams};
use anchor_spl::token::{self};
use anchor_spl::token_interface::{self, Mint, TokenAccount, TransferChecked};
use anchor_spl::{
    token::spl_token,
    token_2022::spl_token_2022,
    token_interface::spl_token_2022::extension::{
        BaseStateWithExtensions, ExtensionType, StateWithExtensions,
    },
};

pub fn balance_of(token_account: &AccountInfo) -> Result<u64> {
    let amount = token::accessor::amount(token_account)?;
    Ok(amount)
}

pub fn decimals(token_account: &Mint) -> Result<u8> {
    let decimals = token_account.decimals;
    Ok(decimals)
}

pub fn total_supply(token_account: &Mint) -> Result<u64> {
    let total_supply = token_account.supply;
    Ok(total_supply)
}

pub fn transfer_spl_tokens(params: TokenTransferParams) -> Result<()> {
    let TokenTransferParams {
        source,
        destination,
        authority,
        amount,
        token_program,
        signer_seeds,
        mint,
    } = params;

    let decimals = decimals(&mint)?;

    let transfer_accounts = TransferChecked {
        from: source.clone(),
        to: destination.clone(),
        authority: authority.clone(),
        mint: mint.to_account_info(),
    };

    if let Some(seeds) = signer_seeds {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(token_program.clone(), transfer_accounts, seeds),
            amount,
            decimals,
        )?
    } else {
        token_interface::transfer_checked(
            CpiContext::new(token_program.clone(), transfer_accounts),
            amount,
            decimals,
        )?
    }

    Ok(())
}

const WHITELISTED_EXTENSIONS: &[ExtensionType] = &[
    ExtensionType::MetadataPointer,
    ExtensionType::TransferFeeConfig,
    ExtensionType::TokenMetadata,
    ExtensionType::TransferHook,
    ExtensionType::DefaultAccountState,
    ExtensionType::ConfidentialTransferFeeConfig,
    ExtensionType::ConfidentialTransferMint,
    ExtensionType::PermanentDelegate,
    ExtensionType::MintCloseAuthority,
];

fn validate_token_extensions_2022(mint: &AccountInfo) -> Result<()> {
    let mint_data = mint.data.borrow();
    let mint = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&mint_data)?;

    for mint_ext in mint.get_extension_types()? {
        if !WHITELISTED_EXTENSIONS.contains(&mint_ext) {
            return err!(ErrorCodes::LibraryUnsupportedTokenExtension);
        }

        match mint_ext {
            ExtensionType::TransferFeeConfig => {
                let ext = mint
                    .get_extension::<spl_token_2022::extension::transfer_fee::TransferFeeConfig>(
                    )?;
                if <u16>::from(ext.older_transfer_fee.transfer_fee_basis_points) != 0
                    || <u16>::from(ext.newer_transfer_fee.transfer_fee_basis_points) != 0
                {
                    return err!(ErrorCodes::LibraryUnsupportedTokenExtension);
                }
            }
            ExtensionType::TransferHook => {
                let ext =
                    mint.get_extension::<spl_token_2022::extension::transfer_hook::TransferHook>()?;
                let hook_program_id: Option<Pubkey> = ext.program_id.into();
                if hook_program_id.is_some() {
                    return err!(ErrorCodes::LibraryUnsupportedTokenExtension);
                }
            }
            ExtensionType::DefaultAccountState => {
                let ext = mint.get_extension::<spl_token_2022::extension::default_account_state::DefaultAccountState>()?;
                if ext.state != spl_token_2022::state::AccountState::Initialized as u8 {
                    return err!(ErrorCodes::LibraryUnsupportedTokenExtension);
                }
            }
            _ => {}
        }
    }
    Ok(())
}

pub fn check_for_token_extensions_only_mint(mint: &InterfaceAccount<'_, Mint>) -> Result<()> {
    let mint_info = mint.to_account_info();

    // If the mint belongs to legacy SPL token program, we don't need to validate extensions
    if mint_info.owner == &spl_token::ID {
        return Ok(());
    }

    // Mint is owned by token program 2022
    // Reject token program 2022 WSOL mint
    if spl_token_2022::native_mint::check_id(&mint.key()) {
        return err!(ErrorCodes::LibraryInvalidTokenMint);
    }

    validate_token_extensions_2022(&mint_info)
}

pub fn check_for_token_extensions(
    mint: &InterfaceAccount<'_, Mint>,
    token_account: &InterfaceAccount<'_, TokenAccount>,
) -> Result<()> {
    let mint_info = mint.to_account_info();

    // If the mint belongs to legacy SPL token program, we don't need to validate extensions
    if mint_info.owner == &spl_token::ID {
        return Ok(());
    }

    // Mint is owned by token program 2022
    // Reject token program 2022 WSOL mint
    if spl_token_2022::native_mint::check_id(&mint.key()) {
        return err!(ErrorCodes::LibraryInvalidTokenMint);
    }

    let token_acc_info = token_account.to_account_info();
    // If the token account belongs to legacy SPL token program, that means token account does not belong to legacy SPL token program
    if token_acc_info.owner == &spl_token::ID {
        return Err(error!(ErrorCodes::LibraryInvalidTokenAccount));
    }

    validate_token_extensions_2022(&mint_info)
}
