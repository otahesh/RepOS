// O7 — Queue abandoned 7+ days.
//
// Master plan W1.3.6.8: a pre-existing pending row whose created_at is ≥7
// days old must surface the staleness banner with copy
// "<N> set queued · <N> days old · flush or clear?". The user gets a chooser
// (flush vs clear) so a stale row doesn't silently re-flush at the wrong time.
//
// The "flush or clear" chooser UI lives behind /settings/storage (W1.3.8); this
// spec asserts the staleness banner surfaces and is clickable to that target.

import { test, expect } from '@playwright/test';
import { inspectQueue, seedMesocycle, seedQueueRow, type PendingSetLogRow } from './_helpers';

const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

test('O7: pending row aged 8 days surfaces staleness banner with day count + click target', async ({ page }) => {
  await seedMesocycle(page);
  await page.goto('/');

  // Page must reach an authenticated, mounted AppShell before we seed —
  // idbQueue's Dexie instance is initialized when the first peek tick runs,
  // and our seedQueueRow re-uses that singleton.
  await page.waitForLoadState('domcontentloaded');

  const eightDaysAgo = Date.now() - EIGHT_DAYS_MS;
  const stale: PendingSetLogRow = {
    client_request_id: 'stale-1',
    queue_owner_user_id: 'user-1',
    planned_set_id: 'ps-1',
    performed_at: new Date(eightDaysAgo).toISOString(),
    weight_lbs: 135,
    reps: 6,
    rir: 2,
    rpe: null,
    notes: null,
    status: 'pending',
    // attempt_count >= MAX_ATTEMPTS (5) so logBuffer.flush() SKIPS this row
    // and never POSTs it — matches the realistic "stalled queue" UX where the
    // row has burned its automatic retries and is now surfaced to the user
    // for explicit flush-or-clear.
    attempt_count: 5,
    next_attempt_at: 0,
    created_at: eightDaysAgo,
    updated_at: eightDaysAgo,
  };
  await seedQueueRow(page, stale);

  // useIdbQueueCounts polls at 1000ms; allow up to 2500ms for the staleness
  // banner to render.
  await expect(
    page.getByText(/1 set queued · 8 days old · flush or clear/i),
  ).toBeVisible({ timeout: 2500 });

  // Banner is clickable (role=button) — surfaces user choice via navigation.
  const banner = page.getByRole('button', { name: /1 set queued · 8 days old · flush or clear/i });
  await expect(banner).toBeVisible();

  // Row is still in the queue — staleness DOES NOT auto-purge.
  const rows = await inspectQueue(page);
  expect(rows).toHaveLength(1);
  expect(rows[0].client_request_id).toBe('stale-1');
  expect(rows[0].status).toBe('pending');
});
