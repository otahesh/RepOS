// O4 — Network drop mid-flush.
//
// Master plan W1.3.6.5: 5 queued, "goOffline after 2 sets posted". The
// post-flush IDB state must show 3 pending with attempt_count > 0 and a
// growing next_attempt_at across retries. After "goOnline" all flush within 30s.
//
// Mocked-backend (page.route()) translation per /goal condition (3):
// instead of literal navigator.onLine flips, the responder counts POSTs and
// returns 201 for POSTs #1–#2 then 503 (transient) for #3–#5. logBuffer treats
// network errors and 5xx identically (both bump attempt_count and gate via
// next_attempt_at), so the IDB outcomes the spec asserts on are equivalent.
// AppShell's periodic 2s retry tick drives the geometric growth across
// attempts. The final "goOnline" is flipping the responder back to 'created'.

import { test, expect } from '@playwright/test';
import { inspectQueue, logSet, seedMesocycle, type SeedSet } from './_helpers';

const FIVE_SETS: SeedSet[] = Array.from({ length: 5 }, (_, i) => ({
  id: `ps-${i + 1}`,
  block_idx: 0,
  set_idx: i,
  exercise: { id: 'ex-bp', slug: 'bp', name: 'Bench' },
  target_reps_low: 6,
  target_reps_high: 8,
  target_rir: 2,
  rest_sec: 90,
}));

test('O4: network drop mid-flush — 2 sync, 3 retry with growing backoff, recover when network returns', async ({
  page,
}) => {
  const server = await seedMesocycle(page, { sets: FIVE_SETS });

  // Responder: first 2 POSTs succeed, then transient failures until flipped.
  let transientMode = false;
  let postCount = 0;
  server.setResponder(() => {
    postCount++;
    if (transientMode) return { kind: 'transient' };
    if (postCount > 2) {
      // "Network drops after the first 2" — the rest fail transient.
      return { kind: 'transient' };
    }
    return { kind: 'created' };
  });

  await page.goto('/today/run-1/log');
  await expect(page.getByTestId('set-row-0')).toBeVisible();

  // Log all 5 sets back-to-back. Logger client-side debounce is 500ms so we
  // need to wait between Log clicks — use a small extra margin.
  for (let i = 0; i < 5; i++) {
    await logSet(page, i, { weight: 135, reps: 6 });
    await page.waitForTimeout(600);
  }

  // Wait for the responder to receive all 5 — first 2 created, rest transient.
  await expect.poll(() => server.posted.length, { timeout: 5000 }).toBeGreaterThanOrEqual(5);

  // First snapshot: at this point 3 rows remain pending with attempt_count >= 1.
  const snap1 = await inspectQueue(page);
  expect(snap1.filter((r) => r.status === 'pending')).toHaveLength(3);
  expect(snap1.some((r) => r.attempt_count > 0)).toBe(true);

  // Pick one of the still-pending rows; capture its next_attempt_at.
  const trackedCrid = snap1.find((r) => r.status === 'pending')!.client_request_id;
  const napBefore = snap1.find((r) => r.client_request_id === trackedCrid)!.next_attempt_at;

  // Wait long enough for the AppShell 2s retry-tick to fire at least twice;
  // each retry bumps attempt_count and recomputes next_attempt_at with a
  // larger base (2^n). 3.2s comfortably covers two ticks.
  await page.waitForTimeout(3200);

  const snap2 = await inspectQueue(page);
  const napAfter = snap2.find((r) => r.client_request_id === trackedCrid)?.next_attempt_at ?? 0;

  // Geometric growth assertion: next_attempt_at moved forward by >1000ms.
  expect(napAfter - napBefore).toBeGreaterThan(1000);

  // Attempt count grew across the snapshots.
  const acBefore = snap1.find((r) => r.client_request_id === trackedCrid)!.attempt_count;
  const acAfter = snap2.find((r) => r.client_request_id === trackedCrid)?.attempt_count ?? 0;
  expect(acAfter).toBeGreaterThan(acBefore);

  // "Go back online" — flip responder back to 'created'. The 2s tick will
  // pick up rows once their next_attempt_at elapses.
  transientMode = false;
  postCount = 999; // ensure the >2 gate doesn't accidentally re-trigger
  server.setResponder(() => ({ kind: 'created' }));

  // All flush within 30s.
  await expect
    .poll(
      async () => {
        const rows = await inspectQueue(page);
        return rows.filter((r) => r.status === 'pending' || r.status === 'syncing').length;
      },
      { timeout: 30_000 },
    )
    .toBe(0);
});
