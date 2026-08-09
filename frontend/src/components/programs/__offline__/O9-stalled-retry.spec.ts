// O9 — Attempt-capped row recovers via the stuck pill + Retry sync.
//
// The prod incident this guards: a set burned all 5 attempts on a since-fixed
// server 400 and sat as a permanent "1 set queued for sync" overlay with no
// recovery affordance anywhere. The full recovery path:
//   stalled row → "stuck" pill → /settings/storage → Retry sync → 201 → synced.

import { test, expect } from '@playwright/test';
import { inspectQueue, seedMesocycle, seedQueueRow, type PendingSetLogRow } from './_helpers';

test('O9: attempt-capped row surfaces stuck pill; Retry sync re-arms and drains it', async ({
  page,
}) => {
  const server = await seedMesocycle(page); // default responder: 201 created

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const now = Date.now();
  const stuck: PendingSetLogRow = {
    client_request_id: 'stuck-1',
    queue_owner_user_id: 'user-1',
    planned_set_id: 'ps-1',
    performed_at: new Date(now - 60_000).toISOString(),
    weight_lbs: 135,
    reps: 6,
    rir: 2,
    rpe: null,
    notes: null,
    status: 'pending',
    // At the cap: flushOnce skips it every tick, so without Retry sync it
    // would sit here forever. Recent created_at keeps the O7 staleness pill
    // out of the way — this asserts the stuck variant specifically.
    attempt_count: 5,
    next_attempt_at: 0,
    created_at: now - 60_000,
    updated_at: now - 60_000,
  };
  await seedQueueRow(page, stuck);

  // Stuck pill renders as a link (useIdbQueueCounts polls at 1000ms).
  const pill = page.getByRole('link', { name: /1 set stuck/i });
  await expect(pill).toBeVisible({ timeout: 2500 });

  // The flusher must NOT have POSTed the capped row on its own.
  expect(server.posted).toHaveLength(0);

  // Pill navigates to the recovery surface.
  await pill.click();
  await expect(page).toHaveURL(/\/settings\/storage/);

  // Retry sync re-arms the row; the next flush tick drains it via 201.
  await page.getByRole('button', { name: /retry sync/i }).click();
  await expect.poll(async () => (await inspectQueue(page)).length, { timeout: 5000 }).toBe(0);

  expect(server.posted).toHaveLength(1);
  expect(server.posted[0].client_request_id).toBe('stuck-1');
  expect(server.posted[0].serverDecision).toBe('created');
});
