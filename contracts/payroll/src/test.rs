#![cfg(test)]

use soroban_sdk::{testutils::Address as _, vec, Address, BytesN, Env, Vec};
use zkoster_types::{MemberRole, Proof};
use zkoster_verifier::VerifyingKey;

use crate::error::Error;
use crate::types::{BatchStatus, PayoutStatus};
use crate::{PayrollContract, PayrollContractClient};

use zkoster_compliance::{ComplianceContract, ComplianceContractClient};
use zkoster_verifier::{VerifierContract, VerifierContractClient};

struct Harness<'a> {
    e: Env,
    payroll: PayrollContractClient<'a>,
    compliance: ComplianceContractClient<'a>,
}

fn zero64(e: &Env) -> BytesN<64> {
    BytesN::from_array(e, &[0u8; 64])
}
fn zero40(e: &Env) -> BytesN<40> {
    BytesN::from_array(e, &[0u8; 40])
}
fn zero32(e: &Env) -> BytesN<32> {
    BytesN::from_array(e, &[0u8; 32])
}
fn zero128(e: &Env) -> BytesN<128> {
    BytesN::from_array(e, &[0u8; 128])
}

/// Deploy and wire all three contracts as one company workspace.
fn setup<'a>() -> Harness<'a> {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let treasury = Address::generate(&e);
    let asset = Address::generate(&e);

    // Compliance.
    let compliance_id = e.register(ComplianceContract, ());
    let compliance = ComplianceContractClient::new(&e, &compliance_id);
    compliance.initialize(&admin);

    // Verifier (with a dummy VK: 1 IC point => 0 public inputs).
    let verifier_id = e.register(VerifierContract, ());
    let verifier = VerifierContractClient::new(&e, &verifier_id);
    verifier.initialize(&admin);
    let g1 = zero64(&e);
    let g2 = zero128(&e);
    let mut ic: Vec<BytesN<64>> = Vec::new(&e);
    ic.push_back(g1.clone());
    verifier.set_vk(&VerifyingKey {
        alpha: g1.clone(),
        beta: g2.clone(),
        gamma: g2.clone(),
        delta: g2,
        ic,
    });

    // Payroll, wired to both.
    let payroll_id = e.register(PayrollContract, ());
    let payroll = PayrollContractClient::new(&e, &payroll_id);
    payroll.initialize(&admin, &treasury, &asset, &compliance_id, &verifier_id);

    Harness {
        e,
        payroll,
        compliance,
    }
}

fn dummy_proof(e: &Env) -> Proof {
    Proof {
        a: zero64(e),
        b: zero128(e),
        c: zero64(e),
    }
}

// --- crypto-independent tests --------------------------------------------

#[test]
fn double_init_fails() {
    let h = setup();
    let a = Address::generate(&h.e);
    assert_eq!(
        h.payroll.try_initialize(&a, &a, &a, &a, &a),
        Err(Ok(Error::AlreadyInitialized))
    );
}

#[test]
fn create_batch_starts_in_draft() {
    let h = setup();
    let id = h.payroll.create_batch(&1_000, &2_000);
    let b = h.payroll.get_batch(&id).unwrap();
    assert_eq!(b.status, BatchStatus::Draft);
    assert_eq!(b.employee_count, 0);
}

#[test]
fn add_payout_rejects_unauthorized_employee() {
    let h = setup();
    let id = h.payroll.create_batch(&1_000, &2_000);
    let ghost = Address::generate(&h.e);
    assert_eq!(
        h.payroll
            .try_add_payout(&id, &ghost, &zero64(&h.e), &zero64(&h.e), &zero40(&h.e)),
        Err(Ok(Error::EmployeeNotAuthorized))
    );
}

