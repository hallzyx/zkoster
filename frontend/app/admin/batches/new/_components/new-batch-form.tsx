"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X, CheckCircle2 } from "lucide-react";

import { Card, SectionHeading } from "@/app/_components/ui";
import { cn, shortWallet } from "@/lib/utils";
import { parseBatchCsv, CSV_MAX_ROWS, type CsvRow } from "@/lib/csv";
import {
  createBatchWithRowsAction,
  type CreateBatchInput,
  type CreateBatchResult,
} from "@/app/admin/actions";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Stellar Ed25519 public key pattern (G-address, 56 chars, base32 A-Z2-7).
 * Used for client-side re-validation after row removal. The server action is
 * the authoritative validator (uses StrKey.isValidEd25519PublicKey).
 */
const STELLAR_ADDR_RE = /^G[A-Z2-7]{55}$/;

/**
 * Amounts below this threshold will floor to 0 on-chain after display scaling.
 * Default displayScale = 1000; any amount < 1000 → toRealAmount = 0 (degenerate payout).
 * This is the default value — the actual scale may differ if ZKOSTER_DISPLAY_SCALE is set.
 */
const DISPLAY_SCALE_WARN_THRESHOLD = 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FormStep = "meta" | "csv" | "submitting" | "done" | "error";

// ---------------------------------------------------------------------------
// Inline per-row validation (re-runs after every row removal)
// ---------------------------------------------------------------------------

/**
 * Validate the current rows[] for the editable preview.
 * Returns a Map<rowIndex, errorMessages[]>. Empty map means all rows are valid.
 *
 * Uses a regex for the wallet check (lightweight; StrKey is authoritative in
 * parseBatchCsv and in the server action).
 */
