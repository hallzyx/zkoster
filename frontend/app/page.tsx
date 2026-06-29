import Link from "next/link";
import { ArrowRight, Eye, ShieldCheck, Users, Wallet } from "lucide-react";

import { getCompany } from "@/lib/data";

const ROLES = [
  {
    href: "/admin",
    title: "Admin",
    blurb: "Create batches, review totals, approve and run private payouts.",
    icon: Wallet,
    accent: "text-emerald-400",
  },
  {
    href: "/employee",
    title: "Employee",
    blurb: "See only your own payouts and download receipts.",
    icon: Users,
    accent: "text-sky-400",
  },
  {
    href: "/auditor",
    title: "Auditor",
    blurb: "Review only what a disclosure grant authorizes you to see.",
    icon: Eye,
    accent: "text-violet-400",
  },
] as const;

export default async function Home() {
  const company = await getCompany();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-12 px-6 py-16">
      <div className="flex flex-col gap-5">
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
          <ShieldCheck className="size-3.5" />
          Stellar · Soroban · ZK
        </span>
        <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
          Run stablecoin payroll without publishing your salary table.
        </h1>
        <p className="max-w-xl text-lg text-slate-400">
          Zkoster pays {company.name}&apos;s team in {company.asset} on Stellar —
          amounts stay private as on-chain commitments, while auditors see only
          what they&apos;re authorized to. Choose a role to explore the demo.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {ROLES.map(({ href, title, blurb, icon: Icon, accent }) => (
          <Link
            key={href}
            href={href}
            className="group flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-5 transition-colors hover:border-slate-600 hover:bg-slate-900"
          >
            <Icon className={`size-6 ${accent}`} />
            <div className="flex items-center gap-1.5 text-lg font-semibold text-white">
              {title}
              <ArrowRight className="size-4 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
            </div>
            <p className="text-sm text-slate-400">{blurb}</p>
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-emerald-400" />
          <span className="text-sm font-medium text-white">
            What the public Stellar ledger sees
          </span>
        </div>
        <p className="text-sm leading-relaxed text-slate-400">
          The amounts shown in this demo are the company&apos;s own off-chain
          records. On the public Stellar ledger, each payout is represented
          only by a <span className="font-mono text-xs text-slate-300">Pedersen commitment</span> and a
          <span className="font-mono text-xs text-slate-300"> Groth16 range proof</span> — never a cleartext
          salary. The demo switches between three roles with no real
          authentication.
        </p>
      </div>
    </main>
  );
}
