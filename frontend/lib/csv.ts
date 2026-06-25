// Client-safe CSV parser and validator for payroll batch uploads.
// NO "server-only" import — this module runs in the browser at file-select time.
// The server action (createBatchWithRowsAction) re-validates all rows
// authoritatively with StrKey before any on-chain operations.

import { StrKey } from "@stellar/stellar-sdk";

export interface CsvRow {
  wallet: string;
  amount: number;
  name?: string;
}

export interface CsvError {
  line: number; // 1-based source line number (blank lines excluded from count)
  message: string;
}

export interface CsvParseResult {
  rows: CsvRow[];   // ALL parsed rows (including rows with errors) — for editable preview
  errors: CsvError[]; // per-line validation errors; empty means fully valid
}

/** Maximum recipients per batch. Enforced at the call site, not inside parseBatchCsv. */
export const CSV_MAX_ROWS = 100;

/**
 * Parse and validate a CSV text string for payroll batch upload.
 *
 * Accepted format: wallet,amount[,name]
 * - Header row: if the first non-blank line contains the word "wallet"
 *   (case-insensitive) it is treated as a header and skipped.
 * - Fields are comma-delimited and individually trimmed.
 * - wallet: Stellar Ed25519 public key (validated with StrKey).
 * - amount: positive integer in UI-display units.
 * - name: optional display label; absent or empty → stored as undefined.
 *
 * Collects ALL validation errors (does not short-circuit on the first error).
 * Row count limit (CSV_MAX_ROWS) is NOT enforced here — enforce at the call site.
 *
 * Returns:
 *   rows   — all data rows in parse order (including errored rows, for the
 *             editable preview table). Invalid amounts are stored as 0.
 *   errors — per-line validation errors, line numbers are 1-based and track
 *             the original source file position (blank lines not counted).
 */
export function parseBatchCsv(text: string): CsvParseResult {
  const rows: CsvRow[] = [];
  const errors: CsvError[] = [];

  // Track valid wallets to detect duplicates.
  const seen = new Set<string>();

  // Collect non-blank lines with their source positions.
  const rawLines = text.split("\n");
  const lines: { content: string; srcLine: number }[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = rawLines[i].trim();
    if (trimmed.length > 0) {
      lines.push({ content: trimmed, srcLine: i + 1 });
    }
  }

  // Skip header row if present.
  let startIdx = 0;
  if (lines.length > 0 && lines[0].content.toLowerCase().includes("wallet")) {
    startIdx = 1;
  }

  for (let i = startIdx; i < lines.length; i++) {
    const { content, srcLine } = lines[i];
    const parts = content.split(",").map((p) => p.trim());

    const wallet = parts[0] ?? "";
    const rawAmount = parts[1] ?? "";
    const rawName = parts[2];
    const name =
      rawName !== undefined && rawName.trim() !== "" ? rawName.trim() : undefined;

    // Wallet validation — authoritative (StrKey).
    let walletValid = false;
    if (!StrKey.isValidEd25519PublicKey(wallet)) {
      errors.push({ line: srcLine, message: "Invalid Stellar address" });
    } else {
      walletValid = true;
    }

    // Amount validation — must be a positive integer.
    const parsed = Number(rawAmount);
    const amountValid = Number.isInteger(parsed) && parsed > 0;
    if (!amountValid) {
      errors.push({ line: srcLine, message: "Amount must be a positive integer" });
    }

    // Duplicate check — only for structurally valid wallets.
    if (walletValid) {
      if (seen.has(wallet)) {
        errors.push({ line: srcLine, message: "Duplicate address" });
      } else {
        seen.add(wallet);
      }
    }

    // Include all rows in the result for the editable preview table.
    // Invalid amounts are stored as 0; the error array captures the violation.
    rows.push({ wallet, amount: amountValid ? parsed : 0, name });
  }

  return { rows, errors };
}
