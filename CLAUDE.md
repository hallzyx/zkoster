# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Zkoster** = ZK + Roster. A private payroll workspace for companies running stablecoin payroll on Stellar without exposing salary amounts, org structure, or payment relationships on the public ledger.

Built for a Stellar hackathon (June 2026). Stack: Soroban smart contracts (Rust) + Next.js 15 frontend.

---

## Architecture

### Smart Contracts (Soroban / Rust)

Three contracts in `/contracts/`:

| Contract | Responsibility |
|---|---|
| `zkoster-payroll` | Treasury management, batch lifecycle, payout commitments, state machine, settlement refs |
| `zkoster-verifier` | Stateless ZK proof verification (Groth16/BN254). Validates batch membership and sum constraints |
| `zkoster-compliance` | Allowlist/denylist membership, `DisclosureGrant` issuance/revocation, auditor access resolution |

**Call flow:** `ZkosterPayroll` → calls `ZkosterVerifier` before executing payouts → calls `ZkosterCompliance` to check recipient eligibility and auditor grants.

**Workspace layout:** `contracts/{shared,compliance,verifier,payroll}`. `shared` (`zkoster-types`) is an rlib-only crate holding cross-boundary types (`MemberRole`, `MemberStatus`, `DisclosureScope`, `Proof`).

**Cross-contract calls — critical pattern:** payroll does NOT depend on the compliance/verifier contract crates at runtime (their `#[contractimpl]` exports collide on `initialize`/`admin`/`set_admin` at wasm link time). Instead, [contracts/payroll/src/clients.rs](contracts/payroll/src/clients.rs) declares `#[contractclient]` interface traits (`ComplianceClient`, `VerifierClient`). The real crates are `dev-dependencies` only, used to register contracts in tests. Keep this pattern when wiring any new cross-contract call.

**Crypto / privacy model:**
- Amounts are stored only as **Pedersen commitments on BN254** (`BytesN<64>`), never cleartext — per payout and per batch total.
- Business rule #5 (`Σ commitments == total`) is checked **homomorphically** via `check_commitment_sum`: it sums the commitment points and tests `(Σ C_i) − total == identity` with a pairing against the VK's `gamma` (an order-r G2 generator). No SNARK needed for the sum.
- Groth16 (`verify_groth16`) covers what the homomorphism can't: per-payout **range proofs**. Built on soroban-sdk 26 BN254 host functions (`e.crypto().bn254()`).
- `Bn254G1Affine` has no `to_bytes`/`PartialEq` — point equality is only expressible via `pairing_check`.
- **Verification is validated with REAL proofs** in [contracts/verifier/tests/groth16_real.rs](contracts/verifier/tests/groth16_real.rs): arkworks generates a genuine Groth16 proof + real Pedersen commitments, the test asserts the on-chain verifier accepts them and rejects tampering. Confirmed serialization: G1 `x‖y` BE (64B), G2 `x.c1‖x.c0‖y.c1‖y.c0` EIP-197 (128B), Fr 32B BE. In-crate unit tests still cover only deterministic paths; the real-crypto checks live in the integration test (uses `ark-*` dev-deps).
- **Prover:** [prover/](prover/) is a standalone (workspace-excluded) arkworks tool that generates Pedersen commitments, Groth16 **range proofs** (amount ∈ `[0,2^64)`) and the VK. CLI (`gen`) + HTTP (`serve`). `prover/tests/onchain.rs` proves its output verifies against the real `ZkosterVerifier` contract — closing the prover↔verifier loop with no mocks.
- **Still pending (hardening):** the range proof binds to a field commitment, not yet cryptographically to the Pedersen EC commitment (in-circuit EC opening). A Noir rewrite is optional.

### Privacy Primitives (Stellar-native)

- **Confidential Tokens / Confidential Transfers**: hides amounts and balances; parties may be visible. Primary candidate for payroll use case per Stellar's own guidance.
- **Stellar Private Payments (SPP)**: hides sender, receiver, and amount via privacy pool. Secondary option if full relationship hiding is needed.
- **ZK Verifier Onchain**: Soroban host functions for Groth16 verification (BN254/Poseidon). Circuits written in Noir.
- **Association Sets**: Merkle membership proofs for KYC allowlists and sanction denylist exclusions.

### Domain Model

Core entities and their relationships:
- `Company` → has `ComplianceMember`s and creates `PayrollBatch`es
- `PayrollBatch` → contains `Payout`s; status machine: `draft → reviewed → approved → funded → processing → paid | partially_flagged | closed`
- `Payout` → stores `private_amount_commitment` (not cleartext); status: `pending → ready → submitted → paid | failed | flagged | disclosed`
- `DisclosureGrant` → scoped to `batch_id` or `payout_id`; scope variants: `totals_only | sample | full_batch`

### Frontend (Next.js 15 App Router)

Three role-based portals in `/app/`:

| Role | Entry | Key screens |
|---|---|---|
| Admin | `/admin` | Dashboard, New Batch, CSV Review, Batch Detail/Payout Status |
| Employee | `/employee` | Payment Portal (own data only) |
| Auditor | `/auditor` | Disclosure View (within `DisclosureGrant` scope) |

Auth is demo/role-select for MVP — no real auth.

---

## Contracts Build & Test

```bash
# Build all contracts to wasm (output: target/wasm32v1-none/release/*.wasm)
stellar contract build

# Run all native tests (workspace root)
cargo test

# Run tests for / target a single contract
cargo test -p zkoster-payroll
cargo test -p zkoster-payroll --lib full_payroll_flow_settles_batch

# Deploy to testnet (requires Protocol 25+/26 network for BN254 host functions)
stellar contract deploy --wasm target/wasm32v1-none/release/zkoster_payroll.wasm --network testnet
```

Toolchain in use: `soroban-sdk 26.1.0` (Protocol 26 / Yardstick), Rust 1.95, `stellar` CLI 23.x. The BN254 host functions require a Protocol 25 (X-Ray) + 26 (Yardstick) network.

## Frontend

```bash
cd app && npm install
npm run dev       # dev server
npm run build     # production build
npm run lint      # ESLint
```

---

## Key Business Rules (enforce in contracts)

1. Only registered companies can create batches.
2. Only `approved` batches can transition to `funded` → execution.
3. Only recipients with `eligibility_status: authorized` (verified via `ZkosterCompliance`) can receive payouts.
4. A payout cannot execute more than once (idempotency guard onchain).
5. Sum of payout commitments must match `total_payroll` committed in the batch.
6. Auditors only access batches/payouts where a valid non-expired `DisclosureGrant` exists.
7. Public ledger must never expose individual salary amounts in cleartext.
8. A batch can only be paid if funded.

---

## MVP Scope Boundaries

**In scope:** batch payroll, CSV upload, three-role demo auth, three Soroban contracts, simulated or semi-real private payout execution, basic receipts, auditor disclosure view.

**Out of scope (do not add):** tax calculation, HRIS integrations, streaming payroll, FX engine, real multi-tenancy, legal onboarding automation.
