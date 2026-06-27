// SPP SDK — contract addresses and network configuration.

/** All SPP contracts deployed on Stellar testnet. */
export const SPP_CONTRACTS = {
  // --- Nethermind original deployments (non-zero ASP roots — not used for proofs) ---
  poolXlm: "CBUEFW2J5QZ6Q2ARZWQPFWF4T7DRXCZWDTM34WNM375Y56FE4DSL42S2",
  poolEurc: "CBM7UDVA4REFKRWXHGXCEB5WNDISMLUSITYAT6GSCNAQJFKASSBHEKEV",
  poolUsdcLegacy: "CBLGZJWVAW4DTI3W7CCU2AB4SPOH7ANTW5ACMQKVVJ5MDF23ACRNFSTC",
  aspMembershipNethermind: "CAMMKUKPKTR73DGBD5CLYXWDUYI6DP2EKUREW6O3L65EAZMF6GXJRMPK",
  aspNonMembershipNethermind: "CAOD7JDSOQ5IYX77KX4AFMZDGHIH3JQU2AZ2DKOBH6U5PGUSTGGWSZBA",

  // --- zkoster-admin deployments (2026-06-27) — empty ASP trees, real proofs work ---
  /** USDC pool wired to empty-tree ASP contracts. Accepts real Groth16 proofs. */
  poolUsdc: "CBHXAGR6CLDIGT6MR42EXWDI2XHD6RZRVTCZZWHVMRBYYSGCQW5O4ORM",
  /** Empty ASP membership tree (depth 10). Root = Poseidon2 empty-tree canonical value. */
  aspMembership: "CBTOY7I7SERRSAOTUAY7CAMHZZBZS2MYOUQUAW7BE6L3SOA7T3NCHCUU",
  /** Empty ASP non-membership SMT. Root = 0. */
  aspNonMembership: "CC3VYWSZBIQCBDXP2XXQIY22CUKBQSYDMU7ER4POXMVDATLZRRYJGFET",

  // --- Shared (Nethermind, immutable) ---
  /** Circom Groth16 verifier (BN254). Shared across all pools. */
  verifier: "CBKOZTEYI5RAGSUKWAQEC4V6MRYDC4KL2D3PRPKMLWHTMXMFSCBVUJXX",
  /** On-chain public-key registry for note encryption. */
  pubkeyRegistry: "CBBWNJ75EQDPQWJJDZ2WHMJWPLDYDQUCTL2V6F23VG3JAL3PEYZSNL4S",
} as const;

/** Active pool for deposit/claim flows. */
export const DEMO_POOL = SPP_CONTRACTS.poolUsdc;

/** Base URL for the local SPP prover HTTP server (port 8788). */
export const PROVER_BASE_URL =
  (typeof process !== "undefined" && process.env.SPP_PROVER_URL) ||
  "http://127.0.0.1:8788";

/** Stellar testnet RPC endpoint. */
export const TESTNET_RPC = "https://soroban-testnet.stellar.org";

/** Stellar testnet network passphrase. */
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
