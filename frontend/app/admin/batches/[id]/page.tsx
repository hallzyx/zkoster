import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, Home } from "lucide-react";

import { TopBar } from "@/app/_components/top-bar";
import {
  BatchStatusBadge,
  PayoutStatusBadge,
} from "@/app/_components/status-badge";
import { Card, SectionHeading, StatCard } from "@/app/_components/ui";
import { TxHashLink } from "@/app/_components/tx-hash-link";
import { getBatch, getBatchPayouts } from "@/lib/data";
import { getConfig } from "@/lib/config";
import { PAYOUT_STATUS, ROLE } from "@/lib/types";
import { formatPeriod, formatUsd, shortWallet } from "@/lib/utils";
import { BatchActions } from "./_components/batch-actions";
import { DisclosureGrantsPanel } from "./_components/disclosure-grants-panel";
import { SppDepositStep } from "./_components/SppDepositStep";

export const dynamic = "force-dynamic";

export default async function BatchDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const batch = await getBatch(Number(id));
  if (!batch) notFound();

  const payouts = await getBatchPayouts(batch.id);
  const paid = payouts.filter((p) => p.status === PAYOUT_STATUS.PAID).length;
  const progress = Math.round((paid / payouts.length) * 100);

  return (
    <>
      <TopBar role={ROLE.ADMIN} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1.5 text-sm text-slate-400">
            <li>
              <Link
                href="/admin"
                className="inline-flex items-center gap-1 transition-colors hover:text-white"
              >
                <Home className="size-3.5" />
                Admin
              </Link>
            </li>
            <li aria-hidden="true">
              <ChevronRight className="size-3.5 text-slate-700" />
            </li>
            <li>
              <Link
                href="/admin"
                className="transition-colors hover:text-white"
              >
                Batches
              </Link>
            </li>
            <li aria-hidden="true">
              <ChevronRight className="size-3.5 text-slate-700" />
            </li>
            <li className="font-medium text-white" aria-current="page">
              #{batch.id} {batch.name}
            </li>
          </ol>
        </nav>
        <div className="mt-4">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-slate-300"
          >
            <ArrowLeft className="size-3.5" />
            Back to dashboard
          </Link>
        </div>

        <div className="mt-4">
          <SectionHeading
            title={batch.name}
            subtitle={`${formatPeriod(batch.periodStart, batch.periodEnd)} · ${batch.asset}`}
            action={<BatchStatusBadge status={batch.status} />}
          />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Batch total" value={formatUsd(batch.totalAmount)} />
          <StatCard label="Recipients" value={batch.employeeCount} />
          <StatCard label="Paid" value={`${paid}/${payouts.length}`} hint={`${progress}% settled`} />
          <StatCard
            label="Settlement"
            value={
              <TxHashLink
                hash={batch.settlementRef}
                passphrase={getConfig().chain?.networkPassphrase ?? ""}
                short={false}
              />
            }
          />
        </div>

        <SppDepositStep
          batchId={batch.id}
          status={batch.status}
          sppDepositRef={batch.sppDepositRef}
          sppDepositTxRef={batch.sppDepositTxRef}
          totalAmount={batch.totalAmount}
        />

        <BatchActions
          batchId={batch.id}
          status={batch.status}
          sppDepositRef={batch.sppDepositRef}
        />

        <DisclosureGrantsPanel batchId={batch.id} />

        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-emerald-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="mt-8">
          <SectionHeading title="Payouts" subtitle="Per-recipient status and settlement reference." />
          <Card className="mt-4 overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Employee</th>
                  <th className="px-5 py-3 font-medium">Wallet</th>
                  <th className="px-5 py-3 text-right font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Tx</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30"
                  >
                    <td className="px-5 py-3 font-medium text-white">{p.employeeName}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-400">
                      {shortWallet(p.employeeWallet)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-white">
                      {formatUsd(p.amount)}
                    </td>
                    <td className="px-5 py-3">
                      <PayoutStatusBadge status={p.status} />
                    </td>
                    <td className="px-5 py-3">
                      <TxHashLink
                        hash={p.txRef}
                        passphrase={getConfig().chain?.networkPassphrase ?? ""}
                      />
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
