// =============================================================================
// W1.3.6 — Offline matrix shared helpers
//
// DO NOT import 'fake-indexeddb' here — Playwright runs against real chromium
// IndexedDB. `fake-indexeddb` is Vitest-only (idbQueue.test.ts,
// logBuffer.test.ts). Importing the fake under Playwright would silently
// exercise the wrong store and let O# specs pass against a non-prod IDB
// implementation. (W1.3.6 frontend reviewer Critical #3.)
// =============================================================================

import type { BrowserContext, Page, Route } from '@playwright/test';

// -----------------------------------------------------------------------------
// Mocked API surface
// -----------------------------------------------------------------------------

export interface SeedSet {
  id: string;
  block_idx: number;
  set_idx: number;
  exercise: { id: string; slug: string; name: string };
  target_reps_low: number;
  target_reps_high: number;
  target_rir: number;
  rest_sec: number;
}

export interface SeedDay {
  id: string;
  kind: 'strength' | 'cardio' | 'hybrid';
  name: string;
  week_idx: number;
  day_idx: number;
}

export interface SeedOptions {
  /** Mesocycle run id. Default 'run-1'. */
  runId?: string;
  /** Set list. Defaults to two sets on one block (a planned bench-press double). */
  sets?: SeedSet[];
  /** Logical day metadata. Default Week 1 / Day 1 "Push". */
  day?: SeedDay;
  /** User shape returned by /api/me. */
  user?: { id: string; email: string; display_name: string | null; timezone: string; onboarding_completed_at?: string | null };
}

export interface CapturedPost {
  url: string;
  client_request_id: string;
  planned_set_id: string;
  weight_lbs: number | null;
  reps: number | null;
  rir: number | null;
  rpe: number | null;
  performed_at: string;
  notes: string | null;
  receivedAt: number;
  /** Filled in after the responder runs; lets specs assert per-POST server outcome. */
  serverDecision?: SetLogResponse['kind'];
}

export type SetLogResponse =
  | { kind: 'created'; serverId?: string }
  | { kind: 'deduped'; serverId?: string }
  | { kind: 'audit-expired' }
  | { kind: 'orphan' }
  | { kind: 'transient'; status?: number };

export type SetLogResponder = (body: CapturedPost, context: { posted: CapturedPost[] }) => SetLogResponse;

export interface MockServer {
  /** All POSTs to /api/set-logs captured (including ones aborted by `offlinePost`). */
  readonly posted: CapturedPost[];
  /** When true, POST /api/set-logs aborts as a network failure. */
  offlinePost: boolean;
  /** Replace the per-POST responder. Default: 201 created for every distinct CRID, 200 deduped if CRID repeats. */
  setResponder(fn: SetLogResponder): void;
  /** Toggle minute-bucket dedupe simulation (server-side). Off by default. */
  enableMinuteBucketDedupe(enabled: boolean): void;
}

const DEFAULT_USER = {
  id: 'user-1',
  email: 'tester@example.com',
  display_name: 'Tester',
  timezone: 'America/New_York',
  // Past timestamp so AppShell.useOnboardingGate does NOT mount the full-viewport
  // OnboardingOverlay (z-1500) over the logger — added when the W2 gate landed.
  onboarding_completed_at: '2026-01-01T00:00:00Z',
};

const DEFAULT_DAY: SeedDay = {
  id: 'day-1',
  kind: 'strength',
  name: 'Push A',
  // week_idx is 1-indexed per the mesocycles schema (min 1). The Playwright
  // specs talk to a mocked API so a 0 here doesn't surface as a dropped
  // rollup row — but it's the same latent bug seed-fixtures.ts had, and a
  // future contributor copying this helper to wire a live-API harness would
  // reproduce it.
  week_idx: 1,
  day_idx: 0,
};

