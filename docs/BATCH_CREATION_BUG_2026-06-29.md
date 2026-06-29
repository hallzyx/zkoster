# Batch creation bug — RESOLVED, plus a deeper SPP Claim issue

## TL;DR

The batch creation "zombie Draft" symptom was caused by the `zkoster-prover`
(port 8787) **never being started** in the dev environment. The CSV flow calls
`proveBatch` early and that call hangs indefinitely against a dead port, so
the `set_vk` / `add_payout` steps never reach the chain. Starting the prover
fixes batch creation end-to-end. With batch creation fixed, the SPP Claim
hits a **second bug** below the surface that the first patch did not reach.

## 1. Batch creation — RESOLVED

### Symptom
`createBatchWithRowsAction` returned 200 to the client within ~10s with a
"fetch failed" banner; the new batch showed up in the dashboard as
`Status: Draft, Recipients: 0, Total: $1,000.00` indefinitely. No `add_payout`
TX was ever submitted on-chain.

### Real root cause
`createBatchWithRowsAction` calls `chainReviewBatchFromRows`, whose first
step is:

```ts
// frontend/lib/data/chain-writes.ts:358
const proved = await proveBatch(realAmounts, /* seed= */ 42);
```

`proveBatch` (`frontend/lib/prover.ts:48`) is a `fetch POST` to
`${ZKOSTER_PROVER_URL}/prove`, which defaults to
`http://127.0.0.1:8787` (`frontend/lib/config.ts:49`). On the dev box used
for this session, **nothing was listening on 8787** — the zkoster-prover
binary was never compiled or started. The `fetch` therefore hung until the
browser cut the connection at ~8s with `fetch failed`, while the server
action continued running in the background. The 3-min polling loop
(`reviewBatchFromRows` line 393) never started, because the await never
returned.

### Evidence (debug log, Jun 29 16:12)
```
[E2E-DEBUG-V2] createBatchWithRowsAction START          ts=…30248
[E2E-DEBUG-V2] before chainCreateBatch                  ts=…30253   (+5ms)
[E2E-DEBUG-V2] after  chainCreateBatch                  ts=…38546   batchId=34  (+8.3s, on-chain OK)
[E2E-DEBUG-V2] after  registerDynamicBatch              ts=…38547   batchId=34  (+1ms, in-memory)
[E2E-DEBUG-V2] before chainReviewBatchFromRows          ts=…38547   batchId=34
# ... no further log; proveBatch never returned ...
POST /admin/batches/new 200 in 10.2s  (browser already gave up)
```

After starting the zkoster-prover on 8787:
```
[E2E-DEBUG] reviewBatchFromRows ENTER                  ts=…18242
[E2E-DEBUG] reviewBatchFromRows: proveBatch DONE       ts=…18274  payoutCount=1  (+31ms)
[E2E-DEBUG] reviewBatchFromRows: set_vk start          ts=…
[writeContract] set_vk: TX … lost in mempool — retrying (attempt 1/5)
[E2E-DEBUG] reviewBatchFromRows: set_vk done
[E2E-DEBUG] reviewBatchFromRows: register_member start
[E2E-DEBUG] reviewBatchFromRows: register_member done
[E2E-DEBUG] reviewBatchFromRows: add_payout start
[writeContract] add_payout: TX … lost in mempool — retrying (attempt 2/5)
[E2E-DEBUG] reviewBatchFromRows: add_payout done
[E2E-DEBUG-V2] after chainReviewBatchFromRows          ts=…                              (success)
```

Batch #35 "Real E2E #1" landed in `Reviewed` with 1 recipient.

### Fix
Nothing to change in the code. Two operational steps, documented so a future
operator does not lose 90 minutes to the same misdiagnosis:

```bash
# 1. Build the prover (1m on Windows, no special flags).
cd prover
cargo build --release
# → target/release/zkoster-prover.exe  (~2.6 MB)

# 2. Run it in serve mode (NOT without a subcommand — exits immediately).
nohup target/release/zkoster-prover.exe serve > /tmp/zkprover.log 2>&1 &
# → "zkoster-prover listening on http://0.0.0.0:8787  (POST /prove)"
```

Without the `serve` subcommand, the binary prints usage and exits 0. The
frontend fetch to `http://127.0.0.1:8787/prove` then hangs.

### Testnet side note
`writeContract` has a 5-attempt retry loop with backoff for lost-mempool
TXs. On Stellar testnet during this session each batch (3 on-chain ops:
`set_vk`, `register_member`, `add_payout`) lost 1–2 TXs to mempool, so
creation took 5–7 minutes per batch instead of 30s. This is a testnet
congestion property, not a code bug. The retries all eventually settled.

## 2. SPP Claim — second bug uncovered

