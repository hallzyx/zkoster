// Runtime configuration from environment variables.
//
// The data layer is ports-and-adapters: ZKOSTER_DATA_SOURCE picks between the
// in-memory demo data ("mock", default) and live Soroban reads ("chain").
// Switching to a real deployment is purely a matter of setting these vars.

export const DATA_SOURCE = {
  MOCK: "mock",
  CHAIN: "chain",
} as const;
export type DataSource = (typeof DATA_SOURCE)[keyof typeof DATA_SOURCE];

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const TESTNET_RPC = "https://soroban-testnet.stellar.org";

export interface ChainConfig {
  rpcUrl: string;
  networkPassphrase: string;
  payrollId: string;
  verifierId: string;
  complianceId: string;
}

export interface AppConfig {
  dataSource: DataSource;
  proverUrl: string | null;
  chain: ChainConfig | null;
  /**
   * UI ↔ on-chain amount factor. The UI shows/accepts amounts multiplied by
   * this; the contract and token use `uiAmount / displayScale`. Lets a demo
   * with little testnet USDC display realistic figures.
   */
  displayScale: number;
}

const DEFAULT_DISPLAY_SCALE = 1000;

function readDisplayScale(): number {
  const raw = process.env.ZKOSTER_DISPLAY_SCALE;
  if (!raw) return DEFAULT_DISPLAY_SCALE;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DISPLAY_SCALE;
}

function readChainConfig(): ChainConfig {
  const payrollId = process.env.ZKOSTER_PAYROLL_ID;
  const verifierId = process.env.ZKOSTER_VERIFIER_ID;
  const complianceId = process.env.ZKOSTER_COMPLIANCE_ID;

  const missing = [
    ["ZKOSTER_PAYROLL_ID", payrollId],
    ["ZKOSTER_VERIFIER_ID", verifierId],
    ["ZKOSTER_COMPLIANCE_ID", complianceId],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new Error(
      `ZKOSTER_DATA_SOURCE=chain requires ${missing.join(", ")}. ` +
        `Set them (see .env.example) or use ZKOSTER_DATA_SOURCE=mock.`,
    );
  }

  return {
    rpcUrl: process.env.STELLAR_RPC_URL ?? TESTNET_RPC,
    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE ?? TESTNET_PASSPHRASE,
    payrollId: payrollId!,
    verifierId: verifierId!,
    complianceId: complianceId!,
  };
}

export function getConfig(): AppConfig {
  const dataSource =
    process.env.ZKOSTER_DATA_SOURCE === DATA_SOURCE.CHAIN
      ? DATA_SOURCE.CHAIN
      : DATA_SOURCE.MOCK;

  return {
    dataSource,
    proverUrl: process.env.ZKOSTER_PROVER_URL ?? null,
    chain: dataSource === DATA_SOURCE.CHAIN ? readChainConfig() : null,
    displayScale: readDisplayScale(),
  };
}
