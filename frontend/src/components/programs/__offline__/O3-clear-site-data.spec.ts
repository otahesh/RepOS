// O3 — Device switch / clear site data mid-workout.
//
// Master plan W1.3.6.4 (Playwright half): the realistic single-device case —
// user reinstalls the PWA or clears site data, then logs the same planned set
// again. Server's minute-bucket dedupe must prevent the 4th POST from
// creating a duplicate row.
//
// Scope of this spec:
//   - IDB-side recovery + minute-bucket dedupe behavior, against a mocked
//     `/api/set-logs` responder with its dedupe flag enabled.
//
// What this spec deliberately does NOT prove:
//   - Auth-side recovery on a real "fresh PWA install." The mocked
//     `/api/me` route in _helpers.ts auto-rehydrates the same user on the
//     next call (see comment at _helpers.ts:55-56), so cleared cookies do
//     not exercise a re-auth round-trip here. The auth-state-change purge
//     contract is covered in frontend/src/auth.test.tsx:107.
//   - Two-device cross-CRID idempotency. The full integration proof is in
//     api/tests/integration/set-logs-flow.test.ts (POST idempotency cases);
//     the unit-level frontend proxy is in logBuffer.test.ts.
//
// Mocked-backend (page.route()) translation per /goal condition (3):
//   - We enable the responder's minute-bucket dedupe flag.
//   - Instead of asserting `GET /api/set-logs?planned_set_id=... returns 3 rows`,
//     we assert: 4 POSTs total; the 4th has serverDecision === 'deduped';
//     distinct (planned_set, minute-bucket) keys === 3.

import { test, expect } from '@playwright/test';
import {
  clearQueueDb,
  inspectQueue,
  logSet,
  seedMesocycle,
  waitForPosts,
  type SeedSet,
} from './_helpers';

const THREE_SETS: SeedSet[] = [
  { id: 'ps-1', block_idx: 0, set_idx: 0, exercise: { id: 'ex-bp', slug: 'bp', name: 'Bench' },
    target_reps_low: 6, target_reps_high: 8, target_rir: 2, rest_sec: 90 },
  { id: 'ps-2', block_idx: 0, set_idx: 1, exercise: { id: 'ex-bp', slug: 'bp', name: 'Bench' },
    target_reps_low: 6, target_reps_high: 8, target_rir: 2, rest_sec: 90 },
  { id: 'ps-3', block_idx: 0, set_idx: 2, exercise: { id: 'ex-bp', slug: 'bp', name: 'Bench' },
    target_reps_low: 6, target_reps_high: 8, target_rir: 2, rest_sec: 90 },
];

test('O3: clear site data mid-workout — minute-bucket dedupe prevents 4th from creating duplicate', async ({ page, context }) => {
  const server = await seedMesocycle(page, { sets: THREE_SETS });
  server.enableMinuteBucketDedupe(true);

  await page.goto('/today/run-1/log');
  await expect(page.getByTestId('set-row-0')).toBeVisible();

  // 1) Log 3 sets online — all sync.
  await logSet(page, 0, { weight: 135, reps: 6 });
  await logSet(page, 1, { weight: 135, reps: 6 });
  await logSet(page, 2, { weight: 135, reps: 6 });
  await waitForPosts(server, 3, page);

  // Queue drains to empty (all synced).
  await expect.poll(async () => (await inspectQueue(page)).length, { timeout: 5000 }).toBe(0);

  // 2) Simulate clear-site-data: nuke cookies + the IDB queue database.
  // The mocked /api/me route handler will re-authenticate the same user on
  // the next /api/me call, so the post-reload session reuses the same user
  // id — matching the realistic "same device, fresh PWA install" path.
  await context.clearCookies();
  await clearQueueDb(page);

  // 3) Reload — page comes up fresh, no queue. Log the same planned set
  // (ps-1) again. The new CRID + minute-bucket dedupe responder will return
  // 200 deduped: true, so the IDB row is marked synced and the queue drains.
  await page.reload();
  await expect(page.getByTestId('set-row-0')).toBeVisible();
  await logSet(page, 0, { weight: 140, reps: 6 });
  await waitForPosts(server, 4, page);

  // 4) Server saw 4 POSTs total.
  expect(server.posted).toHaveLength(4);

  // Distinct CRIDs: 4 (each set generates a fresh UUID).
  const cris = new Set(server.posted.map((p) => p.client_request_id));
  expect(cris.size).toBe(4);

  // Distinct (planned_set, minute-bucket) keys: 3 — the 4th POST hits
  // ps-1's minute bucket again.
  const buckets = new Set(
    server.posted.map((p) => `${p.planned_set_id}@${p.performed_at.slice(0, 16)}`),
  );
  expect(buckets.size).toBe(3);

  // The 4th POST was deduped server-side; the first 3 were created.
  const decisions = server.posted.map((p) => p.serverDecision);
  expect(decisions[0]).toBe('created');
  expect(decisions[1]).toBe('created');
  expect(decisions[2]).toBe('created');
  expect(decisions[3]).toBe('deduped');

  // Queue is empty — minute-bucket-deduped row was marked synced by markSynced.
  await expect.poll(async () => (await inspectQueue(page)).length, { timeout: 5000 }).toBe(0);
});
