# SPP Claim Bug — Handoff & Build Guide

> **Status**: Half-fixed. The SPP deposit path works end-to-end. The SPP claim path
> fails with `Error(Contract, #0)` because the prover's `membership_proof.root`
> is precomputed at startup and never matches the pool's authoritative
> `asp_membership_root` once the pool has been initialized with real leaves.
>
> **Last updated**: 2026-06-29 (hackathon weekend session).

## TL;DR

The project has a fully functional ZKash flow (amount-privacy via Pedersen + Groth16
range proofs) and a working SPP **deposit** path. The SPP **claim** path is one
prover-side change away from working. The change is documented in §4 and is
~10 lines split across two files.

## 1. Architecture quick map

- `frontend/` — Next.js 15 App Router. Three role-based portals (Admin, Employee,
  Auditor). Talks to Stellar testnet via `@stellar/stellar-sdk` and to two local
  prover HTTP servers.
- `contracts/` — Three Soroban contracts (compliance, verifier, payroll) deployed
  on Stellar testnet.
- `spp-prover/` — Axum HTTP service on port 8788. Generates Groth16 proofs for the
  Nethermind SPP pool/withdraw paths.
- `prover/` (renamed `zkoster-prover` internally) — Axum HTTP service on port 8787.
  Generates Pedersen commitments + Groth16 range proofs for ZKash.
- Nethermind SPP at `C:/temp/spp/` (Windows box) or `/tmp/spp/` (WSL2). NOT in this
  repo — it's an external dependency.

## 2. What works today (after the 2026-06-29 fixes)

| Flow | Status | TX on Stellar testnet |
|---|---|---|
| Admin: create batch | ✅ | real |
| Admin: review / approve / fund | ✅ | real |
| Admin: execute payouts (ZKash on-chain) | ✅ | real (e.g. `4bb41c94…5a6b6c`) |
| Admin: SPP deposit to privacy pool | ✅ | real (e.g. `635bfae9…8f03da`) |
| Employee: SPP **claim** / withdraw | ❌ | fails with `Error(Contract, #0)` |
| Auditor: disclosure grants + viewing | ✅ (frontend only) | n/a (frontend reads off-chain) |

The Claim fails because the on-chain Nethermind verifier rejects the proof
(public input `asp_membership_root` mismatch). Root cause: §3.

## 3. Root cause of the Claim failure

The Nethermind SPP verifier (deployed on chain at
`CBKOZTEYI5RAGSUKWAQEC4V6MRYDC4KL2D3PRPKMLWHTMXMFSCBVUJXX`) validates the
Groth16 proof against these public inputs:
- `pool_root` — Merkle root of the deposit commitments
- `asp_membership_root` — Merkle root of the allowed-depositor pubkey tree
- `asp_non_membership_root` — root of the SMT that proves the depositor's pubkey
  is NOT already a member
- `input_nullifiers[0..1]` — to prevent double-spend
- `output_commitments[0..1]` — the new commitments
- `public_amount`, `ext_data_hash` — accounting

`membership_proof.root` is bound into the Groth16 proof at witness-generation
time, so it must equal the pool's authoritative `asp_membership_root` at the
moment the proof is verified.

**The bug**: the local `spp-prover` computes `state.membership.proof` ONCE at
startup (in `spp-prover/src/state.rs::compute_membership_state`) with a single
leaf in a tree of depth 10. The pool's authoritative `asp_membership_root`
on testnet is `6731605845228100536383840723564806187967547925495056315034398112041530379720`
(visible in any Claim event log), which is the root after `insert_leaf` was
called with the depositor's real pubkey.

The two roots diverge → the verifier's on-chain check `poseidon2_compress(...)`
mismatches the proof's claimed root → `Error(Contract, #0)`.

**The encoding itself is correct**: the prover's `merkle.rs` and the pool's
`merkle_with_history.rs` use the same `poseidon2_compression` (Poseidon2 with
t=3, r=2, c=1), the same `ZERO_LEAF_BYTES` hardcoded constant, and the same
binary tree shape. Only the membership tree's root is wrong.

## 4. The fix

### Already applied (commit `6e0cfca` on branch `spp-claim-root-cause`)

`frontend/lib/spp/pool-client.ts`:
- Added `readAspMembershipRoot()` helper (simulates `get_root` on the
  `CBTOY7I7SERRSAOTUAY7CAMHZZBZS2MYOUQUAW7BE6L3SOA7T3NCHCUU` contract).
- Both `depositToPool()` and `claimFromPool()` now read the live
  `asp_membership_root` and include it in the `POST /spp/deposit` and
  `POST /spp/withdraw` request bodies.
- Refactored `readPoolRoot` into a generic `readRootByName` helper.

TypeScript clean. The change is forward-compatible: when the prover gets
the matching route handler change, the existing request body shape already
includes `asp_membership_root`, no second frontend change is needed.

### NOT YET applied (the second half)

The prover's route handlers need to accept and use that field. Apply both
edits in the Nethermind SPP repo at `spp-prover/src/routes/`:

**`deposit.rs`** — three small edits:

