import { describe, it, expect } from 'vitest';
import {
  buildFeedbackRequest,
  serializeFeedbackRequest,
  parseFeedbackRequest,
  assertFeedbackRequest,
  idempotencyKeyFor,
  escapeHtml,
  FEEDBACK_REPLY_TO,
} from '../../src/services/feedbackMailer.js';

const FROM = 'feedback@send.jpmtech.com';

function req(over: Partial<Parameters<typeof buildFeedbackRequest>[0]> = {}) {
  return buildFeedbackRequest({
    kind: 'ack',
    toEmail: 'sub@example.test',
    feedbackId: '5',
    bodyText: 'Thanks — logged it.',
    ...over,
  });
}

describe('idempotencyKeyFor', () => {
  it('is deterministic and inside Resend’s 1-256 character limit', () => {
    expect(idempotencyKeyFor('ack', '5')).toBe('fb-ack-5');
    expect(idempotencyKeyFor('ack', '5')).toBe(idempotencyKeyFor('ack', '5'));
    expect(idempotencyKeyFor('resolved', '5')).not.toBe(idempotencyKeyFor('ack', '5'));
    expect(idempotencyKeyFor('reply', '5').length).toBeLessThanOrEqual(256);
  });
});

describe('buildFeedbackRequest', () => {
  it('addresses the submitter, sends from FEEDBACK_FROM_EMAIL, and replies to a human', () => {
    process.env.FEEDBACK_FROM_EMAIL = FROM;
    const r = req();
    expect(r.to).toEqual(['sub@example.test']);
    expect(r.from).toBe(FROM);
    expect(r.reply_to).toBe(FEEDBACK_REPLY_TO);
    expect(r.subject).toContain('RepOS');
  });

  it('escapes agent-authored prose rather than trusting it', () => {
    process.env.FEEDBACK_FROM_EMAIL = FROM;
    const r = req({ bodyText: 'pwn <img src=x onerror=alert(1)> & "quoted"' });
    expect(r.html).not.toContain('<img');
    expect(r.html).toContain('&lt;img');
    expect(r.html).toContain('&amp;');
    // The text part needs no escaping and keeps the original characters.
    expect(r.text).toContain('<img src=x onerror=alert(1)>');
  });

  it('carries no @font-face, since Gmail strips it', () => {
    process.env.FEEDBACK_FROM_EMAIL = FROM;
    expect(req().html).not.toContain('@font-face');
  });

  it('renders identically across a wall-clock jump', () => {
    process.env.FEEDBACK_FROM_EMAIL = FROM;
    const a = serializeFeedbackRequest(req());
    const b = serializeFeedbackRequest(req());
    expect(a).toBe(b);
  });

  it('fails at use time when FEEDBACK_FROM_EMAIL is unset', () => {
    delete process.env.FEEDBACK_FROM_EMAIL;
    expect(() => req()).toThrow(/FEEDBACK_FROM_EMAIL/);
  });
});

describe('assertFeedbackRequest', () => {
  const good = () => {
    process.env.FEEDBACK_FROM_EMAIL = FROM;
    return JSON.parse(serializeFeedbackRequest(req())) as unknown;
  };

  it('accepts a well-formed request for the right recipient', () => {
    expect(() => assertFeedbackRequest(good(), 'sub@example.test', FROM)).not.toThrow();
  });

  it('rejects a recipient that is not the lifecycle target', () => {
    // The one field where being wrong is actively harmful: a corrupted or
    // tampered row must never mail a third party.
    const r = good() as { to: string[] };
    r.to = ['attacker@example.test'];
    expect(() => assertFeedbackRequest(r, 'sub@example.test', FROM)).toThrow(/recipient/);
  });

  it('rejects more than one recipient', () => {
    const r = good() as { to: string[] };
    r.to = ['sub@example.test', 'attacker@example.test'];
    expect(() => assertFeedbackRequest(r, 'sub@example.test', FROM)).toThrow(/recipient/);
  });

  it('rejects a rewritten sender', () => {
    const r = good() as { from: string };
    r.from = 'spoofed@elsewhere.test';
    expect(() => assertFeedbackRequest(r, 'sub@example.test', FROM)).toThrow(/sender/);
  });

  it('rejects a rewritten reply_to', () => {
    // A user replying to a tampered row must not reach an attacker.
    const r = good() as { reply_to: string };
    r.reply_to = 'attacker@example.test';
    expect(() => assertFeedbackRequest(r, 'sub@example.test', FROM)).toThrow(/reply_to/);
  });

  it('validates rather than defaulting a missing field', () => {
    const r = good() as Record<string, unknown>;
    delete r.subject;
    expect(() => assertFeedbackRequest(r, 'sub@example.test', FROM)).toThrow(/subject/);
  });

  it('rejects an empty field', () => {
    const r = good() as Record<string, unknown>;
    r.html = '';
    expect(() => assertFeedbackRequest(r, 'sub@example.test', FROM)).toThrow(/html/);
  });
});

describe('parseFeedbackRequest', () => {
  it('round-trips byte-identically so a replay reuses the same bytes', () => {
    process.env.FEEDBACK_FROM_EMAIL = FROM;
    const original = serializeFeedbackRequest(req());
    const parsed = parseFeedbackRequest(original, 'sub@example.test', FROM);
    expect(serializeFeedbackRequest(parsed)).toBe(original);
  });

  it('rejects unparseable stored bytes', () => {
    expect(() => parseFeedbackRequest('not json', 'sub@example.test', FROM)).toThrow(
      /mail_request_invalid|JSON/,
    );
  });
});

describe('escapeHtml', () => {
  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
