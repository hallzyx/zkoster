# zkoster-prover

Host-side prover for Zkoster. Produces everything the company needs to drive the
on-chain contracts **without putting a cleartext amount on the ledger**:

- **Pedersen commitments** `C = amount·G + r·H` → `add_payout` / `review_batch`
  and the homomorphic `check_commitment_sum`.
- **Groth16 range proofs** (amount ∈ `[0, 2^64)`) → `execute_payout` / `verify_groth16`.
- the **verifying key** → one-time `set_vk`.

It is a standalone Rust workspace (arkworks, std) — **not** a wasm contract — so
it is excluded from the contracts workspace.

> **Why a host prover is fine for privacy:** in payroll the company already knows
> its own salaries. The privacy boundary is the *public ledger*, which only ever
> sees commitments and proofs. The prover is the company's own infrastructure.

## CLI

```bash
# One-shot: VK + per-payout commitment/proof + batch total, as JSON.
cargo run -- gen --amounts 1000,2500,750 [--seed 42]

# Live HTTP endpoint: POST /prove  { "amounts": [1000,2500,750], "seed": 42 }
cargo run -- serve --port 8787
```

## Output → contract call map

```jsonc
{
  "vk":   { ... },              // → verifier.set_vk(vk)            (once)
  "payouts": [
    {
      "commitment":  "<64B hex>",   // → payroll.add_payout(.., commitment)
      "proof":       { "a","b","c" },// → payroll.execute_payout(.., proof, [public_input])
      "public_input":"<32B hex>"
    }
  ],
  "total_commitment": "<64B hex>"   // → payroll.review_batch(.., total_commitment)
}
```

All bytes use the soroban-sdk BN254 layout: G1 `x‖y` BE (64B), G2
`x.c1‖x.c0‖y.c1‖y.c0` EIP-197 (128B), Fr 32B BE.

## Tests

```bash
cargo test
```

`tests/onchain.rs` registers the real `ZkosterVerifier` contract and asserts the
generated range proofs verify and the commitments sum to the total — on-chain,
no mocks.

## Known simplification

The range proof binds the amount to a field commitment `amount + blinding`. Tying
it cryptographically to the *Pedersen EC* commitment used by the sum check (via an
in-circuit EC opening) is the production hardening step; the MVP uses the same
`(amount, blinding)` for both.
