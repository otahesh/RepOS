// Q5, Q30, Q38 + the G14 email-content requirements.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildInviteRequest,
  sendInviteRequest,
  renderInviteHtml,
  renderInviteText,
  initialIdempotencyKey,
  resendIdempotencyKey,
  __setMailFetchForTesting,
  APP_URL,
} from '../../src/services/inviteMailer.js';

let calls: Array<{ url: string; init: RequestInit }>;
let respond: () => Promise<Response>;

beforeEach(() => {
  process.env.RESEND_API_KEY = 'test-key';
  process.env.INVITE_FROM_EMAIL = 'repos@send.jpmtech.com';
  calls = [];
  respond = async () =>
    new Response(JSON.stringify({ id: 'msg_123' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  __setMailFetchForTesting(async (input, init = {}) => {
    calls.push({ url: String(input), init });
    // Honour init.signal — a double that ignores it makes the Q38 deadline
    // test pass vacuously (the abort fires, nothing observes it).
    return abortable(respond(), init.signal);
  });
});

/** Reject with an AbortError as soon as `signal` aborts. */
function abortable(p: Promise<Response>, signal?: AbortSignal | null): Promise<Response> {
  if (!signal) return p;
  return Promise.race([
    p,
    new Promise<Response>((_, reject) => {
      const fail = () =>
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
      if (signal.aborted) fail();
      else signal.addEventListener('abort', fail, { once: true });
    }),
  ]);
}

afterEach(() => {
  __setMailFetchForTesting(null);
  delete process.env.RESEND_API_KEY;
  delete process.env.INVITE_FROM_EMAIL;
});

describe('idempotency keys (Q30)', () => {
  it('the initial key is stable for the same user + invited_at', () => {
    const at = new Date('2026-07-26T12:00:00Z');
    const a = initialIdempotencyKey('u1', at);
    const b = initialIdempotencyKey('u1', new Date('2026-07-26T12:00:00Z'));
    expect(a).toBe(b);
  });

  it('a different user or a different invited_at yields a different key', () => {
    const at = new Date('2026-07-26T12:00:00Z');
    expect(initialIdempotencyKey('u1', at)).not.toBe(initialIdempotencyKey('u2', at));
    expect(initialIdempotencyKey('u1', at)).not.toBe(
      initialIdempotencyKey('u1', new Date('2026-07-26T12:00:01Z')),
    );
  });

  it('an explicit resend is a FRESH key every time — a deliberate second delivery', () => {
    expect(resendIdempotencyKey('u1')).not.toBe(resendIdempotencyKey('u1'));
  });

  it('both key forms fit Resend’s 1–256 character limit', () => {
    // Verified against Resend’s idempotency docs on 2026-07-30: the header
    // accepts 1–256 characters and rejects anything else with a 400
    // invalid_idempotency_key. Both generators are derived, so a future change
    // to either format could silently cross that line and turn every invite
    // into a hard failure. Pin the external constraint here rather than
    // discovering it in production.
    const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    for (const key of [initialIdempotencyKey(uuid, new Date()), resendIdempotencyKey(uuid)]) {
      expect(key.length).toBeGreaterThanOrEqual(1);
      expect(key.length).toBeLessThanOrEqual(256);
    }
  });
});

describe('copy (G14)', () => {
  const input = { toEmail: 'new@repos.test', invitedByEmail: 'admin@repos.test' };

  it('names the inviter, carries the Beta disclaimer, the Google instruction, a contact path and the link', () => {
    for (const body of [renderInviteHtml(input), renderInviteText(input)]) {
      expect(body).toContain('admin@repos.test');
      expect(body.toLowerCase()).toContain('beta');
      // The repos Access application allows ONLY the Google IdP; an invitee
      // trying a non-Google address is bounced with no in-app explanation.
      expect(body).toContain('Sign in with the Google account for this exact address');
      expect(body).toContain('new@repos.test');
      expect(body).toContain(APP_URL);
    }
  });

  it('the HTML uses inline styles and a table layout, and declares no @font-face', () => {
    const html = renderInviteHtml(input);
    expect(html).toContain('<table');
    expect(html).toContain('style=');
    expect(html).not.toContain('@font-face');
    expect(html).toContain('#4D8DFF');
    expect(html).toContain('#10141C');
  });

  it('renders deterministically across a large jump in wall-clock time', () => {
    // Q30 is protected by persisting the request, not by this — a
    // non-deterministic renderer would simply be frozen at first render. But a
    // template that embedded the date would still make the SAME invite read
    // differently to a reader than to anyone reasoning about it later, so pin
    // purity anyway.
    //
    // Rendering twice back-to-back does not test this: a timestamp rounded to
    // seconds, minutes or days — and often even a millisecond one — lands on
    // the same tick. Move the clock instead.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const html1 = renderInviteHtml(input);
      const text1 = renderInviteText(input);
      vi.setSystemTime(new Date('2027-06-15T13:45:12.500Z'));
      expect(renderInviteHtml(input)).toBe(html1);
      expect(renderInviteText(input)).toBe(text1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the plain-text alternative contains no markup', () => {
    expect(renderInviteText(input)).not.toMatch(/<[a-z]/i);
  });

  it('escapes both addresses into the HTML instead of interpolating them raw', () => {
    // Both addresses are admin-supplied and land inside markup. A local part
    // may legally be a quoted string, so `"a<b"@example.test` is a valid
    // address that would otherwise open a tag mid-document and corrupt the
    // email — and the same hole lets an admin inject markup into a message
    // delivered to someone else.
    const html = renderInviteHtml({
      toEmail: '"a<b"@example.test',
      invitedByEmail: '<script>x</script>@evil.test',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&quot;@example.test');
  });
});

describe('buildInviteRequest / sendInviteRequest', () => {
  const copy = { toEmail: 'new@repos.test', invitedByEmail: 'admin@repos.test' };

  it('POSTs the built request with the from address, both parts and the key', async () => {
    const r = await sendInviteRequest(buildInviteRequest(copy), 'k-1');
    expect(r.messageId).toBe('msg_123');
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key');
    expect(headers['Idempotency-Key']).toBe('k-1');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.from).toContain('repos@send.jpmtech.com');
    expect(body.to).toEqual(['new@repos.test']);
    expect(body.html).toBeTruthy();
    expect(body.text).toBeTruthy();
  });

  it('Q30: replaying a persisted request is byte-identical even after the config and copy change', async () => {
    // The whole point. Build once, then change everything the renderer reads —
    // this is what a redeploy inside Resend's 24h window looks like. The replay
    // must still produce the SAME key and the SAME bytes, so Resend collapses
    // it into the original delivery instead of sending a second one.
    const persisted = buildInviteRequest(copy);
    await sendInviteRequest(persisted, 'k-1');

    process.env.INVITE_FROM_EMAIL = 'somewhere-else@send.jpmtech.com';
    // Round-trip through JSON exactly as a JSONB column would.
    const replayed = JSON.parse(JSON.stringify(persisted));
    await sendInviteRequest(replayed, 'k-1');

    const h = calls.map((c) => (c.init.headers as Record<string, string>)['Idempotency-Key']);
    expect(h[1]).toBe(h[0]);
    expect(String(calls[1].init.body)).toBe(String(calls[0].init.body));
  });

  it('a rebuilt request DOES drift when config changes — which is why it is persisted', async () => {
    // The negative control for the case above: rebuilding is exactly what
    // cannot be done on a retry.
    const a = buildInviteRequest(copy);
    process.env.INVITE_FROM_EMAIL = 'somewhere-else@send.jpmtech.com';
    const b = buildInviteRequest(copy);
    expect(b.from).not.toBe(a.from);
  });

  it.each([
    ['null', null],
    ['a non-object', 'nope'],
    ['an array', []],
    ['a missing html part', { from: 'a', to: ['b'], subject: 'c', text: 'd' }],
    ['an empty recipient list', { from: 'a', to: [], subject: 'c', html: 'd', text: 'e' }],
  ])('refuses to send a persisted request that is %s', async (_label, bad) => {
    await expect(
      sendInviteRequest(bad as never, 'k-1'),
    ).rejects.toMatchObject({ code: 'mail_not_configured' });
    expect(calls).toHaveLength(0);
  });

  it('throws mail_not_configured when RESEND_API_KEY is unset — never at boot', async () => {
    delete process.env.RESEND_API_KEY;
    await expect(sendInviteRequest(buildInviteRequest(copy), 'k')).rejects.toMatchObject({
      code: 'mail_not_configured',
    });
  });

  it('buildInviteRequest throws when INVITE_FROM_EMAIL is unset', () => {
    delete process.env.INVITE_FROM_EMAIL;
    expect(() => buildInviteRequest(copy)).toThrow(/INVITE_FROM_EMAIL/);
  });

  it('surfaces a non-2xx as mail_http_error', async () => {
    respond = async () => new Response(JSON.stringify({ message: 'nope' }), { status: 422 });
    await expect(sendInviteRequest(buildInviteRequest(copy), 'k')).rejects.toMatchObject({
      code: 'mail_http_error',
    });
  });

  // A malformed 2xx is a refusal, not a success with a blank id. Defaulting
  // here would let Task 11 stamp invite_sent_at with an empty
  // invite_message_id — the invite recorded as delivered with no handle on the
  // actual message — and the `null` body would escape as a raw TypeError that
  // callers classify as an unknown error rather than a mail failure.
  for (const [label, payload] of [
    ['an empty object', '{}'],
    ['a bare null', 'null'],
    ['an empty id', '{"id":""}'],
    ['a non-string id', '{"id":123}'],
    ['an array', '[]'],
  ] as const) {
    it(`rejects a 200 carrying ${label}`, async () => {
      respond = async () =>
        new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } });
      await expect(sendInviteRequest(buildInviteRequest(copy), 'k')).rejects.toMatchObject({
        code: 'mail_http_error',
      });
    });
  }

  it('Q38: aborts on deadline', async () => {
    respond = async () => { await new Promise((r) => setTimeout(r, 200)); return new Response('{}', { status: 200 }); };
    await expect(
      sendInviteRequest(buildInviteRequest(copy), 'k', { timeoutMs: 40 }),
    ).rejects.toMatchObject({ code: 'mail_timeout' });
  });
});
