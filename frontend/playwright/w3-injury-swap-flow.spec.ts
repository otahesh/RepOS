/**
 * W3 acceptance — full injury-swap flow against the dev server.
 *
 * Asserts: add chip in /settings/injuries → see the demoted candidate in the
 * mid-session "Got a tweak?" picker → click-through on the demoted candidate
 * succeeds end-to-end (advisory ≠ block).
 *
 * Hermetic via `page.route()`-level mocks — same pattern as
 * src/components/programs/__offline__/_helpers.ts. No real backend is
 * contacted; no DB state is required. The dev vite server is enough
 * because requests are intercepted in the browser before hitting the proxy.
 *
 * The master plan stub lists the path as tests/e2e/w3-injury-swap-flow.spec.ts
 * at the worktree root. That doesn't work in practice because the spec
 * imports `@playwright/test` and node_modules only resolves under frontend/.
 * Hosting the spec here (where the existing playwright/ glob picks it up)
 * keeps both module resolution and config unchanged.
 *
 * Why not reuse `_helpers.seedMesocycle()` directly: that helper is scoped
 * to the offline-logger matrix and assumes /api/set-logs et al. This spec
 * exercises a different surface (today board + swap picker + substitute
 * endpoint + injuries CRUD), so inline route handlers are clearer than
 * expanding the shared helper to accommodate them.
 */

