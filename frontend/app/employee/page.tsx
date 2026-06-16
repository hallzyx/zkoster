import { Download, FileText } from "lucide-react";

import { TopBar } from "@/app/_components/top-bar";
import { PayoutStatusBadge } from "@/app/_components/status-badge";
import { Card, SectionHeading, StatCard } from "@/app/_components/ui";
import {
  DEMO_EMPLOYEE_WALLET,
  getEmployeePayouts,
  getMember,
  listBatches,
} from "@/lib/data";
import { PAYOUT_STATUS, ROLE, type Batch } from "@/lib/types";
import { formatPeriod, formatUsd } from "@/lib/utils";

export default async function EmployeePortal() {
  const [member, payouts, batches] = await Promise.all([
    getMember(DEMO_EMPLOYEE_WALLET),
    getEmployeePayouts(DEMO_EMPLOYEE_WALLET),
    listBatches(),
  ]);

  const batchById = new Map<number, Batch>(batches.map((b) => [b.id, b]));
  const latest = payouts[0];
  const latestBatch = latest ? batchById.get(latest.batchId) : undefined;
  const totalReceived = payouts
    .filter((p) => p.status === PAYOUT_STATUS.PAID)
    .reduce((sum, p) => sum + p.amount, 0);

  return (
    <>
      <TopBar role={ROLE.EMPLOYEE} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <SectionHeading
          title={`Hi, ${member?.displayName ?? "there"}`}
          subtitle="Your payments — only you and the company can see these amounts."
        />

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Latest payout"
            value={latest ? formatUsd(latest.amount) : "—"}
            hint={latestBatch?.name}
          />
          <StatCard
            label="Latest status"
            value={
              latest ? (
                <PayoutStatusBadge status={latest.status} />
              ) : (
                "—"
              )
            }
          />
          <StatCard label="Total received" value={formatUsd(totalReceived)} hint="paid to date" />
        </div>

        <div className="mt-8">
          <SectionHeading title="Payment history" subtitle="Your own records, newest first." />
          <Card className="mt-4 overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Period</th>
                  <th className="px-5 py-3 text-right font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => {
                  const batch = batchById.get(p.batchId);
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30"
                    >
                      <td className="px-5 py-3 text-slate-300">
                        <div className="font-medium text-white">{batch?.name}</div>
                        {batch ? (
                          <div className="text-xs text-slate-500">
                            {formatPeriod(batch.periodStart, batch.periodEnd)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-white">
                        {formatUsd(p.amount)}
                      </td>
                      <td className="px-5 py-3">
                        <PayoutStatusBadge status={p.status} />
                      </td>
                      <td className="px-5 py-3">
                        {p.receiptRef ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
                            <Download className="size-3.5" />
                            {p.receiptRef}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                            <FileText className="size-3.5" />
                            pending
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>
      </main>
    </>
  );
}
