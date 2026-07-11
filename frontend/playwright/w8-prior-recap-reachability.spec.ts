// frontend/playwright/w8-prior-recap-reachability.spec.ts
// W8 / G7 (D6) — a logged-in user reaches a COMPLETED program's recap from `/`
// in <=3 clicks: Programs nav -> Past tab -> "View recap" -> MesocycleRecap.
// Hermetic: all /api routes mocked. onboarding_completed_at MUST be a past
// timestamp or the z-1500 OnboardingOverlay covers the page and eats clicks.
import { test, expect, type BrowserContext, type Route } from '@playwright/test';

const USER = {
  id: 'user-1', email: 'tester@example.com', display_name: 'Tester', timezone: 'UTC',
  is_admin: false, onboarding_completed_at: '2026-01-01T00:00:00Z', beta_disclaimer_ack_at: '2026-01-01T00:00:00Z',
  par_q_version: 1, par_q_advisory_active: false,
};

const COMPLETED_PROGRAM = {
  id: 'up-done', template_id: 't1', template_slug: 'full-body-3x', template_version: 1,
  name: 'Full Body 3x', customizations: {}, status: 'completed',
  created_at: '2026-04-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
};

const COMPLETED_RUN = {
  id: 'run-1', user_program_id: 'up-done', user_id: 'user-1',
  start_date: '2026-03-01', start_tz: 'UTC', weeks: 4, current_week: 4,
  status: 'completed', finished_at: '2026-04-01T00:00:00Z',
  created_at: '2026-03-01T00:00:00Z', updated_at: '2026-04-01T00:00:00Z', day_workouts: [],
};

test('W8/G7: completed-program recap is reachable from / in <=3 clicks', async ({ browser }) => {
  const wire = async (ctx: BrowserContext): Promise<void> => {
    await ctx.route('**/api/me', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(USER) }));
    await ctx.route('**/api/equipment/profile', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ _v: 1, barbell: { available: true } }) }));
    await ctx.route('**/api/health/sync/status', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: 'Apple Health', last_success_at: null, state: 'stale' }) }));
    // Both the bare active-tab load (GET /api/user-programs) and the Past-tab
    // fetch (?include=past) must be mocked. Playwright treats `?` as a literal,
    // so `**/api/user-programs?**` MISSES the bare path; `*` (no slash) covers
    // both the bare list and the optional query string. The more-specific
    // `/api/user-programs/up-done...` routes are registered later and so win.
    await ctx.route('**/api/user-programs*', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ programs: [COMPLETED_PROGRAM] }) }));
    await ctx.route('**/api/user-programs/up-done/mesocycles', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mesocycles: [
        { id: 'run-1', status: 'completed', start_date: '2026-03-01', finished_at: '2026-04-01T00:00:00Z', is_deload: false, weeks: 4 },
      ] }) }));
    await ctx.route('**/api/mesocycles/run-1/recap-stats', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ weeks: 4, total_sets: 180, prs: 3 }) }));
    await ctx.route('**/api/mesocycles/run-1', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(COMPLETED_RUN) }));
    await ctx.route('**/api/user-programs/up-done', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...COMPLETED_PROGRAM, effective_name: 'Full Body 3x', effective_structure: { _v: 1, days: [] } }) }));
  };

  const ctx = await browser.newContext();
  await wire(ctx);
  const page = await ctx.newPage();
  await page.goto('/');

  // 1: Programs nav.
  await page.getByRole('link', { name: /programs/i }).first().click();
  // 2: Past tab.
  await page.getByRole('button', { name: /^past$/i }).click();
  // 3: View recap.
  await page.getByRole('button', { name: /view recap/i }).click();

  // Recap surface visible (MesocycleRecap header copy).
  await expect(page.getByText(/Solid block/i)).toBeVisible();
  await expect(page.getByText(/180/)).toBeVisible();
});
