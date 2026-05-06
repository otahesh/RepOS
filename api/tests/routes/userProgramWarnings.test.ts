// api/tests/routes/userProgramWarnings.test.ts
// HTTP integration tests for GET /api/user-programs/:id/warnings (C.16).

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { mkUser, mkTemplate, mkUserProgram, cleanupUser, cleanupTemplate } from '../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

// ── Shared fixtures ────────────────────────────────────────────────────────────

let userId: string;
let otherUserId: string;
let token: string;
let otherToken: string;
let cleanTemplateId: string;
let heavyTemplateId: string;

beforeAll(async () => {
  app = await buildApp();

  // Primary user
  const u = await mkUser({ prefix: 'vitest.warnings' });
  userId = u.id;

  const mint = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userId, label: 'warnings-test' },
  });
  token = mint.json<{ token: string }>().token;

  // Other user (for 404 ownership test)
  const other = await mkUser({ prefix: 'vitest.warnings-other' });
  otherUserId = other.id;

  const otherMint = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: otherUserId, label: 'warnings-other-test' },
  });
  otherToken = otherMint.json<{ token: string }>().token;

  // Template: clean 3-day full-body (no scheduling collisions)
  const cleanTpl = await mkTemplate({
    prefix: 'vitest-warnings-clean',
    weeks: 5,
    daysPerWeek: 3,
    structure: {
      _v: 1,
      days: [
        { idx: 0, day_offset: 0, kind: 'strength', name: 'Full Body A', blocks: [
          { exercise_slug: 'squat', mev: 8, mav: 14, target_reps_low: 6, target_reps_high: 8, target_rir: 3, rest_sec: 180, movement_pattern: 'squat' },
        ]},
        { idx: 1, day_offset: 2, kind: 'strength', name: 'Full Body B', blocks: [
          { exercise_slug: 'bench-press', mev: 8, mav: 14, target_reps_low: 8, target_reps_high: 10, target_rir: 3, rest_sec: 120, movement_pattern: 'push' },
        ]},
        { idx: 2, day_offset: 4, kind: 'strength', name: 'Full Body C', blocks: [
          { exercise_slug: 'rdl', mev: 8, mav: 14, target_reps_low: 8, target_reps_high: 10, target_rir: 3, rest_sec: 120, movement_pattern: 'hinge' },
        ]},
      ],
    },
  });
  cleanTemplateId = cleanTpl.id;

  // Template: 7 training days → triggers too_many_days_per_week block
  const heavyTpl = await mkTemplate({
    prefix: 'vitest-warnings-7day',
    weeks: 5,
    daysPerWeek: 7,
    structure: {
      _v: 1,
      days: [0, 1, 2, 3, 4, 5, 6].map(offset => ({
        idx: offset,
        day_offset: offset,
        kind: 'strength',
        name: `Day ${offset + 1}`,
        blocks: [
          { exercise_slug: 'squat', mev: 8, mav: 14, target_reps_low: 6, target_reps_high: 8, target_rir: 2, rest_sec: 180, movement_pattern: 'squat' },
        ],
      })),
    },
  });
  heavyTemplateId = heavyTpl.id;
});

afterAll(async () => {
  await cleanupUser(userId);
  await cleanupUser(otherUserId);
  await cleanupTemplate(cleanTemplateId);
  await cleanupTemplate(heavyTemplateId);
  await app.close();
  await db.end();
});

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe('GET /api/user-programs/:id/warnings', () => {
  it('returns { warnings: [] } for a clean 3-day full-body draft program', async () => {
    const up = await mkUserProgram({ userId, templateId: cleanTemplateId });

    const r = await app.inject({
      method: 'GET',
      url: `/api/user-programs/${up.id}/warnings`,
      headers: auth(token),
    });

    expect(r.statusCode).toBe(200);
    const body = r.json<{ warnings: unknown[] }>();
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body.warnings).toHaveLength(0);
  });

  it('returns block warning with code too_many_days_per_week for a 7-day schedule', async () => {
    const up = await mkUserProgram({ userId, templateId: heavyTemplateId });

    const r = await app.inject({
      method: 'GET',
      url: `/api/user-programs/${up.id}/warnings`,
      headers: auth(token),
    });

    expect(r.statusCode).toBe(200);
    const body = r.json<{ warnings: Array<{ code: string; severity: string; message: string }> }>();
    expect(Array.isArray(body.warnings)).toBe(true);
    const blockWarn = body.warnings.find(w => w.code === 'too_many_days_per_week' && w.severity === 'block');
    expect(blockWarn).toBeDefined();
    expect(typeof blockWarn!.message).toBe('string');
    expect(blockWarn!.message.length).toBeGreaterThan(0);
  });

  it('returns 404 when user_program does not belong to the requesting user', async () => {
    // Create a program under userId but request it with otherToken
    const up = await mkUserProgram({ userId, templateId: cleanTemplateId });

    const r = await app.inject({
      method: 'GET',
      url: `/api/user-programs/${up.id}/warnings`,
      headers: auth(otherToken),
    });

    expect(r.statusCode).toBe(404);
    const body = r.json<{ error: string }>();
    expect(typeof body.error).toBe('string');
  });
});
