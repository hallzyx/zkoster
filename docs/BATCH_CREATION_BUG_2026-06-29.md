# SPP Claim fix: validated at prover level, blocked on batch creation

## Summary

The SPP Claim `Error(Contract, #0)` fix (commits `bbc31a0` + `a774d37`) was
validated end-to-end at the **prover level** but a separate, pre-existing bug
in the batch creation flow blocks a full E2E test (admin → deposit → claim).

## What works

1. **Prover-side patch is live and correct** — `/home/arroz/projects/Zkoster/spp-prover/target/release/spp-prover` (17M ELF, Jun 29 09:47)
   built with the override `state.membership.proof.root = live_asp_membership_root`.
2. **Smoke test (Opción 1)** — `POST /spp/deposit` accepts the new
   `asp_membership_root` field and generates a ZK proof with the root overridden:
   - With malformed field → `asp_membership_root: expected 32 bytes, got 38`
     (proves the parser sees the new field)
   - With valid field → returns a complete `proof_scval_xdr_b64` whose `root`
     matches the request's `asp_membership_root` (proves the override fires)
3. **Frontend commit `6e0cfca`** wires the live ASP root into the request body
   for both deposit and withdraw paths. No second frontend change needed.

## What blocks the full E2E

A pre-existing bug in `createBatchWithRowsAction`
(`frontend/app/admin/actions.ts:361`) prevents CSV-created batches from
reaching the Reviewed state. Three steps run in series:

```
Step 1: chainCreateBatch  (5-8s, on-chain)
Step 2: registerDynamicBatch  (instant, in-memory)
Step 3: chainReviewBatchFromRows  (10s-3min, on-chain: prove + add_payout × N + review)
```

The browser (Next.js 16 + Turbopack client) throws `fetch failed` after ~8s,
but the server action continues running in the background. Result: the batch
header is created on-chain (Step 1) and registered off-chain (Step 2), but
the payouts are never added (Step 3 never reaches `add_payout`).

### Evidence (debug log from a live run, Jun 29 16:00)

```
[E2E-DEBUG] createBatchWithRows: step 1 - calling chainCreateBatch { rowCount: 1 }
[E2E-DEBUG] createBatchWithRows: step 1 done { batchId: 31 }
[E2E-DEBUG] createBatchWithRows: step 3 - calling chainReviewBatchFromRows { batchId: 31 }
 POST /admin/batches/new 200 in 10.2s
   └─ ƒ createBatchWithRowsAction(...) in 10188ms
# No "step 3 done" log → Step 3 did not complete
```

Result: Batch #31 in dashboard shows `Status: Draft, Recipients: 0, Total: $1,000.00`.

### Root cause

`chainReviewBatchFromRows` (`frontend/lib/data/chain-writes.ts:346`) blocks
the server action for up to 3 minutes (60 polls × 3s) waiting for
`employee_count >= rows.length` to settle. When the browser already moved on,
the polling loop either fails silently or completes after the connection is
closed. There is no `try/finally` cleanup, so the off-chain metadata
(`registerDynamicBatch`) stays but the on-chain payouts don't land.

## Next steps for a follow-up session

1. **Split `createBatchWithRowsAction` into two server actions**:
   - `createBatchAction(name, period, recipients)` — creates header + metadata only
   - `reviewBatchFromRowsAction(batchId)` — runs the slow step with progress polling
2. **Reduce the polling window in `chainReviewBatchFromRows`** from 3 minutes
   to 30 seconds, with a clear `error` returned on timeout.
3. **Add a fallback path** so CSV batches that already exist in Draft can be
   re-reviewed via the existing "Review batch" button — verify this works on
   the current orphan batches #30, #31, and any others created with this bug.

## Pre-existing batches with the bug

- Batch #30 (Patch Validation E2E) — Draft, 0 recipients, $1,000
- Batch #31 (E2E Debug Run #1) — Draft, 0 recipients, $1,000

Both can be brought to Reviewed state via the per-batch "Review batch" button
once the per-row flow is fixed (the off-chain metadata is already registered
correctly).

## Why this isn't merged to main

Per the session's scope agreement (enforced in CLAUDE.md + the SDD workflow),
this branch stays experimental until the full E2E passes. The two commits
that ARE the SPP Claim fix (`bbc31a0`, `a774d37`) are individually correct
and validated — the missing piece is the orthogonal batch-creation bug, not
the SPP Claim fix itself.
