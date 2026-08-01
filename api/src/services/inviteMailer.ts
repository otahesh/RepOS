// W9 — the invite email (Q5, Q30).
//
// Resend, sending from the send.jpmtech.com subdomain: the subdomain keeps
// root-domain SPF/DKIM untouched, so a misconfiguration here cannot break
// Proton-hosted mail on jpmtech.com.
//
// There is NO invite token and no magic link (Q6). The email links to the app;
// authentication is CF Access + Google, authorization is the pre-created row.
// A token would be a second, weaker credential path into the same app.
import { createHash, randomUUID } from 'node:crypto';

export const APP_URL = 'https://repos.jpmtech.com';
/** G14 requires a documented contact path in every Beta user's invite. */
export const SUPPORT_CONTACT = 'jason.meyer1@gmail.com';

const DEFAULT_TIMEOUT_MS = 10_000;

export const INVITE_SUBJECT = 'You have been invited to RepOS (Beta)';

export type MailerErrorCode =
  | 'mail_not_configured'
  | 'mail_http_error'
  | 'mail_timeout'
  /** A persisted request is missing, unparseable, or addressed to the wrong user. */
  | 'mail_request_invalid';

export class MailerError extends Error {
  readonly code: MailerErrorCode;
  readonly detail?: string;
  constructor(code: MailerErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'MailerError';
    this.code = code;
    this.detail = detail;
  }
}

let mailFetch: typeof fetch | null = null;
export function __setMailFetchForTesting(f: typeof fetch | null): void {
  mailFetch = f;
}

/**
 * Q30 — derived from the user id + invited_at, so a transport timeout that is
 * retried cannot double-send.
 */
export function initialIdempotencyKey(userId: string, invitedAt: Date): string {
  return `invite-${createHash('sha256')
    .update(`${userId}:${invitedAt.toISOString()}`)
    .digest('hex')
    .slice(0, 32)}`;
}

/**
 * Q30 — an explicit admin "resend" is a DELIBERATE second delivery, so it must
 * defeat Resend's idempotency window rather than ride it.
 */
export function resendIdempotencyKey(userId: string): string {
  return `resend-${userId}-${randomUUID()}`;
}

export interface InviteCopyInput {
  toEmail: string;
  invitedByEmail: string;
}

