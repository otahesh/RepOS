// O10 — Duration set (hold) offline round-trip. Measurement model, 2026-07-12.
//
// A side-plank hold logged while POSTs fail must queue with duration_sec (and
// NO reps — never coerced), survive in IDB, then flush with duration_sec in
// the wire payload once the responder recovers. Guards the whole offline
// pipeline for the duration measurement class: SetRow duration mode →
// RowInputs.durationSec → EnqueueFields → PendingSetLog → postSetLog strip.

import { test, expect } from '@playwright/test';
import { HOLD_SEED_SET, inspectQueue, logHoldSet, openFirstBlock, seedMesocycle } from './_helpers';

test('O10: hold logged offline queues duration_sec, flushes it on recovery, never fabricates reps or effort', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const server = await seedMesocycle(page, { sets: [HOLD_SEED_SET] });

  // Start with transient failures — the hold must land in IDB, not the server.
  let online = false;
  server.setResponder(() => (online ? { kind: 'created' } : { kind: 'transient' }));

  await page.goto('/today/run-1/log');
  await openFirstBlock(page);
  await expect(page.getByTestId('set-row-0')).toBeVisible();

  // Duration mode renders: hold-seconds input present, reps input absent.
  await expect(page.getByLabel(/Set 1 hold seconds/i)).toBeVisible();
  await expect(page.getByLabel(/Set 1 reps/i)).toHaveCount(0);

  await logHoldSet(page, 0, { durationSec: 40 });

  // Queued row carries duration_sec 40, reps null, rir null (RPE untouched —
  // effort is never fabricated from the target for holds).
  await expect.poll(async () => (await inspectQueue(page)).length, { timeout: 5000 }).toBe(1);
  const [row] = await inspectQueue(page);
  expect(row.duration_sec).toBe(40);
  expect(row.reps).toBeNull();
  expect(row.rir).toBeNull();
  expect(row.status).toBe('pending');

  // Recover the network; AppShell's retry tick drives the flush.
  online = true;
  await expect
    .poll(async () => server.posted.length, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(1);
  const posted = server.posted[server.posted.length - 1];
  expect(posted.duration_sec).toBe(40);
  // CapturedPost normalizes absent → null; the wire-level absence itself is
  // pinned by logBuffer's unit tests (null-strip both directions).
  expect(posted.reps).toBeNull();
  expect(posted.rir).toBeNull();

  // Queue drains to empty (synced rows are deleted by idbQueue.markSynced) —
  // zero silent set loss.
  await expect.poll(async () => (await inspectQueue(page)).length, { timeout: 30_000 }).toBe(0);
});