function validateRowsForPreview(rows: CsvRow[]): Map<number, string[]> {
  const errors = new Map<number, string[]>();
  const seen = new Set<string>();

  rows.forEach((row, i) => {
    const errs: string[] = [];

    const walletValid = STELLAR_ADDR_RE.test(row.wallet);
    if (!walletValid) errs.push("Invalid Stellar address");

    if (!Number.isInteger(row.amount) || row.amount <= 0) {
      errs.push("Amount must be a positive integer");
    }

    if (walletValid) {
      if (seen.has(row.wallet)) {
        errs.push("Duplicate address");
      } else {
        seen.add(row.wallet);
      }
    }

    if (errs.length > 0) errors.set(i, errs);
  });

  return errors;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NewBatchForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Linear step state machine.
  const [step, setStep] = useState<FormStep>("meta");

  // Metadata fields (step "meta").
  const [name, setName] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [metaErrors, setMetaErrors] = useState<string[]>([]);

  // CSV / preview state (step "csv").
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);

  // Server action result state.
  const [serverError, setServerError] = useState<string | null>(null);
  const [newBatchId, setNewBatchId] = useState<number | null>(null);

  // Derived: per-row errors, recomputed whenever csvRows changes.
  const rowErrors = useMemo(() => validateRowsForPreview(csvRows), [csvRows]);

  // True while a startTransition is in flight OR we've locally set "submitting".
  const isInFlight = isPending || step === "submitting";

  const canSubmit =
    rowErrors.size === 0 &&
    csvRows.length > 0 &&
    csvRows.length <= CSV_MAX_ROWS &&
    !fileError &&
    !isInFlight;

  // ---------------------------------------------------------------------------
  // Meta step handlers
  // ---------------------------------------------------------------------------

  function validateMeta(): string[] {
    const errs: string[] = [];
    if (!name.trim()) errs.push("Batch name is required.");
    if (!periodStart) errs.push("Period start is required.");
    if (!periodEnd) errs.push("Period end is required.");
    if (periodStart && periodEnd && periodEnd <= periodStart) {
      errs.push("Period end must be after period start.");
    }
    return errs;
  }

  function handleMetaNext() {
    const errs = validateMeta();
    if (errs.length > 0) {
      setMetaErrors(errs);
      return;
    }
    setMetaErrors([]);
    setStep("csv");
  }

  // ---------------------------------------------------------------------------
  // CSV handlers
  // ---------------------------------------------------------------------------

  function applyCsvText(text: string) {
    const { rows } = parseBatchCsv(text);
    setCsvRows(rows);
    if (rows.length > CSV_MAX_ROWS) {
      setFileError("Maximum 100 recipients per batch.");
    } else if (rows.length === 0) {
      setFileError("At least one recipient required.");
    } else {
      setFileError(null);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => applyCsvText((ev.target?.result as string) ?? "");
    reader.readAsText(file);
    // Reset value so the same file can be re-selected after edits.
    e.target.value = "";
  }

  function handlePasteChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    applyCsvText(e.target.value);
  }

  function handleRemoveRow(idx: number) {
    const updated = csvRows.filter((_, i) => i !== idx);
    setCsvRows(updated);
    // Recompute file-level limit errors.
    if (updated.length === 0) {
      setFileError("At least one recipient required.");
    } else if (updated.length > CSV_MAX_ROWS) {
      setFileError("Maximum 100 recipients per batch.");
    } else {
      setFileError(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  function handleSubmit() {
    if (!canSubmit) return;
    setStep("submitting");
    setServerError(null);

    const input: CreateBatchInput = {
      name: name.trim(),
      periodStart,
      periodEnd,
      rows: csvRows.map((r) => ({ wallet: r.wallet, amount: r.amount, name: r.name })),
    };

    startTransition(async () => {
      const result: CreateBatchResult = await createBatchWithRowsAction(input);
      if (result.ok) {
        setNewBatchId(result.batchId ?? null);
        setStep("done");
      } else {
        setServerError(result.error);
        // Return to csv step so the user can fix + resubmit; inputs are preserved.
        setStep("error");
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Render: done
  // ---------------------------------------------------------------------------

  if (step === "done" && newBatchId !== null) {
    return (
      <Card className="mt-6 flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-lg border border-emerald-800 bg-emerald-950/40 px-4 py-3">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-400" />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-emerald-300">Batch created</span>
            <span className="text-sm text-emerald-400/80">
              Batch #{newBatchId} is Reviewed and ready for approval.
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push(`/admin/batches/${newBatchId}`)}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 active:bg-emerald-700"
        >
          View Batch #{newBatchId}
        </button>
      </Card>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: meta step
  // ---------------------------------------------------------------------------

  if (step === "meta") {
    return (
      <Card className="mt-6 flex flex-col gap-6">
        <SectionHeading
          title="Batch details"
          subtitle="Set the batch name and pay period before uploading recipients."
        />

        {metaErrors.length > 0 && (
          <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {metaErrors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Batch name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. June 2026 Payroll"
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-600 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Period start
              </label>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-600 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Period end
              </label>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-600 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleMetaNext}
            disabled={!name.trim() || !periodStart || !periodEnd}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              !name.trim() || !periodStart || !periodEnd
                ? "cursor-not-allowed bg-slate-700 text-slate-400"
                : "bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700",
            )}
          >
            Next — Upload CSV
          </button>
        </div>
      </Card>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: csv / submitting / error steps
  // ---------------------------------------------------------------------------

  return (
    <div className="mt-6 flex flex-col gap-4">
      {/* Metadata summary bar with edit link */}
      <Card className="flex items-center justify-between py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-white">{name}</span>
          <span className="text-xs text-slate-500">
            {periodStart} — {periodEnd}
          </span>
        </div>
        <button
          type="button"
          disabled={isInFlight}
          onClick={() => setStep("meta")}
          className="text-xs text-slate-500 transition-colors hover:text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Edit
        </button>
      </Card>

      <Card className="flex flex-col gap-5">
        <SectionHeading
          title="Recipients"
          subtitle="Upload a CSV file: wallet,amount[,name] — one recipient per line."
        />

        {/* Server error banner (step "error" returns here with error displayed) */}
        {step === "error" && serverError && (
          <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            <span className="font-medium text-red-400">[server] </span>
            {serverError}
          </div>
        )}

        {/* File drop zone + paste fallback — hidden while submitting */}
        {!isInFlight && (
          <div className="flex flex-col gap-3">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-700 px-6 py-8 text-sm text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-300">
              <span className="font-medium">Drop CSV file or click to browse</span>
              <span className="text-xs text-slate-500">
                wallet,amount[,name] · max 100 rows
              </span>
              <input
                type="file"
                accept=".csv,.txt"
                className="sr-only"
                onChange={handleFileChange}
              />
            </label>
            <details>
              <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-400">
                Or paste CSV text
              </summary>
              <textarea
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 font-mono text-xs text-slate-300 placeholder-slate-600 focus:border-emerald-600 focus:outline-none"
                rows={5}
                placeholder={"GADDRESS1,1000,Alice\nGADDRESS2,2000,Bob"}
                onChange={handlePasteChange}
              />
            </details>
          </div>
        )}

        {/* File-level error (row count limits) */}
        {fileError && (
          <div className="rounded-lg border border-amber-800 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
            {fileError}
          </div>
        )}

        {/* Editable preview table */}
        {csvRows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Wallet</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  {!isInFlight && (
                    <th className="px-2 py-2" />
                  )}
                </tr>
              </thead>
              <tbody>
                {csvRows.map((row, idx) => {
                  const errs = rowErrors.get(idx) ?? [];
                  const hasError = errs.length > 0;
                  // Warn when amount > 0 but floors to 0 after display scaling.
                  const hasScaleWarn =
                    !hasError &&
                    row.amount > 0 &&
                    row.amount < DISPLAY_SCALE_WARN_THRESHOLD;

                  return (
                    <tr
                      key={idx}
                      className={cn(
                        "border-b border-slate-800/60 last:border-0",
                        hasError && "bg-red-950/20",
                      )}
                    >
                      <td className="px-3 py-2.5 text-xs text-slate-600">{idx + 1}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-300">
                        {row.wallet ? (
                          shortWallet(row.wallet)
                        ) : (
                          <span className="text-red-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-400">
                        {row.name ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">
                        {row.amount > 0 ? (
                          row.amount
                        ) : (
                          <span className="text-red-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {hasError ? (
                          <div className="flex flex-col gap-0.5">
                            {errs.map((e, i) => (
                              <span
                                key={i}
                                className="inline-block rounded bg-red-900/60 px-1.5 py-0.5 text-xs text-red-300"
                              >
                                {e}
                              </span>
                            ))}
                          </div>
                        ) : hasScaleWarn ? (
                          <span
                            className="rounded bg-amber-900/40 px-1.5 py-0.5 text-xs text-amber-400"
                            title="Amount floors to 0 on-chain after display scaling (×1000 by default)."
                          >
                            Rounds to 0 on-chain
                          </span>
                        ) : (
                          <span className="text-xs text-emerald-400">Valid</span>
                        )}
                      </td>
                      {!isInFlight && (
                        <td className="px-2 py-2.5">
                          <button
                            type="button"
                            onClick={() => handleRemoveRow(idx)}
                            aria-label={`Remove recipient ${idx + 1}`}
                            className="rounded p-1 text-slate-600 transition-colors hover:bg-red-900/30 hover:text-red-400"
                          >
                            <X className="size-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Submitting notice */}
        {isInFlight && (
          <div className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800/40 px-4 py-3 text-sm text-slate-300">
            <Loader2 className="size-4 shrink-0 animate-spin text-emerald-400" />
            <span>Submitting — on-chain proving + payouts may take ~60s…</span>
          </div>
        )}

        {/* Footer row: recipient count + submit button */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">
            {csvRows.length > 0
              ? `${csvRows.length} recipient${csvRows.length !== 1 ? "s" : ""}${
                  rowErrors.size > 0
                    ? ` · ${rowErrors.size} error${rowErrors.size !== 1 ? "s" : ""}`
                    : ""
                }`
              : "No recipients loaded"}
          </span>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              !canSubmit
                ? "cursor-not-allowed bg-slate-700 text-slate-400"
                : "bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700",
            )}
          >
            {isInFlight ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" />
                Submitting…
              </span>
            ) : csvRows.length > 0 ? (
              `Submit batch (${csvRows.length} recipient${csvRows.length !== 1 ? "s" : ""})`
            ) : (
              "Submit batch"
            )}
          </button>
        </div>
      </Card>
    </div>
  );
}
