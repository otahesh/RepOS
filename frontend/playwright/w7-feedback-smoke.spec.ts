// frontend/playwright/w7-feedback-smoke.spec.ts
// W7 / G12 (UI layer) — a logged-in (non-admin) user opens feedback from the
// Topbar, submits, and sees a success toast. Hermetic: /api/feedback is mocked
// 201 and the POST body is captured to assert the route auto-fill. The DB-row +
// webhook-delivery assertions live in the api integration tests.
import { test, expect, type BrowserContext, type Route } from '@playwright/test';

// onboarding_completed_at MUST be a past timestamp: AppShell.useOnboardingGate
// mounts a full-viewport OnboardingOverlay (role=dialog, zIndex 1500) whenever
// it is falsy, which would cover the Topbar feedback button and fail the click.
// par_q fields included so the PAR-Q gate also stays down. (No /api/me/par-q
// route mock needed — refreshParQ catches a miss and leaves the gate closed.)
const USER = {
  id: 'user-1', email: 'tester@example.com', display_name: 'Tester', timezone: 'UTC',
  is_admin: false, onboarding_completed_at: '2026-01-01T00:00:00Z',
  par_q_version: 1, par_q_advisory_active: false,
};

test('W7: user submits feedback from the Topbar button', async ({ browser }) => {
  const posted: Array<Record<string, unknown>> = [];

  const wire = async (ctx: BrowserContext): Promise<void> => {
    await ctx.route('**/api/me', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(USER) }));
    await ctx.route('**/api/equipment/profile', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ _v: 1, barbell: { available: true } }) }));
    await ctx.route('**/api/health/sync/status', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: 'Apple Health', last_success_at: null, state: 'stale' }) }));
    await ctx.route('**/api/feedback', async (r: Route) => {
      posted.push(JSON.parse(r.request().postData() ?? '{}'));
      await r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: '1' }) });
    });
  };

  const ctx = await browser.newContext();
  await wire(ctx);
  const page = await ctx.newPage();
  await page.goto('/');

  await page.getByRole('button', { name: /send feedback/i }).click();
  const dialog = page.getByRole('dialog', { name: /send feedback/i });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('textbox', { name: /feedback/i }).fill('the rest timer skipped a beep');
  const resp = page.waitForResponse('**/api/feedback');
  await dialog.getByRole('button', { name: /^send$/i }).click();
  expect((await resp).status()).toBe(201);

  await expect(page.getByText(/feedback sent/i)).toBeVisible();
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({ body: 'the rest timer skipped a beep', route: '/' });
});
