/**
 * Contract tests for the /api/exercises route surface.
 *
 * Tests hit real route handlers via Fastify inject() and parse responses
 * through the canonical Zod schemas in api/src/schemas/exercises.ts.
 * Shape drift between handler and schema causes a loud failure here.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import {
  ExerciseListResponseSchema,
  ExerciseDetailResponseSchema,
  SubstitutionResponseSchema,
} from '../../src/schemas/exercises.js';

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let userId: string;
let token: string;
let exerciseSlug: string | undefined;

beforeAll(async () => {
  app = await buildApp();
  const { rows: [u] } = await db.query(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`vitest.contract.exercises.${Date.now()}@repos.test`],
  );
  userId = u.id;
  const mint = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userId, label: 'contract-test' },
  });
  token = mint.json<{ token: string }>().token;

  // Seed equipment profile so substitution endpoint has something to work with
  await db.query(
    `UPDATE users SET equipment_profile='{"_v":1,"dumbbells":{"min_lb":5,"max_lb":80,"increment_lb":5}}'::jsonb
     WHERE id=$1`,
    [userId],
  );

  // Find a real exercise slug to exercise the detail + substitution endpoints
  const { rows: [ex] } = await db.query(
    `SELECT slug FROM exercises WHERE archived_at IS NULL LIMIT 1`,
  );
  exerciseSlug = ex?.slug;
}, 30_000);

afterAll(async () => {
  if (userId) await db.query('DELETE FROM users WHERE id = $1', [userId]);
  await app.close();
  await db.end();
});

const auth = () => ({ authorization: `Bearer ${token}` });

// ---------------------------------------------------------------------------
// GET /api/exercises
// ---------------------------------------------------------------------------

describe('GET /api/exercises contract', () => {
  it('200 response parses through ExerciseListResponseSchema', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/exercises',
    });
    expect(res.statusCode).toBe(200);
    const parsed = ExerciseListResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(Array.isArray(parsed.data.exercises)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/exercises/:slug
// ---------------------------------------------------------------------------

describe('GET /api/exercises/:slug contract', () => {
  it('200 response parses through ExerciseDetailResponseSchema', async () => {
    if (!exerciseSlug) {
      console.warn('No exercises in DB — skipping detail test');
      return;
    }
    const res = await app.inject({
      method: 'GET',
      url: `/api/exercises/${exerciseSlug}`,
    });
    expect(res.statusCode).toBe(200);
    const parsed = ExerciseDetailResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(parsed.data.slug).toBe(exerciseSlug);
    }
  });

  it('404 on unknown slug', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/exercises/this-exercise-does-not-exist',
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/exercises/:slug/substitutions
// ---------------------------------------------------------------------------

describe('GET /api/exercises/:slug/substitutions contract', () => {
  it('200 response parses through SubstitutionResponseSchema', async () => {
    if (!exerciseSlug) {
      console.warn('No exercises in DB — skipping substitution test');
      return;
    }
    const res = await app.inject({
      method: 'GET',
      url: `/api/exercises/${exerciseSlug}/substitutions`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const parsed = SubstitutionResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(parsed.data.from.slug).toBe(exerciseSlug);
      expect(Array.isArray(parsed.data.subs)).toBe(true);
      expect(typeof parsed.data.truncated).toBe('boolean');
    }
  });
});
