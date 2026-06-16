import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatUsd } from "@/lib/utils";

/**
 * Renders a cleartext amount only when the current actor is authorized to see
 * it; otherwise shows a masked placeholder — the same visibility rule the
 * ledger enforces (only commitments are public).
 */
export function ConfidentialAmount({
  amount,
  visible,
  className,
}: {
  amount: number;
  visible: boolean;
  className?: string;
}) {
  if (visible) {
    return <span className={cn("tabular-nums", className)}>{formatUsd(amount)}</span>;
  }
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-slate-500", className)}
      title="Confidential — not visible at your access level"
    >
      <Lock className="size-3" />
      <span className="tracking-widest">•••••</span>
    </span>
  );
}
