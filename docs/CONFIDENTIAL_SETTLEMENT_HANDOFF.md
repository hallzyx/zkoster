# Handoff — ZKash (Confidential Settlement / hidden-amount payouts)

> **Status:** PR1 (backend) DONE & merged to main (`433c610`); T-07 redeploy + PR2 (frontend) still pending.
> **Component name:** **ZKash** (ZK + cash) — flagship confidential-amount layer.
> **Goal:** Hide each employee's payout **amount** on-chain, so only the employee (with their key) and an authorized auditor (with a disclosure grant + viewing key) can read it.
> **SDD change name:** `confidential-settlement` · artifacts in Engram (see "Recovery" below).
> **Relationship to SPP:** the SPP USDC value-transfer rail (`spp-transfer` + `spp-native-prover`) is **DONE** — see `CONFIDENTIAL_USDC_SETTLEMENT_HANDOFF.md`. ZKash (this doc) is a separate, complementary layer that hides the *amount* rather than the *payer/payee relationship*. Both layers are independent and additive.

---

## 0. Progress / Milestone (updated 2026-06-29)

**PR1 — backend — DONE, committed `433c610`, pushed to main.** ✅
- `prover/src/zkash.rs` — full ECIES module (encrypt + employee/auditor decrypt) over ark-bn254 (ChaCha20Poly1305 + SHA256 KDF). cargo round-trip + tamper tests pass.
- Contracts extended: `Member.pub_key` (BytesN<64>), `Payout.enc_r`/`enc_amt` (BytesN<64>/BytesN<40>), `DisclosureGrant.viewing_key` (Option<BytesN<32>>); `register_member`/`add_payout`/`issue_grant` take the new args; `execute_payout` unchanged. **42 tests green, 3 WASM built.**
- **🔑 Interop gate PASSED** (`scripts/zkash_interop.mjs`): a Rust-emitted fixed vector decrypts in Node via `@noble/curves` bn254 → `5000 == 5000` on both employee and auditor paths. **The #1 risk (Rust↔JS byte parity) is closed.**
- Byte layout locked: G1 = `x‖y` BE 64B (no prefix); Fr = 32B BE; one ephemeral `r` per batch; nonce = row index LE; KDF = `SHA256(64B shared point)`; AEAD plaintext = amount u64 LE; `enc_amt` = nonce(12)‖ct(8)‖tag(16)‖zero(4).
- **⚠️ noble gotcha for PR2:** `@noble/curves` bn254 has `fromBytes = notImplemented` for G1 — use `ProjectivePoint.fromAffine({x,y})` + `point.toAffine()` (NOT `fromHex` / `toRawBytes`).

