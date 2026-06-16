use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Vec};
use zkoster_types::Proof;

use crate::clients::{ComplianceClient, VerifierClient};
use crate::error::Error;
use crate::events::{BatchApproved, BatchCreated, PayoutPaid};
use crate::storage;
use crate::types::{Batch, BatchStatus, Config, Payout, PayoutStatus};

#[contract]
pub struct PayrollContract;

#[contractimpl]
impl PayrollContract {
    /// Bind the instance to a company: admin, treasury, settlement asset, and
    /// the addresses of the compliance and verifier contracts it relies on.
    pub fn initialize(
        e: Env,
        admin: Address,
        treasury: Address,
        asset: Address,
        compliance: Address,
        verifier: Address,
    ) -> Result<(), Error> {
        if storage::has_config(&e) {
            return Err(Error::AlreadyInitialized);
        }
        storage::set_config(
            &e,
            &Config {
                admin,
                treasury,
                asset,
                compliance,
                verifier,
            },
        );
        storage::bump_instance(&e);
        Ok(())
    }

    pub fn config(e: Env) -> Result<Config, Error> {
        storage::get_config(&e).ok_or(Error::NotInitialized)
    }

    // --- Batch creation & assembly ---------------------------------------

    /// Create a new draft batch for a payroll period.
    pub fn create_batch(e: Env, period_start: u64, period_end: u64) -> Result<u64, Error> {
        let cfg = require_admin(&e)?;
        let batch_id = storage::next_batch_id(&e);
        let batch = Batch {
            batch_id,
            period_start,
            period_end,
            total_commitment: zero64(&e),
            employee_count: 0,
            status: BatchStatus::Draft,
            created_by: cfg.admin,
            approved_by: None,
            settlement_ref: zero32(&e),
        };
        storage::set_batch(&e, &batch);
        BatchCreated { batch_id }.publish(&e);
        Ok(batch_id)
    }

    /// Add a payout (employee + amount commitment) to a draft batch.
    /// Enforces recipient eligibility against the compliance contract.
    pub fn add_payout(
        e: Env,
        batch_id: u64,
        employee: Address,
        amount_commitment: BytesN<64>,
    ) -> Result<u64, Error> {
        let cfg = require_admin(&e)?;
        let mut batch = storage::get_batch(&e, batch_id).ok_or(Error::BatchNotFound)?;
        if batch.status != BatchStatus::Draft {
            return Err(Error::InvalidBatchStatus);
        }

        let compliance = ComplianceClient::new(&e, &cfg.compliance);
        if !compliance.is_authorized(&employee) {
            return Err(Error::EmployeeNotAuthorized);
        }

        let payout_id = storage::next_payout_id(&e);
        let payout = Payout {
            payout_id,
            batch_id,
            employee,
            amount_commitment,
            status: PayoutStatus::Pending,
            tx_ref: zero32(&e),
            receipt_ref: zero32(&e),
        };
        storage::set_payout(&e, &payout);
        storage::add_batch_payout(&e, batch_id, payout_id);
        storage::add_employee_payout(&e, &payout.employee, payout_id);

        batch.employee_count += 1;
        storage::set_batch(&e, &batch);
        Ok(payout_id)
    }

    // --- Lifecycle transitions -------------------------------------------

    /// Draft -> Reviewed. Records the batch total commitment.
    pub fn review_batch(e: Env, batch_id: u64, total_commitment: BytesN<64>) -> Result<(), Error> {
        require_admin(&e)?;
        let mut batch = storage::get_batch(&e, batch_id).ok_or(Error::BatchNotFound)?;
        if batch.status != BatchStatus::Draft {
            return Err(Error::InvalidBatchStatus);
        }
        if batch.employee_count == 0 {
            return Err(Error::EmptyBatch);
        }
        batch.total_commitment = total_commitment;
        batch.status = BatchStatus::Reviewed;
        storage::set_batch(&e, &batch);
        Ok(())
    }

