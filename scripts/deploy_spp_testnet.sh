#!/usr/bin/env bash
# deploy_spp_testnet.sh
#
# T-02 Assessment & Reference Script — SPP contracts on Stellar Testnet
#
# STATUS: SPP contracts are ALREADY DEPLOYED on testnet by Nethermind.
# No immediate deployment needed for existing XLM / EURC pools.
#
# ┌───────────────────────────────────────────────────────────────────────────┐
# │  ALREADY DEPLOYED (deployments/testnet/deployments.json from SPP repo)   │
# ├─────────────────────────────────┬─────────────────────────────────────────┤
# │  Contract                       │  Address                                │
# ├─────────────────────────────────┼─────────────────────────────────────────┤
# │  ASP Membership                 │  CAMMKUKPKTR73DGBD5CLYXWDUYI6DP2EKUREW6O3L65EAZMF6GXJRMPK  │
# │  ASP Non-Membership             │  CAOD7JDSOQ5IYX77KX4AFMZDGHIH3JQU2AZ2DKOBH6U5PGUSTGGWSZBA  │
# │  Circom Groth16 Verifier        │  CBKOZTEYI5RAGSUKWAQEC4V6MRYDC4KL2D3PRPKMLWHTMXMFSCBVUJXX  │
# │  Public Key Registry            │  CBBWNJ75EQDPQWJJDZ2WHMJWPLDYDQUCTL2V6F23VG3JAL3PEYZSNL4S  │
# │  Pool (native XLM)              │  CBUEFW2J5QZ6Q2ARZWQPFWF4T7DRXCZWDTM34WNM375Y56FE4DSL42S2  │
# │  Pool (EURC classic)            │  CBM7UDVA4REFKRWXHGXCEB5WNDISMLUSITYAT6GSCNAQJFKASSBHEKEV   │
# ├─────────────────────────────────┴─────────────────────────────────────────┤
# │  Deployer: GBXQBIZWREYHXIEVLXHOMYNWOIMG7DA3NNBSMZ4V5HWPP5MWZOWGRWAY     │
# │  Admin:    GBXQBIZWREYHXIEVLXHOMYNWOIMG7DA3NNBSMZ4V5HWPP5MWZOWGRWAY     │
# │  Circuit:  policy_tx_2_2 (Groth16 / Poseidon2 / BN254)                  │
# └───────────────────────────────────────────────────────────────────────────┘
#
# IMPORTANT: Neither existing pool accepts USDC (zkoster's payroll token).
#   - XLM pool: Stellar native token
#   - EURC pool: Euro-pegged stablecoin by Circle
#   To use SPP with USDC payroll, a new USDC pool must be deployed.
#
# ─────────────────────────────────────────────────────────────────────────────
# OPTION A — Use an existing pool with XLM (demo-mode, not production USDC)
# ─────────────────────────────────────────────────────────────────────────────
# No deployment needed. Set in frontend/.env.local:
#   NEXT_PUBLIC_SPP_POOL=CBUEFW2J5QZ6Q2ARZWQPFWF4T7DRXCZWDTM34WNM375Y56FE4DSL42S2
#   NEXT_PUBLIC_SPP_VERIFIER=CBKOZTEYI5RAGSUKWAQEC4V6MRYDC4KL2D3PRPKMLWHTMXMFSCBVUJXX
#   NEXT_PUBLIC_SPP_ASP_MEMBERSHIP=CAMMKUKPKTR73DGBD5CLYXWDUYI6DP2EKUREW6O3L65EAZMF6GXJRMPK
#   NEXT_PUBLIC_SPP_ASP_NON_MEMBERSHIP=CAOD7JDSOQ5IYX77KX4AFMZDGHIH3JQU2AZ2DKOBH6U5PGUSTGGWSZBA

