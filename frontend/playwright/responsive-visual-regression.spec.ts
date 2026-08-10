import { expect, test, type Page, type Route } from '@playwright/test';

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 900 },
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'wide', width: 1440, height: 960 },
] as const;

const USER = {
  id: 'admin-1',
  email: 'coach@repos.test',
  display_name: 'Morgan Lee',
  timezone: 'America/Indiana/Indianapolis',
  is_admin: true,
  onboarding_completed_at: '2026-01-01T00:00:00Z',
  beta_disclaimer_ack_at: '2026-01-01T00:00:00Z',
  par_q_version: 1,
  par_q_advisory_active: false,
};

const TODAY = {
  state: 'workout',
  run_id: 'run-1',
  start_date: '2026-08-01',
  day: { id: 'day-1', kind: 'strength', name: 'Upper strength', week_idx: 2, day_idx: 1 },
  pacing: { status: 'on_pace', suggested_date: '2026-08-10' },
  completed_today: false,
  track: 'intermediate',
  sets: [
    {
      id: 'set-1',
      block_idx: 0,
      set_idx: 0,
      exercise: { id: 'ex-1', slug: 'barbell-bench-press', name: 'Barbell Bench Press' },
      target_reps_low: 6,
      target_reps_high: 8,
      target_rir: 2,
      rest_sec: 180,
      logged: null,
    },
    {
      id: 'set-2',
      block_idx: 0,
      set_idx: 1,
      exercise: { id: 'ex-1', slug: 'barbell-bench-press', name: 'Barbell Bench Press' },
      target_reps_low: 6,
      target_reps_high: 8,
      target_rir: 2,
      rest_sec: 180,
      logged: null,
    },
    {
      id: 'set-3',
      block_idx: 1,
      set_idx: 0,
      exercise: { id: 'ex-2', slug: 'cable-row', name: 'Cable Row' },
      target_reps_low: 8,
      target_reps_high: 12,
      target_rir: 2,
      rest_sec: 120,
      logged: null,
    },
  ],
  cardio: [],
};

const TEMPLATE = {
  id: 'template-1',
  slug: 'balanced-strength',
  name: 'Balanced Strength',
  description: 'Build strength with measured weekly volume. Equipment minimum: Barbell and bench.',
  weeks: 5,
  days_per_week: 3,
  track: 'intermediate',
  version: 1,
};

const HISTORY = {
  items: [
    {
      id: 'history-1',
      name: 'Upper strength',
      kind: 'strength',
      week_idx: 1,
      day_idx: 0,
      status: 'completed',
      completed_at: '2026-08-08T18:30:00Z',
      scheduled_date: '2026-08-08',
      exercises: [
        {
          slug: 'barbell-bench-press',
          name: 'Barbell Bench Press',
          sets: [
            { weight_lbs: 155, reps: 8, rir: 2, performed_at: '2026-08-08T18:00:00Z' },
            { weight_lbs: 155, reps: 8, rir: 2, performed_at: '2026-08-08T18:05:00Z' },
          ],
        },
      ],
    },
  ],
  next_cursor: null,
};

const ADMIN_USERS = {
  users: [
    {
      id: 'admin-1',
      email: 'coach@repos.test',
      display_name: 'Morgan Lee',
      role: 'admin',
      status: 'active',
      invited_at: '2026-01-01T00:00:00Z',
      activated_at: '2026-01-01T00:00:00Z',
      last_seen_at: '2026-08-10T12:00:00Z',
      cf_synced_at: '2026-08-10T12:00:00Z',
      invite_sent_at: '2026-01-01T00:00:00Z',
      invited_by_email: null,
    },
    {
      id: 'member-1',
      email: 'athlete@repos.test',
      display_name: 'Avery Stone',
      role: 'member',
      status: 'active',
      invited_at: '2026-07-01T00:00:00Z',
      activated_at: '2026-07-02T00:00:00Z',
      last_seen_at: '2026-08-09T16:00:00Z',
      cf_synced_at: '2026-08-09T16:00:00Z',
      invite_sent_at: '2026-07-01T00:00:00Z',
      invited_by_email: 'coach@repos.test',
    },
    {
      id: 'member-2',
      email: 'pending@repos.test',
      display_name: null,
      role: 'member',
      status: 'invited',
      invited_at: '2026-08-09T00:00:00Z',
      activated_at: null,
      last_seen_at: null,
      cf_synced_at: null,
      invite_sent_at: '2026-08-09T00:00:00Z',
      invited_by_email: 'coach@repos.test',
    },
  ],
  cohort: { count: 3, cap: 10 },
  drift: { checked: true, policy_error: null, divergent: [], unknown: ['pending@repos.test'] },
};