#[test]
fn add_payout_for_authorized_employee_increments_count() {
    let h = setup();
    let emp = Address::generate(&h.e);
    h.compliance
        .register_member(&emp, &MemberRole::Employee, &zero64(&h.e));

    let id = h.payroll.create_batch(&1_000, &2_000);
    let pid = h
        .payroll
        .add_payout(&id, &emp, &zero64(&h.e), &zero64(&h.e), &zero40(&h.e));
    assert_eq!(pid, 1);

    let b = h.payroll.get_batch(&id).unwrap();
    assert_eq!(b.employee_count, 1);
    let p = h.payroll.get_payout(&pid).unwrap();
    assert_eq!(p.status, PayoutStatus::Pending);
    assert_eq!(p.batch_id, id);
}

#[test]
fn add_payout_stores_ecies_fields() {
    let h = setup();
    let emp = Address::generate(&h.e);
    h.compliance
        .register_member(&emp, &MemberRole::Employee, &zero64(&h.e));

    // Use non-zero sentinel bytes so we verify round-trip (not just zero-fill).
    let mut r_bytes = [0u8; 64];
    r_bytes[0] = 0xAB;
    r_bytes[63] = 0xCD;
    let enc_r = BytesN::from_array(&h.e, &r_bytes);

    let mut a_bytes = [0u8; 40];
    a_bytes[0] = 0x01;  // nonce byte
    a_bytes[12] = 0x42; // ct byte
    a_bytes[20] = 0xFF; // tag byte
    let enc_amt = BytesN::from_array(&h.e, &a_bytes);

    let id = h.payroll.create_batch(&1_000, &2_000);
    let pid = h
        .payroll
        .add_payout(&id, &emp, &zero64(&h.e), &enc_r, &enc_amt);

    let p = h.payroll.get_payout(&pid).unwrap();
    assert_eq!(p.enc_r, enc_r, "enc_r must round-trip byte-for-byte");
    assert_eq!(p.enc_amt, enc_amt, "enc_amt must round-trip byte-for-byte");
}

#[test]
fn batch_count_and_employee_payout_index() {
    let h = setup();
    let emp = Address::generate(&h.e);
    h.compliance
        .register_member(&emp, &MemberRole::Employee, &zero64(&h.e));

    assert_eq!(h.payroll.batch_count(), 0);

    let b1 = h.payroll.create_batch(&1, &2);
    let b2 = h.payroll.create_batch(&3, &4);
    assert_eq!(h.payroll.batch_count(), 2);

    let p1 = h
        .payroll
        .add_payout(&b1, &emp, &zero64(&h.e), &zero64(&h.e), &zero40(&h.e));
    let p2 = h
        .payroll
        .add_payout(&b2, &emp, &zero64(&h.e), &zero64(&h.e), &zero40(&h.e));

    let mine = h.payroll.get_employee_payouts(&emp);
    assert_eq!(mine.len(), 2);
    assert_eq!(mine.get(0).unwrap(), p1);
    assert_eq!(mine.get(1).unwrap(), p2);

    // An unrelated employee has no payouts.
    let other = Address::generate(&h.e);
    assert_eq!(h.payroll.get_employee_payouts(&other).len(), 0);
}

#[test]
fn review_empty_batch_fails() {
    let h = setup();
    let id = h.payroll.create_batch(&1_000, &2_000);
    assert_eq!(
        h.payroll.try_review_batch(&id, &zero64(&h.e)),
        Err(Ok(Error::EmptyBatch))
    );
}

#[test]
fn approve_before_review_fails() {
    let h = setup();
    let id = h.payroll.create_batch(&1_000, &2_000);
    assert_eq!(
        h.payroll.try_approve_batch(&id),
        Err(Ok(Error::InvalidBatchStatus))
    );
}

#[test]
fn execute_before_funded_fails() {
    let h = setup();
    let emp = Address::generate(&h.e);
    h.compliance
        .register_member(&emp, &MemberRole::Employee, &zero64(&h.e));
    let id = h.payroll.create_batch(&1_000, &2_000);
    let pid = h
        .payroll
        .add_payout(&id, &emp, &zero64(&h.e), &zero64(&h.e), &zero40(&h.e));

    assert_eq!(
        h.payroll.try_execute_payout(
            &id,
            &pid,
            &dummy_proof(&h.e),
            &Vec::new(&h.e),
            &zero32(&h.e)
        ),
        Err(Ok(Error::InvalidBatchStatus))
    );
}