const DEFAULT_SETS: SeedSet[] = [
  {
    id: 'ps-1',
    block_idx: 0,
    set_idx: 0,
    exercise: { id: 'ex-bp', slug: 'barbell-bench-press', name: 'Barbell Bench Press' },
    target_reps_low: 6,
    target_reps_high: 8,
    target_rir: 2,
    rest_sec: 90,
  },
  {
    id: 'ps-2',
    block_idx: 0,
    set_idx: 1,
    exercise: { id: 'ex-bp', slug: 'barbell-bench-press', name: 'Barbell Bench Press' },
    target_reps_low: 6,
    target_reps_high: 8,
    target_rir: 2,
    rest_sec: 90,
  },
];

/**
 * Install a navigator.onLine override that the test can flip via
 * window.__repoOfflineFlag. Must be added BEFORE the first page navigation,
 * which is why seedMesocycle calls it as the first step.
 *
 * We don't use context.setOffline() — that blocks navigation including
 * page.reload(), which breaks the O2 scenario. The JS-level override only
 * lies to the app about navigator.onLine; route.fulfill() responses still
 * flow normally, which matches the realistic semantics: when a phone goes
 * offline mid-session the browser keeps its local cached page reachable.
 */
async function installOfflineHatch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Override runs on EVERY navigation (including reload). The offline flag
    // therefore lives in localStorage so it survives reload — `goOffline()`
    // sets the localStorage key and dispatches 'offline'; reload re-reads it.
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => {
        try {
          return localStorage.getItem('__repo_offline') !== '1';
        } catch {
          return true;
        }
      },
    });
  });
}

/**
 * Seed a mocked workout into `page`.
 *
 * Installs route handlers covering /api/me, /api/equipment/profile,
 * /api/mesocycles/today, and POST /api/set-logs. Returns a MockServer handle
 * so the test can flip `offlinePost`, override per-POST behavior, or count
 * captured payloads.
 *
 * All routes are scoped to the single `page` (not the context), so two pages
 * in the same context can run independent mocks if a spec needs it.
 */
export async function seedMesocycle(page: Page, opts: SeedOptions = {}): Promise<MockServer> {
  await installOfflineHatch(page);

  // The live logger is mobile-only: TodayLoggerMobileGate redirects desktop
  // widths to /today, so set-row-0 never mounts. useIsMobile keys on
  // (max-width: 767px) and Playwright's default Desktop Chrome is 1280px — set
  // a phone viewport BEFORE navigation so the logger actually renders.
  await page.setViewportSize({ width: 390, height: 844 });

  const user = opts.user ?? DEFAULT_USER;
  const day = opts.day ?? DEFAULT_DAY;
  const sets = opts.sets ?? DEFAULT_SETS;
  const runId = opts.runId ?? 'run-1';

  const server: MockServer = {
    posted: [],
    offlinePost: false,
    setResponder(fn) {
      responder = fn;
    },
    enableMinuteBucketDedupe(enabled) {
      minuteBucketEnabled = enabled;
    },
  };
  let minuteBucketEnabled = false;

  // Default responder: 201 created for distinct CRIDs, 200 deduped for repeat
  // CRIDs, plus optional minute-bucket dedupe when enabled.
  let responder: SetLogResponder = (body, ctx) => {
    const seenCrid = ctx.posted.some(
      (p) => p !== body && p.client_request_id === body.client_request_id,
    );
    if (seenCrid) return { kind: 'deduped' };
    if (minuteBucketEnabled) {
      const minute = body.performed_at.slice(0, 16); // YYYY-MM-DDTHH:MM
      const bucketHit = ctx.posted.some(
        (p) =>
          p !== body &&
          p.planned_set_id === body.planned_set_id &&
          p.performed_at.slice(0, 16) === minute,
      );
      if (bucketHit) return { kind: 'deduped' };
    }
    return { kind: 'created' };
  };

  // GET /api/me
  await page.route('**/api/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(user),
    });
  });

  // GET /api/equipment/profile — non-empty so the EquipmentWizard modal stays
  // hidden during O# specs.
  await page.route('**/api/equipment/profile', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ _v: 1, barbell: { available: true } }),
    });
  });

  // GET /api/mesocycles/today
  await page.route('**/api/mesocycles/today', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        state: 'workout',
        run_id: runId,
        day,
        sets,
        cardio: [],
      }),
    });
  });

  // POST /api/set-logs — intercept + score against responder.
  await page.route('**/api/set-logs', async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({ status: 405, contentType: 'application/json', body: '{}' });
      return;
    }
    if (server.offlinePost) {
      await route.abort('failed');
      return;
    }
    let parsed: Omit<CapturedPost, 'url' | 'receivedAt'>;
    try {
      parsed = JSON.parse(route.request().postData() ?? '{}');
    } catch {
      await route.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
      return;
    }
    const captured: CapturedPost = {
      url: route.request().url(),
      receivedAt: Date.now(),
      client_request_id: parsed.client_request_id,
      planned_set_id: parsed.planned_set_id,
      weight_lbs: parsed.weight_lbs,
      reps: parsed.reps,
      rir: parsed.rir,
      rpe: parsed.rpe ?? null,
      performed_at: parsed.performed_at,
      notes: parsed.notes ?? null,
    };
    server.posted.push(captured);

    const decision = responder(captured, { posted: server.posted });
    captured.serverDecision = decision.kind;
    switch (decision.kind) {
      case 'created':
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: decision.serverId ?? `srv-${captured.client_request_id.slice(0, 8)}`,
            deduped: false,
          }),
        });
        return;
      case 'deduped':
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: decision.serverId ?? `srv-${captured.client_request_id.slice(0, 8)}`,
            deduped: true,
          }),
        });
        return;
      case 'audit-expired':
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'audit_window_expired' }),
        });
        return;
      case 'orphan':
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'planned_set_deleted' }),
        });
        return;
      case 'transient':
        await route.fulfill({
          status: decision.status ?? 503,
          contentType: 'text/plain',
          body: 'boom',
        });
        return;
    }
  });

  return server;
}

