use soroban_sdk::{contracttype, Address};
use zkoster_types::{DisclosureScope, MemberRole, MemberStatus};

/// A participant authorized within this company's compliance set.
///
/// `member_id` from the domain model is the `wallet` itself (unique per
/// instance), and `company_id` is implicit: one contract instance == one
/// company workspace.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Member {
    pub wallet: Address,
    pub role: MemberRole,
    pub status: MemberStatus,
}

/// Read-only visibility permission granted to an auditor.
///
/// A grant always targets a `batch_id`. `payout_id == 0` means the grant
/// covers the whole batch; a non-zero `payout_id` scopes it to a single
/// payout. `expires_at == 0` means no expiry.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DisclosureGrant {
    pub grant_id: u64,
    pub batch_id: u64,
    pub payout_id: u64,
    pub grantee: Address,
    pub scope: DisclosureScope,
    pub granted_by: Address,
    pub expires_at: u64,
    pub revoked: bool,
}
