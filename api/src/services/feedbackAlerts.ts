// Feedback triage — active alerting.
//
// Dead letters and auth pauses must ANNOUNCE themselves. A `list
// --dead-lettered` that nobody opens is a silent failure with extra steps.
//
// This reuses FEEDBACK_WEBHOOK_URL — already configured in production and
// already restricted to discord.com by validateFeedbackWebhookUrl (the
// 2026-09-04 hardening) — rather than introducing a second destination.
import { validateFeedbackWebhookUrl } from '../lib/feedbackWebhook.js';

const TIMEOUT_MS = 5_000;
/** Discord rejects content over 2000 characters. */
const MAX_CONTENT = 1_900;

let alertFetch: typeof fetch | null = null;
export function __setAlertFetchForTesting(f: typeof fetch | null): void {
  alertFetch = f;
}

/**
 * Called at sweep start. If alerting is not configured the run should say so
 * loudly rather than proceed and degrade to silence — an unmonitored dead
 * letter is exactly the outcome this design set out to avoid.
 */
export function assertAlertingConfigured(): void {
  const url = process.env.FEEDBACK_WEBHOOK_URL;
  if (!url) {
    throw new Error(
      'FEEDBACK_WEBHOOK_URL must be set: dead letters and auth pauses would otherwise be silent',
    );
  }
  validateFeedbackWebhookUrl(url);
}

/** Advisory: a failed alert must never fail the operation it is reporting on. */
async function post(content: string): Promise<void> {
  const raw = process.env.FEEDBACK_WEBHOOK_URL;
  if (!raw) return;
  let url: string;
  try {
    url = validateFeedbackWebhookUrl(raw);
  } catch {
    return;
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    await (alertFetch ?? fetch)(url, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, MAX_CONTENT) }),
    });
  } catch {
    /* advisory */
  } finally {
    clearTimeout(timer);
  }
}

export async function alertDeadLetter(input: {
  feedbackId: string;
  kind: string;
  recipient: string;
  error: string | null;
}): Promise<void> {
  await post(
    [
      `**Feedback email abandoned** — feedback ${input.feedbackId}, kind \`${input.kind}\`.`,
      `Nobody replied to ${input.recipient}.`,
      input.error ? `Reason: ${input.error.slice(0, 400)}` : 'Reason: unrecorded.',
      'Run `feedback-triage list --dead-lettered` for the full set.',
    ].join('\n'),
  );
}

export async function alertSendingPaused(input: { reason: string }): Promise<void> {
  await post(
    [
      '**Feedback mail is paused** — the provider rejected our credentials.',
      `Reason: ${input.reason.slice(0, 400)}`,
      'Nothing was abandoned; the queue drains once the key is fixed.',
    ].join('\n'),
  );
}
