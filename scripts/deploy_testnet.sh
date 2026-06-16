#!/usr/bin/env bash
# Deploy and wire the Zkoster contract suite on a Stellar network.
#
# Usage:
#   SOURCE=<key-name-or-secret> NETWORK=testnet bash scripts/deploy_testnet.sh
#
# Order matters: compliance and verifier have no dependencies; payroll is wired
# to both at initialize time. One deployment == one company workspace.
set -euo pipefail

: "${SOURCE:?Set SOURCE to a funded identity (stellar keys) or secret}"
NETWORK="${NETWORK:-testnet}"
WASM_DIR="target/wasm32v1-none/release"

# ADMIN defaults to the source account's public key.
ADMIN="${ADMIN:-$(stellar keys address "$SOURCE")}"
# TREASURY and ASSET must be provided for a real deployment.
TREASURY="${TREASURY:-$ADMIN}"
ASSET="${ASSET:?Set ASSET to the settlement token contract address (e.g. USDC SAC)}"

deploy() {
  stellar contract deploy --wasm "$WASM_DIR/$1.wasm" --source "$SOURCE" --network "$NETWORK"
}

invoke() {
  local id="$1"; shift
  stellar contract invoke --id "$id" --source "$SOURCE" --network "$NETWORK" -- "$@"
}

echo "==> Deploying compliance"
COMPLIANCE_ID=$(deploy zkoster_compliance)
echo "    $COMPLIANCE_ID"

echo "==> Deploying verifier"
VERIFIER_ID=$(deploy zkoster_verifier)
echo "    $VERIFIER_ID"

echo "==> Deploying payroll"
PAYROLL_ID=$(deploy zkoster_payroll)
echo "    $PAYROLL_ID"

echo "==> Initializing compliance"
invoke "$COMPLIANCE_ID" initialize --admin "$ADMIN"

echo "==> Initializing verifier"
invoke "$VERIFIER_ID" initialize --admin "$ADMIN"
# NOTE: set the verifying key once the Noir circuit's VK is available:
#   invoke "$VERIFIER_ID" set_vk --vk '<json>'

echo "==> Initializing payroll (wired to compliance + verifier)"
invoke "$PAYROLL_ID" initialize \
  --admin "$ADMIN" \
  --treasury "$TREASURY" \
  --asset "$ASSET" \
  --compliance "$COMPLIANCE_ID" \
  --verifier "$VERIFIER_ID"

cat <<EOF

Done. Contract ids:
  COMPLIANCE_ID=$COMPLIANCE_ID
  VERIFIER_ID=$VERIFIER_ID
  PAYROLL_ID=$PAYROLL_ID

Generate frontend bindings, e.g.:
  make bindings NAME=payroll ID=$PAYROLL_ID NETWORK=$NETWORK
EOF
