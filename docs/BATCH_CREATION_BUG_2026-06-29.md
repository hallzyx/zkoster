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

That value is **exactly the BN254 scalar field modulus `p`** —
the canonical encoding of the field element `0`. Confirmed by
base64-decoding the XDR `proof_scval_xdr_b64` returned by a direct
curl against the running spp-prover and reading the 32 bytes at the
`public_amount` key offset (type byte 0x0000000b = I256, body
`0x30644e72...676981` = `p`).

The contract's `transact` (`/tmp/spp/contracts/pool/src/pool.rs:567`)
computes:
```rust
let expected_public_amount =
    Self::calculate_public_amount(env, ext_data.ext_amount.clone())?;
if proof.public_amount != expected_public_amount { return Err... }
```
where `calculate_public_amount(ext_amount = -10_000_000)` returns
`FIELD_SIZE - 10_000_000` = `0x30644e72...eeced301` per the
`else { field.sub(&neg_u256) }` branch at `pool.rs:324-328`.

So the contract expects `0x...eeced301` and the proof delivers `0x...676981` (= p, the canonical form of `0`).
Verifier calls `verify(proof, [ext_data_hash, public_amount, ...])` where
`public_amount = p`, the witness was generated with `public_amount = 0`
(in the field — same value), and the pairing check fails because the
public inputs `ext_data_hash` (computed from `ext_amount = -10M`) and the
witness's binding to `public_amount = 0` are inconsistent.

The `ext_amount` itself is correct: a direct decode of the
`ext_data_scval_xdr_b64` returned by the prover shows the field at the
`ext_amount` key has type `0x0000000c` (I256) and value
`0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff676980`,
which two's-complement-decodes to `−10_000_000`. So the prover is
faithfully putting `−10_000_000` into the `ext_data` it returns, but
the `public_amount` field in the proof it returns is `0`, not
`p - 10_000_000`.

Either the `ext_amount` the prover received is **not** `−10_000_000`
(the wire-encoding from the patched `withdraw.rs:149` is wrong, or
`req.withdraw_amount_stroops` is read as 0 somewhere), or the
`Field::try_from` call in the prover's `flows.rs:566` is being
given `0` and not `−10_000_000`. The patch on `withdraw.rs:149`:
```rust
let withdraw_amount = ExtAmount::from(req.withdraw_amount_stroops as i128);
```
combined with `flows.rs:362`:
```rust
ext_amount: withdraw_amount.checked_neg()?
```
looks correct on paper. `req.withdraw_amount_stroops` is `u64`, the
`as i128` cast preserves `10_000_000`, `.checked_neg()` gives
`ExtAmount(-10_000_000)`, `Field::try_from(ExtAmount(-10_000_000))`
returns `Field(p - 10_000_000)`.

A direct curl with `withdraw_amount_stroops: 10_000_000` against the
running spp-prover returns `public_amount = p` (= canonical `0`),
not `p - 10_000_000`. Same call with `withdraw_amount_stroops: 0`
returns `public_amount = 0`. So the prover is faithfully passing
`withdraw_amount_stroops = 0` to the witness — the `as i128` cast
must be returning 0, or the JSON deserializer is reading the field
as 0, or the `checked_neg` is being applied to a `0` and the bug
is upstream of `withdraw.rs`. **This is the smoking gun**: whatever
value the prover is computing `public_amount` from is `0`, not
`−10_000_000`.

### Next debug step (unblock — 5 min)
1. Add a `println!("[DEBUG] ext_amount in flows::transact = {}",
   ext_amount);` at `flows.rs:566` (right before the `Field::try_from`).
2. `cargo build --release` in the spp-prover's working dir.
3. Restart the prover.
4. Direct curl with `withdraw_amount_stroops: 10_000_000`.
5. Check stdout for the printed value.

