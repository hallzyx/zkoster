#!/usr/bin/env bash
# Execute a private admin -> employee payroll payment end-to-end on-chain.
#
# Runs the full payroll state machine for a single payout: prove (commitment +
# range proof) -> register member -> set verifying key -> create batch ->
# add payout -> review -> approve (sum check) -> fund -> execute (range proof).
#
# Usage:
#   EMPLOYEE=G... UI_AMOUNT=1000 bash scripts/pay_employee.sh
#
# Env (with sensible testnet defaults):
#   SOURCE        admin identity/secret for signing            (default zkoster-deployer)
#   NETWORK       stellar network                              (default testnet)
#   PROVER_URL    prover HTTP endpoint                         (default http://localhost:8787)
#   SCALE         UI -> on-chain amount divisor                (default 1000)
#   PAYROLL_ID / VERIFIER_ID / COMPLIANCE_ID  deployed contract ids
set -euo pipefail

SOURCE="${SOURCE:-zkoster-deployer}"
NETWORK="${NETWORK:-testnet}"
PROVER_URL="${PROVER_URL:-http://localhost:8787}"
SCALE="${SCALE:-1000}"
PAYROLL_ID="${PAYROLL_ID:-CBCWJ43FQCCP3ZODDYST52QLGK4TPQT2ZIYQKZ54G5CAFGCMEURN54RT}"
VERIFIER_ID="${VERIFIER_ID:-CDAODE4OAQBTWJHX7Y2OQGXZFDCL2XRTOC6MYXF7REMPM2UD7OEVTJE5}"
COMPLIANCE_ID="${COMPLIANCE_ID:-CARUMLJPHND54E3M2IQRW4445TPOY54FB6N2R2FDY5BDCOYCEIHJPU5C}"
: "${EMPLOYEE:?Set EMPLOYEE to the recipient G... address}"
: "${UI_AMOUNT:?Set UI_AMOUNT (UI value; on-chain amount = UI_AMOUNT / SCALE)}"

REAL_AMOUNT=$(( UI_AMOUNT / SCALE ))
ZERO32="0000000000000000000000000000000000000000000000000000000000000000"

log() { printf '\n==> %s\n' "$1" >&2; }
invoke() {
  local id="$1"; shift
  stellar contract invoke --id "$id" --source "$SOURCE" --network "$NETWORK" -- "$@"
}
unquote() { tr -d '"' <<<"$1"; }

log "Proving amount (UI $UI_AMOUNT -> on-chain $REAL_AMOUNT)"
ARTIFACTS=$(curl -fsS -X POST "$PROVER_URL/prove" \
  -H 'content-type: application/json' \
  -d "{\"amounts\":[$REAL_AMOUNT]}")

VK=$(jq -c '.vk' <<<"$ARTIFACTS")
COMMITMENT=$(jq -r '.payouts[0].commitment' <<<"$ARTIFACTS")
PROOF=$(jq -c '.payouts[0].proof' <<<"$ARTIFACTS")
PUBLIC_INPUT=$(jq -r '.payouts[0].public_input' <<<"$ARTIFACTS")
TOTAL=$(jq -r '.total_commitment' <<<"$ARTIFACTS")

log "Authorizing recipient in compliance"
invoke "$COMPLIANCE_ID" register_member --wallet "$EMPLOYEE" --role 0 >/dev/null

log "Registering verifying key"
invoke "$VERIFIER_ID" set_vk --vk "$VK" >/dev/null

log "Creating batch"
BATCH=$(unquote "$(invoke "$PAYROLL_ID" create_batch --period_start 1 --period_end 2)")

log "Adding payout (batch $BATCH)"
PAYOUT=$(unquote "$(invoke "$PAYROLL_ID" add_payout \
  --batch_id "$BATCH" --employee "$EMPLOYEE" --amount_commitment "\"$COMMITMENT\"")")

log "Reviewing batch"
invoke "$PAYROLL_ID" review_batch --batch_id "$BATCH" --total_commitment "\"$TOTAL\"" >/dev/null

log "Approving batch (verifier checks Σ commitments == total)"
invoke "$PAYROLL_ID" approve_batch --batch_id "$BATCH" >/dev/null

log "Funding batch"
invoke "$PAYROLL_ID" fund_batch --batch_id "$BATCH" >/dev/null

log "Executing payout (verifier checks range proof)"
invoke "$PAYROLL_ID" execute_payout \
  --batch_id "$BATCH" --payout_id "$PAYOUT" \
  --proof "$PROOF" --public_inputs "[\"$PUBLIC_INPUT\"]" --tx_ref "\"$ZERO32\"" >/dev/null

log "Done"
jq -n --arg b "$BATCH" --arg p "$PAYOUT" --arg e "$EMPLOYEE" --argjson ui "$UI_AMOUNT" --argjson real "$REAL_AMOUNT" \
  '{batch_id:$b, payout_id:$p, employee:$e, ui_amount:$ui, onchain_amount:$real, status:"paid"}'
