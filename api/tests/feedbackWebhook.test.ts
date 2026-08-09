import { describe, it, expect, vi } from 'vitest';
import { buildDiscordPayload, postWithRetry } from '../src/lib/feedbackWebhook.js';

const ROW = {
  id: '42',
  body: 'rest timer skipped a beep',
  route: '/today/abc/log',
  app_sha: 'deadbee',
  user_email_at_submit: 'tester@repos.test',
};

describe('buildDiscordPayload', () => {
  it('builds a Discord embed with body as description + context fields', () => {
    const p = buildDiscordPayload(ROW);
    expect(p.content).toMatch(/feedback/i);
    expect(p.embeds[0].description).toBe(ROW.body);
    const names = p.embeds[0].fields.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['From', 'Route', 'Build']));
    expect(p.embeds[0].fields.find((f) => f.name === 'From')?.value).toBe('tester@repos.test');
  });

  it('falls back to placeholders for null context', () => {
    const p = buildDiscordPayload({
      ...ROW,
      route: null,
      app_sha: null,
      user_email_at_submit: null,
    });
    expect(p.embeds[0].fields.find((f) => f.name === 'From')?.value).toBe('unknown');
    expect(p.embeds[0].fields.find((f) => f.name === 'Route')?.value).toBe('—');
  });
});

describe('postWithRetry', () => {
  const payload = buildDiscordPayload(ROW);
  const noSleep = () => Promise.resolve();

  it('returns ok on a 2xx first try', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const r = await postWithRetry('http://hook', payload, {
      fetchImpl: fetchImpl as never,
      sleep: noSleep,
    });
    expect(r).toEqual({ ok: true, attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, status: 204 });
    const r = await postWithRetry('http://hook', payload, {
      fetchImpl: fetchImpl as never,
      sleep: noSleep,
    });
    expect(r).toEqual({ ok: true, attempts: 2 });
  });

  it('gives up after maxAttempts on persistent 5xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const r = await postWithRetry('http://hook', payload, {
      fetchImpl: fetchImpl as never,
      sleep: noSleep,
      maxAttempts: 3,
    });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(3);
  });

  it('does NOT retry on a non-429 4xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    const r = await postWithRetry('http://hook', payload, {
      fetchImpl: fetchImpl as never,
      sleep: noSleep,
    });
    expect(r).toEqual({ ok: false, attempts: 1 });
  });
});
