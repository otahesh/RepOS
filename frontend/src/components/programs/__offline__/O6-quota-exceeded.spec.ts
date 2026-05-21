// O6 — IndexedDB quota exceeded.
//
// Master plan W1.3.6.7: when chromium IDB throws QuotaExceededError on put,
// idbQueue surfaces QueueFullError; logBuffer.enqueue propagates; the logger
// surfaces a banner; the app does NOT crash.
//
// Master-plan copy is "Storage full — clear older offline sessions in
// Settings" + a Clear CTA. The current TodayLoggerMobile inline role="alert"
// uses the copy "Offline queue is full — logs cannot be saved until storage
// is freed." with no Clear CTA — the Clear affordance ships as part of W1.3.8
// (Settings storage UI). This spec asserts the current production banner
// surface; the Settings/Clear assertions are tracked as a follow-up in
// W1.3.8.

import { test, expect } from '@playwright/test';
import { seedMesocycle } from './_helpers';

test('O6: IDB quota exceeded surfaces banner, app does not crash', async ({ page }) => {
  await seedMesocycle(page);

  // Patch IDBObjectStore.put on the pendingSetLogs store to throw a
  // QuotaExceededError. Dexie wraps the synchronous throw into a rejected
  // promise, idbQueue maps it to QueueFullError, TodayLoggerMobile renders
  // the quota banner.
  await page.addInitScript(() => {
    const origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: unknown[]) {
      if (this.name === 'pendingSetLogs') {
        // Synthetic IDBRequest that fires error asynchronously — matches the
        // shape Dexie expects without requiring us to fully simulate IDB.
        const req = {
          result: undefined,
          error: null as DOMException | null,
          source: this,
          transaction: this.transaction,
          readyState: 'pending' as IDBRequestReadyState,
          onsuccess: null as ((ev: Event) => void) | null,
          onerror: null as ((ev: Event) => void) | null,
          addEventListener(name: string, fn: (ev: Event) => void) {
            if (name === 'success') (this as { onsuccess: typeof fn }).onsuccess = fn;
            if (name === 'error') (this as { onerror: typeof fn }).onerror = fn;
          },
          removeEventListener() {},
        };
        Promise.resolve().then(() => {
          const err = new DOMException('Quota exceeded', 'QuotaExceededError');
          req.error = err;
          req.readyState = 'done';
          req.onerror?.({ target: req } as unknown as Event);
        });
        return req as unknown as IDBRequest;
      }
      return origPut.apply(this, args as Parameters<typeof origPut>);
    } as typeof IDBObjectStore.prototype.put;
  });

  await page.goto('/today/run-1/log');
  await expect(page.getByTestId('set-row-0')).toBeVisible();

  // Try to log a set. The IDB put will fail with QuotaExceededError → the
  // logger renders its role="alert" quota banner.
  const row = page.getByTestId('set-row-0');
  await row.getByLabel(/Set 1 weight/i).fill('135');
  await row.getByLabel(/Set 1 reps/i).fill('6');
  await row.getByRole('button', { name: /^Log$/ }).click();

  // Banner appears with quota copy.
  await expect(page.getByRole('alert')).toContainText(/Offline queue is full/i, { timeout: 5000 });

  // App did not crash: the Log button is still in the DOM and re-enables
  // (state machine reset to 'input' on QueueFullError in TodayLoggerMobile).
  await expect(row.getByRole('button', { name: /^Log$/ })).toBeVisible();

  // No console "Uncaught" errors propagated to the page (best-effort smoke):
  // we don't dig into console messages here; the visible banner + recoverable
  // button surface is the spec's user-visible contract.
});
