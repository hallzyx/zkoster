#!/usr/bin/env bash
# Deploy and wire the Zkoster contract suite on a Stellar network.
#
# Usage:
#   SOURCE=<key-name-or-secret> ASSET=<usdc-sac> NETWORK=testnet bash scripts/deploy_testnet.sh
#
# CRITICAL — contract ownership/admin must match the frontend signer:
#   The on-chain `admin` (the only account allowed to run create_batch /
#   approve / fund / execute / issue_grant) is set to ADMIN, which DEFAULTS to
#   the SOURCE account's address. The frontend signs admin ops with
#   ZKOSTER_ADMIN_SECRET_KEY (frontend/.env.local). So SOURCE (or an explicit
#   ADMIN=) MUST resolve to that same public key, or every admin action in the
#   UI will trap on require_auth.
#
#   Recommended: import the frontend admin secret once as a stellar identity
#   and deploy as it, so the contract creator AND owner are both the admin:
#     stellar keys add zkoster-admin --secret-key   # paste ZKOSTER_ADMIN_SECRET_KEY
#     SOURCE=zkoster-admin ASSET=<usdc-sac> bash scripts/deploy_testnet.sh
#   (Or keep any funded deployer but pass ADMIN=<frontend-admin-pubkey>.)
#
# Order matters: compliance and verifier have no dependencies; payroll is wired
# to both at initialize time. One deployment == one company workspace.
set -euo pipefail

: "${SOURCE:?Set SOURCE to a funded identity (stellar keys) or secret}"
NETWORK="${NETWORK:-testnet}"
WASM_DIR="target/wasm32v1-none/release"

# ADMIN defaults to the source account's public key (creator == owner).
ADMIN="${ADMIN:-$(stellar keys address "$SOURCE")}"
SOURCE_ADDR="$(stellar keys address "$SOURCE")"
# TREASURY and ASSET must be provided for a real deployment.
TREASURY="${TREASURY:-$ADMIN}"
ASSET="${ASSET:?Set ASSET to the settlement token contract address (e.g. USDC SAC)}"

# --- Pre-flight: show exactly who will own the contracts -------------------
echo "==> Deploy pre-flight"
echo "    NETWORK : $NETWORK"
echo "    SOURCE  : $SOURCE  ($SOURCE_ADDR)   <- signs/creates the contracts"
echo "    ADMIN   : $ADMIN   <- on-chain owner (must equal the frontend ZKOSTER_ADMIN_SECRET_KEY pubkey)"
echo "    TREASURY: $TREASURY"
echo "    ASSET   : $ASSET"
if [ "$ADMIN" != "$SOURCE_ADDR" ]; then
  echo "    !! WARNING: ADMIN != SOURCE address — creator and owner differ."
fi
echo "    Set EXPECTED_ADMIN=<pubkey> to hard-fail on a mismatch."
if [ -n "${EXPECTED_ADMIN:-}" ] && [ "$ADMIN" != "$EXPECTED_ADMIN" ]; then
  echo "    !! ABORT: ADMIN ($ADMIN) != EXPECTED_ADMIN ($EXPECTED_ADMIN)." >&2
  exit 1
fi

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