// Gmail strips @font-face, so Inter Tight / JetBrains Mono cannot be relied on.
// System-font stack + the brand palette + inline CSS + table layout.
/**
 * Both addresses are admin-supplied and land inside markup. A local part may
 * legally be a quoted string, so `"a<b"@example.test` is a valid address that
 * would otherwise open a tag mid-document — and the same hole lets an admin
 * inject markup into a message delivered to someone else. The text part needs
 * no equivalent.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function renderInviteHtml(input: InviteCopyInput): string {
  const toEmail = escapeHtml(input.toEmail);
  const invitedByEmail = escapeHtml(input.invitedByEmail);
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0A0D12;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0D12;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="max-width:520px;background:#10141C;border-radius:12px;padding:28px;font-family:${FONT_STACK};color:#E6EAF2;">
      <tr><td style="font-size:20px;font-weight:700;padding-bottom:12px;">You're in.</td></tr>
      <tr><td style="font-size:14px;line-height:22px;padding-bottom:16px;">
        <strong>${invitedByEmail}</strong> invited you to RepOS — a training log that tracks your
        lifts, your bodyweight, and whether your program is actually working.
      </td></tr>
      <tr><td style="font-size:13px;line-height:20px;padding-bottom:16px;color:#F5B544;">
        This is a Beta. Expect rough edges, occasional downtime, and changes without notice.
        Your data is backed up nightly, but do not treat it as your only copy.
      </td></tr>
      <tr><td style="font-size:14px;line-height:22px;padding-bottom:16px;">
        <strong>Sign in with the Google account for this exact address</strong> —
        <span style="font-family:monospace;">${toEmail}</span>. Any other address will be turned
        away at the door with no explanation.
      </td></tr>
      <tr><td style="padding-bottom:18px;">
        <a href="${APP_URL}" style="display:inline-block;background:#4D8DFF;color:#0A0D12;
           text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:8px;">
           OPEN REPOS</a>
      </td></tr>
      <tr><td style="font-size:12px;line-height:18px;color:#8A93A6;">
        Link: <a href="${APP_URL}" style="color:#4D8DFF;">${APP_URL}</a><br/>
        Stuck? Reply to this email or write to ${SUPPORT_CONTACT}.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export function renderInviteText({ toEmail, invitedByEmail }: InviteCopyInput): string {
  return [
    "You're in.",
    '',
    `${invitedByEmail} invited you to RepOS — a training log that tracks your lifts,`,
    'your bodyweight, and whether your program is actually working.',
    '',
    'THIS IS A BETA. Expect rough edges, occasional downtime, and changes without',
    'notice. Your data is backed up nightly, but do not treat it as your only copy.',
    '',
    `Sign in with the Google account for this exact address: ${toEmail}`,
    'Any other address will be turned away at the door with no explanation.',
    '',
    `Open RepOS: ${APP_URL}`,
    '',
    `Stuck? Reply to this email or write to ${SUPPORT_CONTACT}.`,
  ].join('\n');
}

/**
 * The exact Resend request body. Q30 requires that a retry after a lost
 * acknowledgement cannot deliver twice, and Resend deduplicates only
 * BYTE-IDENTICAL requests sharing a key — so the request has to be frozen the
 * first time and replayed verbatim, not re-rendered.
 *
 * Re-rendering cannot satisfy Q30: `INVITE_FROM_EMAIL` is read from the
 * environment and the copy ships with the deployment, so either the retry's
 * body drifts (409, invite blocked for 24h) or the key is recomputed to match
 * it (a second delivery — exactly what Q30 forbids). Callers therefore build
 * this once, persist it, and replay it on every attempt.
 */
export interface InviteRequest {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
}

/** Render the request. Call ONCE per invite, persist the result, then replay. */
export function buildInviteRequest(input: InviteCopyInput): InviteRequest {
  const from = process.env.INVITE_FROM_EMAIL;
  if (!from) {
    throw new MailerError(
      'mail_not_configured',
      'INVITE_FROM_EMAIL must be set to build an invite',
    );
  }
  return {
    from: `RepOS <${from}>`,
    to: [input.toEmail],
    subject: INVITE_SUBJECT,
    html: renderInviteHtml(input),
    text: renderInviteText(input),
  };
}

/**
 * The canonical wire form. Byte-identity is the whole point, so the body is
 * serialized in a FIXED field order rather than relying on the object's own
 * key order — which does not survive storage. (PostgreSQL's jsonb sorts keys
 * by length then bytewise: PG16 rewrites {from,to,subject,html,text} as
 * {to,from,html,text,subject}. A replay reconstructed from such a round-trip
 * would stringify differently and Resend would treat it as a new request.)
 */
export function serializeInviteRequest(request: InviteRequest): string {
  return JSON.stringify({
    from: request.from,
    to: request.to,
    subject: request.subject,
    html: request.html,
    text: request.text,
  });
}

/**
 * Validate a persisted request before replaying it. It has round-tripped
 * through storage, so it is untrusted input by the time it comes back:
 * validate, never default — sending a half-shaped body under the original key
 * is how a "replay" quietly becomes a different request.
 *
 * `expectedTo` is required because the recipient is the one field where being
 * wrong is actively harmful: a corrupted or mismatched row must never mail a
 * third party. Exactly one recipient, and it must be the lifecycle target.
 */