With batch creation fixed, the full E2E reaches the SPP Claim. It still
fails with `HostError: Error(Contract, #0)`, which in the Nethermind
verifier contract (`/tmp/spp/contracts/types/src/lib.rs:12`) is
`Groth16Error::InvalidProof = 0` — "the pairing product did not equal
identity".

### First patch is still correct
`asp_membership_root: 6731605845228100536383840723564806187967547925495056315034398112041530379720`
is read live from `CBTOY7I7SERRSAOTUAY7CAMHZZBZS2MYOUQUAW7BE6L3SOA7T3NCHCUU`
and overrides `state.membership.proof.root` before the witness calculator
runs. The smoke test against `/spp/deposit` (Opción 1, Jun 29 morning)
proved the override fires and the resulting proof contains the live ASP
root. The Claim diagnostic event also shows the verifier reading the
correct ASP root:
```
6: contract:CBTOY7I7SERRSAOTUAY7CAMHZZBZS2MYOUQUAW7BE6L3SOA7T3NCHCUU
   fn: get_root
   data: 6731605845228100536383840723564806187967547925495056315034398112041530379720  ← correct
```

### What's actually wrong
The Claim diagnostic event shows the proof's `root` field is
`19948069925514516347216041766284928413423764695341851999824042828188062390986`,
but the verifier computes a different root from the witness's
`input_nullifiers` and rejects the pairing check.

The `root` the prover embeds comes from the frontend's
`note.poolRootAfterDeposit` field, which is read from the pool contract
*after* the deposit TX is confirmed. The actual cause of the `InvalidProof`
is **upstream of the prover**:

`frontend/lib/spp/pool-client.ts:138` — `fetchAllPoolCommitments` starts
scanning from `health.oldestLedger` (≈7 days back on Stellar public
testnet) rather than from a recent window. This pulls `NewCommitmentEvent`s
from prior test runs / earlier pool states. The resulting `allCommitments`
list is a corrupted mix, so the `MerklePrefixTree` reconstructed in the
prover (`withdraw.rs:114`) does not terminate at the root the verifier
recomputes, even though the `root` field the prover embeds *is* the live
one. The pairing check fails because the merkle path is inconsistent with
the embedded root.

`fetchAllPoolCommitments` is called from `depositToPool` (line 260), so the
corrupted `allCommitments` is baked into the note at deposit time, before
any Claim logic runs. Re-running the Claim does not help because the note
is already wrong.

### Fix scope (for a follow-up session)
1. Bound the event scan in `fetchAllPoolCommitments` to a recent window
   (e.g. `latestLedger - 50_000`) — pragmatic, no contract changes.
2. Better: read the pool's `next_index` (or equivalent) and use that to
   deduce the correct range, then re-validate `allCommitments` against the
   live pool root.
3. Add a debug log that dumps the first 3 commitments and the computed
   pool root on deposit, so the next operator can see the corruption
   directly without going through the verifier's diagnostic event.

## 3. State of `spp-claim-root-cause` at end of session

```
ff075ec docs(debug): document batch creation bug found during E2E  ← old
a774d37 docs(spp): correct handoff — repo URL, edit location, patch path
bbc31a0 fix(spp): wire live asp_membership_root into prover routes  ← validated
8387a14 docs(spp): SPP claim handoff — root cause + build guide
6e0cfca fix(spp): read live ASP membership root from chain (forward-compatible)
6cf4449 fix(ux): show 'Refreshing…' state on admin action button post-success
```

No new commit is needed for the operational fix (starting the prover) and
no code change ships for the second bug yet — the doc above is the
deliverable so the next session has a clear starting point.

## 4. Operational state at end of session

- `zkoster-prover` (Windows, port 8787): running, PID 5021 (npm/next spawn).
  Will not survive a reboot. Reproducible per §1.
- `spp-prover` (Ubuntu WSL, port 8788): running, PID 24096, binary at
  `/home/arroz/projects/Zkoster/spp-prover/target/release/spp-prover`
  (17 MB ELF, Jun 29 09:47). Artifact links in `spp-prover/artifacts/`
  point at `/tmp/spp/deployments/testnet/circuit_keys/` and
  `/tmp/spp/target/circuits-artifacts/release/`.
- `frontend dev` (port 3000): running, PID varies (Turbopack).
- Testnet state: batches #30, #31 are zombie Drafts with 0 recipients and
  a stale `registerDynamicBatch` (left from the broken-prover era). Batch
  #34 ("Debug Round 4") is the same. Batch #35 ("Real E2E #1") is the
  end-to-end success case: Reviewed, 1 recipient, $1,000, SPP deposit
  landed, Claim attempted (failed at the verifier per §2).