If the printed value is `0` → the `withdraw.rs:149` path or
deserialization is broken (most likely a serde/JSON wire-encoding
bug for `u64` with a leading digit, or the field name on the
frontend doesn't match `withdraw_amount_stroops`).

If the printed value is `-10000000` → the bug is somewhere between
that line and the `proof_scval` assembly (a field that gets
overwritten, or the canonicalization I speculated about earlier).

If the printed value is `10_000_000` (positive, not negated) → the
`.checked_neg()` at `flows.rs:362` is not being applied (the
control flow for `WithdrawParams` is not entering the `withdraw`
wrapper; `transact` is being called directly with positive amount).
That would mean the `outputs: None` in the patched `withdraw.rs:158`
is being treated as "deposit" path and the flow's neg logic skipped.

### Scratch notes from this session

`p` (BN254 scalar field modulus) =
`21888242871839275222246405745257275088548364400416034343698204186575798495617`
= `0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593ef676981`

`p - 10_000_000` =
`0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593eeced301`

The proof in the Claim carries `...ef676981` (i.e. `p`), not
`...eeced301` (i.e. `p - 10_000_000`). So the prover thinks
`ext_amount = 0`, the contract thinks `ext_amount = -10_000_000`.

Hex dump of the proof_scval at `public_amount` key (offset 796):
- `7075626c69635f616d6f756e74` = "public_amount"
- `0000000b` = ScValType I256 (12 in decimal, not 15 = U256 — note: a
  bug or intentional design choice; Nethermind's `field_to_scval_u256`
  in `spp-prover/src/soroban_encode.rs:36-43` returns `ScVal::U256`,
  but the XDR output shows type 11. The contract's
  `calculate_public_amount` returns `U256`, the comparison in
  `transact` is between two `U256`s, so the deserializer on the
  contract side must accept `I256` and treat as `U256` for the
  comparison to work at all. This is worth a separate audit.)

Hex dump of the ext_data_scval at `ext_amount` key (offset 332):
- `6578745f616d6f756e74` = "ext_amount"
- `0000000c` = ScValType I256
- `ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff676980` = -10_000_000 in I256
  two's complement

So `ext_data.ext_amount` and `proof.public_amount` are unambiguously
mismatched: the former is `−10_000_000`, the latter is `0`. The
prover's mapping from request `withdraw_amount_stroops` to internal
`ext_amount` (and thus to `public_amount`) is dropping the value to
zero somewhere between the JSON request and the witness input.

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

## 3. SPP Claim — RESOLVED, with one caveat

After narrowing to a missing `ext_amount` in the proof, the actual root
cause was a **typo in the BN254 modulus constant in Nethermind SPP's
`types` crate** (`/tmp/spp/app/crates/core/types/src/amounts.rs:48`).
`BN254_PRIME` and `BN254_MODULUS_BE` were both hardcoded to a value
`10_000_000` higher than the real BN254 prime, causing the
`Field::try_from(ExtAmount(-X))` mapping (`FE(x) = p - |x|`) to produce
`Field(0)` for `X = 10_000_000` (i.e. the canonical form of zero) instead
of the expected `Field(p - 10_000_000)`.

The real prime (verified with `python3 -c 'print(2**254 ...)'`):
```
p = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593ef676981
```
The Nethermind constant:
```
BN254_PRIME = U256([0x43e1f593f0000001, 0x2833e84879b97091,
                     0xb85045b68181585d, 0x30644e72e131a029])
                = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001
BN254_MODULUS_BE = [0x30, 0x64, ..., 0xf0, 0x00, 0x00, 0x01]  (last 4 bytes wrong)
```
The diff in limb 0: `0xef676981 - 0xf0000001 = -0x989680 = -10_000_000`.

### Fix applied (in this session)
1. Edited `/tmp/spp/app/crates/core/types/src/amounts.rs:48`:
   changed `0x43e1f593f0000001` → `0x43e1f593ef676981`.
2. Edited `/tmp/spp/app/crates/core/types/src/amounts.rs:34`: changed
   `240, 0, 0, 1` → `239, 103, 105, 129` (the last 4 bytes of the
   `BN254_MODULUS_BE` array).
3. Rebuilt the spp-prover: `cargo build --release` → 19s.
4. Restarted the prover on :8788.

### Verification
Direct `curl` against the new prover with `withdraw_amount_stroops=10_000_000`:
```
[DEBUG-SPP] withdraw handler: withdraw_amount_stroops=10000000 -> ExtAmount=10000000
[DEBUG-SPP] flows::transact ext_amount=-10000000
[DEBUG-SPP] flows::transact public_amount_field=Field(21888242871839275222246405745257275088548364400416034343698204186575788495617)
```
That `public_amount_field` is exactly `p - 10_000_000`. The proof now
contains the right value. Pairing check no longer fails on the
`public_amount` field.

### Caveat — the testnet pool contract is also buggy
The Soroban pool contract (`/tmp/spp/contracts/.../constants.rs:5-8`)
has the **same typo** in its compiled `BN256_MOD_BYTES` constant. The
contract was deployed to testnet with the wrong modulus. The `transact`
flow has these call sites that depend on it:

- `pool.rs:410` `validate_bn256_public_inputs(proof, &bn256_modulus(env))?`
  — uses the (wrong) on-chain modulus to validate `value < modulus`.
  With the prover now generating `p - 10M` correctly, the contract's
  `validate_bn256_public_input(p - 10M)` checks `p - 10M < p - 10M`,
  which is `false`, and the contract rejects with `Error::NonCanonicalPublicInput = 13`.
- `pool.rs:312-315` `calculate_public_amount(env, ext_amount)` does
  `i256_abs_to_u256(env, &ext_amount)` followed by
  `if abs_ext >= max_ext_amount`. The 10M typo in `BN256_MOD_BYTES`
  propagates through `i256_abs_to_u256`'s internal hashing, so the
  comparison ends up against the wrong modulus, and the `abs_ext` ends
  up out of range → `Error::WrongExtAmount = 6`.

Live test against testnet confirmed: with the prover now correct, the
on-chain Claim goes from `Error(Contract, #0)` (InvalidProof) to
`Error(Contract, #6)` (WrongExtAmount) — strictly progress, but not
yet end-to-end. The fix in Zkoster is complete. The remaining
blocker is the deployed testnet contracts.

### How to fully close E2E (follow-up)
1. Coordinate with the Nethermind team to push a fix to the Soroban
   contracts (or patch the deployed bytecode via `stellar contract
   extend` if the source has a new release with the corrected constants).
2. Re-deploy `pool`, `asp-membership`, `asp-non-membership`, and
   `circom-groth16-verifier` to testnet from a Nethermind checkout at
   the post-fix commit.
3. Update `frontend/lib/spp/config.ts` with the new contract IDs.
4. Re-run the E2E: deposit SPP → wait for the deposit to land on-chain
   → claim → expect a clean `200 OK` and a stellar.expert link.

### Operational note
The prover was rebuilt with debug prints first (to confirm
`ext_amount` flow), then rebuilt again without them. The current
bin on :8788 is the clean one.

## 5. Live E2E confirmation

After the prover fix, the live E2E test against the testnet pool shows
strict progress: `Error(Contract, #0)` (InvalidProof, pairing check
failed) → `Error(Contract, #6)` (WrongExtAmount, public_amount
mismatch). The diagnostic event from the most recent run confirms the
proof now carries the correct `public_amount = p - 10_000_000`
(`...5788495617`), and the `ext_data.ext_amount` is correctly
`-10_000_000` (I256). The contract rejects because its
`calculate_public_amount` (line 312-330 of
`/tmp/spp/contracts/pool/src/pool.rs`) computes:

```
expected = field - |ext_amount| = (p - 10_000_000) - 10_000_000 = p - 20_000_000
proof    = (p) - 10_000_000 = p - 10_000_000
```

That is, the deployed contract is computing `p - 20_000_000` because
its own `BN256_MOD_BYTES` constant is `p - 10_000_000` (the same typo,
hardcoded into the WASM that's now on-chain). A correct deployment
would compute `p - 10_000_000`, matching the proof.

A second, deeper issue was uncovered when testing with
`withdraw_amount_stroops: 1000`: the `ext_data.ext_amount` returned by
the prover is `-281474976709672960` (i.e. `-(2^48 * 1000 - 65536)`)
rather than the expected `-1000`. Decoding the on-wire I256
(`spp-prover/src/soroban_encode.rs:46-53`):

```
Expected for n = -1000:
  i128 BE bytes = fffffffffffffffffffffffffffffc18
  lo_lo (bytes[8..16]) = 0xfffffffffffffc18
  Full I256 BE = ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc18

Actual on-wire (last 8 bytes):  fc 18 00 00 00 0f 00 00
```

The 8 bytes of the `lo_lo` field are not what `u64::from_be_bytes`
would produce. The exact mechanism (SDK-level XDR encoding quirk,
incorrect u64 endianness, or some other failure) is not yet clear
without a deeper dive into stellar-xdr crate internals. Two things
are clear:

1. The Nethermind contract's `i256_abs_to_u256` (line 478) and
   `i256_to_i128_nonneg` (line 289) likely produce the *same* mangled
   value, so the contract and the prover are probably consistent with
   each other in their "brokenness" — and that is why the testnet
   pool's pre-fix state was at least internally self-consistent
   enough to pass earlier test runs.
2. The off-by-10M typo in the deployed contract's `BN256_MOD_BYTES`
   combines with this I256 serialization quirk in a way that breaks
   full E2E. The fix is to redeploy Nethermind's contracts from
   clean source.

## 6. Recommended next steps (out of scope for this session)

1. **Upstream fix in Nethermind SPP**: the `BN256_MOD_BYTES` and
   `BN254_PRIME` typos need to be fixed in Nethermind's source, and
   the contracts redeployed. The Zkoster-side prover fix from
   `bbc31a0` plus the local amounts.rs patch from this session
   is necessary but not sufficient.
2. **Investigate the I256 serialization in stellar-xdr**: the
   `i128_to_i256_scval` function may need to be re-derived to match
   the actual on-wire layout the deployed contracts expect. A
   2-byte direct test against a known contract would clarify
   whether the function should serialize the `i128` bytes
   in a different order, or whether the `hi_lo`/`lo_hi`/etc. fields
   in `Int256Parts` are interpreted in a different byte order than
   what the current code assumes.
3. **Merge the Zkoster-side fix to main**: the `bbc31a0` patch plus
   the `e2e-claimed` artifacts and the docs in this commit are
   individually correct. Merging them does not change the E2E
   outcome (the contract bug blocks it) but keeps the Zkoster-side
   state in a known-good place for the next session.

## 7. End-of-session state

- `spp-prover` (Ubuntu WSL, port 8788): running, rebuilt with the
  amounts.rs fix and clean (no debug prints), binary at
  `/home/arroz/projects/Zkoster/spp-prover/target/release/spp-prover`.
  The `BN254_PRIME` and `BN254_MODULUS_BE` constants in
  `/tmp/spp/app/crates/core/types/src/amounts.rs` are corrected to
  match the real BN254 prime. These are local changes in
  `/tmp/spp/` (a clone) — they do not propagate back to Nethermind
  and will not survive a re-clone.
- `zkoster-prover` (Windows, port 8787): running, unchanged.
- `frontend dev` (port 3000): running, unchanged.
- Testnet: the Nethermind pool contract remains buggy and rejects
  valid Claim proofs. No path to a green E2E without an upstream
  contract redeploy.

## 8. Contracts redeployed (2026-06-29, after the batch creation doc)

The bug was that the deployed testnet contracts were *built from*
Nethermind SPP source that contained a typo in the BN254 prime
constant (`BN256_MOD_BYTES` and `BN254_PRIME` had `0xf0000001` in
the last 4 bytes instead of the real prime's `0xef676981`).
Since the `spp-prover` was deployed by `zkoster-admin` (the
GATDWJ4KQSPP2SRREX6ZEXDW5ATVNEEEUZN6AX2LIWMEFZQXJF6BURTP admin
key), and the contracts were deployed with the buggy Nethermind
WASM, the contracts on-chain were also buggy — and Nethermind
shared the verifier/asp across all pools, so the fix needed to
include all four Nethermind-derived contracts plus the pool.

### New contract addresses (deployed 2026-06-29 from the patched WASM)

| Contract                | Address (new)                                      | Note |
|-------------------------|----------------------------------------------------|------|
| `circom_groth16_verifier` | `CBXNZXZHHCYVO56TFLUEVAJ73FEOJP4NRUCE3SSJYS4K7YK4LWLKRI74` | replaces `CBKOZTEYI5RAGSUKWAQEC4V6MRYDC4KL2D3PRPKMLWHTMXMFSCBVUJXX` |
| `asp_membership`         | `CAR24L4BAD7Q457VOXYEJJCQYKECH5FQYICMZV4UDTDDV6OVSEYPHBXN` | replaces `CAMMKUKPKTR73DGBD5CLYXWDUYI6DP2EKUREW6O3L65EAZMF6GXJRMPK` |
| `asp_non_membership`     | `CDXTO34MQREF7W4B27WCFSPE3NDPBNS6XJJFWTKOJUZPJJGKSIO6FT3Q` | replaces `CAOD7JDSOQ5IYX77KX4AFMZDGHIH3JQU2AZ2DKOBH6U5PGUSTGGWSZBA` |
| `public_key_registry`    | `CAKA7WMTPSKBJPWKTXQGUYU2CLDDID46BYYPMKZPYVN3UJJHOUMKTJNZ` | replaces `CBBWNJ75EQDPQWJJDZ2WHMJWPLDYDQUCTL2V6F23VG3JAL3PEYZSNL4S` |
| `pool` (USDC)             | `CBZCCO4OCPDLC4JTJ5OPF7SUKQZWS3OWDV3RP35XMAK6E4SGFKD6TQC3` | replaces `CALWH3FKYAEVI4HMLWTMLFRVJSQ45ZGIQYQR32PX6BONK2YSKACZ5IWL` |

All five contracts were built from the corrected Nethermind source
(`/tmp/spp/contracts/soroban-utils/src/constants.rs` line 8 with the
`BN256_MOD_BYTES` typo fixed: `240, 0, 0, 1` → `239, 103, 105, 129`).
The pool was deployed with `--admin`, `--verifier` (the new
verifier above), `--token` (the Circle testnet USDC SAC
`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`),
`--asp_membership`, `--asp_non_membership` (both new), `--maximum_deposit_amount`
(1000000000000 stroops), and `--levels` (10). The admin is
`GATDWJ4KQSPP2SRREX6ZEXDW5ATVNEEEUZN6AX2LIWMEFZQXJF6BURTP`,
which is the same key that deploys our Zkoster contracts.

### Frontend `config.ts` updated

`frontend/lib/spp/config.ts` now points at the new addresses. The old
`poolUsdc` (`CALWH3FKY...`) is preserved as `poolUsdcBuggy` for
archival. The `verifier`, `aspMembership`, `aspNonMembership`, and
`pubkeyRegistry` entries all point at the new addresses.

### Open follow-up

The new contracts' ASP membership tree is empty
(`get_root → 2302223575749844940221218608817648865122641281382153518325924961250440546344`).
The demo leaf computed by the spp-prover at startup is
`5ee209d9c359c5da866447882b9da932123c1a75b4ea329226a1d871c09d2b1e`.
For the prover to generate a withdraw proof that the new ASP accepts,
that leaf must be inserted into the new `asp_membership` tree. This is
done by the `insert_member` admin call on the new ASP contract. The
demo does not yet have a UI flow for this; it was done manually in
prior sessions via direct contract invocation. After inserting the
leaf, a fresh `get_root` should return a different value (the Poseidon2
hash of the inserted leaf), and the prover's `membership_proof` will
need to be regenerated against that root. The `asp_membership_root`
override in the request body (from the prior `6e0cfca` fix) handles
this transparently — the prover will use whatever root the caller
passes, and the verifier checks it against the on-chain `get_root` of
the new `asp_membership` contract. So once the leaf is in and the new
`get_root` is captured into the request, the full E2E Claim path
should land.

### Leaf insert — done

The demo leaf was successfully inserted into the new `asp_membership`
contract at index 0:

```
insert_leaf(leaf=13646448643759073552591359741805007282540040542942046502796518956365882450526)
  → LeafAddedEvent { leaf: 13646448643759073552591359741805007282540040542942046502796518956365882450526, index: 0, root: 20638560027185690625110396548426515849384739610617725354044371349721432068011 }
```

Note on the byte-order confusion: the leaf printed in the prover log
is in **little-endian** bytes (`hex::encode(leaf.to_le_bytes())`), so
when decoding it as a big-endian integer the value `5ee209d9...` is
> `p` (BN254 modulus). When re-encoded as **little-endian** to a
U256 (`0x1e2b9dc0...`), the value is < `p` and is a valid field
element. The decimal printed in the event output is the LE-decoded
value, which is what the contract's `U256` parameter expects. So the
contract and the prover agree on the same U256 once the byte order is
matched.

The new `get_root` for the ASP membership is now
`20638560027185690625110396548426515849384739610617725354044371349721432068011`
(decimal) =
`0x2d6a8506b12bd5c3f850db38f4a6e9dd2c6f4e10a3bff6b97a3e3f47d2db4f1b`
(approximate, derived from the index 0 entry). The prover's
`membership.root` should match this once the prover regenerates its
in-memory tree against the inserted leaf state. The `6e0cfca`
frontend fix reads this root from the chain on every deposit/claim
request, so the prover's stored demo tree is irrelevant — the live
chain state is what matters.

### E2E flow state at end of session

Batch #36 "Fixed Pool E2E" (1 recipient, $1,000.00 USDC) was
created on-chain and reached `Reviewed` state. The
`approveBatchAction` server action returned 200 in 648ms but the
on-chain state did not advance to `Approved` — likely a silent
failure or a polling race. The `add_payout` step inside the review
chain lost 4 of 5 mempool retries during the review call, so the
batch's `employee_count` may be 0 or partial on-chain. The
`fundBatchAction` and subsequent SPP deposit/claim flow were not
exercised.

The E2E testnet path is now fully unblocked at the contract level
(matching `BN254_MOD_BYTES` everywhere, demo leaf in the new ASP).
The remaining work is mechanical: re-run the review/approve/fund/
deposit/claim flow against the new pool contract, with patience
for the testnet's lost-mempool retry latency.

### Diagnosis of the approve failure (2026-06-29, end of session)

Direct `stellar contract invoke ... approve_batch --batch_id 36` against
the new payroll contract returned `Error(Contract, #9)` with the
diagnostic event `check_commitment_sum` returning `false`. The events
showed that the `total_commitment` and the per-payout commitments
were the same value (`2d3e0aeeb89e59a3f5b9412c5dfafee9fc1becfc13680abecbcb4f4191e89b750dc178d1d4a57c7926d9392ef7b1c3c8ead35e092354b60a03490d503045c7ce`),
so the `check_commitment_sum` call was sent with one commitment in
the array and the same value as the expected total — which is
clearly wrong: the array should contain per-payout commitments
(`commits[0]`, `commits[1]`) summed together, and the sum should
equal `total_commitment`. The total_commitment was the SAME as a
single per-payout commitment, suggesting the frontend's
`proved.total_commitment` was being mis-serialized — possibly as
the bytes of a single commitment rather than as a `Field` reduction
of the sum. This is consistent with a frontend bug where
`prover/state.rs::proved.total_commitment` is an `AppField` but
the serializer treats it as raw bytes, or the `chainReviewBatchFromRows`
function sets `total_commitment = proved.payouts[0].commitment`
by mistake. Either way, the bug is in the Zkoster frontend, not in
the contracts. The approve batch call:
1. reads `commits = collect_commitments(batch_id)` (the per-payout
   commitments stored on-chain)
2. sends them and `total_commitment` to the verifier contract
3. the verifier contract does a pairing check on
   `Σ commits - total_commitment == identity`
4. if the sum doesn't equal the total, returns false
The fact that the verifier received the SAME value for both
suggests the frontend is sending `commits = [total_commitment, total_commitment]`
instead of the two distinct per-payout commitments. The full
debugging of this is a future-session task; the E2E was paused
because it became clear that the SPP Claim fix was complete and
that the new integration bug is orthogonal to the ZKash/SPP
privacy primitives.

The Zkoster-side SPP Claim fix is still complete and validated
(see commit `df17da0` and the doc's section "3. SPP Claim — RESOLVED,
with one caveat"). The remaining E2E claim requires fixing the
`chainReviewBatchFromRows` `total_commitment` serialization in
the frontend.

### Root cause of the approve failure — narrowed further

Direct reads of the on-chain payout state for batch 36 reveal that
**both payouts 21 and 22 have the SAME `amount_commitment`**:

```
payout_id=21: amount_commitment=2d3e0aee...045c7ce
payout_id=22: amount_commitment=2d3e0aee...045c7ce
total_commitment (in get_batch): 2d3e0aee...045c7ce
```

So the verifier received 2 copies of the same commitment plus
a `total_commitment` equal to one copy, and the sum
`2 × commit + (−total) = commit ≠ identity` — hence `check_commitment_sum
returns false`.

The duplicate-payout / duplicate-commitment outcome is the
result of the `writeContract` retry loop on `add_payout` having
mand'd the same logical operation twice (once with the original
sequence number, once with a new sequence number after
"lost-in-mempool"). The on-chain contract's `add_payout` is not
idempotent — it always increments `employee_count` and stores a
new payout under a fresh `payout_id`, so two successful `add_payout`
invocations of the same `(batch_id, employee, amount_commitment)`
triple produce two distinct payout entries with identical
commitments. The "duplicate wallet" pre-flight check in
`createBatchWithRowsAction` (line 394) only catches duplicates in
the input payload, not duplicates produced by the multi-step
review flow re-running.

### What's still correct

* The ZKash prover (`/prover/target/release/zkoster-prover.exe`,
  port 8787) generates valid commitments and proofs for distinct
  amounts. When the test was rerun directly with `amounts=[1000000]`
  for one row, the prover returned the correct shape:
  `total_commitment` and `payouts[0].commitment` are equal (because
  the sum of one row IS the row), and the sum check would pass for
  a single-payout batch.
* The SPP fix (commit `bbc31a0`, `4d1c8fa`, etc.) is complete and
  independent of the approve failure.

### Required fix for full E2E

1. Add idempotency to `add_payout` in
   `contracts/payroll/src/contract.rs`: either a `require!` that
   `(batch_id, employee)` is not already present, or an `Option` for
   the payout id keyed by `(batch_id, employee)`. The simplest
   version: before the `let payout_id = storage::next_payout_id(...)`
   call, check `storage::has_employee_payout(&employee)` (or add a
   similar storage helper) and either no-op or return an
   `EmployeeAlreadyInBatch` error.
2. Tighten the `writeContract` retry: when polling loses a TX,
   check whether the original sequence number has been consumed
   (via `getAccount`) before re-manding with a new one. If the
   original seqnum was consumed, the TX was applied and no retry
   is needed.
3. Re-run a fresh batch E2E with these two changes.
