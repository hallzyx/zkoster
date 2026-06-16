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
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    pub admin: Address,
    pub treasury: Address,
    /// Stellar Asset Contract address used for settlement (e.g. USDC).
    pub asset: Address,
    pub compliance: Address,
    pub verifier: Address,
}

/// A payroll batch. `total_commitment` is the Pedersen commitment to the
/// batch total — the cleartext total never touches the ledger.
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
}

/// An individual payout. `amount_commitment` is the Pedersen commitment to
/// the salary — the cleartext amount never touches the ledger.
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
}
