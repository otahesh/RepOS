// Beta W7 — Discord-compatible webhook delivery for feedback rows.
// No new dependency: native fetch (Node >=18). Delivery is ADVISORY — the POST
// /api/feedback handler fires it without awaiting and never fails the user
// submit on a webhook error (per CLAUDE.md: webhook is a notification, not the
// source of truth).

export interface FeedbackRow {
  id: string;
  body: string;
  route: string | null;
  app_sha: string | null;
  user_email_at_submit: string | null;
}

export interface DiscordWebhookPayload {
  content: string;
  embeds: Array<{
    title: string;
    description: string;
    fields: Array<{ name: string; value: string; inline?: boolean }>;
  }>;
}

export function buildDiscordPayload(row: FeedbackRow): DiscordWebhookPayload {
  return {
    content: 'New RepOS feedback',
    embeds: [
      {
        title: `Feedback #${row.id}`,
        // Discord embed description max is 4096; body is already capped at 4000.
        description: row.body.slice(0, 4000),
        fields: [
          { name: 'From', value: row.user_email_at_submit ?? 'unknown', inline: true },
          { name: 'Route', value: row.route ?? '—', inline: true },
          { name: 'Build', value: row.app_sha ?? 'dev', inline: true },
        ],
      },
    ],
  };
}

type FetchImpl = typeof fetch;

export interface PostOpts {
  fetchImpl?: FetchImpl;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Retries on network error / 429 / 5xx with capped exponential backoff (per
// CLAUDE.md API-reliability). Gives up immediately on a non-429 4xx (a bad
// payload won't fix itself). Returns the final outcome + attempt count.
export async function postWithRetry(
  url: string,
  payload: DiscordWebhookPayload,
  opts: PostOpts = {},
): Promise<{ ok: boolean; attempts: number }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxAttempts = opts.maxAttempts ?? 3;
  const sleep = opts.sleep ?? defaultSleep;
  const timeoutMs = opts.timeoutMs ?? 5000;
  let attempts = 0;

  for (let i = 0; i < maxAttempts; i++) {
    attempts++;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
        if (res.ok) return { ok: true, attempts };
        if (res.status !== 429 && res.status < 500) return { ok: false, attempts };
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // network error / abort — fall through to retry
    }
    if (i < maxAttempts - 1) await sleep(250 * 2 ** i);
  }
  return { ok: false, attempts };
}
