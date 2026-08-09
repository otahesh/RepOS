// O1 — Server returns 409 audit_window_expired on a queued set.
//
// Master plan W1.3.6.2: queued set is rejected by server with
// `audit_window_expired`; SyncStatusPill surfaces it as a clickable pill;
// the IDB row keeps status='rejected' so the user can review (never silent drop).
//
// Mocked-backend (page.route()) translation per /goal condition (3): the 409
// comes from the responder, not a real Postgres audit gate.

import { test, expect } from '@playwright/test';
import { inspectQueue, logSet, openFirstBlock, seedMesocycle } from './_helpers';

test('O1: 409 audit_window_expired surfaces pill + rejected status; row preserved', async ({
  page,
}) => {
  const server = await seedMesocycle(page);
  server.setResponder(() => ({ kind: 'audit-expired' }));

  await page.goto('/today/run-1/log');
  await openFirstBlock(page);
  // Wait for the logger to render its first set row.
  await expect(page.getByTestId('set-row-0')).toBeVisible();

  await logSet(page, 0, { weight: 135, reps: 5 });

  // Wait for the POST to be intercepted and the row to flip to rejected.
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
  expect(rows).toHaveLength(1); // row is preserved, NOT silently dropped
  expect(rows[0].status).toBe('rejected');
  expect(rows[0].rejection_reason).toBe('audit_window_expired');

  // SyncStatusPill surfaces rejected count; useIdbQueueCounts polls
  // at 1000ms so allow up to the poll window plus a tick. The clickable pill
  // renders as a <Link> (role=link), not a button — a11y change in the component.
  await expect(page.getByRole('link', { name: /1 sets? rejected/i })).toBeVisible({
    timeout: 2000,
  });

  // Server only received the one POST that flipped to 409 — no silent retry.
  expect(server.posted).toHaveLength(1);
});
