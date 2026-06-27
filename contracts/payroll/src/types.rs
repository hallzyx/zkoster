use soroban_sdk::{contracttype, Address, BytesN};

/// Lifecycle of a payroll batch (PRD §10).
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BatchStatus {
    Draft = 0,
    Reviewed = 1,
    Approved = 2,
    Funded = 3,
    Processing = 4,
    Paid = 5,
    PartiallyFlagged = 6,
    Closed = 7,
}

/// Lifecycle of an individual payout (PRD §10).
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayoutStatus {
    Pending = 0,
    Ready = 1,
    Submitted = 2,
    Paid = 3,
    Failed = 4,
    Flagged = 5,
    Disclosed = 6,
}

/// One company workspace's wiring and treasury config.
///
/// MIGRATION NOTE: The `spp_pool` field was added as part of the SPP bridge
/// (spp-transfer change). Any previously stored `Config` value (before this
/// change) will fail to deserialize — Soroban does NOT auto-default new fields
/// for existing on-chain data. A fresh redeploy + `initialize` is required (T-05).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    pub admin: Address,
    pub treasury: Address,
    /// Stellar Asset Contract address used for settlement (e.g. USDC).
    pub asset: Address,
    pub compliance: Address,
    pub verifier: Address,
    /// Optional address of the Stellar Private Payments pool used for this
    /// workspace. Set via `set_spp_pool`; `None` until explicitly configured.
    pub spp_pool: Option<Address>,
}

/// A payroll batch. `total_commitment` is the Pedersen commitment to the
/// batch total — the cleartext total never touches the ledger.
///
/// MIGRATION NOTE: The `spp_deposit_ref` field was added as part of the SPP
/// bridge (spp-transfer change). Any previously stored `Batch` value will fail
/// to deserialize — `Option<_>` does NOT auto-default for existing on-chain
/// storage in Soroban. A fresh redeploy is required (T-05).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Batch {
    pub batch_id: u64,
    pub period_start: u64,
    pub period_end: u64,
    pub total_commitment: BytesN<64>,
    pub employee_count: u32,
    pub status: BatchStatus,
    pub created_by: Address,
    pub approved_by: Option<Address>,
    pub settlement_ref: BytesN<32>,
    /// Optional 32-byte reference to the Stellar Private Payments deposit for
    /// this batch. Set via `record_spp_deposit` after the treasury transfers
    /// the pooled amount to the SPP pool contract. `None` until recorded.
    pub spp_deposit_ref: Option<BytesN<32>>,
}

/// An individual payout. `amount_commitment` is the Pedersen commitment to
/// the salary — the cleartext amount never touches the ledger.
///
/// `enc_r` and `enc_amt` are the ZKash ECIES-encrypted amount layer:
///   - `enc_r`  : ephemeral BN254-G1 point R = eph·G (x‖y BE, 64B)
///   - `enc_amt`: [0..12] nonce | [12..20] ct | [20..36] tag | [36..40] zeros
///
/// Both fields are read by the employee/auditor portals for client-side
/// decryption. `execute_payout` ignores them entirely.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Payout {
    pub payout_id: u64,
    pub batch_id: u64,
    pub employee: Address,
    pub amount_commitment: BytesN<64>,
    pub status: PayoutStatus,
    pub tx_ref: BytesN<32>,
    pub receipt_ref: BytesN<32>,
    /// ZKash ECIES ephemeral point R = eph·G (x‖y BE, 64 bytes).
    pub enc_r: BytesN<64>,
    /// ZKash encrypted amount blob (40 bytes): nonce‖ct‖tag‖zeros.
    pub enc_amt: BytesN<40>,
}