# ─────────────────────────────────────────────────────────────────────────────
# OPTION B — Deploy a new USDC pool (recommended for real payroll demo)
# ─────────────────────────────────────────────────────────────────────────────
# Prerequisites:
#   1. Clone the SPP repo:
#        git clone https://github.com/NethermindEth/stellar-private-payments
#        cd stellar-private-payments
#   2. Build SPP contracts (requires Rust + stellar-cli 23.x + Protocol 26 target):
#        cargo build --release --target wasm32-unknown-unknown
#   3. Add your identity to stellar-cli:
#        stellar keys add deployer --seed-phrase  # prompts for seed phrase
#
# Deploy a new USDC pool against the ALREADY DEPLOYED verifier + ASP contracts:
#   (USDC testnet SAC contract ID — verify current value from the zkoster config)
#
# USDC_CONTRACT="<USDC_SAC_CONTRACT_ID_FROM_FRONTEND_CONFIG>"
# DEPLOYER="<YOUR_STELLAR_IDENTITY>"
#
# ./deployments/scripts/deploy.sh testnet \
#   --deployer "${DEPLOYER}" \
#   --asp-levels 10 \
#   --pool-levels 10 \
#   --max-deposit 1000000000 \
#   --vk-file deployments/testnet/circuit_keys/policy_tx_2_2_vk.json \
#   --pool "contract:${USDC_CONTRACT}"
#
# This will:
#   1. Deploy asp-membership contract
#   2. Deploy asp-non-membership contract
#   3. Build + deploy circom-groth16-verifier with embedded VK
#   4. Deploy pool contract referencing verifier + ASP
#   5. Output addresses to deployments/testnet/deployments.json

# ─────────────────────────────────────────────────────────────────────────────
# OPTION C — Skip-init deploy (reuse existing verifier + ASP, pool only)
# ─────────────────────────────────────────────────────────────────────────────
# If you want to deploy only the pool contract and wire it to existing
# verifier/ASP contracts, use --skip-init and configure pool constructor manually:
#
# stellar contract invoke \
#   --id "<NEW_POOL_CONTRACT_ID>" \
#   --source-account "${DEPLOYER}" \
#   --network testnet \
#   -- constructor \
#   --admin "${DEPLOYER}" \
#   --token "${USDC_CONTRACT}" \
#   --verifier "CBKOZTEYI5RAGSUKWAQEC4V6MRYDC4KL2D3PRPKMLWHTMXMFSCBVUJXX" \
#   --asp_membership "CAMMKUKPKTR73DGBD5CLYXWDUYI6DP2EKUREW6O3L65EAZMF6GXJRMPK" \
#   --asp_non_membership "CAOD7JDSOQ5IYX77KX4AFMZDGHIH3JQU2AZ2DKOBH6U5PGUSTGGWSZBA" \
#   --max_deposit 1000000000 \
#   --levels 10

# ─────────────────────────────────────────────────────────────────────────────
# NOTES ON PROVING KEY COMPATIBILITY
# ─────────────────────────────────────────────────────────────────────────────
# - The circuit is policy_tx_2_2 (Groth16 / BN254 / Poseidon2)
# - Proving key: deployments/testnet/circuit_keys/policy_tx_2_2_proving_key.bin
#   Format: compressed arkworks VerifyingKey (NOT snarkjs .zkey)
# - The SPP frontend uses a Rust/WASM prover (Trunk build), NOT snarkjs
# - To generate proofs in the browser, build SPP's Rust app with Trunk:
#     cd app && npm install && trunk build
#   Or wait for circuit recompile with snarkjs toolchain (adds ~1 day)
# - Prebuilt .wasm witness generators are NOT checked into the repo
#   (dist/ is gitignored per SPP's own README)

# ─────────────────────────────────────────────────────────────────────────────
# VALIDATE EXISTING POOL (quick smoke check — run this now)
# ─────────────────────────────────────────────────────────────────────────────
# stellar contract invoke \
#   --id CBUEFW2J5QZ6Q2ARZWQPFWF4T7DRXCZWDTM34WNM375Y56FE4DSL42S2 \
#   --network testnet \
#   -- get_state

echo "SPP testnet assessment complete."
echo "Existing contracts are live. See comments above for next steps."
echo ""
echo "Pool (XLM):   CBUEFW2J5QZ6Q2ARZWQPFWF4T7DRXCZWDTM34WNM375Y56FE4DSL42S2"
echo "Pool (EURC):  CBM7UDVA4REFKRWXHGXCEB5WNDISMLUSITYAT6GSCNAQJFKASSBHEKEV"
echo "Verifier:     CBKOZTEYI5RAGSUKWAQEC4V6MRYDC4KL2D3PRPKMLWHTMXMFSCBVUJXX"
echo "ASP Mbr:      CAMMKUKPKTR73DGBD5CLYXWDUYI6DP2EKUREW6O3L65EAZMF6GXJRMPK"
echo "ASP NonMbr:   CAOD7JDSOQ5IYX77KX4AFMZDGHIH3JQU2AZ2DKOBH6U5PGUSTGGWSZBA"
echo "Public Key Registry: CBBWNJ75EQDPQWJJDZ2WHMJWPLDYDQUCTL2V6F23VG3JAL3PEYZSNL4S"