#[test]
fn cannot_add_payout_after_review() {
    let h = setup();
    let emp = Address::generate(&h.e);
    h.compliance
        .register_member(&emp, &MemberRole::Employee, &zero64(&h.e));
    let id = h.payroll.create_batch(&1_000, &2_000);
    h.payroll
        .add_payout(&id, &emp, &zero64(&h.e), &zero64(&h.e), &zero40(&h.e));
    h.payroll.review_batch(&id, &zero64(&h.e));

    assert_eq!(
        h.payroll
            .try_add_payout(&id, &emp, &zero64(&h.e), &zero64(&h.e), &zero40(&h.e)),
        Err(Ok(Error::InvalidBatchStatus))
    );
}

// --- full happy path (uses identity points: Σ O == O) --------------------

#[test]
fn full_payroll_flow_settles_batch() {
    let h = setup();
    let emp1 = Address::generate(&h.e);
    let emp2 = Address::generate(&h.e);
    h.compliance
        .register_member(&emp1, &MemberRole::Employee, &zero64(&h.e));
    h.compliance
        .register_member(&emp2, &MemberRole::Employee, &zero64(&h.e));

    let id = h.payroll.create_batch(&1_000, &2_000);
    let p1 = h
        .payroll
        .add_payout(&id, &emp1, &zero64(&h.e), &zero64(&h.e), &zero40(&h.e));
    let p2 = h
        .payroll
        .add_payout(&id, &emp2, &zero64(&h.e), &zero64(&h.e), &zero40(&h.e));

    h.payroll.review_batch(&id, &zero64(&h.e));
    h.payroll.approve_batch(&id);
    assert_eq!(
        h.payroll.get_batch(&id).unwrap().status,
        BatchStatus::Approved
    );

    h.payroll.fund_batch(&id);

    let empty_inputs: Vec<BytesN<32>> = vec![&h.e];
    h.payroll
        .execute_payout(&id, &p1, &dummy_proof(&h.e), &empty_inputs, &zero32(&h.e));
    // After one of two payouts, batch is Processing.
    assert_eq!(
        h.payroll.get_batch(&id).unwrap().status,
        BatchStatus::Processing
    );
    assert_eq!(
        h.payroll.get_payout(&p1).unwrap().status,
        PayoutStatus::Paid
    );

    // Re-executing the same payout while the batch is still Processing is
    // forbidden (rule #4 — no double settlement).
    assert_eq!(
        h.payroll
            .try_execute_payout(&id, &p1, &dummy_proof(&h.e), &empty_inputs, &zero32(&h.e)),
        Err(Ok(Error::PayoutAlreadyExecuted))
    );

    // Settling the last payout flips the batch to Paid.
    h.payroll
        .execute_payout(&id, &p2, &dummy_proof(&h.e), &empty_inputs, &zero32(&h.e));
    assert_eq!(h.payroll.get_batch(&id).unwrap().status, BatchStatus::Paid);
}

// --- T-04: set_spp_pool + record_spp_deposit tests -----------------------

/// Returns a batch_id in Funded status (create → add_payout → review → approve → fund).
fn funded_batch(h: &Harness) -> u64 {
    let emp = Address::generate(&h.e);
    h.compliance
        .register_member(&emp, &MemberRole::Employee, &zero64(&h.e));
    let id = h.payroll.create_batch(&1_000, &2_000);
    h.payroll
        .add_payout(&id, &emp, &zero64(&h.e), &zero64(&h.e), &zero40(&h.e));
    h.payroll.review_batch(&id, &zero64(&h.e));
    h.payroll.approve_batch(&id);
    h.payroll.fund_batch(&id);
    id
}

#[test]
fn set_spp_pool_stores_address() {
    let h = setup();
    let pool = Address::generate(&h.e);

    h.payroll.set_spp_pool(&pool);

    let cfg = h.payroll.config();
    assert_eq!(cfg.spp_pool, Some(pool), "spp_pool must round-trip through Config");
}

