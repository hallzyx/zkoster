import { ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Renders a Stellar transaction hash as a clickable link to Stellar Expert.
 *
 * The contract `ChainConfig` exposes `networkPassphrase` which we match against
 * well-known Stellar networks to pick the right explorer subdomain. If the
 * passphrase is custom (e.g. localnet), the link degrades to the testnet
 * explorer with a "best effort" tooltip — the user can still copy the hash.
 *
 * Detection: the standard SDF passphrase constants for testnet/mainnet/futurenet
 * are stable enough to hardcode (any change would break half the ecosystem).
 */
function explorerBaseFor(passphrase: string): {
  base: string;
  networkLabel: string;
} {
  // SDF public passphrases (see https://github.com/stellar/stellar-core/blob/master/src/protocol/ConfigKey.cpp)
  if (passphrase.includes("Test SDF Network"))
    return { base: "https://stellar.expert/explorer/testnet", networkLabel: "Testnet" };
  if (passphrase.includes("Public Global Stellar Network"))
    return { base: "https://stellar.expert/explorer/public", networkLabel: "Mainnet" };
  if (passphrase.includes("Test SDF Future Network"))
    return { base: "https://stellar.expert/explorer/futurenet", networkLabel: "Futurenet" };
  // Standalone / localnet — fall back to testnet explorer as best-effort.
  return { base: "https://stellar.expert/explorer/testnet", networkLabel: "Local" };
}

/**
 * Renders a tx hash with a leading "tx" label, a short monospace display, and
 * a clickable icon that opens the explorer in a new tab. Falls back to a
 * monospace span (no link) if the hash is empty, "demo:" prefixed, or malformed.
 */
export function TxHashLink({
  hash,
  passphrase,
  short = true,
  className,
}: {
  hash: string | null | undefined;
  passphrase: string;
  short?: boolean;
  className?: string;
}) {
  if (!hash) {
    return <span className={cn("text-slate-700", className)}>—</span>;
  }

  // Demo / mock hashes — not real on-chain TXs.
  if (hash.startsWith("demo:") || hash.length < 16) {
    return (
      <span className={cn("font-mono text-xs text-slate-600", className)}>
        {hash}
      </span>
    );
  }

  const { base, networkLabel } = explorerBaseFor(passphrase);
  const href = `${base}/tx/${hash}`;
  const display = short ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`View on Stellar Expert (${networkLabel})`}
      className={cn(
        "inline-flex items-center gap-1 font-mono text-xs text-slate-400 transition-colors hover:text-emerald-300",
        className,
      )}
    >
      <span>{display}</span>
      <ExternalLink className="size-3" />
    </a>
  );
}
