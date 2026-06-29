import { Eye, Lock } from "lucide-react";

import { TopBar } from "@/app/_components/top-bar";
import { BatchStatusBadge } from "@/app/_components/status-badge";
import { ConfidentialAmount } from "@/app/_components/confidential-amount";
import { Card, SectionHeading } from "@/app/_components/ui";
import {
  DEMO_AUDITOR_WALLET,
  getBatch,
  getBatchPayouts,
  getGranteeGrants,
} from "@/lib/data";
import {
  DISCLOSURE_SCOPE,
  ROLE,
  type DisclosureScope,
  type Grant,
} from "@/lib/types";
import { formatPeriod, formatUsd, shortWallet } from "@/lib/utils";

const SCOPE_LABEL: Record<DisclosureScope, string> = {
  [DISCLOSURE_SCOPE.TOTALS_ONLY]: "Totals only",
  [DISCLOSURE_SCOPE.SAMPLE]: "Single payout",
  [DISCLOSURE_SCOPE.FULL_BATCH]: "Full batch",
};

function amountVisible(grant: Grant, payoutId: number): boolean {
  if (grant.scope === DISCLOSURE_SCOPE.FULL_BATCH) return true;
  if (grant.scope === DISCLOSURE_SCOPE.SAMPLE) return payoutId === grant.payoutId;
  return false; // totals only
}

export const dynamic = "force-dynamic";

export default async function AuditorView() {
  const grants = await getGranteeGrants(DEMO_AUDITOR_WALLET);
  const sections = await Promise.all(
    grants.map(async (grant) => ({
      grant,
      batch: await getBatch(grant.batchId),
      payouts: await getBatchPayouts(grant.batchId),
    })),
  );

  return (
    <>
      <TopBar role={ROLE.AUDITOR} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <SectionHeading
          title="Auditor Disclosure View"
          subtitle="You can only see batches and amounts a disclosure grant authorizes."
          action={
            <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300 ring-1 ring-inset ring-violet-500/30">
              <Lock className="size-3.5" />
              Read-only Authorized View
            </span>
          }
        />

        <div className="mt-6 flex flex-col gap-6">
          {sections.length === 0 ? (
            <Card className="flex flex-col items-center gap-3 py-12 text-center">
              <Lock className="size-8 text-slate-600" />
              <div className="flex flex-col gap-1">
                <h3 className="font-semibold text-white">
                  No disclosure grants yet
                </h3>
                <p className="max-w-md text-sm text-slate-400">
                  The company hasn&apos;t issued any disclosure grants to your
                  wallet. When they do, you&apos;ll see exactly what
                  you&apos;re authorized to view here — and nothing more.
                </p>
              </div>
            </Card>
          ) : null}
          {sections.map(({ grant, batch, payouts }) => {
            if (!batch) return null;
            return (
              <Card key={grant.id} className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-white">{batch.name}</h3>
                      <BatchStatusBadge status={batch.status} />
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatPeriod(batch.periodStart, batch.periodEnd)} · {batch.asset}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-300 ring-1 ring-inset ring-slate-700">
                    <Eye className="size-3.5" />
                    {SCOPE_LABEL[grant.scope]}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-px bg-slate-800 sm:grid-cols-3">
                  <div className="bg-slate-900/60 px-5 py-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Disclosed total</div>
                    <div className="mt-1 text-lg font-semibold text-white">
                      {formatUsd(batch.totalAmount)}
                    </div>
                  </div>
                  <div className="bg-slate-900/60 px-5 py-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Recipients</div>
                    <div className="mt-1 text-lg font-semibold text-white">
                      {batch.employeeCount}
                    </div>
                  </div>
                  <div className="bg-slate-900/60 px-5 py-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Settlement</div>
                    <div className="mt-1 truncate font-mono text-sm text-slate-300">
                      {batch.settlementRef ?? "—"}
                    </div>
                  </div>
                </div>

                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-5 py-3 font-medium">Recipient</th>
                      <th className="px-5 py-3 font-medium">Wallet</th>
                      <th className="px-5 py-3 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payouts.map((p) => (
                      <tr
                        key={p.id}
                        className="border-b border-slate-800/60 last:border-0"
                      >
                        <td className="px-5 py-3 text-slate-300">{p.employeeName}</td>
                        <td className="px-5 py-3 font-mono text-xs text-slate-500">
                          {shortWallet(p.employeeWallet)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <ConfidentialAmount
                            amount={p.amount}
                            visible={amountVisible(grant, p.id)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            );
          })}
        </div>
      </main>
    </>
  );
}
