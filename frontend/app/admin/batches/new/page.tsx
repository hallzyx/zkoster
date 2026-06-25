import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { TopBar } from "@/app/_components/top-bar";
import { SectionHeading } from "@/app/_components/ui";
import { ROLE } from "@/lib/types";
import { NewBatchForm } from "./_components/new-batch-form";

export const dynamic = "force-dynamic";

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

        <div className="mt-4">
          <SectionHeading
            title="New batch"
            subtitle="Upload a recipient list to create and review a payroll batch on-chain."
          />
        </div>

        <NewBatchForm />
      </main>
    </>
  );
}
