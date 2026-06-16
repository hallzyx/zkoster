import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { ROLE, type Role } from "@/lib/types";

const ROLE_LABEL: Record<Role, string> = {
  [ROLE.ADMIN]: "Admin",
  [ROLE.EMPLOYEE]: "Employee",
  [ROLE.AUDITOR]: "Auditor",
};

export function TopBar({ role }: { role: Role }) {
  return (
    <header className="border-b border-slate-800 bg-slate-900/40">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold text-white">
          <ShieldCheck className="size-5 text-emerald-400" />
          Zkoster
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-300 ring-1 ring-inset ring-slate-700">
            {ROLE_LABEL[role]} view
          </span>
          <Link href="/" className="text-slate-400 transition-colors hover:text-white">
            Switch role
          </Link>
        </div>
      </div>
    </header>
  );
}
