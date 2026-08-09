// frontend/playwright/w-seq-backfill-flow.spec.ts
// sequence-workouts / Task 10 — the behind-pace backfill flow, end to end, on a
// MOBILE viewport (the logger is mobile-only; TodayLoggerMobileGate redirects
// to /today on desktop).
//
// Flow: `/` (behind pace) → LOG PAST WORKOUT → date picker prefilled with the
// suggested date → LOG → logger opens at ?for=<date> with the "Logging for …"
// banner → open the block → log a set → assert the set-log POST stamps
// performed_at on the CHOSEN date → FINISH WORKOUT → assert the complete POST
// body carries completed_on:<chosen date>.
//
// Hermetic: a catch-all `**/api/**` → `{}` (registered FIRST so specific routes
// win). onboarding_completed_at is a PAST timestamp (else the z-1500 overlay
// eats clicks); equipment profile is non-empty (else the wizard covers the
// page). User tz is UTC so noon-local == noon-UTC and performed_at's date
// portion is exactly the picked date.
import { test, expect, type BrowserContext, type Route } from '@playwright/test';

const USER = {
  id: 'user-1',
  email: 'tester@example.com',
  display_name: 'Tester',
  timezone: 'UTC',
  is_admin: false,
  onboarding_completed_at: '2026-01-01T00:00:00Z', beta_disclaimer_ack_at: '2026-01-01T00:00:00Z',
  par_q_version: 1,
  par_q_advisory_active: false,
};

// A date safely in the past relative to the real clock (Playwright uses the
// system clock; `max` on the date input is the LOCAL today). Three days back is
// clear of any midnight boundary, so noon-UTC of this date is always < now and
// the logger never clamps performed_at to "now".
function pastLocalISO(daysAgo: number): string {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth(), n.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

test('seq/backfill: behind-pace → pick date → log set + finish stamp the chosen date', async ({
  browser,
}) => {
  const CHOSEN = pastLocalISO(3);

  const TODAY_WORKOUT = {
    state: 'workout',
    run_id: 'run-1',
    track: null,
    day: { id: 'dw-1', kind: 'strength', name: 'Lower A', week_idx: 1, day_idx: 0 },
    pacing: { status: 'behind', days_behind: 2, suggested_date: CHOSEN },
    completed_today: false,
    sets: [
      {
        id: 'ps-1',
        block_idx: 0,
        set_idx: 0,
        exercise: { id: 'ex-1', slug: 'barbell-back-squat', name: 'Back Squat' },
        target_reps_low: 6,
        target_reps_high: 8,
        target_rir: 2,
        rest_sec: 120,
        logged: null,
      },
    ],
    cardio: [],
  };

  // Captured POST bodies — asserted on VALUES, not merely that a POST happened.
  let setLogBody: Record<string, unknown> | null = null;
  let completeBody: Record<string, unknown> | null = null;

  const wire = async (ctx: BrowserContext): Promise<void> => {
    // Catch-all FIRST; specific routes below take precedence.
    await ctx.route('**/api/**', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await ctx.route('**/api/me', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(USER) }),
    );
    await ctx.route('**/api/equipment/profile', (r: Route) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ _v: 1, barbell: { available: true } }),
      }),
    );
    await ctx.route('**/api/health/sync/status', (r: Route) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ source: 'Apple Health', last_success_at: null, state: 'stale' }),
      }),
    );
    // Both the today board and the logger read this; it stays workout/behind
    // across the whole flow. `logged: null` means that after the logger remounts
    // on the hub↔focus route change the set reads as unlogged → FINISH prompts
    // the "unlogged" confirm, which we drive through.
    await ctx.route('**/api/mesocycles/today', (r: Route) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(TODAY_WORKOUT),
      }),
    );
    // Logger metadata / history / guide — kept empty/absent so nothing blocks
    // logging. `*` matches the bare list; the more-specific slug routes below
    // are registered later and win for their URLs.
    await ctx.route('**/api/exercises', (r: Route) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ exercises: [] }),
      }),
    );
    await ctx.route('**/api/exercises/*/history*', (r: Route) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessions: [] }),
      }),
    );
    await ctx.route('**/api/exercises/*/guide', (r: Route) =>
      r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
    );
    // Set-log POST (fired by logBuffer's fetch, not apiFetch) — capture + 201.
    await ctx.route('**/api/set-logs', (r: Route) => {
      if (r.request().method() === 'POST') {
        setLogBody = JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>;
      }
      return r.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });
    // Day-workout completion — capture + 200 (run not yet complete).
    await ctx.route('**/api/day-workouts/*/complete', (r: Route) => {
      if (r.request().method() === 'POST') {
        completeBody = JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>;
      }
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'dw-1',
          status: 'completed',
          completed_at: `${CHOSEN}T12:00:00.000Z`,
          run_completed: false,
        }),
      });
    });
  };

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // iPhone 14
  await wire(ctx);
  const page = await ctx.newPage();
  await page.goto('/');

  // --- Behind-pace board → open the past-workout date picker. ---------------
  await page.getByRole('button', { name: /log past workout/i }).click();

  // The date input is prefilled with the suggested (chosen) date; assert that,
  // then re-affirm the pick explicitly before logging.
  const dateInput = page.getByLabel(/log a past workout/i);
  await expect(dateInput).toHaveValue(CHOSEN);
  await dateInput.fill(CHOSEN);

  // --- LOG → navigate into the backfill-mode logger. ------------------------
  await page.getByRole('button', { name: /^log$/i }).click();
  await expect(page).toHaveURL(new RegExp(`/today/run-1/log\\?for=${CHOSEN}$`));

  // Backfill banner is the persistent mode indicator.
  await expect(page.getByText(/logging for/i)).toBeVisible();

  // --- Open the block → log a set. ------------------------------------------
  await page.getByTestId('hub-row-0').click();
  await page.getByLabel('Set 1 weight in pounds').fill('135');
  await page.getByLabel('Set 1 reps').fill('8');
  await page.getByRole('button', { name: 'Log', exact: true }).click();

  // The set-log POST must carry performed_at stamped on the CHOSEN date.
  await expect.poll(() => setLogBody, { timeout: 15_000 }).not.toBeNull();
  expect(String((setLogBody as Record<string, unknown>).performed_at).slice(0, 10)).toBe(CHOSEN);
  // Sanity: it is the set we logged, with the entered values.
  expect((setLogBody as Record<string, unknown>).planned_set_id).toBe('ps-1');
  expect((setLogBody as Record<string, unknown>).reps).toBe(8);

  // --- Back to the hub → FINISH WORKOUT. ------------------------------------
  await page.getByRole('button', { name: /done, back to plan/i }).click();
  await expect(page.getByRole('button', { name: /finish workout/i })).toBeVisible();
  await page.getByRole('button', { name: /finish workout/i }).click();

  // Route remount reset the row to unlogged (mock logged:null) → confirm sheet.
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: /finish anyway/i }).click();

  // The complete POST must carry completed_on:<chosen date>.
  await expect.poll(() => completeBody, { timeout: 15_000 }).not.toBeNull();
  expect((completeBody as Record<string, unknown>).completed_on).toBe(CHOSEN);

  await ctx.close();
});
