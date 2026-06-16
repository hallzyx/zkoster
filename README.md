# Zkoster

> Run stablecoin payroll on Stellar without publishing your salary table to the internet.

**Zkoster** (ZK + Roster) is a private payroll workspace for companies paying in
stablecoins on Stellar. HR uploads a batch, employees receive confidential
payouts and only see their own, and authorized auditors review what they need
through selective disclosure. Private by default, auditable when needed.

Built for a Stellar hackathon on **Soroban** + **BN254 ZK** (Protocol 25 X-Ray /
Protocol 26 Yardstick).

## Architecture

Three Soroban contracts — one deployment of the trio per company workspace:

```
ZkosterPayroll ──calls──▶ ZkosterVerifier   (Groth16 + Pedersen commitment sum)
       │
       └────────calls──▶ ZkosterCompliance  (membership, denylist, disclosure grants)
```

- **ZkosterPayroll** — treasury config, batch lifecycle, private payout
  commitments, settlement state machine.
- **ZkosterVerifier** — stateless ZK arbiter: verifies Groth16 range proofs and
  the homomorphic commitment sum (`Σ Cᵢ == total`) on BN254 host functions.
- **ZkosterCompliance** — allowlist/denylist membership and auditor disclosure
  grants.

Amounts are stored only as **Pedersen commitments** — never cleartext on the
ledger.

## Quick start

```bash
make build   # compile contracts to wasm
make test    # run the full test suite
make lint    # clippy, warnings = errors
```

Deploy + wire on testnet (order matters: compliance/verifier first, then payroll):

```bash
ASSET=<usdc-sac-address> make deploy-testnet SOURCE=<funded-key>
```

## Docs

- [`zkoster-prd.md`](zkoster-prd.md) — product requirements & domain model.
- [`contracts/README.md`](contracts/README.md) — contract interface, screen → call map, deploy & bindings.
- [`CLAUDE.md`](CLAUDE.md) — architecture notes for contributors.

## Status

Contract layer complete and tested (including verification against real Groth16
proofs). Frontend and the production Noir range-proof circuit are next.
