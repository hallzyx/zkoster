//! Zkoster prover CLI / HTTP service.
//!
//!   zkoster-prover gen --amounts 1000,2500,750            # one-shot JSON
//!   zkoster-prover serve --port 8787                      # live HTTP endpoint
//!
//! Both produce the same artifacts (VK + per-payout commitment/proof + total)
//! that drive the on-chain contracts.

use axum::{routing::post, Json, Router};
use clap::{Parser, Subcommand};
use serde::Deserialize;

use zkoster_prover::{gen_batch_json, gen_batch_raw, BatchJson};

#[derive(Parser)]
#[command(name = "zkoster-prover", about = "Zkoster commitment + range-proof prover")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Generate VK + commitments + range proofs for a batch of amounts.
    Gen {
        /// Comma-separated payout amounts, e.g. 1000,2500,750
        #[arg(long, value_delimiter = ',', required = true)]
        amounts: Vec<u64>,
        /// RNG seed (deterministic output).
        #[arg(long, default_value_t = 42)]
        seed: u64,
    },
    /// Serve proofs over HTTP: POST /prove { "amounts": [...], "seed": 42 }.
    Serve {
        #[arg(long, default_value_t = 8787)]
        port: u16,
    },
}

#[derive(Deserialize)]
struct ProveReq {
    amounts: Vec<u64>,
    #[serde(default)]
    seed: Option<u64>,
}

async fn prove_handler(Json(req): Json<ProveReq>) -> Json<BatchJson> {
    let batch = gen_batch_raw(&req.amounts, req.seed.unwrap_or(42)).into();
    Json(batch)
}

fn main() {
    match Cli::parse().cmd {
        Cmd::Gen { amounts, seed } => {
            println!("{}", gen_batch_json(&amounts, seed));
        }
        Cmd::Serve { port } => {
            let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
            rt.block_on(async move {
                let app = Router::new().route("/prove", post(prove_handler));
                let addr = format!("0.0.0.0:{port}");
                let listener = tokio::net::TcpListener::bind(&addr)
                    .await
                    .expect("bind listener");
                println!("zkoster-prover listening on http://{addr}  (POST /prove)");
                axum::serve(listener, app).await.expect("serve");
            });
        }
    }
}
