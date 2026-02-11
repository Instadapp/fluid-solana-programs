use litesvm::LiteSVM;
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    instruction::Instruction as SdkInstruction,
    pubkey::Pubkey as SdkPubkey,
    signature::{Keypair, Signer},
};
use std::fmt;

use solana_account::Account as LiteAccount;
use solana_message::{Message as LiteMessage, VersionedMessage as LiteVersionedMessage};
use solana_pubkey::Pubkey as LitePubkey;
use solana_transaction::versioned::VersionedTransaction as LiteVersionedTransaction;

pub use litesvm::types::FailedTransactionMetadata;

#[derive(Debug)]
pub struct LiteSvmError(pub String);

impl fmt::Display for LiteSvmError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for LiteSvmError {}

impl From<std::io::Error> for LiteSvmError {
    fn from(err: std::io::Error) -> Self {
        LiteSvmError(format!("IO error: {}", err))
    }
}

impl From<solana_client::client_error::ClientError> for LiteSvmError {
    fn from(err: solana_client::client_error::ClientError) -> Self {
        LiteSvmError(format!("RPC client error: {}", err))
    }
}

impl From<litesvm::types::FailedTransactionMetadata> for LiteSvmError {
    fn from(err: litesvm::types::FailedTransactionMetadata) -> Self {
        LiteSvmError(format!("Transaction failed: {:?}", err))
    }
}

impl From<solana_sdk::transport::TransportError> for LiteSvmError {
    fn from(err: solana_sdk::transport::TransportError) -> Self {
        LiteSvmError(format!("Transport error: {}", err))
    }
}

pub type Result<T> = std::result::Result<T, LiteSvmError>;

pub fn to_lite_pubkey(pubkey: &SdkPubkey) -> LitePubkey {
    LitePubkey::from(pubkey.to_bytes())
}

pub fn to_lite_account(account: solana_sdk::account::Account) -> LiteAccount {
    LiteAccount {
        lamports: account.lamports,
        data: account.data,
        owner: to_lite_pubkey(&account.owner),
        executable: account.executable,
        rent_epoch: account.rent_epoch,
    }
}

pub fn to_lite_instruction(ix: SdkInstruction) -> solana_instruction::Instruction {
    solana_instruction::Instruction {
        program_id: to_lite_pubkey(&ix.program_id),
        accounts: ix
            .accounts
            .into_iter()
            .map(|acc| solana_instruction::AccountMeta {
                pubkey: to_lite_pubkey(&acc.pubkey),
                is_signer: acc.is_signer,
                is_writable: acc.is_writable,
            })
            .collect(),
        data: ix.data,
    }
}

pub async fn setup_with_mainnet_accounts(
    rpc_url: &str,
    account_addresses: Vec<SdkPubkey>,
) -> Result<LiteSVM> {
    let client = RpcClient::new(rpc_url.to_string());
    let mut svm = LiteSVM::new();

    for address in account_addresses {
        match client.get_account(&address) {
            Ok(rpc_account) => {
                if rpc_account.executable {
                    let bpf_loader_upgradeable = solana_sdk::bpf_loader_upgradeable::id();

                    if rpc_account.owner == bpf_loader_upgradeable {
                        if let Ok(program_state) = bincode::deserialize::<
                            solana_sdk::bpf_loader_upgradeable::UpgradeableLoaderState,
                        >(&rpc_account.data)
                        {
                            if let solana_sdk::bpf_loader_upgradeable::UpgradeableLoaderState::Program { programdata_address } = program_state {
                                match client.get_account(&programdata_address) {
                                    Ok(programdata_account) => {
                                        // Program data starts after the metadata (45 bytes)
                                        const PROGRAMDATA_METADATA_SIZE: usize = 45;
                                        if programdata_account.data.len() > PROGRAMDATA_METADATA_SIZE {
                                            let bytecode = &programdata_account.data[PROGRAMDATA_METADATA_SIZE..];
                                            add_program(&mut svm, &address, bytecode)?;
                                        } else {
                                            return Err(LiteSvmError(format!("Invalid program data size for {}", address)));
                                        }
                                    }
                                    Err(e) => {
                                        return Err(LiteSvmError(format!("Failed to fetch program data for {}: {}", address, e)));
                                    }
                                }
                            }
                        }
                    } else {
                        add_program(&mut svm, &address, &rpc_account.data)?;
                    }
                } else {
                    let lite_account = to_lite_account(rpc_account);
                    let lite_address = to_lite_pubkey(&address);
                    svm.set_account(lite_address, lite_account).map_err(|e| {
                        LiteSvmError(format!("Failed to set account {}: {:?}", address, e))
                    })?;
                }
            }

            Err(e) => {
                println!("  ✗ Failed to clone account {}: {}", address, e);
                return Err(LiteSvmError(format!(
                    "Failed to fetch account {}: {}",
                    address, e
                )));
            }
        }
    }

    Ok(svm)
}