**PENDING:**
- **T-07 — testnet redeploy** (schema changed → fresh deploy, no migration; **wipes the live demo state**). Use `scripts/deploy_testnet.sh` with the frontend admin as SOURCE so creator == owner == admin (see the script header + `EXPECTED_ADMIN` guard). Then update the 3 contract IDs in `frontend/.env.local` and re-seed.
- **PR2 — frontend (T-08..T-16)** — stacked on PR1. `frontend/lib/zkash.ts` (TS mirror), chain.ts decode, chain-writes thread args + `Option<BytesN<32>>` ScVal, employee/auditor decrypt, admin flow. See `sdd/confidential-settlement/tasks` (#253) and `apply-progress` (#254).

---

## 1. Why this exists

Today `execute_payout` (contracts/payroll/src/contract.rs) verifies the Groth16 range proof and marks the payout `Paid` — **no real value moves, and no cleartext amount is ever stored**. The amount lives only as a Pedersen commitment.

We want to keep that privacy property **while making the per-employee amount recoverable by the right parties** (employee + scoped auditor), as the foundation for real confidential value transfer.

### Decision log (how we got here)
- **True "Confidential Transfers / Confidential Tokens" do NOT exist on Stellar yet.** The "Confidential Token Association" (SDF + OpenZeppelin + Zama, Meridian 2025) is a standards body — no CAP, no SEP, no implementation. Protocol 26 (Yardstick) / 27 (Zipper) add none.
- Stellar's official ZK docs are explicit: the BN254/Poseidon host functions *"do not, on their own, provide end-to-end private payments without additional higher-level protocol or application logic."* → **we build the privacy layer ourselves** on the ZK bricks that already work.
- **Chosen path:** build our own minimal confidential-amount layer (the "moat"), reusing our existing Pedersen commitments + Groth16 verifier. We do **not** adopt Stellar Private Payments (SPP) — it's WIP/unaudited and UTXO-shaped (wrong for balance-based payroll).

---

## 2. The scheme — ECIES on BN254-G1

Encrypt the amount to the employee's public key. No new ZK circuit needed for the demo; the existing Pedersen commitment + Groth16 range proof are **unchanged**.

```
r            = ephemeral scalar (Fr), known only to the admin/prover
R            = r·G                        # ephemeral EC point -> stored on-chain (BytesN<64>)
pk_employee  = sk·G                       # employee public key (BN254-G1)
shared       = r·pk_employee = sk·R       # ECDH shared secret
key          = SHA256(shared)
enc_amt      = ChaCha20Poly1305(key, nonce=payout_id, plaintext=amount_u64_le)   # ~40 bytes on-chain
```

- `R` and `sk·R` are just `g1_mul` — the **same host op** our verifier already calls.
- The amount **never** appears in cleartext in contract storage, tx args, or events.
- **Why not full Zether (twisted ElGamal):** recovering `amount` from `amount·G` needs baby-step-giant-step (~64 MB table for stroop-scale amounts). ECDH sidesteps that entirely.

### Noir / UltraHonk — deferred (with evidence)
Writing the circuit in Noir + verifying via an UltraHonk Soroban verifier is **not testnet-ready as of June 2026**: the UltraHonk verifier is still ~112M CPU instructions (over the ~100M budget), localnet-only, requires `--limits unlimited`. Keep **arkworks/Groth16** (already working on testnet). Noir is a **future upgrade**, not for this PoC.

---

## 3. Architecture (no new contract)

Extend the existing contracts following the `#[contractclient]` cross-contract pattern.

### Contract changes
- **`contracts/payroll/src/types.rs` — `Payout`** add:
  ```rust
  pub enc_r:   BytesN<64>,   // r·G  (ephemeral EC point for ECDH)
  pub enc_amt: Bytes,        // ChaCha20Poly1305 ciphertext of amount_u64_le (~40 bytes)
  ```
- **`contracts/payroll/src/contract.rs` — `add_payout`**: accept `enc_r` + `enc_amt` alongside the existing `amount_commitment`. `execute_payout` stays **unchanged** (still verifies the range proof).
- **`contracts/compliance/src/types.rs` — `DisclosureGrant`** add:
  ```rust
  pub viewing_key: Option<BytesN<32>>,   // r (Fr, big-endian) handed to the auditor
  ```
- **`contracts/compliance/src/contract.rs` — `issue_grant`**: accept the optional `viewing_key`. `can_access` logic is **unchanged**.
- **`contracts/shared/src/lib.rs`** (optional): an `EmployeePublicKey` newtype. The employee `pk` must live somewhere readable — add a field to `Member` (compliance) **or** define a wallet→key derivation convention. **OPEN QUESTION — decide in design.**

### Prover (off-chain, Rust — `ark-bn254` already in Cargo.toml)
- New file **`prover/src/elgamal.rs`**:
  ```rust
  pub fn derive_employee_pubkey(sk: Fr) -> G1Affine;                 // sk·G
  pub fn ecies_encrypt(pk: G1Affine, amount: u64, r: Fr) -> ([u8;64], Vec<u8>);  // (R, enc_amt)
  pub fn ecies_decrypt_employee(sk: Fr, r_bytes: &[u8;64], enc_amt: &[u8]) -> u64;
  pub fn ecies_decrypt_auditor(r: Fr, pk: G1Affine, enc_amt: &[u8]) -> u64;
  ```
- `prover/src/main.rs` `gen` command: output `enc_r` + `enc_amt` per payout alongside the existing commitment/proof.

### Frontend
- **Employee portal** (`frontend/app/employee/`): input `sk` → ECDH (`@noble/curves/bn254`) → decrypt `enc_amt` → show amount. Today amounts come from off-chain metadata; this replaces that with **real client-side decryption**.
- **Auditor portal** (`frontend/app/auditor/`): read `viewing_key` from the `DisclosureGrant` → decrypt → show amount, **scoped** by grant.
- **Admin new-batch flow**: prover output now carries `enc_r` + `enc_amt`; thread them into `add_payout`.

---

## 4. The elegant part — viewing key ↔ disclosure grants

The existing grant scopes map **directly** onto decryption capability (zero changes to `can_access`):

| DisclosureScope | `viewing_key` | Auditor can… |
|---|---|---|
| `TotalsOnly` | `None` | see only the batch total commitment |
| `Sample` (one payout) | `Some(r)` | decrypt that one `enc_amt` |
| `FullBatch` | `Some(r)` per payout | decrypt every payout |

This is the strongest pitch line: *"On the public Stellar ledger you see commitments and proofs — never salaries. Employees decrypt their own amount with their private key. Auditors decrypt only what their disclosure grant scopes — and the grant itself is on-chain and revocable."*

---

## 5. Deposit / withdraw edge (a strength, not a weakness)

- **Deposit:** company sends the lump-sum USDC total to treasury (revealed once — already matches the public `total_commitment`). Acceptable: it's an aggregate, not individual salaries.
- **Internal:** per-employee `enc_amt` stays hidden on-chain. This is the private part.
- **Settlement:** for the demo, `execute_payout` stays as-is (marks Paid); real SAC movement is a separate later step. The confidentiality of the **per-person amount** is what we're proving here.

---

## 6. Smallest demoable slice — 3 days

**Scope: one batch, one employee, one auditor.**

- **Day 1 — Contracts:** add `enc_r`/`enc_amt` to `Payout`; add `viewing_key` to `DisclosureGrant`; update `add_payout` + `issue_grant` signatures + storage; redeploy fresh contracts to testnet (no migration — fresh deploy). Update the 3 contract IDs in `frontend/.env.local`.
- **Day 2 — Prover:** `prover/src/elgamal.rs` (ECIES) + CLI emits `enc_r`/`enc_amt`; unit test: `encrypt → decrypt_employee` and `decrypt_auditor` both recover the amount.
- **Day 3 — Frontend:** employee decrypt (key in → amount out), auditor decrypt via grant `viewing_key`, admin flow threads the new fields.

## 7. Fallback (if ECIES on the client is too fiddly) — 1 day

XOR field masking, **no new EC code**:
```
enc_amt = amount_bytes XOR blake3(r_bytes || payout_id_bytes)[0..8]   # 8 bytes on-chain
viewing_key = r
```
Employee/auditor XOR the same hash to unmask. Same UX ("enter your key, see your salary"), cryptographically weaker (no ECDH). **Build this FIRST as the 1-day version, then upgrade to ECIES.**

---

## 8. Open questions / sharpest unknowns (resolve in design)

1. **Employee public key storage** — add `pub_key` to `Member` (compliance) vs derive from wallet. Needs one decision before Day 1.
2. **`@noble/curves` BN254-G1 API** — confirm `G1.multiply(scalar)` and that its point (de)serialization matches the prover's BN254 byte layout (G1 = `x‖y` BE, 64B — see CLAUDE.md crypto notes).
3. **Soroban `Bytes` vs `BytesN<40>`** for `enc_amt` — `BytesN<40>` (fixed) is simpler if we pin cipher params; `Bytes` (variable) needs a `to_val()` conversion.
4. **Amount ↔ commitment binding** — the Groth16 circuit currently binds the range proof to a *field* commitment, not the EC Pedersen point (existing known gap, see CLAUDE.md "Still pending"). ECIES does not close this; an in-circuit EC opening (Noir rewrite) is the eventual hardening. Acceptable for PoC; document it.

## 9. Effort / risk

| Item | Est. | Risk |
|---|---|---|
| Contract changes (additive fields) | 0.5d | Low |
| Prover ECIES module | 0.5d | Low (arkworks present) |
| Frontend employee decrypt | 0.5d | Medium (@noble/curves BN254 quirks) |
| Frontend auditor decrypt | 0.5d | Low |
| Integration test + redeploy | 1d | Medium (fresh testnet deploy) |
| **Total** | **~3d** | |

## 10. Affected / new files

**Modify:** `contracts/payroll/src/types.rs`, `contracts/payroll/src/contract.rs`, `contracts/compliance/src/types.rs`, `contracts/compliance/src/contract.rs`, `contracts/shared/src/lib.rs` (optional), `prover/src/lib.rs` + `prover/src/main.rs`, `frontend/app/employee/page.tsx`, `frontend/app/auditor/page.tsx`, admin new-batch flow + `frontend/lib/data/chain-writes.ts`.
**New:** `prover/src/elgamal.rs`.

## 11. Recovery (Engram topic keys, project `zkoster`)

- `sdd/confidential-settlement/explore` — landscape (why no turnkey primitive; approaches A–D)
- `sdd/confidential-settlement/explore-poc` — **this PoC design (authoritative)**
- Related context: `#245` (execute_payout does not transfer USDC), `#240`/`#242`/`#243`/`#244` (explorer links, auditor toolkit, receipts) — adjacent UX features to do AFTER this.

## 12. Sources (with dates)

- PGC: Pretty Good Confidential Payment System — ePrint 2019/319 (twisted ElGamal, audit key; ESORICS 2020)
- Zether — Financial Crypto 2020 (account-based ElGamal)
- UltraHonk Soroban Verifier, Milestone 3 — HackMD, Jun 2025 (localnet only, over CPU budget)
- Stellar BN254 additional host functions — github.com/orgs/stellar/discussions/1826 (P26: MSM, Fr arithmetic)
- noir-lang discussion #8509 — UltraHonk Soroban (~112M instructions, still over budget)
- tupui/ultrahonk_soroban_contract ; jamesbachini/Noirlang-Experiments
- Stellar ZK app docs — developers.stellar.org/docs/build/apps/zk ("building blocks … do not, on their own, provide end-to-end private payments")

---

## Next-day checklist (start here)

- [ ] Decide employee-pubkey storage (Q1) → unblock contract schema.
- [ ] Implement the **XOR fallback first** (1 day) for an end-to-end demoable path.
- [ ] Then upgrade to ECIES (Days 1–3 above).
- [ ] Resume SDD: `sdd-propose` for `confidential-settlement` reading `sdd/confidential-settlement/explore-poc`.
