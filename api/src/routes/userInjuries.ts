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
  UserInjuryListResponseSchema,
  type UserInjuryListResponse,
} from '../schemas/userInjuries.js';

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
}
