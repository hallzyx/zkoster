use soroban_sdk::{contracttype, BytesN, Vec};

// `Proof` lives in `zkoster_types` (shared, decoupled). Re-exported by lib.rs.

/// Groth16 verifying key over BN254.
///
/// Byte layouts follow the soroban-sdk BN254 serialization:
/// - G1 points: 64 bytes (`x || y`, 32-byte big-endian each).
/// - G2 points: 128 bytes.
///
/// `ic` holds `IC_0 .. IC_n` where `n == number of public inputs`.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifyingKey {
    pub alpha: BytesN<64>,
    pub beta: BytesN<128>,
    pub gamma: BytesN<128>,
    pub delta: BytesN<128>,
    pub ic: Vec<BytesN<64>>,
}
