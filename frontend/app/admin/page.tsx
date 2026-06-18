import Link from "next/link";
import { ChevronRight, Layers, Plus, Users } from "lucide-react";

import { TopBar } from "@/app/_components/top-bar";
import { BatchStatusBadge } from "@/app/_components/status-badge";
import { Card, SectionHeading, StatCard } from "@/app/_components/ui";
import { getCompany, getMembers, listBatches } from "@/lib/data";
import { BATCH_STATUS, ROLE } from "@/lib/types";
import { formatPeriod, formatUsd } from "@/lib/utils";

// Always render server-side so live chain reads are fresh (not prerendered).
export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const [company, batches, members] = await Promise.all([
    getCompany(),
    listBatches(),
    getMembers(),
  ]);

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

        <div className="mt-8">
          <SectionHeading title="Batches" subtitle="Totals are visible to the company only." />
          <Card className="mt-4 overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Batch</th>
                  <th className="px-5 py-3 font-medium">Period</th>
                  <th className="px-5 py-3 font-medium">Recipients</th>
                  <th className="px-5 py-3 text-right font-medium">Total</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
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
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/admin/batches/${b.id}`}
                        className="inline-flex text-slate-500 hover:text-white"
                      >
                        <ChevronRight className="size-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </main>
    </>
  );
}
