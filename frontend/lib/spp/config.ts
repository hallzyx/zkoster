// SPP SDK — contract addresses and network configuration.

/** All SPP contracts deployed on Stellar testnet. */
export const SPP_CONTRACTS = {
  // --- Nethermind original deployments (non-zero ASP roots — not used for proofs) ---
  poolXlm: "CBUEFW2J5QZ6Q2ARZWQPFWF4T7DRXCZWDTM34WNM375Y56FE4DSL42S2",
  poolEurc: "CBM7UDVA4REFKRWXHGXCEB5WNDISMLUSITYAT6GSCNAQJFKASSBHEKEV",
  poolUsdcLegacy: "CBLGZJWVAW4DTI3W7CCU2AB4SPOH7ANTW5ACMQKVVJ5MDF23ACRNFSTC",
  aspMembershipNethermind: "CAMMKUKPKTR73DGBD5CLYXWDUYI6DP2EKUREW6O3L65EAZMF6GXJRMPK",
  aspNonMembershipNethermind: "CAOD7JDSOQ5IYX77KX4AFMZDGHIH3JQU2AZ2DKOBH6U5PGUSTGGWSZBA",

  // --- zkoster-admin deployments (2026-06-27/28) — empty ASP trees, real proofs work ---
  /** Previous pool — bound to native XLM SAC. Kept for reference. */
  poolNativeXlm: "CBHXAGR6CLDIGT6MR42EXWDI2XHD6RZRVTCZZWHVMRBYYSGCQW5O4ORM",
  /**
   * Old USDC pool — deployed 2026-06-28 using the Nethermind SPP WASM (hash
   * f9cf9c2f…) bound to the Circle testnet USDC SAC. The deployed bytecode
   * has the BN256_MOD_BYTES off-by-10_000_000 typo, so it rejects valid proofs
   * with `WrongExtAmount = 6`. Replaced by `poolUsdcFixed` on 2026-06-29
   * after rebuilding the Nethermind sources with the modulus corrected.
   * Kept here for reference; do NOT use for live flows.
   */
  poolUsdcBuggy: "CALWH3FKYAEVI4HMLWTMLFRVJSQ45ZGIQYQR32PX6BONK2YSKACZ5IWL",
  // ^ alias for the CAL...IWL deployment that had the BN256_MOD_BYTES
  // typo. Renamed from `poolUsdcLegacy` to avoid clashing with the
  // legacy `poolUsdcLegacy: CB...STC` above (line 8).
  /**
   * Active USDC pool — deployed 2026-06-29 from Nethermind SPP source patched
   * locally to fix the BN256_MOD_BYTES typo (limb 0 changed from
   * `0x43e1f593f0000001` to `0x43e1f593ef676981`). Bound to the Circle
   * testnet USDC SAC (`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`,
   * asset = USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5).
   * Deposits pull real USDC and claims pay USDC to the recipient.
   */
  poolUsdc: "CBZCCO4OCPDLC4JTJ5OPF7SUKQZWS3OWDV3RP35XMAK6E4SGFKD6TQC3",
  /** Empty ASP membership tree (depth 10). Root = Poseidon2 empty-tree canonical value. */
  aspMembership: "CAR24L4BAD7Q457VOXYEJJCQYKECH5FQYICMZV4UDTDDV6OVSEYPHBXN",
  /** Empty ASP non-membership SMT. Root = 0. */
  aspNonMembership: "CDXTO34MQREF7W4B27WCFSPE3NDPBNS6XJJFWTKOJUZPJJGKSIO6FT3Q",

  // --- Shared (zkoster-admin redeployed 2026-06-29 with the modulus fix) ---
  /** Circom Groth16 verifier (BN254). Shared across all pools. */
  verifier: "CBXNZXZHHCYVO56TFLUEVAJ73FEOJP4NRUCE3SSJYS4K7YK4LWLKRI74",
  /** On-chain public-key registry for note encryption. */
  pubkeyRegistry: "CAKA7WMTPSKBJPWKTXQGUYU2CLDDID46BYYPMKZPYVN3UJJHOUMKTJNZ",
} as const;

/** Active pool for deposit/claim flows — settles in real USDC. */
export const DEMO_POOL = SPP_CONTRACTS.poolUsdc;

/** The asset the active DEMO_POOL settles in. */
export const SETTLEMENT_ASSET = "USDC" as const;

/** Base URL for the local SPP prover HTTP server (port 8788). */
export const PROVER_BASE_URL =
  (typeof process !== "undefined" && process.env.SPP_PROVER_URL) ||
  "http://127.0.0.1:8788";

/** Stellar testnet RPC endpoint. */
export const TESTNET_RPC = "https://soroban-testnet.stellar.org";

/** Stellar testnet network passphrase. */
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