// -----------------------------------------------------------------------------
// Network state
// -----------------------------------------------------------------------------

/**
 * Force the app to believe the network is offline by flipping the
 * navigator.onLine hatch installed by seedMesocycle, then dispatching the
 * 'offline' window event so listeners (useNetworkState, logBuffer.onReconnect)
 * see the transition.
 *
 * We deliberately do NOT call page.context().setOffline(true) — that blocks
 * page.reload(), which breaks the O2 reload-mid-queue scenario.
 */
export async function goOffline(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.setItem('__repo_offline', '1');
    window.dispatchEvent(new Event('offline'));
  });
}

/**
 * Restore online state and dispatch the 'online' event so reconnect handlers
 * fire (logBuffer.onReconnect drives the auto-flush).
 */
export async function goOnline(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.removeItem('__repo_offline');
    window.dispatchEvent(new Event('online'));
  });
}

// -----------------------------------------------------------------------------
// IndexedDB inspection (real chromium IDB — never fake-indexeddb)
// -----------------------------------------------------------------------------

export interface PendingSetLogRow {
  client_request_id: string;
  queue_owner_user_id: string;
  planned_set_id: string;
  performed_at: string;
  weight_lbs: number | null;
  reps: number | null;
  rir: number | null;
  rpe: number | null;
  notes: string | null;
  status: 'pending' | 'syncing' | 'synced' | 'rejected';
  rejection_reason?: 'audit_window_expired' | 'planned_set_deleted' | 'other';
  attempt_count: number;
  next_attempt_at: number;
  created_at: number;
  updated_at: number;
}

/**
 * Read every row from the real chromium IDB `RepOSLogQueue.pendingSetLogs`
 * store. The page must have opened the queue at least once (TodayLoggerMobile
 * does this on first enqueue or via the useIdbQueueCounts poll).
 */
export async function inspectQueue(page: Page): Promise<PendingSetLogRow[]> {
  return page.evaluate(async () => {
    // Wait briefly for any in-flight Dexie open. If the DB doesn't exist yet,
    // resolve to [] so callers can assert "queue empty" cleanly.
    const dbs = await indexedDB.databases?.().catch(() => []) ?? [];
    if (!dbs.some((d) => d.name === 'RepOSLogQueue')) return [] as unknown[];

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('RepOSLogQueue');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (!db.objectStoreNames.contains('pendingSetLogs')) {
      db.close();
      return [] as unknown[];
    }

    const tx = db.transaction('pendingSetLogs', 'readonly');
    const store = tx.objectStore('pendingSetLogs');
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows;
  }) as Promise<PendingSetLogRow[]>;
}