export function assertInviteRequest(
  r: unknown,
  expectedTo: string,
): asserts r is InviteRequest {
  const o = r as Record<string, unknown> | null;
  const shaped =
    o !== null && typeof o === 'object' && !Array.isArray(o) &&
    typeof o.from === 'string' && o.from !== '' &&
    typeof o.subject === 'string' && o.subject !== '' &&
    typeof o.html === 'string' && o.html !== '' &&
    typeof o.text === 'string' && o.text !== '' &&
    Array.isArray(o.to);
  if (!shaped) {
    throw new MailerError(
      'mail_request_invalid',
      'the persisted invite request is missing or malformed — refusing to send',
      JSON.stringify(r)?.slice(0, 200),
    );
  }
  const to = o.to as unknown[];
  if (to.length !== 1 || to[0] !== expectedTo) {
    throw new MailerError(
      'mail_request_invalid',
      'the persisted invite request does not address exactly the invited user',
      `expected [${expectedTo}], found ${JSON.stringify(to)?.slice(0, 120)}`,
    );
  }
}

/** Parse a request frozen as TEXT, failing closed on anything unusable. */
export function parseInviteRequest(stored: string, expectedTo: string): InviteRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw new MailerError(
      'mail_request_invalid',
      'the persisted invite request is not valid JSON',
      stored.slice(0, 200),
    );
  }
  assertInviteRequest(parsed, expectedTo);
  return parsed;
}

/**
 * POST a previously built request under `idempotencyKey`. The body is sent
 * verbatim: nothing here reads the environment or the templates, which is what
 * makes a retry byte-identical to the original and lets Resend collapse the
 * two into one delivery (Q30).
 */
export async function sendInviteRequest(
  request: InviteRequest,
  idempotencyKey: string,
  expectedTo: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ messageId: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // Missing credentials fail at USE time with a specific error, never at
    // boot — matching the Healthchecks and feedback-webhook precedent.
    throw new MailerError(
      'mail_not_configured',
      'RESEND_API_KEY must be set to send invites',
    );
  }
  assertInviteRequest(request, expectedTo);

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  // As in cfAccessPolicy.ts, the deadline covers the response BODY too: this
  // call runs inside the membership lock's critical section, so a stalled body
  // would wedge every user-management operation.
  try {
    let res: Response;
    try {
      res = await (mailFetch ?? fetch)('https://api.resend.com/emails', {
        method: 'POST',
        signal: ac.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          // Q30 — transport retry protection, scoped to this exact body.
          'Idempotency-Key': idempotencyKey,
        },
        body: serializeInviteRequest(request),
      });
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        throw new MailerError('mail_timeout', `Resend send timed out after ${timeoutMs}ms`);
      }
      throw new MailerError('mail_http_error', 'Resend send failed', String(err));
    }

    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        throw new MailerError('mail_timeout', `Resend body stalled past ${timeoutMs}ms`);
      }
      throw new MailerError('mail_http_error', 'Resend body read failed', String(err));
    }

    if (!res.ok) {
      throw new MailerError(
        'mail_http_error',
        `Resend returned HTTP ${res.status}`,
        text.slice(0, 300),
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new MailerError('mail_http_error', 'Resend returned non-JSON', text.slice(0, 200));
    }
    // Validate, never default — the same rule cfAccessPolicy.ts learned the
    // hard way. Coercing a malformed 2xx to `messageId: ''` would record the
    // invite as delivered with an empty provider id, destroying the only
    // handle on the actual message; reading `.id` off a bare `null` body would
    // throw a raw TypeError that callers classify as an unknown error rather
    // than a mail failure. Resend documents a non-empty id on every success,
    // so anything else is a refusal.
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      typeof (parsed as { id?: unknown }).id !== 'string' ||
      (parsed as { id: string }).id === ''
    ) {
      throw new MailerError(
        'mail_http_error',
        'Resend returned 2xx without a message id',
        text.slice(0, 200),
      );
    }
    return { messageId: (parsed as { id: string }).id };
  } finally {
    clearTimeout(timer);
  }
}
