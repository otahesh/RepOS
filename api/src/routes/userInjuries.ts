// api/src/routes/userInjuries.ts
//
// Beta W3.4 — user_injuries CRUD plugin. Task 5 ships the GET (list); Tasks
// 6/7/8 attach POST (upsert) / PATCH / DELETE to this same plugin.
//
// Auth: requireBearerOrCfAccess populates req.userId; requireScope enforces
// that bearer tokens carry `health:injuries:read`. CF Access JWTs (the webapp
// path) pass through requireScope because tokenScopes is undefined — whole-host
// CF Access already gates identity at the edge.
//
// [FIX-2] requireScope lives in middleware/scope.ts (singular), NOT cfAccess.js.
// [FIX-29] use typed req.userId with explicit nullish guard — matches
//          setLogs.ts:50-51. The guard returns 500 (auth_state_missing) rather
//          than falling through because requireBearerOrCfAccess is supposed to
//          have set req.userId or short-circuited with 401; a missing userId
//          here is a contract violation in the middleware chain, not a client
//          error.
//
// Response shape: onset_at is rendered as 'YYYY-MM-DD' (or null) via to_char
// in SQL — the column is DATE so node-pg would otherwise return a JS Date
// stamped at midnight UTC, which the frontend can't safely re-format without
// timezone risk. created_at / updated_at come back as TIMESTAMPTZ → JS Date,
// then serialized to ISO 8601 strings at the Zod boundary.
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { requireScope } from '../middleware/scope.js';
import {
  INJURY_JOINTS,
  UserInjuryListResponseSchema,
  UserInjuryPatchRequestSchema,
  UserInjuryUpsertRequestSchema,
  type UserInjuryItem,
  type UserInjuryListResponse,
} from '../schemas/userInjuries.js';
import { zodToFieldError } from '../utils/zodToFieldError.js';

