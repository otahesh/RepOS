import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  alertDeadLetter,
  alertSendingPaused,
  assertAlertingConfigured,
  __setAlertFetchForTesting,
} from '../../src/services/feedbackAlerts.js';

const HOOK = 'https://discord.com/api/webhooks/123/abc';

beforeEach(() => {
  process.env.FEEDBACK_WEBHOOK_URL = HOOK;
  __setAlertFetchForTesting(null);
});

describe('assertAlertingConfigured', () => {
  it('throws loudly when the webhook is unset, rather than degrading to silence', () => {
    delete process.env.FEEDBACK_WEBHOOK_URL;
    expect(() => assertAlertingConfigured()).toThrow(/FEEDBACK_WEBHOOK_URL/);
  });

  it('rejects a non-Discord destination', () => {
    process.env.FEEDBACK_WEBHOOK_URL = 'https://evil.example/api/webhooks/1/2';
    expect(() => assertAlertingConfigured()).toThrow(/discord/i);
  });

  it('accepts the configured Discord webhook', () => {
    expect(() => assertAlertingConfigured()).not.toThrow();
  });
});

describe('alertDeadLetter', () => {
  it('posts the feedback id and kind, and never the error body verbatim beyond a cap', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    __setAlertFetchForTesting(
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), body: String(init.body) });
        return new Response('', { status: 204 });
      }) as unknown as typeof fetch,
    );

    await alertDeadLetter({
      feedbackId: '5',
      kind: 'ack',
      recipient: 'sub@example.test',
      error: 'x'.repeat(5000),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(HOOK);
    expect(calls[0].body).toContain('feedback 5');
    expect(calls[0].body).toContain('ack');
    expect(calls[0].body.length).toBeLessThan(2000);
  });

  it('does not throw when the webhook call fails — alerting is advisory', async () => {
    __setAlertFetchForTesting(
      vi.fn(async () => {
        throw new Error('discord down');
      }) as unknown as typeof fetch,
    );
    await expect(
      alertDeadLetter({ feedbackId: '5', kind: 'ack', recipient: 'a@b.test', error: null }),
    ).resolves.toBeUndefined();
  });
});

describe('alertSendingPaused', () => {
  it('names the reason so an expired key is recognisable', async () => {
    const bodies: string[] = [];
    __setAlertFetchForTesting(
      vi.fn(async (_u: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return new Response('', { status: 204 });
      }) as unknown as typeof fetch,
    );
    await alertSendingPaused({ reason: 'Resend returned HTTP 401' });
    expect(bodies[0]).toContain('401');
    expect(bodies[0]).toMatch(/paused/i);
  });
});
