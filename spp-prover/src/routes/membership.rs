use axum::{Json, extract::State};
use serde::Serialize;

use crate::state::SharedState;

#[derive(Serialize)]
pub struct MembershipInfo {
    /// Big-endian hex of the leaf value to insert into the ASP membership contract.
    /// Call: `stellar contract invoke --id <ASP_MEMBERSHIP> -- insert_leaf --leaf <leaf_be_hex>`
    pub leaf_be_hex: String,
    /// Expected root after inserting this leaf as the first (and only) entry.
    pub expected_root_be_hex: String,
}

pub async fn handler(State(state): State<SharedState>) -> Json<MembershipInfo> {
    let leaf = state.membership.leaf;
    let root = state.membership.proof.root;
    Json(MembershipInfo {
        leaf_be_hex: format!("0x{}", hex::encode(leaf.to_be_bytes())),
        expected_root_be_hex: format!("0x{}", hex::encode(root.to_be_bytes())),
    })
}
