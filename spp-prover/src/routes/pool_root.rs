use axum::Json;
use prover::merkle::MerklePrefixTree;
use serde::{Deserialize, Serialize};

use crate::{routes::deposit::parse_field_be_hex, state::POOL_TREE_DEPTH};

#[derive(Debug, Deserialize)]
pub struct PoolRootRequest {
    /// Pool commitments in insertion order (BE hex 32B each).
    pub commitments_be_hex: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PoolRootResponse {
    /// Computed pool Merkle root (BE hex 32B).
    pub root_be_hex: String,
}

pub async fn handler(
    Json(req): Json<PoolRootRequest>,
) -> Result<Json<PoolRootResponse>, String> {
    compute_root(req).map(Json).map_err(|e| format!("pool-root error: {e:#}"))
}

fn compute_root(req: PoolRootRequest) -> anyhow::Result<PoolRootResponse> {
    let leaves = req
        .commitments_be_hex
        .iter()
        .enumerate()
        .map(|(i, s)| parse_field_be_hex(s, &format!("commitment[{i}]")))
        .collect::<anyhow::Result<Vec<_>>>()?;

    let tree = MerklePrefixTree::new(POOL_TREE_DEPTH, &leaves)?.into_built();
    let root = tree.root()?;
    Ok(PoolRootResponse { root_be_hex: hex::encode(root.to_be_bytes()) })
}
