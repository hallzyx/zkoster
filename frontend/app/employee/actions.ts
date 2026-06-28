"use server";

// Employee server actions — SPP claim flow.

import { claimFromPool } from "@/lib/spp/pool-client";
import type { SppNote } from "@/lib/spp/types";
import { ROLE } from "@/lib/types";
import { roleKeypair } from "@/lib/wallets";
import { getSppNoteForBatch } from "@/lib/data/metadata";

export type ClaimResult =
  | { ok: true; txHash: string }
  | { ok: false; error: string };

/**
 * Claim a payout from the SPP privacy pool using the note stored after the
 * admin deposit. Requires the local spp-prover to be running (port 8788).
 *
 * @param payoutId        ID of the payout being claimed (for error messages).
 * @param batchId         ID of the batch whose SPP deposit note to use.
 * @param recipientAddress Stellar address of the employee.
 */
export async function claimPayoutFromPool(
  payoutId: number,
  batchId: number,
  recipientAddress: string,
): Promise<ClaimResult> {
  void recipientAddress;
  try {
    const keypair = roleKeypair(ROLE.EMPLOYEE);

    const noteJson = getSppNoteForBatch(batchId);
    if (!noteJson) {
      return {
        ok: false,
        error: `No deposit note found for batch ${batchId}. Admin must deposit to the privacy pool first (in the same server session).`,
      };
    }

    const raw = JSON.parse(noteJson) as Record<string, unknown>;
    const note: SppNote = {
      commitment: raw.commitment as string,
      amount: BigInt(raw.amount as string | number),
      blinding: raw.blinding as string,
      leafIndex: raw.leafIndex as number,
      allCommitments: raw.allCommitments as string[],
    };

    const result = await claimFromPool(note, keypair);
    return { ok: true, txHash: result.txHash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Payout #${payoutId} claim failed: ${msg}` };
  }
}
