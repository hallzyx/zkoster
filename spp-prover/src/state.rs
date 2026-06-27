use std::sync::Arc;

/// Shared server state — proving artifacts loaded once at startup.
/// Proof generation logic (witness + groth16) is added in T-03.
pub struct ProverState {
    pub pk_bytes: Vec<u8>,
    pub r1cs_bytes: Vec<u8>,
    pub wasm_bytes: Vec<u8>,
}

pub type SharedState = Arc<ProverState>;

impl ProverState {
    pub fn load(pk_path: &str, r1cs_path: &str, wasm_path: &str) -> anyhow::Result<Self> {
        let pk_bytes = std::fs::read(pk_path).map_err(|e| {
            anyhow::anyhow!(
                "Cannot read proving key at '{pk_path}': {e}\n\
                 Run `cargo build -p circuits --release` in the SPP repo first."
            )
        })?;
        let r1cs_bytes = std::fs::read(r1cs_path).map_err(|e| {
            anyhow::anyhow!(
                "Cannot read R1CS at '{r1cs_path}': {e}\n\
                 Run `cargo build -p circuits --release` in the SPP repo first."
            )
        })?;
        let wasm_bytes = std::fs::read(wasm_path).map_err(|e| {
            anyhow::anyhow!(
                "Cannot read circuit WASM at '{wasm_path}': {e}\n\
                 Run `cargo build -p circuits --release` in the SPP repo first."
            )
        })?;

        tracing::info!(
            pk_bytes = pk_bytes.len(),
            r1cs_bytes = r1cs_bytes.len(),
            wasm_bytes = wasm_bytes.len(),
            "Proving artifacts loaded"
        );
        Ok(Self { pk_bytes, r1cs_bytes, wasm_bytes })
    }
}