export async function userInjuriesRoutes(app: FastifyInstance) {
  app.get(
    '/user/injuries',
    { preHandler: [requireBearerOrCfAccess, requireScope('health:injuries:read')] },
    async (req, reply) => {
      const userId = req.userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });

      const { rows } = await db.query<{
        joint: string;
        severity: string;
        notes: string;
        onset_at: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT joint, severity, notes,
                to_char(onset_at, 'YYYY-MM-DD') AS onset_at,
                created_at, updated_at
         FROM user_injuries
         WHERE user_id = $1
         ORDER BY joint`,
        [userId],
      );

      const body: UserInjuryListResponse = {
        injuries: rows.map((r) => ({
          joint: r.joint,
          severity: r.severity,
          notes: r.notes,
          onset_at: r.onset_at, // null if NULL in DB
          created_at: r.created_at.toISOString(),
          updated_at: r.updated_at.toISOString(),
        })) as UserInjuryListResponse['injuries'],
      };
      // Re-parse at the boundary so an unexpected DB shape (e.g. a new joint
      // value not yet in INJURY_JOINTS) becomes a loud 500 in the catch-all
      // rather than silently leaking through to the client.
      return reply.send(UserInjuryListResponseSchema.parse(body));
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/user/injuries — upsert by (user_id, joint).
  //
  // Idempotent shape: 201 on insert, 200 on update. The "isNew" decision is a
  // separate SELECT before INSERT...ON CONFLICT because Postgres has no
  // standard way to surface "did this collide" cheaply from a single RETURNING
  // statement (xmax tricks are fragile across PG versions). Two queries inside
  // the same request is acceptable for a low-frequency settings write.
  //
  // [FIX-29] req.userId guard identical to GET above — middleware contract
  // violation surfaces as 500, not a silent NULL user_id insert.
  //
  // 400 envelope: { error: 'invalid_payload', field_error: { error, field } }
  // — distinct from other routes that return the bare zodToFieldError shape,
  // because the W3.4 frontend (InjuryChipsEditor, Task 20) discriminates on
  // body.field_error to highlight the offending chip.
  // -------------------------------------------------------------------------
  app.post(
    '/user/injuries',
    { preHandler: [requireBearerOrCfAccess, requireScope('health:injuries:write')] },
    async (req, reply) => {
      const parsed = UserInjuryUpsertRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'invalid_payload',
          field_error: zodToFieldError(parsed.error),
        });
      }
      const userId = req.userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });
      const { joint, severity, notes, onset_at } = parsed.data;

      const { rows: [existing] } = await db.query<{ joint: string }>(
        `SELECT joint FROM user_injuries WHERE user_id=$1 AND joint=$2`,
        [userId, joint],
      );
      const isNew = !existing;

      const { rows: [row] } = await db.query<{
        joint: string;
        severity: string;
        notes: string;
        onset_at: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO user_injuries (user_id, joint, severity, notes, onset_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, joint) DO UPDATE SET
           severity   = EXCLUDED.severity,
           notes      = EXCLUDED.notes,
           onset_at   = EXCLUDED.onset_at,
           updated_at = now()
         RETURNING joint, severity, notes,
                   to_char(onset_at, 'YYYY-MM-DD') AS onset_at,
                   created_at, updated_at`,
        [userId, joint, severity, notes, onset_at ?? null],
      );

      const injury = {
        joint: row.joint,
        severity: row.severity,
        notes: row.notes,
        onset_at: row.onset_at,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      } as UserInjuryItem;
      return reply.code(isNew ? 201 : 200).send({ injury });
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/user/injuries/:joint — partial update.
  //
  // Dynamic UPDATE field list — only columns actually present in the body are
  // rewritten. This is distinct from POST upsert (which overwrites every
  // column with EXCLUDED values, including defaulted ones); PATCH is the right
  // surface for the frontend's per-chip edit affordances.
  //
  // Ordering matters:
  //   1. INJURY_JOINTS guard runs FIRST — catches URL-path injection
  //      (`/user/injuries/../something`) before we touch zod or the DB.
  //   2. Zod safeParse on the body — same 400 envelope as POST for frontend
  //      consistency (see Task 6 reviewer note).
  //   3. req.userId guard (FIX-29) — middleware contract violation → 500.
  //   4. Empty patch → 400 `empty_patch` — protects against no-op writes
  //      that would still bump updated_at and confuse the UI's "dirty" state.
  //   5. UPDATE...RETURNING; null row → 404 (not_found). PATCH is NOT
  //      idempotent like POST — a missing row is a real client error.
  // -------------------------------------------------------------------------
  app.patch<{ Params: { joint: string } }>(
    '/user/injuries/:joint',
    { preHandler: [requireBearerOrCfAccess, requireScope('health:injuries:write')] },
    async (req, reply) => {
      if (!INJURY_JOINTS.includes(req.params.joint as (typeof INJURY_JOINTS)[number])) {
        return reply.code(400).send({ error: 'unknown_joint' });
      }
      const parsed = UserInjuryPatchRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'invalid_payload',
          field_error: zodToFieldError(parsed.error),
        });
      }
      const userId = req.userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });

      const fields: string[] = [];
      const values: unknown[] = [userId, req.params.joint];
      let i = 3;
      for (const k of ['severity', 'notes', 'onset_at'] as const) {
        if (parsed.data[k] !== undefined) {
          fields.push(`${k} = $${i++}`);
          values.push(parsed.data[k]);
        }
      }
      if (!fields.length) return reply.code(400).send({ error: 'empty_patch' });

      const { rows: [row] } = await db.query<{
        joint: string;
        severity: string;
        notes: string;
        onset_at: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `UPDATE user_injuries SET ${fields.join(', ')}, updated_at = now()
         WHERE user_id = $1 AND joint = $2
         RETURNING joint, severity, notes,
                   to_char(onset_at, 'YYYY-MM-DD') AS onset_at,
                   created_at, updated_at`,
        values,
      );
      if (!row) return reply.code(404).send({ error: 'not_found' });

      const injury: UserInjuryItem = {
        joint: row.joint as UserInjuryItem['joint'],
        severity: row.severity as UserInjuryItem['severity'],
        notes: row.notes,
        onset_at: row.onset_at,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      };
      return reply.send({ injury });
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/user/injuries/:joint — idempotent removal.
  //
  // Contract:
  //   - 204 on successful delete (row existed and is now gone).
  //   - 204 on missing row (idempotent — caller intent is "ensure this joint
  //     has no injury record"; if it already doesn't, that's success).
  //   - 400 on unknown :joint path param — same envelope as PATCH.
  //   - 500 on missing req.userId (FIX-29 middleware-contract guard).
  //
  // DELETE intentionally does NOT distinguish "row existed" from "row didn't"
  // — surfacing that would let an unauthenticated probe enumerate which joints
  // a user has injured (timing aside, even response-code variance is signal).
  // -------------------------------------------------------------------------
  app.delete<{ Params: { joint: string } }>(
    '/user/injuries/:joint',
    { preHandler: [requireBearerOrCfAccess, requireScope('health:injuries:write')] },
    async (req, reply) => {
      if (!INJURY_JOINTS.includes(req.params.joint as (typeof INJURY_JOINTS)[number])) {
        return reply.code(400).send({ error: 'unknown_joint' });
      }
      const userId = req.userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });
      await db.query(
        `DELETE FROM user_injuries WHERE user_id=$1 AND joint=$2`,
        [userId, req.params.joint],
      );
      return reply.code(204).send();
    },
  );
}