pub fn add_program_from_file(
    svm: &mut LiteSVM,
    program_id: &SdkPubkey,
    file_path: &str,
) -> Result<()> {
    let program_data = std::fs::read(file_path)
        .map_err(|e| LiteSvmError(format!("Failed to read program file {}: {}", file_path, e)))?;
    add_program(svm, program_id, &program_data)
}

pub fn add_program(svm: &mut LiteSVM, program_id: &SdkPubkey, program_bytes: &[u8]) -> Result<()> {
    let lite_program_id = to_lite_pubkey(program_id);
    svm.add_program(lite_program_id, program_bytes)
        .map_err(|e| LiteSvmError(format!("Failed to add program {}: {:?}", program_id, e)))?;
    Ok(())
}

pub fn airdrop(svm: &mut LiteSVM, pubkey: &SdkPubkey, lamports: u64) -> Result<()> {
    let lite_pubkey = to_lite_pubkey(pubkey);
    svm.airdrop(&lite_pubkey, lamports).map_err(|e| {
        LiteSvmError(format!(
            "Failed to airdrop {} lamports to {}: {:?}",
            lamports, pubkey, e
        ))
    })?;
    Ok(())
}

pub fn send_transaction(
    svm: &mut LiteSVM,
    instruction: SdkInstruction,
    payer: &Keypair,
    signers: &[&Keypair],
) -> Result<litesvm::types::TransactionMetadata> {
    let recent_blockhash = svm.latest_blockhash();
    let lite_instruction = to_lite_instruction(instruction);
    let lite_payer = to_lite_pubkey(&payer.pubkey());

    let message =
        LiteMessage::new_with_blockhash(&[lite_instruction], Some(&lite_payer), &recent_blockhash);
    let versioned_message = LiteVersionedMessage::Legacy(message);

    let lite_signers: Vec<solana_keypair::Keypair> = signers
        .iter()
        .map(|s| solana_keypair::Keypair::try_from(&s.to_bytes()[..]).unwrap())
        .collect();

    let lite_signer_refs: Vec<&solana_keypair::Keypair> = lite_signers.iter().collect();

    let tx = LiteVersionedTransaction::try_new(versioned_message, &lite_signer_refs)
        .map_err(|e| LiteSvmError(format!("Failed to create transaction: {}", e)))?;

    let result = svm
        .send_transaction(tx)
        .map_err(|e| LiteSvmError(format!("Transaction failed: {:?}", e)))?;

    Ok(result)
}

pub fn send_transaction_with_instructions(
    svm: &mut LiteSVM,
    instructions: Vec<SdkInstruction>,
    payer: &Keypair,
    signers: &[&Keypair],
) -> Result<()> {
    let recent_blockhash = svm.latest_blockhash();
    let lite_instructions: Vec<_> = instructions.into_iter().map(to_lite_instruction).collect();
    let lite_payer = to_lite_pubkey(&payer.pubkey());

    let message =
        LiteMessage::new_with_blockhash(&lite_instructions, Some(&lite_payer), &recent_blockhash);
    let versioned_message = LiteVersionedMessage::Legacy(message);

    let lite_signers: Vec<solana_keypair::Keypair> = signers
        .iter()
        .map(|s| solana_keypair::Keypair::try_from(&s.to_bytes()[..]).unwrap())
        .collect();

    let lite_signer_refs: Vec<&solana_keypair::Keypair> = lite_signers.iter().collect();

    let tx = LiteVersionedTransaction::try_new(versioned_message, &lite_signer_refs)
        .map_err(|e| LiteSvmError(format!("Failed to create transaction: {}", e)))?;

    svm.send_transaction(tx)
        .map_err(|e| LiteSvmError(format!("Transaction failed: {:?}", e)))?;

    Ok(())
}

