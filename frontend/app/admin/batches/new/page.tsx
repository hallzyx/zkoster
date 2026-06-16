import Link from "next/link";
import { ArrowLeft, Construction } from "lucide-react";

import { TopBar } from "@/app/_components/top-bar";
import { Card } from "@/app/_components/ui";
import { ROLE } from "@/lib/types";

export default function NewBatch() {
  return (
    <>
      <TopBar role={ROLE.ADMIN} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="size-4" />
          Dashboard
        </Link>

        <Card className="mt-6 flex flex-col gap-4">
          <Construction className="size-7 text-amber-400" />
          <h1 className="text-xl font-semibold text-white">
            Create batch flow — next build
          </h1>
          <p className="text-sm text-slate-400">
            This screen will host the create → CSV upload → review → approve flow,
            wired to the prover and the contracts:
          </p>
          <ol className="flex flex-col gap-2 text-sm text-slate-300">
            <li>
              <span className="font-mono text-emerald-300">payroll.create_batch</span>{" "}
              — period &amp; asset
            </li>
            <li>
              <span className="font-mono text-emerald-300">prover.gen</span> +{" "}
              <span className="font-mono text-emerald-300">payroll.add_payout</span>{" "}
              — per-row commitment from the CSV
            </li>
            <li>
              <span className="font-mono text-emerald-300">payroll.review_batch</span>{" "}
              — total commitment
            </li>
            <li>
              <span className="font-mono text-emerald-300">payroll.approve_batch</span>{" "}
              — verifier checks Σ commitments == total
            </li>
          </ol>
        </Card>
      </main>
    </>
  );
}
