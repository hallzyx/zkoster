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
| `ZKOSTER_DISPLAY_SCALE` | UI↔on-chain amount factor (default `1000`: UI 1000 == 1 real USDC) |
| `ZKOSTER_PAYROLL_ID` / `ZKOSTER_VERIFIER_ID` / `ZKOSTER_COMPLIANCE_ID` | deployed contract ids (chain mode) |
| `STELLAR_RPC_URL` / `STELLAR_NETWORK_PASSPHRASE` | network (defaults to testnet) |
| `ZKOSTER_{ADMIN,EMPLOYEE,AUDITOR}_SECRET_KEY` | per-role testnet secret keys — **server-only**, never exposed to the client (public keys derived for reads; secrets sign writes) |

## Amount scaling

The UI works in scaled units; the contract and token use `uiAmount / displayScale`
(`lib/utils.ts` `toRealAmount` / `toUiAmount`). With the default scale of 1000,
sending "1000 USDC" in the UI moves 1 real USDC on-chain — so a wallet holding a
few testnet USDC still shows realistic payroll figures.

## Role wallets

`lib/wallets.ts` (server-only) derives each role's public key from its secret and
exposes a keypair for server-side signing. When the secrets are unset (pure mock
demo) the placeholder identities in `lib/data/metadata.ts` are used instead.

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