import { test, expect, type Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const USER = {
  id: 'user-1',
  email: 'tester@example.com',
  display_name: 'Tester',
  timezone: 'America/New_York',
  // Past timestamp so the W2 OnboardingOverlay (z-1500) does not cover the page.
  onboarding_completed_at: '2026-01-01T00:00:00Z', beta_disclaimer_ack_at: '2026-01-01T00:00:00Z',
};

const PLANNED_SET_ID = 'ps-bs-0';
const FROM_EXERCISE_ID = 'ex-back-squat';
const FROM_EXERCISE_SLUG = 'barbell-back-squat';
const FROM_EXERCISE_NAME = 'Back Squat';
const DEMOTED_CANDIDATE_ID = 'ex-low-bar-back-squat';
const DEMOTED_CANDIDATE_NAME = 'Low-Bar Back Squat';

test('inj-swap: chip → today → swap → demoted candidate click-through', async ({ page }) => {
  // -------------------------------------------------------------------------
  // Stateful mock of /api/user/injuries — POST mutates, GET reflects.
  // -------------------------------------------------------------------------
  type Injury = {
    joint: string;
    severity: 'low' | 'mod' | 'high';
    notes: string;
    onset_at: string | null;
    created_at: string;
    updated_at: string;
  };
  const injuries: Injury[] = [];

  // /api/me — same shape as AuthProvider expects (auth.tsx).
  await page.route('**/api/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(USER),
    });
  });

  // /api/equipment/profile — non-empty so the EquipmentWizard modal stays
  // hidden. Mirrors the W1.3.6 offline helper.
  await page.route('**/api/equipment/profile', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ _v: 1, barbell: { available: true } }),
    });
  });

  // /api/user/injuries — list + upsert (PATCH/DELETE not exercised here).
  await page.route('**/api/user/injuries', async (route: Route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ injuries }),
      });
      return;
    }
    if (method === 'POST') {
      const payload = JSON.parse(route.request().postData() ?? '{}') as {
        joint: string;
        severity?: 'low' | 'mod' | 'high';
        notes?: string;
        onset_at?: string | null;
      };
      const now = new Date().toISOString();
      const existingIdx = injuries.findIndex((i) => i.joint === payload.joint);
      const row: Injury = {
        joint: payload.joint,
        severity: payload.severity ?? 'mod',
        notes: payload.notes ?? '',
        onset_at: payload.onset_at ?? null,
        created_at: existingIdx >= 0 ? injuries[existingIdx].created_at : now,
        updated_at: now,
      };
      if (existingIdx >= 0) injuries[existingIdx] = row;
      else injuries.push(row);
      await route.fulfill({
        status: existingIdx >= 0 ? 200 : 201,
        contentType: 'application/json',
        body: JSON.stringify({ injury: row }),
      });
      return;
    }
    await route.fulfill({ status: 405, contentType: 'application/json', body: '{}' });
  });

  // /api/mesocycles/today — one strength block on the back squat. The
  // exercise.slug must match what the picker hands to getSubstitutions().
  await page.route('**/api/mesocycles/today', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        state: 'workout',
        run_id: 'run-1',
        day: {
          id: 'day-1',
          kind: 'strength',
          name: 'Lower A',
          week_idx: 1,
          day_idx: 0,
        },
        pacing: { status: 'on_pace', suggested_date: '2026-01-01' },
        completed_today: false,
        sets: [
          {
            id: PLANNED_SET_ID,
            block_idx: 0,
            set_idx: 0,
            exercise: {
              id: FROM_EXERCISE_ID,
              slug: FROM_EXERCISE_SLUG,
              name: FROM_EXERCISE_NAME,
            },
            target_reps_low: 6,
            target_reps_high: 8,
            target_rir: 2,
            rest_sec: 180,
          },
        ],
        cardio: [],
      }),
    });
  });

  // /api/exercises/:slug/substitutions — return a candidate with the
  // injury_advisory tag so the picker renders the W3.2 copy from
  // lib/terms.ts:INJURY_ADVISORY_COPY (verified copy: "High knee load —
  // you noted left knee", not "Higher" as the master-plan stub
  // accidentally wrote).
  await page.route(`**/api/exercises/${FROM_EXERCISE_SLUG}/substitutions`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        from: { slug: FROM_EXERCISE_SLUG, name: FROM_EXERCISE_NAME },
        subs: [
          {
            id: DEMOTED_CANDIDATE_ID,
            slug: 'barbell-low-bar-back-squat',
            name: DEMOTED_CANDIDATE_NAME,
            score: 480,
            reason: '',
            injury_advisory: { joint: 'knee_left', level: 'high' },
          },
          {
            id: 'ex-leg-press',
            slug: 'leg-press',
            name: 'Leg Press',
            score: 320,
            reason: '',
          },
        ],
        truncated: false,
      }),
    });
  });

  // /api/planned-sets/:id/substitute — the click-through endpoint.
  // Success = 200 with the updated planned-set shape. After this the
  // confirm sheet closes and TodayWorkoutMobile re-fetches /today; the
  // re-fetch is already mocked above.
  await page.route(`**/api/planned-sets/${PLANNED_SET_ID}/substitute`, async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({ status: 405, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: PLANNED_SET_ID,
        exercise_id: DEMOTED_CANDIDATE_ID,
        substituted_from_exercise_id: FROM_EXERCISE_ID,
        overridden_at: new Date().toISOString(),
      }),
    });
  });

  // ---------------------------------------------------------------------------
  // 1. Land on /, get past AuthGate.
  // ---------------------------------------------------------------------------
  await page.goto('/');

  // ---------------------------------------------------------------------------
  // 2. Navigate to /settings/injuries and add the knee_left chip.
  // ---------------------------------------------------------------------------
  await page.goto('/settings/injuries');
  // Inactive chip: aria-pressed=false, text 'knee_left'.
  const kneeChip = page.getByRole('button', { name: /^knee_left$/ });
  await expect(kneeChip).toBeVisible();
  await kneeChip.click();

  // The chip flips to active — text becomes 'knee_left ✓'. The InjuryChipsEditor
  // re-renders with the in-memory `items` updated, so the new accessible name is
  // pulled from React state, not a re-fetch.
  await expect(page.getByRole('button', { name: /^knee_left ✓/ })).toBeVisible();

  // ---------------------------------------------------------------------------
  // 3. Force mobile viewport so TodayPage renders TodayWorkoutMobile (which
  //    is where the BlockOverflowMenu + "Got a tweak?" flow lives).
  //    The desktop TodayCard does not yet wire BlockOverflowMenu.
  // ---------------------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14
  await page.goto('/today');

  // ---------------------------------------------------------------------------
  // 4. Open the per-block menu on the back-squat block, then click "Got a tweak?".
  // ---------------------------------------------------------------------------
  const moreBtn = page.getByRole('button', { name: /more options for back squat/i });
  await expect(moreBtn).toBeVisible();
  await moreBtn.click();
  await page.getByRole('menuitem', { name: /got a tweak/i }).click();

  // ---------------------------------------------------------------------------
  // 5. Picker dialog opens and the demoted candidate row carries the W3.2
  //    advisory copy.
  // ---------------------------------------------------------------------------
  const picker = page.getByRole('dialog', { name: /swap back squat/i });
  await expect(picker).toBeVisible();
  // The exact copy comes from INJURY_ADVISORY_COPY.knee_left.high in
  // frontend/src/lib/terms.ts. The plan's reference string ("higher knee
  // load") doesn't match real source — see comment in the route mock above.
  await expect(picker.getByText(/high knee load — you noted left knee/i)).toBeVisible();

  // ---------------------------------------------------------------------------
  // 6. Click the demoted candidate. The picker hands off to MidSessionSwapSheet
  //    (a separate dialog titled "Swap exercise?"). We then confirm the swap
  //    and verify the entire stack closes with no error toast.
  // ---------------------------------------------------------------------------
  await picker.getByRole('button', { name: new RegExp(DEMOTED_CANDIDATE_NAME, 'i') }).click();

  const confirmSheet = page.getByRole('dialog', { name: /swap exercise/i });
  await expect(confirmSheet).toBeVisible();
  await confirmSheet.getByRole('button', { name: /confirm swap/i }).click();

  // After confirm: both dialogs unmount and no error toast surfaces.
  await expect(page.getByRole('dialog', { name: /swap/i })).toBeHidden();
  await expect(page.getByText(/swap failed/i)).toBeHidden();
});
