// frontend/playwright/w-seq-history-reachability.spec.ts
// sequence-workouts / Task 10 — a logged-in user reaches the /history page from
// `/` in <=3 clicks, on BOTH desktop and mobile, and sees a completed workout
// card with its set detail (weight × reps @RIR).
//
// Desktop: the History nav link is always in the sidebar → 1 click.
// Mobile:  the sidebar is a drawer, so it takes the Topbar hamburger
//          ("Open navigation") THEN the History link → 2 clicks.
//
// Hermetic: a catch-all `**/api/**` returns `{}` for anything not explicitly
// wired (registered FIRST so the specific routes below win — Playwright matches
// the last-registered route). onboarding_completed_at MUST be a past timestamp
// or the z-1500 OnboardingOverlay covers the page and eats clicks. equipment
// profile MUST be non-empty or the EquipmentWizard modal covers the page.
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

// One completed workout, grouped by exercise, with two logged sets. The page
// auto-expands the most-recent (first) item, so the set detail renders without
// a toggle — but we still exercise the collapse/expand toggle below to prove
// the detail is reachable behind it.
const COMPLETED_WORKOUT = {
  id: 'dw-1',
  name: 'Lower A',
  kind: 'strength',
  week_idx: 1,
  day_idx: 0,
  status: 'completed',
  completed_at: '2026-07-05T18:30:00Z',
  scheduled_date: '2026-07-05',
  exercises: [
    {
      slug: 'barbell-back-squat',
      name: 'Back Squat',
      sets: [
        { weight_lbs: 135, reps: 8, rir: 2, performed_at: '2026-07-05T18:00:00Z' },
        { weight_lbs: 135, reps: 8, rir: 2, performed_at: '2026-07-05T18:05:00Z' },
      ],
    },
  ],
};

// The canonical non-beginner set label (formatHistorySet): `135 × 8 @RIR 2`.
// The × is U+00D7 with surrounding spaces — match it verbatim.
const SET_LABEL = '135 × 8 @RIR 2';

async function wire(ctx: BrowserContext): Promise<void> {
  // Catch-all FIRST so the specific routes registered after it take precedence.
  // `{}` is benign for the decorative surfaces the home page touches
  // (weight chip, dashboard, PAR-Q) — none throw on missing fields.
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
  // Home page (Today) — keep it a clean no-op state so nothing on `/` competes
  // for render; the History nav lives in the sidebar (outside the route body).
  await ctx.route('**/api/mesocycles/today', (r: Route) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ state: 'no_active_run' }),
    }),
  );
  // `*` (no slash) matches the bare path AND the ?cursor=… follow-up — Playwright
  // treats `?` literally, so `?**` would MISS the bare first load.
  await ctx.route('**/api/workouts/history*', (r: Route) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [COMPLETED_WORKOUT], next_cursor: null }),
    }),
  );
}

test('seq/history: reachable from / in <=3 clicks on DESKTOP with set detail', async ({
  browser,
}) => {
  const ctx = await browser.newContext(); // desktop default viewport
  await wire(ctx);
  const page = await ctx.newPage();
  await page.goto('/');

  // 1 click: the always-visible sidebar History link.
  await page.getByRole('link', { name: /^history$/i }).click();

  // Completed workout card renders.
  await expect(page.getByText('Lower A')).toBeVisible();
  // First card auto-expands → exercise + set detail are on screen. Two sets
  // share the label, so scope to .first() to stay out of strict-mode.
  await expect(page.getByText('Back Squat')).toBeVisible();
  await expect(page.getByText(SET_LABEL).first()).toBeVisible();

  // Prove the detail lives behind the expand toggle: collapse hides it, expand
  // brings it back. The toggle is the card's only button while collapsed
  // (Reopen renders only when open), so scope to the card to disambiguate.
  const card = page.getByTestId('history-card');
  await card.getByRole('button', { expanded: true }).click();
  await expect(page.getByText(SET_LABEL).first()).toBeHidden();
  await card.getByRole('button', { expanded: false }).click();
  await expect(page.getByText(SET_LABEL).first()).toBeVisible();

  await ctx.close();
});

test('seq/history: reachable from / in <=3 clicks on MOBILE with set detail', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // iPhone 14
  await wire(ctx);
  const page = await ctx.newPage();
  await page.goto('/');

  // On mobile the sidebar is a drawer. 1: open it via the Topbar hamburger.
  await page.getByRole('button', { name: /open navigation/i }).click();
  // 2: the History link inside the now-visible drawer.
  await page.getByRole('link', { name: /^history$/i }).click();

  // Completed workout card + set detail (mobile renders a flat single-column
  // list; first card auto-expands).
  await expect(page.getByText('Lower A')).toBeVisible();
  await expect(page.getByText('Back Squat')).toBeVisible();
  await expect(page.getByText(SET_LABEL).first()).toBeVisible();

  await ctx.close();
});
