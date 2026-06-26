import { Card, SectionHeading } from "@/app/_components/ui";
import { getBatchGrants } from "@/lib/data";
import { DISCLOSURE_SCOPE } from "@/lib/types";
import { shortWallet } from "@/lib/utils";
import { GrantActions, RevokeButton } from "./grant-actions";

// Human-readable labels for DisclosureScope discriminants.
const SCOPE_LABEL: Record<string, string> = {
  [DISCLOSURE_SCOPE.TOTALS_ONLY]: "Totals only",
  [DISCLOSURE_SCOPE.SAMPLE]: "Sample",
  [DISCLOSURE_SCOPE.FULL_BATCH]: "Full batch",
};

interface DisclosureGrantsPanelProps {
  batchId: number;
}

/**
 * Server component: fetches all grants (including revoked) for a batch and
 * renders the disclosure grants section on the admin batch detail page.
 *
 * Admin must see revoked grants to confirm state and avoid double-issuing.
 * Auditors only see active grants (handled in /auditor page by getGranteeGrants).
 */
export async function DisclosureGrantsPanel({ batchId }: DisclosureGrantsPanelProps) {
  const grants = await getBatchGrants(batchId);

  return (
    <div className="mt-8">
      <SectionHeading
        title="Disclosure grants"
        subtitle="Auditor access to this batch (business rule #6)."
      />
      <Card className="mt-4 flex flex-col gap-4">
        <GrantActions batchId={batchId} />

        {grants.length === 0 ? (
          <p className="text-sm italic text-slate-500">
            No disclosure grants issued for this batch yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-medium">Grant ID</th>
                  <th className="px-4 py-3 font-medium">Scope</th>
                  <th className="px-4 py-3 font-medium">Grantee</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((g) => (
                  <tr
                    key={g.id}
                    className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{g.id}</td>
                    <td className="px-4 py-3 text-slate-300">
                      {SCOPE_LABEL[g.scope] ?? g.scope}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {g.granteeName || shortWallet(g.granteeWallet)}
                    </td>
                    <td className="px-4 py-3">
                      {g.revoked ? (
                        <span className="inline-flex items-center rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-400">
                          Revoked
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-emerald-950/60 px-2 py-0.5 text-xs font-medium text-emerald-400">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!g.revoked && <RevokeButton grantId={g.id} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
