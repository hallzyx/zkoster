/**
 * E2E: Full payroll + SPP privacy pool flow
 *
 * Admin path:  /admin/batches/new → review → approve → fund → execute → SPP deposit
 * Employee path: /employee → Claim from Privacy Pool
 *
 * Prerequisites (must be running):
 *   - Next.js dev server on :3000
 *   - spp-prover on :8788
 */

import { test, expect, type Page } from "@playwright/test";

// ── Config ────────────────────────────────────────────────────────────────────

const EMPLOYEE_WALLET = "GBZIXC7CQVPGAQGLXR44FBWI4RHOBX4IQZOYOW6TTRPR6N6FYSG6NCCS";

// Use today + 30 days so the period is always valid.
function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const BATCH_NAME = `E2E Payroll ${Date.now()}`;
const PERIOD_START = isoDate(0);
const PERIOD_END = isoDate(30);
const CSV_CONTENT = `${EMPLOYEE_WALLET},5000,Sofia Gimenez`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Click a button by its visible text and wait for the loading state to clear. */
async function clickActionButton(page: Page, label: string) {
  const btn = page.getByRole("button", { name: label, exact: false });
  await btn.click();
  // Wait until the button is no longer disabled/pending (label changes or re-enables).
  await page.waitForFunction(
    (text) => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const target = buttons.find((b) => b.textContent?.includes(text));
      // Either the button is gone (page refreshed) or it's re-enabled.
      return !target || !target.disabled;
    },
    label,
    { timeout: 180_000 },
  );
}

/** Wait for a success banner containing the given text. */
async function waitForSuccess(page: Page, text: string) {
  await expect(page.getByText(text, { exact: false })).toBeVisible({
    timeout: 180_000,
  });
}

// ── Test ─────────────────────────────────────────────────────────────────────

test("full payroll + SPP privacy pool: create → fund → deposit → claim", async ({ page }) => {
  // ── Step 1: Create batch ────────────────────────────────────────────────────
  await test.step("admin: create new batch", async () => {
    await page.goto("/admin/batches/new");
    await expect(page.getByText("New batch")).toBeVisible();

    // Meta step
    await page.getByPlaceholder(/June 2026 Payroll/i).fill(BATCH_NAME);
    await page.locator('input[type="date"]').first().fill(PERIOD_START);
    await page.locator('input[type="date"]').last().fill(PERIOD_END);
    await page.getByRole("button", { name: /Next.*CSV/i }).click();

    // CSV step — use the paste textarea
    await page.getByRole("button", { name: /Or paste CSV text/i }).click();
    // The details element expands; find the textarea
    const textarea = page.locator("details textarea");
    await textarea.fill(CSV_CONTENT);

    // Wait for preview to show Valid
    await expect(page.getByText("Valid")).toBeVisible({ timeout: 5_000 });

    // Submit
    await page.getByRole("button", { name: /Submit batch/i }).click();

    // Wait for "Batch created" confirmation
    await expect(page.getByText("Batch created", { exact: false })).toBeVisible({
      timeout: 60_000,
    });
  });

  // Navigate to the new batch via the "View Batch" button
  await page.getByRole("button", { name: /View Batch/i }).click();
  await page.waitForURL(/\/admin\/batches\/\d+/);
  const batchUrl = page.url();

  // ── Step 2: Approve ─────────────────────────────────────────────────────────
  await test.step("admin: approve batch", async () => {
    await expect(page.getByRole("button", { name: "Approve batch" })).toBeVisible({
      timeout: 10_000,
    });
    await clickActionButton(page, "Approve batch");
    await waitForSuccess(page, "Success");
    await page.waitForTimeout(1_500); // allow router.refresh()
  });

  // ── Step 3: Fund ────────────────────────────────────────────────────────────
  await test.step("admin: fund batch", async () => {
    await page.reload();
    await expect(page.getByRole("button", { name: "Fund batch" })).toBeVisible({
      timeout: 10_000,
    });
    await clickActionButton(page, "Fund batch");
    await waitForSuccess(page, "Success");
    await page.waitForTimeout(1_500);
  });

  // ── Step 4: Execute payouts ──────────────────────────────────────────────────
  await test.step("admin: execute payouts", async () => {
    await page.reload();
    await expect(page.getByRole("button", { name: "Execute payouts" })).toBeVisible({
      timeout: 10_000,
    });
    await clickActionButton(page, "Execute payouts");
    await waitForSuccess(page, "Success");
    await page.waitForTimeout(1_500);
  });

  // ── Step 5: SPP deposit ──────────────────────────────────────────────────────
  await test.step("admin: deposit to privacy pool", async () => {
    await page.reload();
    // The SPP deposit button is violet and visible only after batch is funded.
    const depositBtn = page.getByRole("button", { name: "Deposit to Privacy Pool" });
    await expect(depositBtn).toBeVisible({ timeout: 10_000 });
    await depositBtn.click();

    // This involves real Groth16 proof generation + on-chain tx (~30-90s).
    await expect(page.getByText("Privacy Pool: funded", { exact: false })).toBeVisible({
      timeout: 180_000,
    });
    // Also verify the SPP ref is shown.
    await expect(page.getByText("SPP deposit ref", { exact: false })).toBeVisible();
  });

  // ── Step 6: Employee claims ──────────────────────────────────────────────────
  await test.step("employee: claim from privacy pool", async () => {
    await page.goto("/employee");
    await expect(page.getByText("Hi,", { exact: false })).toBeVisible({ timeout: 10_000 });

    // The "Claim from Privacy Pool" button should be visible for the paid payout.
    const claimBtn = page.getByRole("button", { name: "Claim from Privacy Pool" });
    await expect(claimBtn).toBeVisible({ timeout: 10_000 });
    await claimBtn.click();

    // Wait for "Claimed ✓" — involves real Groth16 withdraw proof + on-chain tx.
    await expect(page.getByText("Claimed", { exact: false })).toBeVisible({
      timeout: 180_000,
    });

    // Verify tx hash is shown.
    await expect(page.locator("text=/tx: [0-9a-f]{12}/")).toBeVisible({ timeout: 5_000 });
  });

  // ── Done ────────────────────────────────────────────────────────────────────
  // Navigate back to confirm batch is in a settled state.
  await page.goto(batchUrl);
  await expect(page.getByText("Privacy Pool: funded", { exact: false })).toBeVisible({
    timeout: 10_000,
  });
});