```rust
// 1. Add the field to DepositRequest (around line 22):
pub asp_membership_root: String,

// 2. Parse it after the existing pool_root parse (around line 79):
let asp_membership_root =
    parse_field_be_hex(&req.asp_membership_root, "asp_membership_root")?;

// 3. Override the precomputed proof's root (around line 97, replace the existing
//    `let membership_proof = state.membership.proof.clone();`):
let mut membership_proof = state.membership.proof.clone();
membership_proof.root = asp_membership_root;
```

**`withdraw.rs`** — same three edits:
1. Add `pub asp_membership_root: String,` to `WithdrawRequest`.
2. Parse after the `pool_root` parse.
3. Replace `let membership_proof = state.membership.proof.clone();` with the
   `membership_proof.root = asp_membership_root;` override.

**Why this works**: `membership_proof.root` is a public input of the
circuit. The witness generator reads the field and binds it into the
Groth16 proof. The precomputed `membership_proof` from `state.rs` is correct
in all its other fields (leaf, blinding, path_elements) — only the
declared `root` is wrong, and the circuit only checks that the path
actually hashes up to the declared root, which it trivially does for a
single-leaf tree.

## 5. How to finish the build on Linux

The Nethermind `circuits` crate has a `build.rs` that overflows the stack
on Windows (cargo 1.96 from WSL2 still hits it). A full Linux build
environment is required.

```bash
# 1. Clone Nethermind SPP (the upstream Nethermind privacy pool repo).
git clone https://github.com/NethermindEth/spp /opt/spp

# 2. Apply the four edits above to /opt/spp/prover/src/routes/{deposit,withdraw}.rs
#    (paths inside the Nethermind repo; equivalent to this repo's
#    spp-prover/src/routes/*.rs but in the Nethermind source tree).

# 3. Build Nethermind SPP — produces the prover lib + the WASM circuits.
cd /opt/spp
cargo build --release
# This produces /opt/spp/target/release/libprover.rlib and the WASM
# artifacts. 5-15 min the first time.

# 4. Re-point this repo's spp-prover at the Nethermind libs.
#    Edit spp-prover/Cargo.toml path dependencies from the
#    C:/temp/spp/app/crates/core/* (or /tmp/spp/*) hardcoded paths to
#    /opt/spp/app/crates/core/*.

# 5. Rebuild + restart the local prover.
cd /path/to/zkoster/spp-prover
cargo build --release
./target/release/spp-prover   # serves on :8788

# 6. Smoke test the claim path.
#    In the browser: Admin → create batch → approve → fund → SPP deposit
#    (works today). Then Employee → Claim from Privacy Pool. Should now
#    land on chain with a real TX hash instead of `Error(Contract, #0)`.
```

## 6. What is NOT in scope for this fix

- **Amount ↔ commitment binding gap** (documented in
  `docs/CONFIDENTIAL_SETTLEMENT_HANDOFF.md`): the ZKash range proof binds to
  a field commitment, not to the Pedersen EC commitment. In-circuit EC
  opening would require a Noir rewrite. Deferred per the handoff.
- **Testnet congestion** (handled separately on branch `harden-admin-flow`,
  merged to main): `writeContract` now retries lost-mempool TXs automatically
  (5 outer attempts with fresh sequence number, 8s backoff between attempts).
  This was the gap that made `create_batch` fail with `EmptyBatch` on
  batch N+1 after a previous successful one.

## 7. Engram memory pointers

- Memory #275 (topic `spp/fix-t06-sp-deposit-claim`): the original T-06 fix
  for InvalidProof that landed in `feat/spp-transfer` → main. The 3 fixes
  applied there (startLedger range, topic[1] discriminant, pre-deposit
  state pattern) are all in current `pool-client.ts` and remain correct.
- Memory #280 (topic `spp/membership-proof-root-mismatch`): the current
  root-cause analysis and the prover-side patch template. Read this
  before resuming work.
- Memory #278 (topic `spp/tx-lost-in-mempool`): the `writeContract`
  retry strategy.

## 8. Quick-reference addresses (Stellar testnet, June 2026)

- zkoster payroll: `CCYBEFE6ZW4AWXZV2XV6IU2MYJQN44QIGPD3OSOKGWGXQ7QPNJK76VDM`
- zkoster compliance: see `frontend/lib/config.ts`
- SPP USDC pool (deployed by zkoster-admin, 2026-06-28): `CALWH3FKYAEVI4HMLWTMLFRVJSQ45ZGIQYQR32PX6BONK2YSKACZ5IWL`
- ASP membership (depth 10): `CBTOY7I7SERRSAOTUAY7CAMHZZBZS2MYOUQUAW7BE6L3SOA7T3NCHCUU`
- ASP non-membership (empty SMT): `CC3VYWSZBIQCBDXP2XXQIY22CUKBQSYDMU7ER4POXMVDATLZRRYJGFET`
- Circom Groth16 verifier: `CBKOZTEYI5RAGSUKWAQEC4V6MRYDC4KL2D3PRPKMLWHTMXMFSCBVUJXX`
- Sofía Giménez (employee wallet for demo): `GBZIXC7CQVPGAQGLXR44FBWI4RHOBX4IQZOYOW6TTRPR6N6FYSG6NCCS`
- Display scale: 1000 UI = 1 USDC on chain. Testnet faucet gives ~1 USDC per wallet.
