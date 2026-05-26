// api/src/routes/account.ts
//
// Beta W6 Task 7 — account-ops route plugin.
//
// Endpoints:
//   PATCH  /api/me/profile        — partial profile update (display_name, timezone)
//   GET    /api/account/sessions  — list non-revoked bearer tokens
//   GET    /api/account/events    — keyset-paginated audit feed
//   DELETE /api/me                — stub (405) until Task 9 wires the real handler
//
// Auth: requireBearerOrCfAccess populates req.userId for both the bearer and
// CF Access paths. user_email is NOT on req for the bearer path (the bearer
// middleware only sets userId/tokenScopes), so PATCH /me/profile fetches it
// alongside the before-state SELECT and feeds it to recordAccountEvent.
//
// CSRF: csrfOrigin is attached to mutating routes (PATCH profile, DELETE /me
// stub) so the contract holds when the CF Access cookie path eventually
// reaches them. The bearer path no-ops through csrfOrigin (authMode !=
// 'cf_access') — same convention as middleware/csrfOrigin.ts.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess, requireCfAccessOnly } from '../middleware/cfAccess.js';
import { csrfOrigin } from '../middleware/csrfOrigin.js';
import {
  recordAccountEvent,
  listAccountEvents,
} from '../services/accountEvents.js';
import {
  ProfilePatchRequestSchema,
  SessionListResponseSchema,
  AccountEventListResponseSchema,
  DeleteMeRequestSchema,
  CONFIRM_DELETE_ACCOUNT_PHRASE,
} from '../schemas/account.js';
import { IANA_TIMEZONES } from '../lib/timezones.js'; // static fallback per I-IANA-TIMEZONES

const VALID_TZ = new Set(IANA_TIMEZONES);

// Truncate an IPv4 to /24 for display (per I-LAST-IP-TRUNCATE). Returns null on
// null input. IPv6 is returned unmodified (we can revisit if cohort crosses
// into IPv6 territory).
export function truncateIpTo24(ip: string | null): string | null {
  if (!ip) return null;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return ip; // not IPv4 → leave it alone (IPv6 case)
  return `${m[1]}.${m[2]}.${m[3]}.0/24`;
}

// userEmail isn't typed on FastifyRequest (CF Access path sets it as a
// non-typed cast; bearer path doesn't set it at all). Centralize the cast so
// callers don't pepper `as { userEmail?: string }` through the file.
function getUserEmail(req: FastifyRequest): string | undefined {
  return (req as { userEmail?: string }).userEmail;
}

