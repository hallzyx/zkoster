import Link from "next/link";
import { ChevronRight, Layers, Plus, Users } from "lucide-react";

import { TopBar } from "@/app/_components/top-bar";
import { BatchStatusBadge } from "@/app/_components/status-badge";
import { Card, SectionHeading, StatCard } from "@/app/_components/ui";
import { TxHashLink } from "@/app/_components/tx-hash-link";
import { PUBLIC_NETWORK_PASSPHRASE } from "@/lib/config";
import {
  getBatchPayouts,
  getCompany,
  getMembers,
  listBatches,
} from "@/lib/data";
import { BATCH_STATUS, ROLE, type Payout } from "@/lib/types";
import { formatPeriod, formatUsd, shortWallet } from "@/lib/utils";

// Always render server-side so live chain reads are fresh (not prerendered).
export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const [company, batches, members] = await Promise.all([
    getCompany(),
    listBatches(),
    getMembers(),
  ]);

  // Per-batch latest payout (for the "Last activity" column).
  // Bounded to first 10 batches; for larger lists we'd paginate or cache.
  const recent = batches.slice(0, 10);
  const lastActivityByBatchId = new Map<number, string | null>();
  await Promise.all(
    recent.map(async (b) => {
      const payouts = await getBatchPayouts(b.id);
      // The last payout by id is the most recently executed.
      const last = payouts.reduce<Payout | undefined>(
        (acc, p) => (acc === undefined || p.id > acc.id ? p : acc),
        undefined,
      );
      lastActivityByBatchId.set(b.id, last?.txRef ?? null);
    }),
  );

  const recipients = members.filter((m) => m.role === ROLE.EMPLOYEE).length;
  const processing = batches.filter(
    (b) => b.status === BATCH_STATUS.PROCESSING,
  ).length;
  const latest = batches[0];

  return (
    <>
      <TopBar role={ROLE.ADMIN} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <SectionHeading
          title="Payroll Dashboard"
          subtitle={`${company.name} · paying in ${company.asset}`}
          action={
            <Link
              href="/admin/batches/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-emerald-400"
            >
              <Plus className="size-4" />
              New Payroll Batch
            </Link>
          }
        />

        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Batches" value={batches.length} icon={<Layers className="size-4" />} />
          <StatCard label="Recipients" value={recipients} icon={<Users className="size-4" />} />
          <StatCard
            label="Latest batch total"
            value={latest ? formatUsd(latest.totalAmount) : "—"}
            hint={latest?.name}
          />
          <StatCard label="Processing" value={processing} hint="batches in flight" />
        </div>

        {latest ? (
          <p className="mt-3 text-xs text-slate-500">
            Cleartext totals above are the company&apos;s own off-chain records.
            The public Stellar ledger only ever sees Pedersen commitments and
            Groth16 range proofs for this batch.
          </p>
        ) : null}

        <div className="mt-8">
          <SectionHeading title="Batches" subtitle="Totals are visible to the company only." />
          {batches.length === 0 ? (
            <Card className="mt-4 flex flex-col items-center gap-3 py-12 text-center">
              <Layers className="size-8 text-slate-600" />
              <div className="flex flex-col gap-1">
                <h3 className="font-semibold text-white">No batches yet</h3>
                <p className="max-w-md text-sm text-slate-400">
                  Create your first payroll batch to commit a Pedersen total
                  on-chain and prove each amount with a Groth16 range proof.
                </p>
              </div>
              <Link
                href="/admin/batches/new"
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-emerald-400"
              >
                <Plus className="size-4" />
                New Payroll Batch
              </Link>
            </Card>
          ) : (
          <Card className="mt-4 overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Batch</th>
                  <th className="px-5 py-3 font-medium">Period</th>
                  <th className="px-5 py-3 font-medium">Recipients</th>
                  <th className="px-5 py-3 text-right font-medium">Total</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Last activity</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const lastTx = lastActivityByBatchId.get(b.id) ?? null;
                  const showLastActivity = recent.some((r) => r.id === b.id);
                  return (
                    <tr
                      key={b.id}
                      className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30"
                    >
                      <td className="px-5 py-3 font-medium text-white">
                        <Link href={`/admin/batches/${b.id}`} className="hover:text-emerald-300">
                          {b.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-slate-400">
                        {formatPeriod(b.periodStart, b.periodEnd)}
                      </td>
                      <td className="px-5 py-3 text-slate-300">{b.employeeCount}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-white">
                        {formatUsd(b.totalAmount)}
                      </td>
                      <td className="px-5 py-3">
                        <BatchStatusBadge status={b.status} />
                      </td>
                      <td className="px-5 py-3">
                        {showLastActivity ? (
                          lastTx ? (
                            <TxHashLink
                              hash={lastTx}
                              passphrase={PUBLIC_NETWORK_PASSPHRASE}
                            />
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )
                        ) : (
                          <span className="text-xs text-slate-700">…</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Link
                          href={`/admin/batches/${b.id}`}
                          className="inline-flex text-slate-500 hover:text-white"
                        >
                          <ChevronRight className="size-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          )}
        </div>
      </main>
    </>
  );
}
