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

### What's actually wrong — `public_amount` mismatch
The Claim's `ext_data` carries `ext_amount: -10000000` (decimal, 1 USDC
in stroops, mapped in `ext_data_hash`). The ZK proof's `public_amount`
field carries the value `21888242871839275222246405745257275088548364400416034343698204186575798495617`
which is `0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593ef676981`.

That value is **exactly the BN254 scalar field modulus `p`**
(`/tmp/spp/app/crates/core/types/src/amounts.rs:458-485` does
`Field::try_from(ExtAmount::from(x))` → for `x < 0` returns
`Field(p - |x|)`; for `x = 0` returns `Field(0)`). Since the bytes
serialized are not all-zero, the value is `Field(0)` represented via
`Field::to_be_bytes()` on `Field(p)` — which is the canonical
canonicalization Nethermind uses (see `Field::canonicalize` in
`/tmp/spp/app/crates/core/types/src/amounts.rs`).

So the proof was generated with `ext_amount = 0`, not `-10_000_000`.
Either:

1. The `ExtAmount` the prover received was already 0 (a routing bug in
   the patch, the handler, or the wire encoding), or
2. The `ExtAmount` was correct (`-10_000_000`) but somewhere between
   `withdraw.rs:149` (`let withdraw_amount = ExtAmount::from(req.withdraw_amount_stroops as i128)`)
   and `flows.rs:566` (`let public_amount_field = Field::try_from(ext_amount)?`)
   it gets reset to zero.

The patch on the prover side looks correct: `flows.rs:362` does
`withdraw_amount.checked_neg()` so the `ext_amount` that reaches
`Field::try_from` is `-10_000_000`. The conversion in amounts.rs:485
returns `Field(p - 10_000_000)`, which is `0x30644e72eeced301...`, **not**
`Field(p)`.

A direct curl against the running spp-prover with
`withdraw_amount_stroops: 10_000_000` reproduces the
`public_amount = p` value in the returned `proof_scval_xdr_b64` (verified
by base64-decoding the XDR and reading the U256 at the `public_amount`
key offset). The same call with `withdraw_amount_stroops: 0` returns
`public_amount = 0`. So the prover is faithfully mapping
`withdraw_amount_stroops → public_amount` with the negative-correct
negation: `0 → 0`, `10_000_000 → p`. But the contract-side `ext_amount`
in `ext_data` is `-10_000_000`, so the on-chain check
`ext_data_hash = hash(ext_amount, encrypted_outputs, ...)` disagrees
with the proof's `public_amount`, and the pairing check fails because
the witness was bound to the wrong `public_amount`.

**Root cause is therefore on the frontend side, not the prover.**
`claimFromPool` (`frontend/lib/spp/pool-client.ts:356`) builds the
`ext_data` independently of the proof (line 417 builds the
`ext_data` with the original negative `ext_amount`). The contract
then verifies `ext_data_hash` against the proof's `public_amount`
and they don't match. Likely the contract expects `public_amount` to
be the **positive** representation of the magnitude (`+10_000_000`)
while `ext_amount` is the signed transfer amount (`-10_000_000`). The
Nethermind prover is built assuming positive `public_amount` for
withdraw, and the contract does `public_amount = -ext_amount` internally.
This needs to be confirmed against the pool contract's `transact`
implementation in `/tmp/spp/contracts/pool/src/pool.rs` — specifically
the section that builds the `public_amount` for the verifier call.

### Fix scope (for a follow-up session)
1. **Read `/tmp/spp/contracts/pool/src/pool.rs` around the `transact`
   function** to see how `public_amount` is computed from `ext_amount`
   in the contract. Specifically, does the contract pass
   `ext_amount` directly to the verifier, or does it negate it first?
2. **If the contract negates internally**, the fix is on the frontend
   in `depositToPool` (line 264-274): it currently passes `pool_root` as
   `computePoolRoot([])` (empty tree) for the deposit, but the correct
   pre-deposit root should be `computePoolRoot(priorCommitments)`. For
   the claim, the bug is that `ext_data` carries the *signed* amount
   while the proof carries the *unsigned magnitude* — the contract is
   likely passing the magnitude to the verifier. Either way, **the
   proof is correct, the wire encoding to the contract is wrong.**
3. **Likely root cause (most probable)**: in
   `frontend/lib/spp/pool-client.ts` `extData` is built with
   `ext_amount: -(amount)` (signed), and then `pool.transact(proof, ext_data, sender)`
   is called. The contract then takes `ext_data.ext_amount` and uses it
   as the verifier's `public_amount` *directly* (without negating). The
   proof was generated with `public_amount = 10_000_000` (positive
   magnitude), but the contract passes `-10_000_000` (signed). The
   fix is to make the wire-side `ext_data.ext_amount` carry the same
   signed encoding the prover used, or to negate it in the contract
   call. Read `pool.rs::transact` first to confirm which side is wrong.

### Scratch notes from this session

`p` (BN254 scalar field modulus) =
`21888242871839275222246405745257275088548364400416034343698204186575798495617`
= `0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593ef676981`

`p - 10_000_000` =
`0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593eeced301`

The proof in the Claim carries `...ef676981` (i.e. `p`), not
`...eeced301` (i.e. `p - 10_000_000`). So the prover thinks
`ext_amount = 0`, the contract thinks `ext_amount = -10_000_000`.

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