export async function accountRoutes(app: FastifyInstance) {
  // PATCH /api/me/profile — partial update of editable profile fields.
  // Identity from req.userId (set by requireBearerOrCfAccess); body cannot
  // override. Per memory feedback_user_reachability_dod.md the route is the
  // server side of the AccountProfileEditor surface — the matched UI lands
  // in Task 13. csrfOrigin guard enforces Origin/X-RepOS-CSRF on CF-Access
  // cookie path (per C-CSRF-ORIGIN).
  app.patch(
    '/me/profile',
    { preHandler: [requireBearerOrCfAccess, csrfOrigin] },
    async (req, reply) => {
      const userId = req.userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });

      const parsed = ProfilePatchRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'invalid_body', issues: parsed.error.issues });
      }

      if (parsed.data.timezone && !VALID_TZ.has(parsed.data.timezone)) {
        return reply
          .code(400)
          .send({ error: 'invalid_timezone', timezone: parsed.data.timezone });
      }

      // Read before-state for idempotency check + redacted audit meta. We
      // also pull email here so recordAccountEvent has it without a second
      // round-trip (bearer middleware doesn't populate req.userEmail).
      const before = await db.query<{
        email: string;
        display_name: string | null;
        timezone: string;
      }>(
        `SELECT email, display_name, timezone FROM users WHERE id=$1`,
        [userId],
      );
      if (before.rows.length === 0) {
        return reply.code(500).send({ error: 'auth_state_missing' });
      }
      const userEmail = getUserEmail(req) ?? before.rows[0].email;

      // Compute the actual changes (idempotency, per I-PROFILE-IDEMPOTENCY-TEST).
      // If nothing actually changes, skip the UPDATE + skip the audit event.
      const changedFields: string[] = [];
      const sets: string[] = [];
      const vals: unknown[] = [];
      if (
        parsed.data.display_name !== undefined &&
        parsed.data.display_name !== before.rows[0].display_name
      ) {
        sets.push(`display_name=$${sets.length + 2}`);
        vals.push(parsed.data.display_name);
        changedFields.push('display_name');
      }
      if (
        parsed.data.timezone !== undefined &&
        parsed.data.timezone !== before.rows[0].timezone
      ) {
        sets.push(`timezone=$${sets.length + 2}`);
        vals.push(parsed.data.timezone);
        changedFields.push('timezone');
      }

      if (sets.length === 0) {
        // No-op: re-fetch current row, return 200, no audit event.
        const { rows } = await db.query<{
          id: string;
          email: string;
          display_name: string | null;
          timezone: string;
        }>(
          `SELECT id::text, email, display_name, timezone FROM users WHERE id=$1`,
          [userId],
        );
        return reply.code(200).send(rows[0]);
      }

      const { rows } = await db.query<{
        id: string;
        email: string;
        display_name: string | null;
        timezone: string;
      }>(
        `UPDATE users SET ${sets.join(', ')} WHERE id=$1 RETURNING id::text, email, display_name, timezone`,
        [userId, ...vals],
      );

      // Redacted meta (per I-ACCOUNT-EVENTS-META) — we record WHICH fields
      // changed, not the prior PII values. The new values live in the users
      // row (current state) and can be reconstructed from there if needed.
      await recordAccountEvent({
        userId,
        userEmail,
        kind: 'profile_changed',
        ip: req.ip,
        meta: { fields: changedFields, changed: true },
      });
      return reply.code(200).send(rows[0]);
    },
  );

  // GET /api/account/sessions — list of the user's non-revoked device_tokens.
  // IP truncated to /24 per I-LAST-IP-TRUNCATE.
  app.get(
    '/account/sessions',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      const userId = req.userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });
      const { rows } = await db.query<{
        id: string;
        label: string | null;
        created_at: Date;
        last_used_at: Date | null;
        last_used_ip: string | null;
      }>(
        `SELECT id::text, label, created_at, last_used_at, last_used_ip
           FROM device_tokens
          WHERE user_id=$1 AND revoked_at IS NULL
          ORDER BY created_at DESC`,
        [userId],
      );
      const resp = SessionListResponseSchema.parse({
        sessions: rows.map((r) => ({
          id: r.id,
          label: r.label,
          created_at:
            r.created_at instanceof Date
              ? r.created_at.toISOString()
              : String(r.created_at),
          last_used_at:
            r.last_used_at instanceof Date
              ? r.last_used_at.toISOString()
              : (r.last_used_at ?? null),
          last_used_ip_24: truncateIpTo24(r.last_used_ip),
        })),
      });
      return reply.send(resp);
    },
  );

  // GET /api/account/events — keyset-paginated audit feed (per I-PAGINATION-KEYSET).
  app.get<{
    Querystring: { before_ts?: string; before_id?: string; limit?: string };
  }>(
    '/account/events',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      const userId = req.userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });
      const beforeTs = req.query.before_ts
        ? new Date(req.query.before_ts)
        : undefined;
      const beforeId = req.query.before_id;
      const limit = req.query.limit
        ? Math.min(parseInt(req.query.limit, 10), 200)
        : 50;
      const rows = await listAccountEvents(userId, {
        beforeTs,
        beforeId,
        limit,
      });
      const last = rows[rows.length - 1];
      const nextCursor =
        rows.length === limit && last
          ? { before_ts: last.occurred_at.toISOString(), before_id: last.id }
          : null;
      const resp = AccountEventListResponseSchema.parse({
        events: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          ip: r.ip,
          user_email_at_event: r.user_email_at_event,
          meta: r.meta,
          occurred_at: r.occurred_at.toISOString(),
        })),
        next_cursor: nextCursor,
      });
      return reply.send(resp);
    },
  );

  // DELETE /api/account/sessions/:id — revoke a single bearer token (Task 14).
  //
  // Per I-CONTAM-MATRIX option (a): shipped alongside GET /account/sessions so
  // the "here are your sessions" surface has a matching action affordance. The
  // WHERE clause pins user_id=$1 (identity from req.userId) — that's the
  // contamination guard: user-A can never revoke user-B's token (rowCount=0 →
  // 404, never 204). Covered by account-sessions-delete-contamination.test.ts.
  //
  // Auth: requireBearerOrCfAccess (a user must be able to revoke their own
  // sessions from either the bearer or the cookie path — unlike DELETE /me,
  // which is CF-Access-only). csrfOrigin guards the CF-Access cookie path.
  //
  // userEmail: bearer auth populates req.userId but NOT req.userEmail (see
  // middleware/cfAccess.ts requireAuth) — mirror the PATCH /me/profile fallback
  // and re-read email from users when req.userEmail is undefined so the audit
  // event always has the actor's email.
  app.delete<{ Params: { id: string } }>(
    '/account/sessions/:id',
    { preHandler: [requireBearerOrCfAccess, csrfOrigin] },
    async (req, reply) => {
      const userId = req.userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });

      const { rowCount } = await db.query(
        `UPDATE device_tokens
            SET revoked_at = now(), revoke_reason = 'user_revoked'
          WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [req.params.id, userId],
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'session_not_found' });

      // Re-read email if the bearer path didn't plumb it through.
      let userEmail = getUserEmail(req);
      if (!userEmail) {
        const { rows } = await db.query<{ email: string }>(
          `SELECT email FROM users WHERE id=$1`,
          [userId],
        );
        if (rows.length === 0) {
          return reply.code(500).send({ error: 'auth_state_missing' });
        }
        userEmail = rows[0].email;
      }

      await recordAccountEvent({
        userId,
        userEmail,
        kind: 'token_revoked',
        ip: req.ip,
        meta: { token_id: req.params.id },
      });
      return reply.code(204).send();
    },
  );

  // DELETE /api/me — full-cascade account deletion (Task 9).
  //
  // Auth: CF-Access-JWT-only (per C-SIGNOUT-CFACCESS-ONLY) — a stolen bearer
  // must NEVER be able to delete a user's account. requireCfAccessOnly 403s
  // any Authorization: Bearer header before JWT validation and stamps
  // authMode='cf_access' so the chained csrfOrigin guard runs.
  //
  // Body: { confirm: "DELETE my account" } — exact-match typed-confirm phrase
  // (per I-CONFIRM-PHRASE-CONST) so a misclicked DELETE without the dialog
  // never lands.
  //
  // Cascade: DB-level ON DELETE CASCADE on users.id (per D8 + the migration
  // FK shapes — every per-user table FKs back to users with CASCADE) does the
  // wipe. account_events FK is ON DELETE SET NULL with user_id_at_event +
  // user_email_at_event preserved — forensic survival.
  //
  // Atomicity: single BEGIN/COMMIT against a pooled client. ROLLBACK + 500
  // on any error inside the txn. The structured log fires AFTER the COMMIT
  // (per I-DELETE-COMPLETED) — never claim deleted on a half-committed state.
  app.delete(
    '/me',
    { preHandler: [requireCfAccessOnly, csrfOrigin] },
    async (req, reply) => {
      const userId = (req as { userId?: string }).userId;
      const userEmail = (req as { userEmail?: string }).userEmail;
      if (!userId || !userEmail) return reply.code(500).send({ error: 'auth_state_missing' });

      const parsed = DeleteMeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'invalid_confirm', expected: CONFIRM_DELETE_ACCOUNT_PHRASE });
      }

      const { rows: tokRows } = await db.query<{ n: number }>(
        `SELECT count(*)::int n FROM device_tokens WHERE user_id=$1`,
        [userId],
      );
      const previousTokenCount = tokRows[0]?.n ?? 0;

      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM users WHERE id=$1', [userId]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        req.log.error({ err, userId }, 'account_delete_failed');
        return reply.code(500).send({ error: 'delete_failed' });
      } finally {
        client.release();
      }

      req.log.info(
        {
          event: 'account_deleted',
          userId,
          userEmail,
          previous_token_count: previousTokenCount,
          ip: req.ip,
        },
        'account_deleted',
      );

      reply.header(
        'Set-Cookie',
        'CF_Authorization=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
      );
      return reply.code(204).send();
    },
  );
}