pub fn simulate_transaction(
    svm: &mut LiteSVM,
    instruction: SdkInstruction,
    payer: &Keypair,
    signers: &[&Keypair],
) -> Result<litesvm::types::SimulatedTransactionInfo> {
    let recent_blockhash = svm.latest_blockhash();
    let lite_instruction = to_lite_instruction(instruction);
    let lite_payer = to_lite_pubkey(&payer.pubkey());

    let message =
        LiteMessage::new_with_blockhash(&[lite_instruction], Some(&lite_payer), &recent_blockhash);
    let versioned_message = LiteVersionedMessage::Legacy(message);

    let lite_signers: Vec<solana_keypair::Keypair> = signers
        .iter()
        .map(|s| solana_keypair::Keypair::try_from(&s.to_bytes()[..]).unwrap())
        .collect();

    let lite_signer_refs: Vec<&solana_keypair::Keypair> = lite_signers.iter().collect();

    let tx = LiteVersionedTransaction::try_new(versioned_message, &lite_signer_refs)
        .map_err(|e| LiteSvmError(format!("Failed to create transaction: {}", e)))?;

    let result = svm
        .simulate_transaction(tx)
        .map_err(|e| LiteSvmError(format!("Simulation failed: {:?}", e)))?;

    Ok(result)
}

pub fn get_account(svm: &LiteSVM, pubkey: &SdkPubkey) -> Option<LiteAccount> {
    let lite_pubkey = to_lite_pubkey(pubkey);
    svm.get_account(&lite_pubkey)
}

pub fn account_exists(svm: &LiteSVM, pubkey: &SdkPubkey) -> bool {
    get_account(svm, pubkey).is_some()
}

pub fn get_balance(svm: &LiteSVM, pubkey: &SdkPubkey) -> u64 {
    get_account(svm, pubkey)
        .map(|acc| acc.lamports)
        .unwrap_or(0)
}

pub fn create_funded_keypair(svm: &mut LiteSVM, lamports: u64) -> Result<Keypair> {
    let keypair = Keypair::new();
    airdrop(svm, &keypair.pubkey(), lamports)?;
    Ok(keypair)
}

pub fn load_oracle_program(svm: &mut LiteSVM, program_id: &SdkPubkey) -> Result<()> {
    let program_path = if std::path::Path::new("../target/deploy/oracle.so").exists() {
        "../target/deploy/oracle.so"
    } else if std::path::Path::new("target/deploy/oracle.so").exists() {
        "target/deploy/oracle.so"
    } else {
        return Err(LiteSvmError(
            "Oracle program not found. Run 'anchor build' first.".to_string(),
        ));
    };

    add_program_from_file(svm, program_id, program_path)
}

pub fn set_block_timestamp(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut clock = svm.get_sysvar::<solana_clock::Clock>();
    clock.unix_timestamp = unix_timestamp;
    svm.set_sysvar::<solana_clock::Clock>(&clock);
}

pub fn warp_time_forward(svm: &mut LiteSVM, seconds: i64) {
    let mut clock = svm.get_sysvar::<solana_clock::Clock>();
    clock.unix_timestamp += seconds;
    svm.set_sysvar::<solana_clock::Clock>(&clock);
}

pub fn get_block_timestamp(svm: &LiteSVM) -> i64 {
    let clock = svm.get_sysvar::<solana_clock::Clock>();
    clock.unix_timestamp
}

pub fn warp_to_slot(svm: &mut LiteSVM, slot: u64) {
    svm.warp_to_slot(slot);
}

pub fn get_current_slot(svm: &LiteSVM) -> u64 {
    let clock = svm.get_sysvar::<solana_clock::Clock>();
    clock.slot
}
