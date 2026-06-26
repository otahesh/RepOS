// O2 — Page reload mid-queue.
//
// Master plan W1.3.6.3: with 3 sets queued offline, reloading the page must
// surface the banner ("3 sets queued"), and on reconnect all 3 must flush
// with NO double-submit.
//
// Mocked-backend (page.route()) translation per /goal condition (3): rather
// than "server-side dedupe verified via GET /api/set-logs", we assert that
// page.route() captured exactly 3 distinct POSTs (distinct client_request_ids,
// distinct planned_set_ids).

import { test, expect } from '@playwright/test';
import {
  goOffline,
  goOnline,
  inspectQueue,
  logSet,
  seedMesocycle,
  waitForPosts,
  waitForQueueLength,
  type SeedSet,
} from './_helpers';

const THREE_SETS: SeedSet[] = [
  {
    id: 'ps-1',
    block_idx: 0,
    set_idx: 0,
    exercise: { id: 'ex-bp', slug: 'bp', name: 'Bench' },
    target_reps_low: 6,
    target_reps_high: 8,
    target_rir: 2,
    rest_sec: 90,
  },
  {
    id: 'ps-2',
    block_idx: 0,
    set_idx: 1,
    exercise: { id: 'ex-bp', slug: 'bp', name: 'Bench' },
    target_reps_low: 6,
    target_reps_high: 8,
    target_rir: 2,
    rest_sec: 90,
  },
  {
    id: 'ps-3',
    block_idx: 0,
    set_idx: 2,
    exercise: { id: 'ex-bp', slug: 'bp', name: 'Bench' },
    target_reps_low: 6,
    target_reps_high: 8,
    target_rir: 2,
    rest_sec: 90,
  },
];

test('O2: 3 sets queued offline survive reload, banner surfaces, reconnect flushes all 3 with no dupes', async ({
  page,
}) => {
  const server = await seedMesocycle(page, { sets: THREE_SETS });

  await page.goto('/today/run-1/log');
  await expect(page.getByTestId('set-row-0')).toBeVisible();

  // 1) Go offline and log 3 sets — all should land in IDB pending.
  await goOffline(page);
  await logSet(page, 0, { weight: 135, reps: 6 });
  await logSet(page, 1, { weight: 135, reps: 6 });
  await logSet(page, 2, { weight: 135, reps: 6 });

  const queuedBefore = await waitForQueueLength(page, 3);
  expect(queuedBefore.every((r) => r.status === 'pending')).toBe(true);
  expect(server.posted).toHaveLength(0); // offline — no POST attempts yet

  // 2) Reload the page. Route handlers persist across navigation, so the
  // mocked /api/me + /api/mesocycles/today still return; logBuffer.onReconnect
  // re-mounts via AppShell useEffect.
  await page.reload();
  await expect(page.getByTestId('set-row-0')).toBeVisible();

  // After reload while still offline, LogBufferRecovery surfaces the offline
  // pending banner. useIdbQueueCounts polls at 1000ms; allow up to 2000ms.
  await expect(page.getByText(/OFFLINE.*3 sets queued/i)).toBeVisible({ timeout: 2000 });

  // Queue must still have the 3 rows.
  const queuedAfter = await inspectQueue(page);
  expect(queuedAfter).toHaveLength(3);

  // 3) Go online → AppShell's onReconnect handler triggers flush.
  await goOnline(page);
  await waitForPosts(server, 3, page);

  // Each POST is for a distinct planned_set_id and a distinct CRID.
  const cris = new Set(server.posted.map((p) => p.client_request_id));
  const planned = new Set(server.posted.map((p) => p.planned_set_id));
  expect(cris.size).toBe(3);
  expect(planned.size).toBe(3);

  // 4) Queue drains to empty (synced rows are deleted by idbQueue.markSynced).
  await expect
    .poll(async () => (await inspectQueue(page)).length, {
      timeout: 5000,
    })
    .toBe(0);
});
