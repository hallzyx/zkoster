use soroban_sdk::{contract, contractimpl, Address, Env, Vec};
use zkoster_types::{DisclosureScope, MemberRole, MemberStatus};

use crate::error::Error;
use crate::events::{
    GrantIssued, GrantRevoked, MemberDenied, MemberRegistered, MemberStatusChanged,
};
use crate::storage;
use crate::types::{DisclosureGrant, Member};

#[contract]
pub struct ComplianceContract;

#[contractimpl]
impl ComplianceContract {
    /// Bind the contract instance to a company admin. One instance == one
    /// company workspace.
    pub fn initialize(e: Env, admin: Address) -> Result<(), Error> {
        if storage::has_admin(&e) {
            return Err(Error::AlreadyInitialized);
        }
        storage::set_admin(&e, &admin);
        storage::bump_instance(&e);
        Ok(())
    }

    /// Rotate the admin. Current admin must authorize.
    pub fn set_admin(e: Env, new_admin: Address) -> Result<(), Error> {
        require_admin(&e)?;
        storage::set_admin(&e, &new_admin);
        storage::bump_instance(&e);
        Ok(())
    }

    pub fn admin(e: Env) -> Result<Address, Error> {
        storage::get_admin(&e).ok_or(Error::NotInitialized)
    }

    // --- Membership / allowlist -------------------------------------------

    /// Register (or re-register) a wallet as an authorized member.
    pub fn register_member(e: Env, wallet: Address, role: MemberRole) -> Result<(), Error> {
        require_admin(&e)?;
        let member = Member {
            wallet: wallet.clone(),
            role,
            status: MemberStatus::Authorized,
        };
        storage::set_member(&e, &member);
        MemberRegistered { wallet, role }.publish(&e);
        Ok(())
    }

    /// Authorize or revoke an existing member.
    pub fn set_member_status(e: Env, wallet: Address, status: MemberStatus) -> Result<(), Error> {
        require_admin(&e)?;
        let mut member = storage::get_member(&e, &wallet).ok_or(Error::MemberNotFound)?;
        member.status = status;
        storage::set_member(&e, &member);
        MemberStatusChanged { wallet, status }.publish(&e);
        Ok(())
    }

    /// Add or remove a wallet from the sanction denylist. A denied wallet is
    /// never authorized, regardless of member status.
    pub fn set_denied(e: Env, wallet: Address, denied: bool) -> Result<(), Error> {
        require_admin(&e)?;
        storage::set_denied(&e, &wallet, denied);
        MemberDenied { wallet, denied }.publish(&e);
        Ok(())
    }

    pub fn get_member(e: Env, wallet: Address) -> Option<Member> {
        storage::get_member(&e, &wallet)
    }

    pub fn is_denied(e: Env, wallet: Address) -> bool {
        storage::is_denied(&e, &wallet)
    }

    /// Single source of truth for payout eligibility (business rule #3):
    /// the wallet must be a member with `Authorized` status and not denied.
    pub fn is_authorized(e: Env, wallet: Address) -> bool {
        if storage::is_denied(&e, &wallet) {
            return false;
        }
        match storage::get_member(&e, &wallet) {
            Some(m) => m.status == MemberStatus::Authorized,
            None => false,
        }
    }

    // --- Disclosure grants ------------------------------------------------

    /// Issue a read-only disclosure grant to an auditor.
    ///
    /// `payout_id == 0` => whole-batch grant; non-zero => single payout.
    /// `expires_at == 0` => no expiry.
    pub fn issue_grant(
        e: Env,
        grantee: Address,
        batch_id: u64,
        payout_id: u64,
        scope: DisclosureScope,
        expires_at: u64,
    ) -> Result<u64, Error> {
        let admin = require_admin(&e)?;

        if expires_at != 0 && expires_at <= e.ledger().timestamp() {
            return Err(Error::InvalidExpiry);
        }
        // A single-payout scope must name a payout; totals/full must not.
        let targets_payout = payout_id != 0;
        let scope_is_single = scope == DisclosureScope::Sample;
        if targets_payout != scope_is_single {
            return Err(Error::InvalidGrantTarget);
        }

        let grant_id = storage::next_grant_id(&e);
        let grant = DisclosureGrant {
            grant_id,
            batch_id,
            payout_id,
            grantee: grantee.clone(),
            scope,
            granted_by: admin,
            expires_at,
            revoked: false,
        };
        storage::set_grant(&e, &grant);
        storage::add_grantee_grant(&e, &grantee, grant_id);
        GrantIssued {
            grantee,
            grant_id,
            batch_id,
            scope,
        }
        .publish(&e);
        Ok(grant_id)
    }

    pub fn revoke_grant(e: Env, grant_id: u64) -> Result<(), Error> {
        require_admin(&e)?;
        let mut grant = storage::get_grant(&e, grant_id).ok_or(Error::GrantNotFound)?;
        grant.revoked = true;
        storage::set_grant(&e, &grant);
        GrantRevoked { grant_id }.publish(&e);
        Ok(())
    }

    pub fn get_grant(e: Env, grant_id: u64) -> Option<DisclosureGrant> {
        storage::get_grant(&e, grant_id)
    }

    /// All grant ids issued to a given auditor. Lets the Auditor Disclosure
    /// View enumerate its authorized scope.
    pub fn get_grantee_grants(e: Env, grantee: Address) -> Vec<u64> {
        storage::get_grantee_grants(&e, &grantee)
    }

    /// Resolve whether `grantee` may read `(batch_id, payout_id)`.
    ///
    /// Pass `payout_id == 0` to ask about batch-level access. A whole-batch
    /// grant (its own `payout_id == 0`) covers any payout in the batch.
    pub fn can_access(e: Env, grantee: Address, batch_id: u64, payout_id: u64) -> bool {
        let now = e.ledger().timestamp();
        let ids = storage::get_grantee_grants(&e, &grantee);
        for id in ids.iter() {
            if let Some(g) = storage::get_grant(&e, id) {
                let live = !g.revoked && (g.expires_at == 0 || g.expires_at > now);
                let covers =
                    g.batch_id == batch_id && (g.payout_id == 0 || g.payout_id == payout_id);
                if live && covers {
                    return true;
                }
            }
        }
        false
    }
}

/// Load the admin, enforce its authorization, and return it.
fn require_admin(e: &Env) -> Result<Address, Error> {
    let admin = storage::get_admin(e).ok_or(Error::NotInitialized)?;
    admin.require_auth();
    storage::bump_instance(e);
    Ok(admin)
}
