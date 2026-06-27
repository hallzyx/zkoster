# Handoff — Confidential USDC Settlement (value-transfer rail)

> **Status:** PLANNED — checkpoint only, NOT started. Pick up here after ZKash PR2 + testnet redeploy land.
> **Component:** the **value-transfer rail** that sits at the FINAL settlement step, on top of ZKash.
> **Goal:** at settlement, move **real USDC on testnet** to the employee with the **amount hidden on the public ledger** — not a toy token. This is the "cover the whole payment" capability.
> **Why it matters (business):** this is the go-to-market differentiator for selling to **LATAM companies**, NOT a hackathon deliverable. Companies need to see real, confidential USDC movement end-to-end. Hackathon deadline (Jul 3, 2026) is a milestone, not the ceiling.

---

## 0. Relationship to ZKash (read this first — it kills the "rewrite everything" fear)

This is **ADDITIVE**, not a rewrite. The layers are sequential and independent:

| Layer | What it hides | Status |
|---|---|---|
| **ZKash** (Pedersen + ECIES) | the **recorded** amount (commitment + ciphertext) | DONE (backend `433c610`) |
| **This rail** (confidential USDC) | the **moved** amount (real value transfer on-chain) | PLANNED |

The bridge between them is **one field**: `Payout.tx_ref` (`BytesN<32>`) in `contracts/payroll/src/contract.rs:209`. Today `execute_payout` verifies the range proof, marks `Paid`, and stores `tx_ref` — **no value moves** (confirmed: zero `transfer`/`TokenClient`/SAC code in `contracts/payroll/src`). This rail fills that hole. **ZKash is not touched.**

---

## 1. ⚠️ TASK #0 — resolve the contradiction BEFORE any code

Our own prior research and recent press disagree. Do not build until this is settled with primary sources (Stellar docs / CAPs / SEPs / actual repos), not hype articles:

- **Prior handoff (our research, Jun 2026):** "True Confidential Tokens / Confidential Transfers do NOT exist on Stellar yet. The Confidential Token Association (SDF + OpenZeppelin + Zama) is a standards body — no CAP, no SEP, no implementation." (`CONFIDENTIAL_SETTLEMENT_HANDOFF.md` §1)
- **Recent press (Jan–Feb 2026):** claims Confidential Tokens / Stellar Private Payments are "live on mainnet", open-sourced by Nethermind (Groth16/Circom, association sets), code available.

**Resolve:** Is there a usable, deployable **confidential USDC** path on testnet TODAY?
1. A shipped Confidential Token standard/SEP + reference contract, OR
2. Stellar Private Payments (SPP) as a deployable pool we can settle through, OR
3. Neither is turnkey → we build the rail ourselves on BN254/Groth16 bricks.

The answer decides the whole architecture below. **Verify in primary sources first.**

---

## 2. The mechanism the user wants (validated mental model)

Shield → confidential transfer → unshield. Key correction baked in: **the amount does NOT change — it is the SAME value, hidden, not transformed into a different number.**

1. **Shield (deposit):** company deposits the USDC lump sum into the confidential rail → balance becomes encrypted/committed on-chain.
2. **Confidential transfer:** per-employee transfer of the private balance. Ledger shows a ZK transaction occurred; the amount stays encrypted. Bound to the ZKash `enc_amt` / commitment so the moved value matches the recorded one.
3. **Unshield (withdraw):** employee withdraws and gets normal, spendable USDC.

---

## 3. Two paths (decision pending on Task #0)

| Path | What it is | Pro | Con / risk |
|---|---|---|---|
| **A. Integrate SPP / a confidential-token reference** | settle through an existing confidential rail (Nethermind SPP / OZ confidential token) | "real", credible to enterprises; standards-aligned | **other crypto stack** (Circom/Groth16 pool + Merkle association sets); UTXO-shaped vs our balance model; integration risk; maturity/audit unknown |
| **B. Own minimal confidential USDC rail** | a small Soroban contract: shield USDC (SAC), confidential balance, transfer, unshield — reusing our BN254 primitives | full control; reuses what the prover already dominates; fits our balance model | we own the crypto correctness; "production-grade" claim is weaker without audit |

**User's intent:** real USDC, sell the power of covering everything → leans toward a path that is **credible and real**, not a toy. If Task #0 finds a usable turnkey confidential token → **Path A**. If not → **Path B** as a genuine (but unaudited) own rail, documented honestly.

**Note from prior research:** we previously rejected SPP for payroll because it is UTXO-shaped (wrong for balance-based payroll) and WIP/unaudited. Re-validate that judgment in Task #0 — it may have changed.

---

## 4. Honest constraints

- **USDC on testnet** = a SAC (Stellar Asset Contract). A plain `transfer` exposes amount + asset publicly. Hiding it requires the confidential rail to hold the balance, NOT a raw SAC transfer at the visible step.
- **Amount↔commitment binding** (existing gap, see CLAUDE.md "Still pending"): the range proof binds to a field commitment, not the EC Pedersen point. A real confidential settlement should bind the moved amount to the ZKash commitment, or the two layers can disagree. This is the sharpest correctness unknown.
- **Deposit reveal:** the lump-sum company deposit is an aggregate (already matches the public `total_commitment`) — acceptable to reveal. Individual salaries must stay hidden through the transfer step.

---

## 5. Next-session checklist (start here)

- [ ] **Task #0** — verify in PRIMARY sources whether confidential USDC is deployable on testnet today (CAP/SEP/repo, not press). Decide Path A vs B.
- [ ] Confirm whether SPP is still UTXO-shaped / unaudited, or has matured to fit balance-based payroll.
- [ ] Design the **shield/transfer/unshield** flow and where it hooks `execute_payout` (`tx_ref` → real confidential settlement ref).
- [ ] Decide how the moved amount **binds** to the existing ZKash `enc_amt` / Pedersen commitment.
- [ ] Only then: `sdd-new confidential-usdc-settlement` (explore → propose). This is a NEW SDD change, separate from `confidential-settlement` (ZKash).

## 6. Prerequisites (must land first)

- ZKash **PR2 (frontend)** + **T-07 testnet redeploy** from `CONFIDENTIAL_SETTLEMENT_HANDOFF.md` must be done — this rail builds on the redeployed schema.

## 7. Recovery (Engram, project `zkoster`)

- Checkpoint: `project/confidential-usdc-settlement-checkpoint`
- Predecessor: `sdd/confidential-settlement/*` (ZKash) and `CONFIDENTIAL_SETTLEMENT_HANDOFF.md`
