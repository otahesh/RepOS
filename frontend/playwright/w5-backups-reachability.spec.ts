import { test, expect } from '@playwright/test';

// Common auth + bootstrap mocks so the SPA renders past AuthGate/EquipmentWizard.
async function stubBootstrap(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/me', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      // onboarding_completed_at set so the W2 OnboardingOverlay (z-1500) stays down.
      body: JSON.stringify({ id: 'u1', email: 'a@b', display_name: 'X', timezone: 'UTC', onboarding_completed_at: '2026-01-01T00:00:00Z', beta_disclaimer_ack_at: '2026-01-01T00:00:00Z' }),
    }),
  );
  await page.route('**/api/equipment/profile', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ _v: 1, barbell: { available: true } }),
    }),
  );
  await page.route('**/api/backups', async (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) }),
  );
  // The MaintenanceBanner polls this on every page; keep it inactive.
  await page.route('**/api/maintenance/status', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ active: false, restore: null, recovery_available: false }),
    }),
  );
}

test('W5 — desktop user reaches /settings/backups in 2 clicks from /', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubBootstrap(page);
  await page.goto('/');
  await page.getByRole('link', { name: /^settings$/i }).click();
  await page.getByRole('link', { name: /^backups$/i }).click();
  await expect(page).toHaveURL(/\/settings\/backups$/);
  await expect(page.getByRole('heading', { name: 'Backups' })).toBeVisible();
  await expect(page.getByRole('button', { name: /backup now/i })).toBeVisible();
});

test('W5 — mobile viewport hides Backup Now affordance', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubBootstrap(page);
  await page.goto('/settings/backups');
  await expect(page.getByText(/managed from desktop|on desktop/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /backup now/i })).toHaveCount(0);
});

// C-MOBILE-MAINTENANCE — restore-completes-mid-logger should NOT force-reload.
// Drives a mobile-sized live logger, flips maintenance active→inactive via the
// mocked status endpoint, and asserts the soft Reload CTA appears and the URL
// stays on the logger (no auto-reload).
test('W5 — mobile /today/:runId/log suppresses force-reload, shows CTA', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubBootstrap(page);
  // Override maintenance/status: first poll active, subsequent polls inactive.
  let calls = 0;
  await page.route('**/api/maintenance/status', async (route) => {
    calls += 1;
    const body =
      calls === 1
        ? { active: true, restore: { status: 'running' }, recovery_available: false }
        : { active: false, restore: { status: 'ok' }, recovery_available: false };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/today/00000000-0000-0000-0000-000000000abc/log');
  await expect(page.getByText(/Restore complete — reload to continue/i)).toBeVisible({
    timeout: 15_000,
  });
  // URL is still the logger — no auto-reload happened.
  await expect(page).toHaveURL(/\/today\/[^/]+\/log$/);
});
