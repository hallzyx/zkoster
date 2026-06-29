import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

// UI ↔ on-chain amount scaling. The UI works in scaled units; the contract and
// token work in `ui / scale`. See AppConfig.displayScale.
// On-chain amounts (and the prover's u64 inputs) are integers, so this floors —
// mirroring scripts/pay_employee.sh's integer division `$(( UI_AMOUNT / SCALE ))`.
export function toRealAmount(uiAmount: number, scale: number): number {
  return Math.floor(uiAmount / scale);
}

export function toUiAmount(realAmount: number, scale: number): number {
  return realAmount * scale;
}

export function shortWallet(wallet: string): string {
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

export function formatPeriod(start: string, end: string): string {
  // Parse "YYYY-MM-DD" as a local date (not UTC) to avoid the off-by-one that
  // happens when a date-only ISO string is interpreted as UTC midnight and
  // then displayed in a negative-offset timezone (e.g. 2026-06-01 → May 31).
  const parseLocal = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  };
  const fmt = (iso: string) =>
    parseLocal(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  return `${fmt(start)} — ${fmt(end)}`;
}
