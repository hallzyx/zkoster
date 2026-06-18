import "server-only";

import { Keypair } from "@stellar/stellar-sdk";

import { ROLE, type Role } from "@/lib/types";

// Per-role testnet secret keys. SERVER-ONLY — never exposed to the client.
// Public keys are derived for reads/display; secrets are used only to sign
// write transactions server-side.
const SECRETS: Record<Role, string | undefined> = {
  [ROLE.ADMIN]: process.env.ZKOSTER_ADMIN_SECRET_KEY,
  [ROLE.EMPLOYEE]: process.env.ZKOSTER_EMPLOYEE_SECRET_KEY,
  [ROLE.AUDITOR]: process.env.ZKOSTER_AUDITOR_SECRET_KEY,
};

function derivePublic(secret: string | undefined): string | null {
  if (!secret) return null;
  try {
    return Keypair.fromSecret(secret).publicKey();
  } catch {
    return null;
  }
}

/** Public key per role, or null when the secret isn't configured. */
export const roleWallet: Record<Role, string | null> = {
  [ROLE.ADMIN]: derivePublic(SECRETS[ROLE.ADMIN]),
  [ROLE.EMPLOYEE]: derivePublic(SECRETS[ROLE.EMPLOYEE]),
  [ROLE.AUDITOR]: derivePublic(SECRETS[ROLE.AUDITOR]),
};

/** Keypair for signing a transaction as `role`. Throws if the secret is unset. */
export function roleKeypair(role: Role): Keypair {
  const secret = SECRETS[role];
  if (!secret) {
    throw new Error(
      `Secret key for role "${role}" is not set (ZKOSTER_${role.toUpperCase()}_SECRET_KEY).`,
    );
  }
  return Keypair.fromSecret(secret);
}
