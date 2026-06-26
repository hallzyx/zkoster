use soroban_sdk::{contracttype, Address, BytesN};
use zkoster_types::{DisclosureScope, MemberRole, MemberStatus};

/// A participant authorized within this company's compliance set.
///
/// `member_id` from the domain model is the `wallet` itself (unique per
/// instance), and `company_id` is implicit: one contract instance == one
/// company workspace.
///
/// `pub_key` is the employee's uncompressed BN254-G1 ZKash public key,
/// serialized as x‖y big-endian (64 bytes). Used to encrypt payout amounts
/// so only the employee can decrypt their own salary.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Member {
    pub wallet: Address,
    pub role: MemberRole,
    pub status: MemberStatus,
    /// BN254-G1 public key for ZKash ECIES: x‖y BE (64 bytes).
    pub pub_key: BytesN<64>,
}

/// Read-only visibility permission granted to an auditor.
///
/// A grant always targets a `batch_id`. `payout_id == 0` means the grant
/// covers the whole batch; a non-zero `payout_id` scopes it to a single
/// payout. `expires_at == 0` means no expiry.
///
/// `viewing_key` carries the ZKash ephemeral Fr scalar `eph` encoded as 32B
/// big-endian. Present for Sample and FullBatch scopes; `None` for TotalsOnly.
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
    /// ZKash ephemeral scalar (32B BE) for per-payout decryption.
    /// None = TotalsOnly (no per-payout decryption); Some(r) = Sample or FullBatch.
    pub viewing_key: Option<BytesN<32>>,
}
