// api/src/routes/parQ.ts
// Beta W2.3 — PAR-Q-lite acknowledgment routes.
// GET returns current vs acknowledged version + question list + advisory_active.
// POST atomically upserts the user's row + per-version audit row + advisory
// flag + Q5 joint-follow-up user_injuries rows + account_events emission.
//
// Mount path: /api/me/par-q (panel C-MOUNT-PATH; the existing whoami is at
// /api/me, this route prefix is /api).
//
// Scope: gated on account:write (panel C-SCOPE). Default-minted bearer
// tokens lack it; CF Access browser path bypasses scope checks.
//
// Atomic-upsert with is_new returning (panel I-UPSERT): INSERT ON CONFLICT
// RETURNING (accepted_at = now()) AS is_new tells us 201 vs 200 — the
// DO UPDATE clause deliberately does NOT touch accepted_at, so a re-accept
// keeps the original timestamp and the predicate is false (→ 200).
//
// Per-user rate-limit (panel I-RATE-LIMIT): nginx zone uses binary_remote_addr
// but CF Tunnel collapses all egress to one IP. parQRateLimit.ts checks
// per-user write count over 24h; >5 → 429.
import type { FastifyInstance } from 'fastify';
import { requireUserId } from '../utils/requestIdentity.js';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { requireScope } from '../middleware/scope.js';
import {
  PAR_Q_VERSION,
  PAR_Q_QUESTIONS,
  PAR_Q_Q5_INDEX,
  PAR_Q_Q5_INJURY_JOINTS,
} from '../constants/parQ.js';
import {
  ParQAcceptRequestSchema,
  type ParQStatusResponse,
  type ParQAcceptResponse,
} from '../schemas/parQ.js';
import { zodToFieldError } from '../utils/zodToFieldError.js';
import { checkParQWriteRateLimit, recordParQWrite } from '../services/parQRateLimit.js';
import { recordAccountEventTx } from '../services/accountEvents.js';
import { clientIp } from '../utils/clientIp.js';