function json(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function wire(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const NativeDate = Date;
    const fixed = new NativeDate('2026-08-10T14:00:00-04:00').valueOf();
    class FixedDate extends NativeDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        super(...(args.length === 0 ? [fixed] : args));
      }
      static now() {
        return fixed;
      }
    }
    globalThis.Date = FixedDate as DateConstructor;
  });

  await page.route('**/api/**', (route) => json(route, {}));
  await page.route('**/api/me', (route) => json(route, USER));
  await page.route('**/api/me/par-q', (route) =>
    json(route, { needs_prompt: false, advisory_active: false, version: 1 }),
  );
  await page.route('**/api/equipment/profile', (route) =>
    json(route, { _v: 1, barbell: true, adjustable_bench: true, cable_stack: true }),
  );
  await page.route('**/api/maintenance/status', (route) =>
    json(route, { active: false, restore: null, recovery_available: false }),
  );
  await page.route('**/api/health/sync/status', (route) =>
    json(route, {
      source: 'Apple Health',
      last_success_at: '2026-08-10T11:30:00Z',
      state: 'fresh',
    }),
  );
  await page.route('**/api/health/weight*', (route) =>
    json(route, {
      current: { weight_lbs: 181.2, date: '2026-08-10', time: '07:30:00' },
      samples: [
        { date: '2026-08-04', weight_lbs: 182.1, source: 'Apple Health' },
        { date: '2026-08-06', weight_lbs: 181.8, source: 'Apple Health' },
        { date: '2026-08-08', weight_lbs: 181.5, source: 'Manual' },
        { date: '2026-08-10', weight_lbs: 181.2, source: 'Apple Health' },
      ],
      stats: {
        trend_7d_lbs: -0.9,
        trend_30d_lbs: -2.4,
        trend_90d_lbs: -5.1,
        adherence_pct: 86,
        missed_days: [],
      },
      sync: { source: 'Mixed sources', last_success_at: '2026-08-10T11:30:00Z', state: 'fresh' },
    }),
  );
  await page.route('**/api/recovery-flags', (route) => json(route, { flags: [] }));
  await page.route('**/api/mesocycles/today', (route) => json(route, TODAY));
  await page.route('**/api/exercises', (route) =>
    json(route, {
      exercises: [
        {
          id: 'ex-1',
          slug: 'barbell-bench-press',
          name: 'Barbell Bench Press',
          primary_muscle_name: 'Chest',
          required_equipment: { requires: [{ key: 'barbell' }, { key: 'adjustable_bench' }] },
        },
        {
          id: 'ex-2',
          slug: 'cable-row',
          name: 'Cable Row',
          primary_muscle_name: 'Back',
          required_equipment: { requires: [{ key: 'cable_stack' }] },
        },
      ],
    }),
  );
  await page.route('**/api/program-templates*', (route) => json(route, { templates: [TEMPLATE] }));
  await page.route('**/api/user-programs*', (route) => json(route, { programs: [] }));
  await page.route('**/api/workouts/history*', (route) => json(route, HISTORY));
  await page.route('**/api/admin/users', (route) => json(route, ADMIN_USERS));
  await page.route('**/api/backups', (route) => json(route, { items: [] }));
  await page.route('**/api/account/sessions', (route) =>
    json(route, {
      sessions: [
        {
          id: 'session-1',
          created_at: '2026-08-01T12:00:00Z',
          last_seen_at: '2026-08-10T12:00:00Z',
          last_ip_prefix: '192.0.2.0/24',
          user_agent_family: 'Safari',
          is_current: true,
        },
      ],
    }),
  );
  await page.route('**/api/account/events*', (route) =>
    json(route, { events: [], next_cursor: null }),
  );
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.locator('.app-main').evaluate((main) => ({
    client: main.clientWidth,
    scroll: main.scrollWidth,
  }));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.client + 1);
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px keeps core capabilities reachable and captures visual states`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await wire(page);

    await page.goto('/');
    await expect(page.getByText(/next workout/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /start workout/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot(`today-${viewport.name}.png`, {
      animations: 'disabled',
      fullPage: true,
    });

    await page.getByRole('button', { name: /start workout/i }).click();
    await expect(page).toHaveURL(/\/today\/run-1\/log$/);
    await expect(page.getByRole('button', { name: /finish workout/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`logger-${viewport.width}.png`),
      fullPage: true,
    });

    await page.goto('/programs');
    await expect(page.getByRole('button', { name: /customize program/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`programs-${viewport.width}.png`),
      fullPage: true,
    });

    await page.goto('/history');
    await expect(page.getByText('Barbell Bench Press')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`history-${viewport.width}.png`),
      fullPage: true,
    });

    await page.goto('/settings/users');
    await expect(page.getByRole('button', { name: /invite user/i })).toBeVisible();
    await expect(page.getByTestId('user-row-athlete@repos.test')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    if (viewport.width <= 1023) {
      await expect(page.getByRole('button', { name: /suspend/i }).first()).toBeVisible();
      await expect(page.getByLabel(/more actions for athlete@repos.test/i)).toBeVisible();
    } else {
      await expect(page.getByRole('button', { name: /delete/i }).first()).toBeVisible();
    }
    await page.screenshot({
      path: testInfo.outputPath(`users-${viewport.width}.png`),
      fullPage: true,
    });

    await page.goto('/settings/backups');
    await expect(page.getByRole('button', { name: /backup now/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`backups-${viewport.width}.png`),
      fullPage: true,
    });
  });
}

test('mobile primary controls meet touch targets and keyboard focus stays visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await wire(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /start workout/i })).toBeVisible();

  const controls = [
    page.getByRole('button', { name: /open navigation/i }),
    page.getByRole('button', { name: /feedback/i }),
    page.getByRole('button', { name: /start workout/i }),
    page.getByRole('button', { name: /^skip$/i }),
    page.getByRole('button', { name: /deload this week/i }),
    page.getByRole('link', { name: /^programs$/i }),
    page.getByRole('link', { name: /^settings$/i }),
  ];

  for (const control of controls) {
    const box = await control.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  const start = page.getByRole('button', { name: /start workout/i });
  await start.focus();
  const outline = await start.evaluate((node) => getComputedStyle(node).outlineWidth);
  expect(Number.parseFloat(outline)).toBeGreaterThanOrEqual(2);
});

test('reduced motion removes interface transitions and skeleton animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await wire(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /start workout/i })).toBeVisible();

  const transitionDuration = await page
    .getByRole('button', { name: /start workout/i })
    .evaluate((node) => getComputedStyle(node).transitionDuration);
  expect(Number.parseFloat(transitionDuration)).toBeLessThanOrEqual(0.01);
});