    /// Reviewed -> Approved. Verifies `Σ commitments == total` (rule #5) via
    /// the verifier contract before approving.
    pub fn approve_batch(e: Env, batch_id: u64) -> Result<(), Error> {
        let cfg = require_admin(&e)?;
        let mut batch = storage::get_batch(&e, batch_id).ok_or(Error::BatchNotFound)?;
        if batch.status != BatchStatus::Reviewed {
            return Err(Error::InvalidBatchStatus);
        }

        let commitments = collect_commitments(&e, batch_id);
        let verifier = VerifierClient::new(&e, &cfg.verifier);
        if !verifier.check_commitment_sum(&commitments, &batch.total_commitment) {
            return Err(Error::CommitmentSumMismatch);
        }

        batch.status = BatchStatus::Approved;
        batch.approved_by = Some(cfg.admin);
        storage::set_batch(&e, &batch);
        BatchApproved { batch_id }.publish(&e);
        Ok(())
    }

    /// Approved -> Funded. In the MVP this marks the treasury as funded; a
    /// production build would move asset into escrow here.
    pub fn fund_batch(e: Env, batch_id: u64) -> Result<(), Error> {
        require_admin(&e)?;
        let mut batch = storage::get_batch(&e, batch_id).ok_or(Error::BatchNotFound)?;
        if batch.status != BatchStatus::Approved {
            return Err(Error::InvalidBatchStatus);
        }
        batch.status = BatchStatus::Funded;
        storage::set_batch(&e, &batch);
        Ok(())
    }

    /// Execute a single private payout: verify its range proof, then settle.
    /// Idempotent — a settled payout can never be re-executed (rule #4).
    /// A batch must be funded to pay (rule #8).
    pub fn execute_payout(
        e: Env,
        batch_id: u64,
        payout_id: u64,
        proof: Proof,
        public_inputs: Vec<BytesN<32>>,
        tx_ref: BytesN<32>,
    ) -> Result<(), Error> {
        let cfg = require_admin(&e)?;
        let mut batch = storage::get_batch(&e, batch_id).ok_or(Error::BatchNotFound)?;
        if batch.status != BatchStatus::Funded && batch.status != BatchStatus::Processing {
            return Err(Error::InvalidBatchStatus);
        }

        let mut payout = storage::get_payout(&e, payout_id).ok_or(Error::PayoutNotFound)?;
        if payout.batch_id != batch_id {
            return Err(Error::BatchPayoutMismatch);
        }
        if payout.status == PayoutStatus::Paid || payout.status == PayoutStatus::Disclosed {
            return Err(Error::PayoutAlreadyExecuted);
        }
        if payout.status == PayoutStatus::Flagged {
            return Err(Error::InvalidPayoutStatus);
        }

        // Re-check eligibility at settlement time (rule #3).
        let compliance = ComplianceClient::new(&e, &cfg.compliance);
        if !compliance.is_authorized(&payout.employee) {
            return Err(Error::EmployeeNotAuthorized);
        }

        // Verify the payout range proof.
        let verifier = VerifierClient::new(&e, &cfg.verifier);
        if !verifier.verify_groth16(&proof, &public_inputs) {
            return Err(Error::ProofInvalid);
        }

        payout.status = PayoutStatus::Paid;
        payout.tx_ref = tx_ref;
        storage::set_payout(&e, &payout);

        if batch.status == BatchStatus::Funded {
            batch.status = BatchStatus::Processing;
        }
        if all_payouts_paid(&e, batch_id) {
            batch.status = BatchStatus::Paid;
        }
        storage::set_batch(&e, &batch);

        PayoutPaid {
            payout_id,
            batch_id,
        }
        .publish(&e);
        Ok(())
    }

