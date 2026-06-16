# Zkoster Frontend

Next.js 16 (App Router, React 19, Tailwind 4) workspace for the three demo roles:
Admin, Employee and Auditor — each enforcing per-role visibility of payouts.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

## Data source (mock ↔ chain)

The data layer (`lib/data/`) is ports-and-adapters:

- **`mock`** (default) — in-memory demo dataset; runs with no deployment.
- **`chain`** — live Soroban reads via `@stellar/stellar-sdk`, decorated with the
  company's off-chain metadata (the ledger stores only commitments, so cleartext
  amounts and names are merged from `lib/data/metadata.ts`).

Pages import from `@/lib/data` and never know which adapter is active — flip it
with env vars. Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

| Var | Purpose |
|---|---|
| `ZKOSTER_DATA_SOURCE` | `mock` (default) or `chain` |
| `ZKOSTER_PROVER_URL` | prover HTTP endpoint (`zkoster-prover serve`) |
| `ZKOSTER_PAYROLL_ID` / `ZKOSTER_VERIFIER_ID` / `ZKOSTER_COMPLIANCE_ID` | deployed contract ids (chain mode) |
| `STELLAR_RPC_URL` / `STELLAR_NETWORK_PASSPHRASE` | network (defaults to testnet) |

## Status of the chain adapter

`lib/data/chain.ts` is wired with the real read pattern (simulate + `scValToNative`
+ off-chain decoration) but is **provisional until verified against a deployed
contract** — the exact ScVal encodings (enum variant shapes, struct field names)
must be confirmed with `stellar contract invoke`. Mock remains the default so the
demo always runs.

## Layout

```
app/                role pages (page = Server Component by default)
  _components/       reusable UI (Card, badges, ConfidentialAmount, TopBar)
  admin/ employee/ auditor/
lib/
  types.ts           domain types (const-object pattern)
  config.ts          env-driven config
  prover.ts          client for the zkoster-prover HTTP endpoint
  data/              mock | chain adapters + index dispatch + off-chain metadata
```
