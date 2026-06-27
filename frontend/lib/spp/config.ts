// SPP SDK — contract addresses and network configuration.
//
// Addresses sourced from deployments/testnet/deployments.json (deployed by
// Nethermind on the Stellar testnet, June 2026).

/** All SPP contracts deployed on Stellar testnet. */
export const SPP_CONTRACTS = {
  /** XLM-denominated privacy pool (original Nethermind deployment). */
  poolXlm: "CBUEFW2J5QZ6Q2ARZWQPFWF4T7DRXCZWDTM34WNM375Y56FE4DSL42S2",
  /** EURC-denominated privacy pool. */
  poolEurc: "CBM7UDVA4REFKRWXHGXCEB5WNDISMLUSITYAT6GSCNAQJFKASSBHEKEV",
  /**
   * USDC-denominated privacy pool deployed by zkoster-admin (2026-06-26).
   * Token: CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC (USDC SAC testnet)
   * Levels: 10 | Max deposit: 1 000 000 000 stroops
   */
  poolUsdc: "CBLGZJWVAW4DTI3W7CCU2AB4SPOH7ANTW5ACMQKVVJ5MDF23ACRNFSTC",
  /** Circom Groth16 verifier (BN254). */
  verifier: "CBKOZTEYI5RAGSUKWAQEC4V6MRYDC4KL2D3PRPKMLWHTMXMFSCBVUJXX",
  /** ASP membership allowlist (know-your-sender). */
  aspMembership: "CAMMKUKPKTR73DGBD5CLYXWDUYI6DP2EKUREW6O3L65EAZMF6GXJRMPK",
  /** ASP non-membership denylist (sanctions check). */
  aspNonMembership: "CAOD7JDSOQ5IYX77KX4AFMZDGHIH3JQU2AZ2DKOBH6U5PGUSTGGWSZBA",
  /** On-chain public-key registry for note encryption. */
  pubkeyRegistry: "CBBWNJ75EQDPQWJJDZ2WHMJWPLDYDQUCTL2V6F23VG3JAL3PEYZSNL4S",
} as const;

/** Pool contract used for demo flows (USDC). */
export const DEMO_POOL = SPP_CONTRACTS.poolUsdc;

/** Stellar testnet RPC endpoint. */
export const TESTNET_RPC = "https://soroban-testnet.stellar.org";

/** Stellar testnet network passphrase. */
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
