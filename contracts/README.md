# Zkoster Contracts

Three Soroban contracts (Rust, `soroban-sdk 26.1.0`). One deployment of the trio
== one company workspace.

```
ZkosterPayroll ──calls──▶ ZkosterVerifier   (ZK math: Groth16 + commitment sum)
       │
       └────────calls──▶ ZkosterCompliance  (membership, denylist, disclosure grants)
```

## Build & test

```bash
make build     # → target/wasm32v1-none/release/*.wasm
make test      # native test suite
make lint      # clippy, warnings = errors
make sizes     # wasm byte sizes
```

## Deploy & wire (order matters)

```bash
ASSET=<usdc-sac-address> make deploy-testnet SOURCE=<funded-key>
```

Compliance and verifier deploy first (no deps); payroll is wired to both at
`initialize`. After the Noir circuit exists, set the verifying key:
`verifier.set_vk(vk)`.

## Frontend bindings

```bash
make bindings NAME=payroll ID=<contract-id> NETWORK=testnet
```

---

## Privacy model (what the frontend must know)

- **Amounts are never on-chain in cleartext.** Each payout and the batch total
  are stored as **Pedersen commitments on BN254** (`BytesN<64>`). The cleartext
  amount lives off-chain (admin's CSV, receipts).
- The frontend/admin computes commitments off-chain and submits only the
  `BytesN<64>` commitment + the Groth16 range proof.
- `total_commitment` must equal `Σ payout commitments` (homomorphically) — the
  blinding factor of the total must be the sum of per-payout blinding factors.

---

## Public interface

### ZkosterCompliance

| Function | Auth | Purpose |
|---|---|---|
| `initialize(admin)` | — | Bind instance to a company admin |
| `set_admin(new_admin)` | admin | Rotate admin |
| `admin() -> Address` | — | Read admin |
| `register_member(wallet, role)` | admin | Add/authorize a member (`Employee`/`Auditor`/`Admin`) |
| `set_member_status(wallet, status)` | admin | `Authorized` / `Revoked` |
| `set_denied(wallet, denied)` | admin | Sanction denylist |
| `is_authorized(wallet) -> bool` | — | Eligibility (member + Authorized + not denied) |
| `get_member(wallet) -> Option<Member>` | — | Member record |
| `is_denied(wallet) -> bool` | — | Denylist check |
| `issue_grant(grantee, batch_id, payout_id, scope, expires_at) -> u64` | admin | Issue auditor disclosure grant |
| `revoke_grant(grant_id)` | admin | Revoke a grant |
| `get_grant(grant_id) -> Option<DisclosureGrant>` | — | Grant record |
| `get_grantee_grants(grantee) -> Vec<u64>` | — | All grant ids for an auditor |
| `can_access(grantee, batch_id, payout_id) -> bool` | — | Resolve auditor access |

**Grant rules:** `payout_id == 0` ⇒ whole-batch; non-zero ⇒ single payout.
`scope == Sample` requires a specific payout; `TotalsOnly`/`FullBatch` require
`payout_id == 0`. `expires_at == 0` ⇒ no expiry.

### ZkosterVerifier (stateless math arbiter)

| Function | Auth | Purpose |
|---|---|---|
| `initialize(admin)` | — | Bind admin |
| `set_vk(vk)` | admin | Register the Groth16 verifying key |
| `get_vk() -> Option<VerifyingKey>` | — | Read VK |
| `verify_groth16(proof, public_inputs) -> bool` | — | Verify a payout range proof |
| `check_commitment_sum(commitments, total) -> bool` | — | `Σ commitments == total` (homomorphic) |

### ZkosterPayroll (orchestration)

| Function | Auth | Purpose |
|---|---|---|
| `initialize(admin, treasury, asset, compliance, verifier)` | — | Wire the workspace |
| `config() -> Config` | — | Read wiring/treasury config |
| `create_batch(period_start, period_end) -> u64` | admin | New `Draft` batch |
| `add_payout(batch_id, employee, amount_commitment) -> u64` | admin | Add payout (checks eligibility) |
| `review_batch(batch_id, total_commitment)` | admin | `Draft → Reviewed` |
| `approve_batch(batch_id)` | admin | `Reviewed → Approved` (verifies sum) |
| `fund_batch(batch_id)` | admin | `Approved → Funded` |
| `execute_payout(batch_id, payout_id, proof, public_inputs, tx_ref)` | admin | Verify proof + settle (idempotent) |
| `flag_payout(batch_id, payout_id)` | admin | Flag for review |
| `set_receipt(payout_id, receipt_ref)` | admin | Attach receipt reference |
| `close_batch(batch_id)` | admin | `Paid`/`PartiallyFlagged → Closed` |
| `get_batch(batch_id) -> Option<Batch>` | — | Batch record |
| `get_payout(payout_id) -> Option<Payout>` | — | Payout record |
| `get_batch_payouts(batch_id) -> Vec<u64>` | — | Payout ids in a batch |
| `batch_count() -> u64` | — | Dashboard: ids run `1..=batch_count` |
| `get_employee_payouts(employee) -> Vec<u64>` | — | Employee Portal: own history |

**Batch status:** `Draft → Reviewed → Approved → Funded → Processing → Paid`
(plus `PartiallyFlagged`, `Closed`).
**Payout status:** `Pending → … → Paid` (plus `Failed`, `Flagged`, `Disclosed`).

### Screen → call map

| Screen | Reads |
|---|---|
| Admin Dashboard | `batch_count`, `get_batch` per id |
| New Batch | `create_batch` |
| CSV Review | `add_payout` ×N, `review_batch`, `get_batch_payouts` |
| Batch Detail / Payout Status | `get_batch`, `get_batch_payouts`, `get_payout`, `approve/fund/execute` |
| Employee Portal | `get_employee_payouts`, `get_payout` |
| Auditor Disclosure View | `get_grantee_grants`, `can_access`, `get_batch`, `get_payout` |

---

## Status

- **Cross-contract pattern:** payroll uses `#[contractclient]` interface traits
  (`src/clients.rs`), not crate deps — avoids duplicate wasm export symbols.
- **ZK verification is validated against REAL proofs.**
  [`verifier/tests/groth16_real.rs`](verifier/tests/groth16_real.rs) generates a
  genuine Groth16/BN254 proof and real Pedersen commitments with arkworks, then
  asserts the on-chain verifier accepts valid inputs and rejects tampered ones.
  This confirms both the pairing logic and the byte serialization:
  - **G1**: `x ‖ y`, 32-byte big-endian each (64 bytes).
  - **G2**: `x.c1 ‖ x.c0 ‖ y.c1 ‖ y.c0` (EIP-197 ordering, 128 bytes).
  - **Fr** (public inputs): 32-byte big-endian.

### Remaining for production

- The **payout range-proof circuit** (Noir) is not yet written — the fixture
  circuit (`a·b == c`) only validates the verifier, not the payroll semantics.
- `set_vk` must be called with that circuit's real verifying key before use.
