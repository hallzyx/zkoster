import "server-only";

import { getConfig } from "@/lib/config";

// Mirrors the prover's JSON output (see prover/src/lib.rs BatchJson). All byte
// fields are hex strings in the soroban-sdk BN254 layout.

export interface ProverProof {
  a: string;
  b: string;
  c: string;
}

export interface ProverVk {
  alpha: string;
  beta: string;
  gamma: string;
  delta: string;
  ic: string[];
}

export interface ProverPayout {
  commitment: string;
  proof: ProverProof;
  public_input: string;
}

export interface ProverBatch {
  vk: ProverVk;
  payouts: ProverPayout[];
  total_commitment: string;
}

/**
 * Ask the prover service for the commitments + range proofs + VK of a batch.
 * The cleartext amounts are sent to the company's own prover only — never to
 * the ledger.
 */
export async function proveBatch(
  amounts: number[],
  seed?: number,
): Promise<ProverBatch> {
  const { proverUrl } = getConfig();
  if (!proverUrl) {
    throw new Error("ZKOSTER_PROVER_URL is not set (see .env.example).");
  }

  const res = await fetch(`${proverUrl}/prove`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amounts, seed }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Prover responded ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as ProverBatch;
}
