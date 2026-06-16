#![cfg(test)]

use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Address, Env};
use zkoster_types::{DisclosureScope, MemberRole, MemberStatus};

use crate::error::Error;
use crate::{ComplianceContract, ComplianceContractClient};

fn setup<'a>() -> (Env, ComplianceContractClient<'a>, Address) {
    let e = Env::default();
    e.mock_all_auths();
    let contract_id = e.register(ComplianceContract, ());
    let client = ComplianceContractClient::new(&e, &contract_id);
    let admin = Address::generate(&e);
    client.initialize(&admin);
    (e, client, admin)
}

#[test]
fn initialize_sets_admin_and_rejects_double_init() {
    let (e, client, admin) = setup();
    assert_eq!(client.admin(), admin);

    let other = Address::generate(&e);
    assert_eq!(
        client.try_initialize(&other),
        Err(Ok(Error::AlreadyInitialized))
    );
}

#[test]
fn register_member_makes_wallet_authorized() {
    let (e, client, _admin) = setup();
    let emp = Address::generate(&e);

    assert!(!client.is_authorized(&emp));
    client.register_member(&emp, &MemberRole::Employee);

    assert!(client.is_authorized(&emp));
    let m = client.get_member(&emp).unwrap();
    assert_eq!(m.role, MemberRole::Employee);
    assert_eq!(m.status, MemberStatus::Authorized);
}

#[test]
fn revoking_member_status_removes_authorization() {
    let (e, client, _admin) = setup();
    let emp = Address::generate(&e);
    client.register_member(&emp, &MemberRole::Employee);

    client.set_member_status(&emp, &MemberStatus::Revoked);
    assert!(!client.is_authorized(&emp));
}

#[test]
fn set_member_status_on_unknown_member_errors() {
    let (e, client, _admin) = setup();
    let ghost = Address::generate(&e);
    assert_eq!(
        client.try_set_member_status(&ghost, &MemberStatus::Revoked),
        Err(Ok(Error::MemberNotFound))
    );
}

#[test]
fn denylist_overrides_authorization() {
    let (e, client, _admin) = setup();
    let emp = Address::generate(&e);
    client.register_member(&emp, &MemberRole::Employee);
    assert!(client.is_authorized(&emp));

    client.set_denied(&emp, &true);
    assert!(client.is_denied(&emp));
    assert!(!client.is_authorized(&emp));

    client.set_denied(&emp, &false);
    assert!(client.is_authorized(&emp));
}

#[test]
fn whole_batch_grant_covers_any_payout() {
    let (e, client, _admin) = setup();
    let auditor = Address::generate(&e);

    let gid = client.issue_grant(&auditor, &7, &0, &DisclosureScope::FullBatch, &0);
    assert_eq!(gid, 1);

    // Batch-level and any payout within batch 7 are accessible.
    assert!(client.can_access(&auditor, &7, &0));
    assert!(client.can_access(&auditor, &7, &42));
    // A different batch is not.
    assert!(!client.can_access(&auditor, &8, &0));
}

#[test]
fn sample_grant_scopes_to_a_single_payout() {
    let (e, client, _admin) = setup();
    let auditor = Address::generate(&e);

    client.issue_grant(&auditor, &7, &42, &DisclosureScope::Sample, &0);

    assert!(client.can_access(&auditor, &7, &42));
    assert!(!client.can_access(&auditor, &7, &43));
}

#[test]
fn grant_target_and_scope_must_agree() {
    let (e, client, _admin) = setup();
    let auditor = Address::generate(&e);

    // Sample scope but no payout id.
    assert_eq!(
        client.try_issue_grant(&auditor, &7, &0, &DisclosureScope::Sample, &0),
        Err(Ok(Error::InvalidGrantTarget))
    );
    // FullBatch scope but a specific payout id.
    assert_eq!(
        client.try_issue_grant(&auditor, &7, &42, &DisclosureScope::FullBatch, &0),
        Err(Ok(Error::InvalidGrantTarget))
    );
}

#[test]
fn get_grantee_grants_indexes_by_auditor() {
    let (e, client, _admin) = setup();
    let auditor = Address::generate(&e);

    let g1 = client.issue_grant(&auditor, &7, &0, &DisclosureScope::FullBatch, &0);
    let g2 = client.issue_grant(&auditor, &8, &0, &DisclosureScope::TotalsOnly, &0);

    let ids = client.get_grantee_grants(&auditor);
    assert_eq!(ids.len(), 2);
    assert_eq!(ids.get(0).unwrap(), g1);
    assert_eq!(ids.get(1).unwrap(), g2);

    // A different auditor has none.
    let other = Address::generate(&e);
    assert_eq!(client.get_grantee_grants(&other).len(), 0);
}

#[test]
fn revoked_grant_denies_access() {
    let (e, client, _admin) = setup();
    let auditor = Address::generate(&e);
    let gid = client.issue_grant(&auditor, &7, &0, &DisclosureScope::TotalsOnly, &0);

    assert!(client.can_access(&auditor, &7, &0));
    client.revoke_grant(&gid);
    assert!(!client.can_access(&auditor, &7, &0));
}

#[test]
fn expired_grant_denies_access() {
    let (e, client, _admin) = setup();
    let auditor = Address::generate(&e);

    e.ledger().set_timestamp(1_000);
    client.issue_grant(&auditor, &7, &0, &DisclosureScope::TotalsOnly, &2_000);
    assert!(client.can_access(&auditor, &7, &0));

    // Jump past expiry.
    e.ledger().set_timestamp(2_001);
    assert!(!client.can_access(&auditor, &7, &0));
}

#[test]
fn issuing_already_expired_grant_errors() {
    let (e, client, _admin) = setup();
    let auditor = Address::generate(&e);

    e.ledger().set_timestamp(5_000);
    assert_eq!(
        client.try_issue_grant(&auditor, &7, &0, &DisclosureScope::TotalsOnly, &4_999),
        Err(Ok(Error::InvalidExpiry))
    );
}