/// Calling `set_spp_pool` without providing admin auth must panic (host trap).
/// We use a fresh Env without mock_all_auths so require_auth() is enforced.
/// `initialize` itself has no require_auth call, so it bootstraps cleanly.
#[test]
#[should_panic]
fn set_spp_pool_non_admin_panics() {
    let e = Env::default();
    // Intentionally NO e.mock_all_auths() — auth enforcement is live.
    let admin = Address::generate(&e);
    let treasury = Address::generate(&e);
    let asset = Address::generate(&e);
    // Dummy addresses: set_spp_pool never calls into these contracts.
    let compliance_dummy = Address::generate(&e);
    let verifier_dummy = Address::generate(&e);
    let pool = Address::generate(&e);

    let payroll_id = e.register(PayrollContract, ());
    let payroll = PayrollContractClient::new(&e, &payroll_id);
    // initialize has no require_auth — succeeds without mocking.
    payroll.initialize(&admin, &treasury, &asset, &compliance_dummy, &verifier_dummy);

    // require_auth() is NOT satisfied → host trap → test must panic.
    payroll.set_spp_pool(&pool);
}

#[test]
fn record_spp_deposit_happy_path() {
    let h = setup();
    let batch_id = funded_batch(&h);
    let spp_ref = BytesN::from_array(&h.e, &[0xAB; 32]);

    h.payroll.record_spp_deposit(&batch_id, &spp_ref);

    let batch = h.payroll.get_batch(&batch_id).unwrap();
    assert_eq!(
        batch.spp_deposit_ref,
        Some(spp_ref),
        "spp_deposit_ref must be stored on the batch"
    );
    // Status must remain Funded — record_spp_deposit is a side annotation, not a transition.
    assert_eq!(
        batch.status,
        BatchStatus::Funded,
        "batch status must stay Funded after recording the SPP ref"
    );
}

#[test]
fn record_spp_deposit_wrong_status_fails() {
    let h = setup();
    // Draft batch — not Funded or Processing.
    let id = h.payroll.create_batch(&1_000, &2_000);
    let spp_ref = BytesN::from_array(&h.e, &[0x01; 32]);

    assert_eq!(
        h.payroll.try_record_spp_deposit(&id, &spp_ref),
        Err(Ok(crate::error::Error::InvalidBatchStatus)),
        "record_spp_deposit must reject batches not in Funded/Processing status"
    );
}

#[test]
fn record_spp_deposit_already_set_fails() {
    let h = setup();
    let batch_id = funded_batch(&h);
    let spp_ref = BytesN::from_array(&h.e, &[0xBB; 32]);

    h.payroll.record_spp_deposit(&batch_id, &spp_ref);

    // Second call with a different ref must be rejected to keep the anchor tamper-evident.
    let other_ref = BytesN::from_array(&h.e, &[0xCC; 32]);
    assert_eq!(
        h.payroll.try_record_spp_deposit(&batch_id, &other_ref),
        Err(Ok(crate::error::Error::SppDepositAlreadyRecorded)),
        "second record_spp_deposit call must be rejected"
    );
}

/// Calling `record_spp_deposit` without admin auth must panic (host trap).
#[test]
#[should_panic]
fn record_spp_deposit_non_admin_panics() {
    let e = Env::default();
    // Intentionally NO e.mock_all_auths() — auth enforcement is live.
    let admin = Address::generate(&e);
    let treasury = Address::generate(&e);
    let asset = Address::generate(&e);
    let compliance_dummy = Address::generate(&e);
    let verifier_dummy = Address::generate(&e);

    let payroll_id = e.register(PayrollContract, ());
    let payroll = PayrollContractClient::new(&e, &payroll_id);
    payroll.initialize(&admin, &treasury, &asset, &compliance_dummy, &verifier_dummy);

    let spp_ref = BytesN::from_array(&e, &[0x01; 32]);
    // require_auth() is NOT satisfied → host trap → test must panic.
    payroll.record_spp_deposit(&1u64, &spp_ref);
}
