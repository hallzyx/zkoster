# Handoff — SPP / Confidential USDC Settlement

> **Status:** DONE — shipped as two SDD changes: `spp-transfer` + `spp-native-prover`.
> **Branch:** `feat/spp-transfer` → merged to `main` (2026-06-28/29).
> **What it does:** moves real USDC through Stellar Private Payments (SPP) so deposit and claim are unlinkable on-chain. The company is not visible as the payer from the employee's perspective on the public ledger.

---

## 0. What was built

### Layer map

| Layer | What it hides | Status |
|---|---|---|
| **ZKash** (Pedersen + ECIES) | the recorded amount (commitment + ciphertext) | PR1 done; PR2 pending — see `CONFIDENTIAL_SETTLEMENT_HANDOFF.md` |
| **SPP USDC rail** (this doc) | the payer → payee relationship (deposit and claim are unlinkable) | **DONE** |

### Architecture (protocol-bridge pattern)

Three layers, each independent:

1. **zkoster-payroll contract** — stores a 32-byte `spp_deposit_ref` per batch as tamper-evident on-chain anchor. Added two new admin functions: `set_spp_pool` (config) and `record_spp_deposit` (per-batch anchor).
2. **SPP pool contract** — standard Nethermind SPP pool (`CALWH3FK…`), deployed and bound to the USDC SAC. Never called by the payroll contract directly — the frontend bridges them.
3. **spp-prover** (Rust / Axum, port 8788) — standalone HTTP server that generates real Groth16 proofs for SPP deposit and withdraw using `PolicyTransaction(2,2,1,1,10,10)` circuit. Output: 256-byte proof + public inputs, ready for the pool contract.

### Key contracts / addresses (Stellar testnet)

| Resource | Address / ID |
|---|---|
| SPP USDC pool (active) | `CALWH3FKYAEVI4HMLWTMLFRVJSQ45ZGIQYQR32PX6BONK2YSKACZ5IWL` |
| USDC SAC (Circle testnet) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| USDC issuer | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| ASP membership tree | `CBTOY7I7SERRSAOTUAY7CAMHZZBZS2MYOUQUAW7BE6L3SOA7T3NCHCUU` |
| ASP non-membership SMT | `CC3VYWSZBIQCBDXP2XXQIY22CUKBQSYDMU7ER4POXMVDATLZRRYJGFET` |
| Circom Groth16 verifier | `CBKOZTEYI5RAGSUKWAQEC4V6MRYDC4KL2D3PRPKMLWHTMXMFSCBVUJXX` |
| Previous pool (XLM, retired) | `CBHXAGR6CLDIGT6MR42EXWDI2XHD6RZRVTCZZWHVMRBYYSGCQW5O4ORM` |

### Amount encoding

UI display units where 1000 = 1 USDC. Conversion to stroops: `stroops = display_units × 10_000` (USDC has 7 decimals on Stellar: 1 USDC = 10 000 000 stroops).

---

## 1. Flow (end-to-end)

```
Admin portal                  spp-prover (:8788)        Testnet
───────────────────────────── ─────────────────────────  ──────────────────────
1. Execute payouts          → verifies Groth16 range     payroll.execute_payout()
2. Deposit to Privacy Pool  → POST /deposit              pool.transact(deposit_proof)
                               real Groth16 proof         → USDC leaves admin wallet
                               note stored in IndexedDB   → spp_deposit_ref anchored
3. Employee: Claim          → POST /withdraw             pool.transact(withdraw_proof)
                               real Groth16 proof         → USDC arrives at employee
                               note consumed               wallet (source = pool, not admin)
```

The deposit and claim transactions have **no on-chain link**. A blockchain observer sees:
- Admin wallet → pool contract (USDC in)
- Pool contract → employee wallet (USDC out)

They cannot determine these two txs belong to the same payroll batch without the note (which lives only in the browser's IndexedDB, never on-chain).

---

## 2. Key files

| File | Role |
|---|---|
| `frontend/lib/spp/pool-client.ts` | deposit + claim logic; talks to spp-prover; polls tx confirmation |
| `frontend/lib/spp/config.ts` | pool addresses, DEMO_POOL, PROVER_BASE_URL |
| `frontend/lib/spp/notes.ts` | SppNote type; IndexedDB persistence |
| `frontend/app/admin/batches/[id]/_components/SppDepositStep.tsx` | admin UI for deposit |
| `frontend/app/employee/ClaimFromPool.tsx` | employee UI for claim |
| `frontend/app/admin/actions.ts` | `depositToPrivacyPoolAction` (amount conversion + deposit call) |
| `frontend/app/employee/actions.ts` | `claimPayoutFromPool` |
| `spp-prover/src/routes/deposit.rs` | `/deposit` handler — Groth16 deposit proof |
| `spp-prover/src/routes/withdraw.rs` | `/withdraw` handler — Groth16 withdraw proof |
| `contracts/payroll/src/contract.rs` | `set_spp_pool` + `record_spp_deposit` |

---

## 3. Running the prover

```bash
cd spp-prover
cargo run --release -- serve   # listens on :8788
# or: cargo run --release -- gen  (CLI mode for one-shot proof)
```

Health check: `curl http://127.0.0.1:8788/health` → `{"status":"ok"}`.

The dev server (`npm run dev` in `frontend/`) reads `PROVER_BASE_URL` from `process.env.SPP_PROVER_URL` or defaults to `http://127.0.0.1:8788`.

---

## 4. Known limitations / next steps

- **Note persistence is browser-local (IndexedDB).** If the employee clears their browser storage before claiming, the note is lost and the USDC is stuck in the pool. For production, notes should be encrypted and backed up server-side or in a user-controlled key store.
- **ASP trees are empty** (depth-10 Poseidon2 empty tree). For production, real association set membership (KYC allowlist, sanctions denylist) must be committed to the on-chain ASP roots.
- **Amount ↔ commitment binding gap** (inherited, not introduced here): the Groth16 range proof binds to a field commitment, not the EC Pedersen point. The SPP proof and the ZKash commitment are not cryptographically linked. Acceptable for hackathon demo; closing this requires an in-circuit EC opening (Noir rewrite — deferred).
- **Single-note per batch.** The current deposit bundles the full batch total into one note. A production version would issue one note per employee to preserve unlinkability at the per-payout level.

---

## 5. Recovery (Engram, project `zkoster`)

- `sdd/spp-transfer/*` — protocol-bridge design + tasks (T-01 … T-10, all complete)
- `sdd/spp-native-prover/*` — Rust prover design + tasks (T-01 … T-06, all complete)
- Bugfix memory: "T-06 SPP deposit+claim fixed: getEvents bugs + pre-deposit state pattern"
- Bugfix memory: "SPP pool pays native XLM, not USDC (root cause of 'no USDC received')"