export async function parQRoutes(app: FastifyInstance) {
  app.get('/me/par-q', { preHandler: requireBearerOrCfAccess }, async (req, _reply) => {
    const userId = requireUserId(req);
    const {
      rows: [u],
    } = await db.query<{ par_q_version: number; par_q_advisory_active: boolean }>(
      'SELECT par_q_version, par_q_advisory_active FROM users WHERE id = $1',
      [userId],
    );
    const acknowledged = u?.par_q_version ?? 0;
    const resp: ParQStatusResponse = {
      current_version: PAR_Q_VERSION,
      acknowledged_version: acknowledged,
      needs_prompt: acknowledged < PAR_Q_VERSION,
      questions: [...PAR_Q_QUESTIONS],
      advisory_active: u?.par_q_advisory_active ?? false,
    };
    return resp;
  });

  app.post(
    '/me/par-q',
    { preHandler: [requireBearerOrCfAccess, requireScope('account:write')] },
    async (req, reply) => {
      const userId = requireUserId(req);
      const ip = clientIp(req) ?? '';

      const parsed = ParQAcceptRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return zodToFieldError(parsed.error);
      }
      if (parsed.data.version !== PAR_Q_VERSION) {
        reply.code(409);
        return { error: 'par_q_version_mismatch', current_version: PAR_Q_VERSION };
      }

      // Q5 follow-up consistency: joints allowed only when Q5='yes'.
      const q5Yes = parsed.data.answers[PAR_Q_Q5_INDEX] === true;
      const q5Joints = q5Yes ? parsed.data.q5_joints : [];
      if (!q5Yes && parsed.data.q5_joints.length > 0) {
        reply.code(400);
        return { error: 'q5_joints_provided_but_q5_no' };
      }

      // Per-user rate limit (5 writes / 24h).
      const allowed = await checkParQWriteRateLimit(userId);
      if (!allowed) {
        reply.code(429);
        return { error: 'par_q_write_rate_limited', limit_per_day: 5 };
      }

      const anyYes = parsed.data.answers.some((a) => a === true);
      const responses = JSON.stringify({
        questions: PAR_Q_QUESTIONS,
        answers: parsed.data.answers,
      });

      const client = await db.connect();
      try {
        await client.query('BEGIN');

        // Atomic upsert with is_new returning (panel I-UPSERT). DO UPDATE does
        // NOT touch accepted_at so re-accept keeps the original timestamp and
        // is_new is false.
        const {
          rows: [ack],
        } = await client.query<{ is_new: boolean }>(
          `INSERT INTO par_q_acknowledgments (user_id, version, responses, ip)
           VALUES ($1, $2, $3::jsonb, $4)
           ON CONFLICT (user_id, version) DO UPDATE
             SET responses = EXCLUDED.responses,
                 ip        = COALESCE(par_q_acknowledgments.ip, EXCLUDED.ip)
           RETURNING (accepted_at = now()) AS is_new`,
          [userId, parsed.data.version, responses, ip || null],
        );

        // Users row update. COALESCE on acknowledged_at = first-write-wins
        // for the audit timestamp (panel C-COALESCE). par_q_version bumps
        // forward-only via GREATEST. advisory_active is set true when
        // any_yes; it can be cleared only via /me/par-q/mark-cleared.
        // email is returned so the account-event audit row carries it (the
        // bearer auth path does NOT populate req.userEmail).
        const { rows: userRows } = await client.query<{ email: string }>(
          `UPDATE users
              SET par_q_version          = GREATEST(par_q_version, $2),
                  par_q_acknowledged_at  = COALESCE(par_q_acknowledged_at, now()),
                  par_q_advisory_active  = CASE WHEN $3::boolean THEN true ELSE par_q_advisory_active END
            WHERE id = $1
            RETURNING email`,
          [userId, parsed.data.version, anyYes],
        );

        // Auth-state check (panel I-AUTH-MISSING): if UPDATE returned no
        // rows the bearer points at a deleted user. Don't access undefined.
        if (userRows.length === 0) {
          await client.query('ROLLBACK');
          reply.code(500);
          return { error: 'auth_state_missing' };
        }
        const userEmail = userRows[0].email;

        // Q5 follow-up: write user_injuries rows in the same transaction.
        // 'other' is offered in the UI but filtered out here because the W3
        // user_injuries.joint CHECK (migration 032) has no 'other' value and
        // the injuryRanker JOINT_ROOT has no mapping for it. We still record
        // the full q5_joints (incl. 'other') in the account_events meta below.
        let injuriesCreated = 0;
        const writableJoints = q5Joints.filter((j): j is (typeof PAR_Q_Q5_INJURY_JOINTS)[number] =>
          (PAR_Q_Q5_INJURY_JOINTS as readonly string[]).includes(j),
        );
        if (writableJoints.length > 0) {
          // De-dup against existing rows. Per QA: do not stack identical
          // par_q-sourced rows across re-acceptance of the same version.
          const { rows: existing } = await client.query<{ joint: string }>(
            `SELECT joint FROM user_injuries WHERE user_id = $1`,
            [userId],
          );
          const have = new Set(existing.map((r) => r.joint));
          for (const joint of writableJoints) {
            if (have.has(joint)) continue;
            await client.query(
              `INSERT INTO user_injuries
                 (user_id, joint, severity, notes, source)
               VALUES ($1, $2, 'mod', $3, $4)`,
              [
                userId,
                joint,
                `From PAR-Q v${PAR_Q_VERSION} self-report`,
                `par_q_v${PAR_Q_VERSION}`,
              ],
            );
            injuriesCreated++;
          }
        }

        // Per-user rate-limit audit row.
        await recordParQWrite(client, userId);

        // Account event emission (panel D8). W6 owns the table + the
        // 'par_q_acknowledged' enum value (already merged), so we emit
        // directly in-transaction via recordAccountEventTx.
        await recordAccountEventTx(client, {
          userId,
          userEmail,
          kind: 'par_q_acknowledged',
          ip: ip || null,
          meta: {
            version: parsed.data.version,
            any_yes: anyYes,
            q5_joints: q5Joints,
          },
        });

        await client.query('COMMIT');

        reply.code(ack.is_new ? 201 : 200);
        const resp: ParQAcceptResponse = {
          version: parsed.data.version,
          accepted_at: new Date().toISOString(),
          any_yes: anyYes,
          advisory_active: anyYes, // mirrors the UPDATE above
          injuries_created: injuriesCreated,
        };
        return resp;
      } catch (e) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw e;
      } finally {
        client.release();
      }
    },
  );

  // Settings → Health "Mark cleared" affordance (user decision D2).
  // Clears par_q_advisory_active. Does NOT bump par_q_version.
  app.post(
    '/me/par-q/mark-cleared',
    { preHandler: [requireBearerOrCfAccess, requireScope('account:write')] },
    async (req, reply) => {
      const userId = requireUserId(req);
      const { rows } = await db.query(
        `UPDATE users SET par_q_advisory_active = false WHERE id = $1 RETURNING id`,
        [userId],
      );
      if (rows.length === 0) {
        reply.code(500);
        return { error: 'auth_state_missing' };
      }
      return { advisory_active: false };
    },
  );
}