/**
 * Pre-seed a row into the chromium IDB queue without going through the UI.
 * Used by O7 (7-day abandoned queue) where the starting state must include a
 * row that wasn't enqueued via the logger.
 *
 * Writes the row via raw indexedDB (same access pattern as inspectQueue) rather
 * than a dynamic `import('/src/lib/idbQueue.ts')` — that source URL only exists
 * under the Vite dev server, NOT the production `vite preview` build the suite
 * runs against (it 404s with "Failed to fetch dynamically imported module").
 *
 * To avoid the schema race the previous implementation guarded against, this
 * WAITS for the app's Dexie instance to create `RepOSLogQueue` (v2, with the
 * `pendingSetLogs` store) before opening it with no explicit version — so we
 * inherit the app's schema rather than creating a divergent v1. The caller must
 * therefore navigate to a banner-bearing route (e.g. `/`) first so
 * useIdbQueueCounts opens the DB.
 */
export async function seedQueueRow(page: Page, row: PendingSetLogRow): Promise<void> {
  await page.evaluate(async (r) => {
    const deadline = Date.now() + 5000;
    const dbExists = async (): Promise<boolean> => {
      const dbs = (await indexedDB.databases?.().catch(() => [])) ?? [];
      return dbs.some((d) => d.name === 'RepOSLogQueue');
    };
    while (!(await dbExists()) && Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 50));
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('RepOSLogQueue'); // no version → inherit app's schema
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('pendingSetLogs', 'readwrite');
      tx.objectStore('pendingSetLogs').put(r);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, row);
}

/**
 * Delete the entire `RepOSLogQueue` database — used by O3 to simulate the
 * "user clears site data" path.
 */
export async function clearQueueDb(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase('RepOSLogQueue');
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve();
      }),
  );
}

// -----------------------------------------------------------------------------
// UI helpers
// -----------------------------------------------------------------------------

/**
 * Helper: log a single set via the mobile logger UI.
 * Assumes the page is on /today/<runId>/log with at least one set rendered.
 */
export async function logSet(
  page: Page,
  setIdx: number,
  values: { weight: number; reps: number },
): Promise<void> {
  const row = page.getByTestId(`set-row-${setIdx}`);
  await row.getByLabel(new RegExp(`Set ${setIdx + 1} weight`, 'i')).fill(String(values.weight));
  await row.getByLabel(new RegExp(`Set ${setIdx + 1} reps`, 'i')).fill(String(values.reps));
  // The button label is "Log" online and "Log (offline)" when navigator.onLine
  // is false (TodayLoggerMobile SetRow) — match both, but NOT the "Logged"
  // locked state. O2 logs while offline, so an exact /^Log$/ would miss it.
  await row.getByRole('button', { name: /^Log( \(offline\))?$/ }).click();
}

/**
 * Wait until the page's queue contains `n` rows. Polls inspectQueue() every
 * 100ms up to `timeoutMs`.
 */
export async function waitForQueueLength(
  page: Page,
  n: number,
  timeoutMs = 5000,
): Promise<PendingSetLogRow[]> {
  const start = Date.now();
  for (;;) {
    const rows = await inspectQueue(page);
    if (rows.length === n) return rows;
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `waitForQueueLength: expected ${n} rows, got ${rows.length} after ${timeoutMs}ms`,
      );
    }
    await page.waitForTimeout(100);
  }
}

/**
 * Wait until at least one captured POST exists. Used in scenarios that race
 * UI input against the flusher.
 */
export async function waitForPosts(
  server: MockServer,
  n: number,
  page: Page,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (server.posted.length < n) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitForPosts: expected ${n} POSTs, got ${server.posted.length} after ${timeoutMs}ms`);
    }
    await page.waitForTimeout(50);
  }
}

// Re-export for spec convenience.
export type { BrowserContext };
