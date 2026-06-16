.PHONY: build test fmt fmt-check lint clean sizes bindings deploy-testnet

WASM_DIR := target/wasm32v1-none/release
CONTRACTS := zkoster_compliance zkoster_verifier zkoster_payroll

# Build all contracts to optimized wasm.
build:
	stellar contract build

# Run the full native test suite.
test:
	cargo test

# Format all crates.
fmt:
	cargo fmt

fmt-check:
	cargo fmt --check

# Lint with warnings treated as errors (CI gate).
lint:
	cargo clippy --all-targets -- -D warnings

clean:
	cargo clean

# Print the size of each built wasm.
sizes: build
	@for c in $(CONTRACTS); do \
		printf "%-22s %s bytes\n" "$$c" "$$(wc -c < $(WASM_DIR)/$$c.wasm)"; \
	done

# Generate TypeScript bindings for the frontend from a deployed contract.
#   make bindings NAME=payroll ID=C... NETWORK=testnet
bindings:
	stellar contract bindings typescript \
		--contract-id $(ID) \
		--network $(NETWORK) \
		--output-dir bindings/$(NAME) \
		--overwrite

# Deploy + wire the three contracts on testnet (see scripts/deploy_testnet.sh).
#   make deploy-testnet SOURCE=my-key
deploy-testnet: build
	SOURCE=$(SOURCE) NETWORK=testnet bash scripts/deploy_testnet.sh
