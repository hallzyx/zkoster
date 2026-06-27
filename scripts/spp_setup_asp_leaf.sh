#!/usr/bin/env bash
# One-time setup: insert the spp-prover demo identity leaf into the ASP membership contract.
#
# Prerequisites:
#   1. spp-prover binary built: cd spp-prover && cargo build --release
#   2. spp-prover running:      RUSTFLAGS="-C link-arg=/STACK:268435456" cargo run -p spp-prover
#   3. stellar CLI configured with zkoster-admin identity
#
# Run this ONCE after deploying fresh ASP membership contract.
# The leaf value is deterministic — re-running is idempotent if already inserted.

set -euo pipefail

PROVER_URL="${SPP_PROVER_URL:-http://127.0.0.1:8788}"
ASP_MEMBERSHIP="${ASP_MEMBERSHIP:-CBTOY7I7SERRSAOTUAY7CAMHZZBZS2MYOUQUAW7BE6L3SOA7T3NCHCUU}"
NETWORK="${STELLAR_NETWORK:-testnet}"

echo "Fetching demo membership leaf from prover..."
MEMBERSHIP=$(curl -sf "${PROVER_URL}/spp/membership")
LEAF=$(echo "$MEMBERSHIP" | jq -r '.leaf_be_hex')
EXPECTED_ROOT=$(echo "$MEMBERSHIP" | jq -r '.expected_root_be_hex')

echo "Leaf:          $LEAF"
echo "Expected root: $EXPECTED_ROOT"
echo ""
echo "Inserting leaf into ASP membership contract $ASP_MEMBERSHIP..."

stellar contract invoke \
  --id "$ASP_MEMBERSHIP" \
  --source-account zkoster-admin \
  --network "$NETWORK" \
  -- insert_leaf \
  --leaf "$LEAF"

echo ""
echo "Verifying on-chain root..."
ROOT=$(stellar contract invoke \
  --id "$ASP_MEMBERSHIP" \
  --source-account zkoster-admin \
  --network "$NETWORK" \
  -- root 2>/dev/null || echo "unknown")

echo "On-chain root: $ROOT"
echo "Expected root: $EXPECTED_ROOT"
echo ""
echo "ASP membership setup complete."