    /// Flag a payout for review; marks the batch partially flagged.
    pub fn flag_payout(e: Env, batch_id: u64, payout_id: u64) -> Result<(), Error> {
        require_admin(&e)?;
        let mut batch = storage::get_batch(&e, batch_id).ok_or(Error::BatchNotFound)?;
        let mut payout = storage::get_payout(&e, payout_id).ok_or(Error::PayoutNotFound)?;
        if payout.batch_id != batch_id {
            return Err(Error::BatchPayoutMismatch);
        }
        if payout.status == PayoutStatus::Paid {
            return Err(Error::PayoutAlreadyExecuted);
        }
        payout.status = PayoutStatus::Flagged;
        storage::set_payout(&e, &payout);
        batch.status = BatchStatus::PartiallyFlagged;
        storage::set_batch(&e, &batch);
        Ok(())
    }

    /// Record the receipt reference for a settled payout.
    pub fn set_receipt(e: Env, payout_id: u64, receipt_ref: BytesN<32>) -> Result<(), Error> {
        require_admin(&e)?;
        let mut payout = storage::get_payout(&e, payout_id).ok_or(Error::PayoutNotFound)?;
        payout.receipt_ref = receipt_ref;
        storage::set_payout(&e, &payout);
        Ok(())
    }

    /// Close a fully-settled (or flagged) batch.
    pub fn close_batch(e: Env, batch_id: u64) -> Result<(), Error> {
        require_admin(&e)?;
        let mut batch = storage::get_batch(&e, batch_id).ok_or(Error::BatchNotFound)?;
        if batch.status != BatchStatus::Paid && batch.status != BatchStatus::PartiallyFlagged {
            return Err(Error::InvalidBatchStatus);
        }
        batch.status = BatchStatus::Closed;
        storage::set_batch(&e, &batch);
        Ok(())
    }

    // --- Read-only views --------------------------------------------------

    pub fn get_batch(e: Env, batch_id: u64) -> Option<Batch> {
        storage::get_batch(&e, batch_id)
    }

    pub fn get_payout(e: Env, payout_id: u64) -> Option<Payout> {
        storage::get_payout(&e, payout_id)
    }

    pub fn get_batch_payouts(e: Env, batch_id: u64) -> Vec<u64> {
        storage::get_batch_payouts(&e, batch_id)
    }

    /// Number of batches ever created. Batch ids run `1..=batch_count`, so the
    /// Admin Dashboard can enumerate batches without an explicit list.
    pub fn batch_count(e: Env) -> u64 {
        storage::batch_count(&e)
    }

    /// All payout ids belonging to an employee — powers the Employee Portal's
    /// personal history (an employee only ever sees their own payouts).
    pub fn get_employee_payouts(e: Env, employee: Address) -> Vec<u64> {
        storage::get_employee_payouts(&e, &employee)
    }
}

// --- helpers -------------------------------------------------------------

fn require_admin(e: &Env) -> Result<Config, Error> {
    let cfg = storage::get_config(e).ok_or(Error::NotInitialized)?;
    cfg.admin.require_auth();
    storage::bump_instance(e);
    Ok(cfg)
}

fn collect_commitments(e: &Env, batch_id: u64) -> Vec<BytesN<64>> {
    let ids = storage::get_batch_payouts(e, batch_id);
    let mut out: Vec<BytesN<64>> = Vec::new(e);
    for id in ids.iter() {
        if let Some(p) = storage::get_payout(e, id) {
            out.push_back(p.amount_commitment);
        }
    }
    out
}

fn all_payouts_paid(e: &Env, batch_id: u64) -> bool {
    let ids = storage::get_batch_payouts(e, batch_id);
    for id in ids.iter() {
        match storage::get_payout(e, id) {
            Some(p) if p.status == PayoutStatus::Paid => {}
            _ => return false,
        }
    }
    true
}

fn zero32(e: &Env) -> BytesN<32> {
    BytesN::from_array(e, &[0u8; 32])
}

fn zero64(e: &Env) -> BytesN<64> {
    BytesN::from_array(e, &[0u8; 64])
}
