// Feedback triage — outbound mail.
//
// Distinct from INVITE_FROM_EMAIL so the two streams can be filtered apart,
// with Reply-To pointing at a human because inbound email is a non-goal: a
// reply must reach a person, not a mailbox nobody reads.
//
// Every constraint from inviteMailer.ts applies and is repeated here rather
// than shared, because the two messages have different lifecycles and coupling
// them would make a change to one silently alter the other.

export const FEEDBACK_REPLY_TO = 'jason@jpmtech.com';
export const APP_URL = 'https://repos.jpmtech.com';

const DEFAULT_TIMEOUT_MS = 10_000;

export type EmailKind = 'ack' | 'resolved' | 'reply';

export type FeedbackMailerErrorCode =
  | 'mail_not_configured'
  | 'mail_http_error'
  | 'mail_timeout'
  | 'mail_request_invalid';

export class MailerError extends Error {
  readonly code: FeedbackMailerErrorCode;
  readonly detail?: string;
  /** Present for HTTP failures; drives the retry/dead-letter classification. */
  readonly status?: number;
  constructor(code: FeedbackMailerErrorCode, message: string, detail?: string, status?: number) {
    super(message);
    this.name = 'MailerError';
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

let mailFetch: typeof fetch | null = null;
export function __setMailFetchForTesting(f: typeof fetch | null): void {
  mailFetch = f;
}

/**
 * Deterministic and stable across retries, so a transport timeout that is
 * replayed cannot double-send inside Resend's 24-hour window. Well inside the
 * 1-256 character limit.
 */
export function idempotencyKeyFor(kind: EmailKind, feedbackId: string): string {
  return `fb-${kind}-${feedbackId}`;
}

/**
 * Agent-authored prose lands inside markup, and it is written downstream of a
 * feedback body an attacker controls. The agent writes words; it does not write
 * markup. The text part needs no equivalent.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface FeedbackRequest {
  from: string;
  to: string[];
  reply_to: string;
  subject: string;
  html: string;
  text: string;
}

export interface CopyInput {
  kind: EmailKind;
  toEmail: string;
  feedbackId: string;
  /** The agent's prose. Plain text; never markup. */
  bodyText: string;
}

const SUBJECTS: Record<EmailKind, string> = {
  ack: 'RepOS — we got your feedback',
  resolved: 'RepOS — the thing you reported is fixed',
  reply: 'RepOS — about your feedback',
};

export function fromAddress(): string {
  const from = process.env.FEEDBACK_FROM_EMAIL;
  if (!from) {
    // Use time, never boot — matching inviteMailer.ts and the feedback webhook.
    throw new MailerError(
      'mail_not_configured',
      'FEEDBACK_FROM_EMAIL must be set to send feedback mail',
    );
  }
  return from;
}

/**
 * Gmail strips @font-face, so the brand typefaces cannot be relied on:
 * system-font stack, inline CSS, table layout, brand palette.
 *
 * Deliberately contains no timestamp and no random id — the rendered bytes are
 * frozen and replayed verbatim, so anything time-varying would make a replay a
 * different request under the same idempotency key.
 */
function renderHtml(input: CopyInput): string {
  const body = escapeHtml(input.bodyText).replace(/\n/g, '<br>');
  return [
    '<!doctype html><html><body style="margin:0;padding:0;background:#0A0D12;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"',
    ' style="background:#0A0D12;padding:24px 0;"><tr><td align="center">',
    '<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"',
    ' style="background:#10141C;border-radius:12px;padding:32px;',
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;",
    'color:#E6EAF2;font-size:15px;line-height:1.55;">',
    '<tr><td>',
    `<div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#4D8DFF;">RepOS</div>`,
    `<p style="margin:16px 0 0;">${body}</p>`,
    `<p style="margin:24px 0 0;"><a href="${APP_URL}" style="color:#4D8DFF;">Open RepOS</a></p>`,
    `<p style="margin:24px 0 0;font-size:13px;color:#8A93A6;">`,
    `Reply to this email and it reaches a person.`,
    '</p>',
    '</td></tr></table></td></tr></table></body></html>',
  ].join('');
}

function renderText(input: CopyInput): string {
  return [
    input.bodyText,
    '',
    `Open RepOS: ${APP_URL}`,
    '',
    'Reply to this email and it reaches a person.',
  ].join('\n');
}

export function buildFeedbackRequest(input: CopyInput): FeedbackRequest {
  const from = fromAddress();
  return {
    from,
    to: [input.toEmail],
    reply_to: FEEDBACK_REPLY_TO,
    subject: SUBJECTS[input.kind],
    html: renderHtml(input),
    text: renderText(input),
  };
}

/**
 * Key order is fixed by hand. Postgres does not preserve JSONB key order, and a
 * replay reconstructed from a round-trip would otherwise stringify differently
 * and be treated by Resend as a new request under the same key.
 */
export function serializeFeedbackRequest(request: FeedbackRequest): string {
  return JSON.stringify({
    from: request.from,
    to: request.to,
    reply_to: request.reply_to,
    subject: request.subject,
    html: request.html,
    text: request.text,
  });
}

/**
 * A persisted request has round-tripped through storage and is untrusted by the
 * time it comes back. Validate, never default: sending a half-shaped body under
 * the original key is how a "replay" quietly becomes a different request.
 *
 * The recipient, the sender, and reply_to are the fields where being wrong is
 * actively harmful, so all three are checked against values derived outside
 * the row rather than merely required to be non-empty. A reply to a tampered
 * row must reach a human at jpmtech, not whatever address the row now holds.
 */
export function assertFeedbackRequest(
  r: unknown,
  expectedTo: string,
  expectedFrom: string,
): asserts r is FeedbackRequest {
  const o = r as Record<string, unknown> | null;
  const str = (v: unknown) => typeof v === 'string' && v !== '';
  if (o === null || typeof o !== 'object' || Array.isArray(o)) {
    throw new MailerError('mail_request_invalid', 'stored request is not an object');
  }
  if (!Array.isArray(o.to) || o.to.length !== 1 || o.to[0] !== expectedTo) {
    throw new MailerError(
      'mail_request_invalid',
      `stored request recipient is not the lifecycle target (${expectedTo})`,
    );
  }
  if (o.from !== expectedFrom) {
    throw new MailerError(
      'mail_request_invalid',
      'stored request sender is not FEEDBACK_FROM_EMAIL',
    );
  }
  if (o.reply_to !== FEEDBACK_REPLY_TO) {
    throw new MailerError(
      'mail_request_invalid',
      'stored request reply_to is not FEEDBACK_REPLY_TO',
    );
  }
  for (const field of ['subject', 'html', 'text'] as const) {
    if (!str(o[field])) {
      throw new MailerError('mail_request_invalid', `stored request ${field} is missing or empty`);
    }
  }
}

export function parseFeedbackRequest(
  stored: string,
  expectedTo: string,
  expectedFrom: string,
): FeedbackRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch (err) {
    throw new MailerError('mail_request_invalid', 'stored request is not valid JSON', String(err));
  }
  assertFeedbackRequest(parsed, expectedTo, expectedFrom);
  return parsed;
}

/** POST to Resend. Throws MailerError; the caller classifies it. */
export async function sendFeedbackRequest(
  request: FeedbackRequest,
  idempotencyKey: string,
  expectedTo: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ messageId: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new MailerError(
      'mail_not_configured',
      'RESEND_API_KEY must be set to send feedback mail',
    );
  }
  assertFeedbackRequest(request, expectedTo, fromAddress());

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await (mailFetch ?? fetch)('https://api.resend.com/emails', {
        method: 'POST',
        signal: ac.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: serializeFeedbackRequest(request),
      });
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        throw new MailerError('mail_timeout', `Resend send timed out after ${timeoutMs}ms`);
      }
      throw new MailerError('mail_http_error', 'Resend send failed', String(err));
    }

    // The deadline covers the body too: a stalled body would otherwise hold the
    // feedback lock open indefinitely.
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
        res.status,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new MailerError(
        'mail_http_error',
        'Resend returned unparseable JSON',
        text.slice(0, 300),
      );
    }
    const id = (parsed as { id?: unknown }).id;
    if (typeof id !== 'string' || id === '') {
      throw new MailerError('mail_http_error', 'Resend response had no message id');
    }
    return { messageId: id };
  } finally {
    clearTimeout(timer);
  }
}
