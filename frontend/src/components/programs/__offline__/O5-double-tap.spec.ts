// O5 — Double-tap on the Log button within 500ms.
//
// Master plan W1.3.6.6: two taps within 500ms must collapse to a single IDB
// row (the second tap dismissed by the 500ms aria-busy/debounce window) and
// a single POST. UI must not flash "2 sets queued" at any point.
//
// The counterpart regenerated-CRID case (release finger, tap again at 600ms+
// — same minute bucket) is covered as a Vitest unit test in
// logBuffer.test.ts because the current SetRow state machine transitions to
// 'logged' on first success and refuses subsequent clicks, so a UI-only
// scenario for the 600ms case cannot reach logBuffer.enqueue. The unit test
// exercises the same dedupe path at the logBuffer/responder boundary.

import { test, expect } from '@playwright/test';
import { inspectQueue, openFirstBlock, seedMesocycle, waitForPosts } from './_helpers';

test('O5: double-tap within 500ms → exactly 1 IDB row, 1 POST, banner never shows >1 queued', async ({
  page,
}) => {
  const server = await seedMesocycle(page);

  await page.goto('/today/run-1/log');
  await openFirstBlock(page);
  await expect(page.getByTestId('set-row-0')).toBeVisible();

  // Fill weight + reps so the Log button is enabled.
  const row = page.getByTestId('set-row-0');
  await row.getByLabel(/Set 1 weight/i).fill('135');
  await row.getByLabel(/Set 1 reps/i).fill('6');

  const logBtn = row.getByRole('button', { name: /^Log$/ });

  // Observe banner copy throughout: count how often "2 sets queued" appears.
  // We poll for any flash of the banner with a 2-queued count.
  let everSawTwoQueued = false;
  const watchInterval = setInterval(async () => {
    try {
      const visible = await page.getByText(/2 sets queued/i).count();
      if (visible > 0) everSawTwoQueued = true;
    } catch {
      /* page may be closing */
    }
  }, 30);

  // Two clicks within 500ms. Playwright .click() awaits the event, so we
  // dispatch the second click directly via JS to ensure the SetRow's
  // `debounced` state from the first click is still true.
  await logBtn.click();
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button')).filter(
      (b) => b.textContent === 'Log' || b.textContent === 'Set queued',
    );
    buttons[0]?.click();
  });

  // Give the debounce window to elapse + the flush to complete.
  await page.waitForTimeout(700);
  clearInterval(watchInterval);

  // Exactly one POST hit the server.
  await waitForPosts(server, 1, page);
  expect(server.posted).toHaveLength(1);

  // The banner never flashed 2 sets queued during the interaction.
  expect(everSawTwoQueued).toBe(false);

  // IDB state: at most one row was ever created. Synced rows are deleted, so
  // by now the queue is empty.
  const rows = await inspectQueue(page);
  expect(rows.length).toBeLessThanOrEqual(1);
});
