// O8 — Orphan planned_set.
//
// Master plan W1.3.6.9: server returns 404 for a planned_set that no longer
// exists; idbQueue must mark the row rejected with reason planned_set_deleted;
// banner surfaces the rejection so user can review.
//
// Master plan suggests per-reason banner copy ("…original workout no longer
// exists"). The current LogBufferRecovery uses the generic
// "⚠ N sets rejected — review" copy regardless of reason; the per-reason
// detail surfaces in /settings/storage (W1.3.8). This spec asserts the
// production banner contract + the IDB row's rejection_reason.

import { test, expect } from '@playwright/test';
import { inspectQueue, logSet, seedMesocycle } from './_helpers';

test('O8: 404 on POST → row marked rejected with reason planned_set_deleted; banner surfaces', async ({
  page,
}) => {
  const server = await seedMesocycle(page);
  server.setResponder(() => ({ kind: 'orphan' }));

  await page.goto('/today/run-1/log');
  await expect(page.getByTestId('set-row-0')).toBeVisible();

  await logSet(page, 0, { weight: 135, reps: 6 });

  await expect
    .poll(
      async () => {
        const rows = await inspectQueue(page);
        return rows[0]?.status ?? 'none';
      },
      { timeout: 5000 },
    )
    .toBe('rejected');

  const rows = await inspectQueue(page);
  expect(rows).toHaveLength(1);
  expect(rows[0].rejection_reason).toBe('planned_set_deleted');

  // Banner surfaces the rejection. The clickable banner renders as a <Link>
  // (role=link), not a button.
  await expect(page.getByRole('link', { name: /1 sets? rejected/i })).toBeVisible({
    timeout: 2000,
  });

  // Exactly one POST hit the server — no retry storm after 404.
  expect(server.posted).toHaveLength(1);
});
