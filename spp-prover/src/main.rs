mod routes;
mod soroban_encode;
mod state;

use axum::{Router, routing::{get, post}};
use clap::Parser;
use state::{ProverState, SharedState};
use std::sync::Arc;

const DEFAULT_PORT: u16 = 8788;
const DEFAULT_PK: &str = "artifacts/policy_tx_2_2_proving_key.bin";
const DEFAULT_R1CS: &str = "artifacts/policy_tx_2_2.r1cs";
const DEFAULT_WASM: &str = "artifacts/policy_tx_2_2.wasm";

#[derive(Parser, Debug)]
#[command(name = "spp-prover", about = "SPP Groth16 proof generation HTTP server")]
struct Args {
    #[arg(long, env = "SPP_PROVER_PORT", default_value_t = DEFAULT_PORT)]
    port: u16,

    #[arg(long, env = "SPP_PK_PATH", default_value = DEFAULT_PK)]
    pk: String,

    #[arg(long, env = "SPP_R1CS_PATH", default_value = DEFAULT_R1CS)]
    r1cs: String,

    #[arg(long, env = "SPP_WASM_PATH", default_value = DEFAULT_WASM)]
    wasm: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "spp_prover=info".into()),
        )
        .init();

    let args = Args::parse();

    let state: SharedState = Arc::new(ProverState::load(&args.pk, &args.r1cs, &args.wasm)?);

    let app = Router::new()
        .route("/health", get(routes::health::handler))
        .route("/spp/membership", get(routes::membership::handler))
        .route("/spp/deposit", post(routes::deposit::handler))
        .with_state(state);

    let addr = format!("127.0.0.1:{}", args.port);
    tracing::info!("SPP prover listening on http://{addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
