// Q10, Q19, Q22, Q38 — the fail-closed Cloudflare policy client.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  fetchPolicy,
  putPolicyEmails,
  CfPolicyError,
  __setFetchForTesting,
} from '../../src/services/cfAccessPolicy.js';

const ACCOUNT = '400d0b4a35d63a32b86ab774b9feb4ab';
const POLICY = 'b4a92a15-27d5-477b-ad36-f78fcdae931c';

function policyResult(over: Record<string, unknown> = {}) {
  return {
    success: true,
    errors: [],
    result: {
      id: POLICY,
      name: 'Owner Only',
      decision: 'allow',
      app_count: 1,
      include: [{ email: { email: 'a@repos.test' } }, { email: { email: 'b@repos.test' } }],
      exclude: [],
      require: [],
      ...over,
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let calls: Array<{ url: string; init: RequestInit }>;
// Queue entries receive the request's AbortSignal so a response can model a
// body that stalls until the deadline fires (see the stalled-body test).
let queue: Array<(signal?: AbortSignal | null) => Promise<Response>>;

beforeEach(() => {
  process.env.CF_API_TOKEN = 'test-token';
  process.env.CF_ACCOUNT_ID = ACCOUNT;
  process.env.CF_ACCESS_POLICY_ID = POLICY;
  calls = [];
  queue = [];
  __setFetchForTesting(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected fetch: ${String(input)}`);
    // The double MUST honour init.signal the way a real fetch does. A double
    // that ignores it makes the Q38 deadline test pass vacuously: the abort
    // fires, nothing observes it, and the slow response resolves normally —
    // so the assertion would be testing nothing.
    return abortable(next(init.signal), init.signal);
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
  __setFetchForTesting(null);
  delete process.env.CF_API_TOKEN;
  delete process.env.CF_ACCOUNT_ID;
  delete process.env.CF_ACCESS_POLICY_ID;
});

describe('fetchPolicy', () => {
  it('returns the email set and hits the account-scoped policy URL', async () => {
    queue.push(async () => jsonResponse(policyResult()));
    const snap = await fetchPolicy();
    expect(snap.emails).toEqual(['a@repos.test', 'b@repos.test']);
    expect(calls[0].url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/access/policies/${POLICY}`,
    );
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-token',
    );
  });

  it('Q10: refuses when app_count !== 1', async () => {
    queue.push(async () => jsonResponse(policyResult({ app_count: 2 })));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'app_count_not_one' });
  });

  it('Q10: refuses when app_count is absent — fail closed, never assume 1', async () => {
    const r = policyResult();
    delete (r.result as Record<string, unknown>).app_count;
    queue.push(async () => jsonResponse(r));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'app_count_not_one' });
  });

  it('Q22: refuses an `everyone` selector rather than preserving it', async () => {
    queue.push(async () => jsonResponse(policyResult({ include: [{ everyone: {} }] })));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'non_email_selector' });
  });

  it('Q22: refuses email_domain, group and service_token selectors', async () => {
    for (const bad of [
      { email_domain: { domain: 'repos.test' } },
      { group: { id: 'g' } },
      { service_token: { token_id: 't' } },
    ]) {
      queue.push(async () => jsonResponse(policyResult({ include: [bad] })));
      await expect(fetchPolicy()).rejects.toMatchObject({ code: 'non_email_selector' });
    }
  });

  it('surfaces a non-2xx as cf_http_error', async () => {
    queue.push(async () =>
      jsonResponse({ success: false, errors: [{ message: 'bad token' }] }, 403),
    );
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'cf_http_error' });
  });

  it('throws cf_not_configured when CF_API_TOKEN is unset', async () => {
    delete process.env.CF_API_TOKEN;
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'cf_not_configured' });
  });

  it('Q38: aborts on deadline and reports cf_timeout', async () => {
    queue.push(async () => {
      await new Promise((r) => setTimeout(r, 200));
      return jsonResponse(policyResult());
    });
    await expect(fetchPolicy({ timeoutMs: 40 })).rejects.toMatchObject({ code: 'cf_timeout' });
  });

  it('Q38: the deadline covers the RESPONSE BODY, not just the headers', async () => {
    // Round-7 finding: clearing the abort timer once headers arrive would let a
    // stalled body hold the pooled connection AND the global membership lock
    // indefinitely — exactly what the deadline exists to prevent. Headers here
    // arrive immediately; the body never does.
    queue.push(async (signal) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener(
            'abort',
            () => controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            { once: true },
          );
          // deliberately never enqueue and never close
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
    });
    await expect(fetchPolicy({ timeoutMs: 40 })).rejects.toMatchObject({ code: 'cf_timeout' });
  });
});

describe('putPolicyEmails', () => {
  it('re-fetches and compares immediately before PUT, then writes include[]', async () => {
    queue.push(async () => jsonResponse(policyResult())); // fetchPolicy
    queue.push(async () => jsonResponse(policyResult())); // pre-PUT re-fetch
    queue.push(async () => jsonResponse(policyResult({ include: [] }))); // the PUT
    const snap = await fetchPolicy();
    await putPolicyEmails(['a@repos.test', 'b@repos.test', 'c@repos.test'], snap);

    const put = calls[2];
    expect(put.init.method).toBe('PUT');
    const body = JSON.parse(String(put.init.body));
    expect(body.include).toEqual([
      { email: { email: 'a@repos.test' } },
      { email: { email: 'b@repos.test' } },
      { email: { email: 'c@repos.test' } },
    ]);
    // Q22: exclude[] and require[] are never touched — echoed back verbatim.
    expect(body.exclude).toEqual([]);
    expect(body.require).toEqual([]);
    expect(body.name).toBe('Owner Only');
    expect(body.decision).toBe('allow');
  });

  it('Q19: aborts when the dashboard changed the policy between GET and PUT', async () => {
    queue.push(async () => jsonResponse(policyResult())); // fetchPolicy
    queue.push(async () =>
      jsonResponse(
        policyResult({
          // re-fetch: changed!
          include: [
            { email: { email: 'a@repos.test' } },
            { email: { email: 'intruder@repos.test' } },
          ],
        }),
      ),
    );
    const snap = await fetchPolicy();
    await expect(
      putPolicyEmails(['a@repos.test', 'b@repos.test', 'c@repos.test'], snap),
    ).rejects.toMatchObject({ code: 'policy_changed' });
    expect(calls).toHaveLength(2); // no PUT was issued
  });

  it('Q19: aborts on a decision flip, even though include[] is untouched', async () => {
    // We echo `decision` back from the fresh read, so a compare that only
    // looked at emails would silently re-write a policy a human just changed.
    queue.push(async () => jsonResponse(policyResult()));
    queue.push(async () => jsonResponse(policyResult({ decision: 'deny' })));
    const snap = await fetchPolicy();
    await expect(putPolicyEmails(['a@repos.test'], snap)).rejects.toMatchObject({
      code: 'policy_changed',
    });
    expect(calls).toHaveLength(2);
  });

  it('Q19: aborts on a rename', async () => {
    queue.push(async () => jsonResponse(policyResult()));
    queue.push(async () => jsonResponse(policyResult({ name: 'Owner Only (edited)' })));
    const snap = await fetchPolicy();
    await expect(putPolicyEmails(['a@repos.test'], snap)).rejects.toMatchObject({
      code: 'policy_changed',
    });
  });

  it('Q19: aborts on a new exclude[] rule', async () => {
    queue.push(async () => jsonResponse(policyResult()));
    queue.push(async () =>
      jsonResponse(policyResult({ exclude: [{ email: { email: 'banned@repos.test' } }] })),
    );
    const snap = await fetchPolicy();
    await expect(putPolicyEmails(['a@repos.test'], snap)).rejects.toMatchObject({
      code: 'policy_changed',
    });
  });

  it('Q19: aborts on a new require[] rule', async () => {
    queue.push(async () => jsonResponse(policyResult()));
    queue.push(async () =>
      jsonResponse(policyResult({ require: [{ email_domain: { domain: 'repos.test' } }] })),
    );
    const snap = await fetchPolicy();
    await expect(putPolicyEmails(['a@repos.test'], snap)).rejects.toMatchObject({
      code: 'policy_changed',
    });
  });

  it('Q10/Q22 are re-asserted on the pre-PUT re-fetch, not just the first read', async () => {
    queue.push(async () => jsonResponse(policyResult()));
    queue.push(async () => jsonResponse(policyResult({ app_count: 3 })));
    const snap = await fetchPolicy();
    await expect(putPolicyEmails(['a@repos.test'], snap)).rejects.toMatchObject({
      code: 'app_count_not_one',
    });
    expect(calls).toHaveLength(2);
  });
});

describe('CfPolicyError', () => {
  it('is the error type every refusal uses', async () => {
    queue.push(async () => jsonResponse(policyResult({ app_count: 9 })));
    await expect(fetchPolicy()).rejects.toBeInstanceOf(CfPolicyError);
  });
});

// A 2xx response is not the same thing as a well-formed one. Defaulting an
// absent field to a plausible value ([], 'allow', '') makes BOTH reads degrade
// identically, so the Q19 compare passes and the PUT then writes the degraded
// values back — stripping exclude[]/require[] and rewriting name and decision.
describe('malformed policy responses fail closed rather than defaulting', () => {
  it('refuses a result carrying only app_count and name', async () => {
    queue.push(async () =>
      jsonResponse({
        success: true,
        errors: [],
        result: { app_count: 1, name: 'Owner Only' },
      }),
    );
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'malformed_policy' });
  });

  it('refuses a missing include[] instead of treating it as empty', async () => {
    const r = policyResult();
    delete (r.result as Record<string, unknown>).include;
    queue.push(async () => jsonResponse(r));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'malformed_policy' });
  });

  it('refuses a missing decision instead of assuming allow', async () => {
    const r = policyResult();
    delete (r.result as Record<string, unknown>).decision;
    queue.push(async () => jsonResponse(r));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'malformed_policy' });
  });

  it('refuses a missing name instead of blanking it', async () => {
    const r = policyResult();
    delete (r.result as Record<string, unknown>).name;
    queue.push(async () => jsonResponse(r));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'malformed_policy' });
  });

  it('refuses a non-array exclude[]', async () => {
    queue.push(async () => jsonResponse(policyResult({ exclude: 'nope' })));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'malformed_policy' });
  });

  // Every one of these threw a raw TypeError before. That matters beyond
  // tidiness: callers map CfPolicyError.code onto a sync_error and render it as
  // drift, so an unclassified throw escapes that path and becomes a 500.
  it('refuses a null result rather than throwing TypeError', async () => {
    queue.push(async () => jsonResponse({ success: true, errors: [], result: null }));
    const err = await fetchPolicy().catch((e) => e);
    expect(err).toBeInstanceOf(CfPolicyError);
    expect(err.code).toBe('malformed_policy');
  });

  it('refuses a non-object result rather than reporting app_count_not_one', async () => {
    queue.push(async () => jsonResponse({ success: true, errors: [], result: 'nope' }));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'malformed_policy' });
  });

  it('refuses an array result', async () => {
    queue.push(async () => jsonResponse({ success: true, errors: [], result: [] }));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'malformed_policy' });
  });

  it('refuses a null envelope rather than throwing TypeError', async () => {
    queue.push(async () => jsonResponse(null));
    const err = await fetchPolicy().catch((e) => e);
    expect(err).toBeInstanceOf(CfPolicyError);
    expect(err.code).toBe('cf_http_error');
  });

  it('refuses a null include[] entry rather than throwing TypeError', async () => {
    queue.push(async () => jsonResponse(policyResult({ include: [null] })));
    const err = await fetchPolicy().catch((e) => e);
    expect(err).toBeInstanceOf(CfPolicyError);
    expect(err.code).toBe('malformed_policy');
  });

  it('refuses a scalar include[] entry', async () => {
    queue.push(async () => jsonResponse(policyResult({ include: ['a@repos.test'] })));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'malformed_policy' });
  });

  it('still reports a null nested email object as a non-email selector', async () => {
    queue.push(async () => jsonResponse(policyResult({ include: [{ email: null }] })));
    await expect(fetchPolicy()).rejects.toMatchObject({ code: 'non_email_selector' });
  });

  it('no malformed shape ever escapes as something other than CfPolicyError', async () => {
    const shapes: unknown[] = [
      null,
      { success: true, errors: [], result: null },
      { success: true, errors: [], result: [] },
      { success: true, errors: [], result: 42 },
      policyResult({ include: [null] }),
      policyResult({ include: [[]] }),
      policyResult({ include: [{ email: 'flat@repos.test' }] }),
      policyResult({ exclude: null }),
      policyResult({ require: 7 }),
    ];
    for (const body of shapes) {
      queue.push(async () => jsonResponse(body));
      const err = await fetchPolicy().catch((e) => e);
      expect(err, `shape ${JSON.stringify(body)?.slice(0, 60)}`).toBeInstanceOf(CfPolicyError);
    }
  });

  it('an absent optional field stays absent — the PUT never invents one', async () => {
    const withoutExclude = () => {
      const r = policyResult();
      delete (r.result as Record<string, unknown>).exclude;
      return r;
    };
    queue.push(async () => jsonResponse(withoutExclude()));
    queue.push(async () => jsonResponse(withoutExclude()));
    queue.push(async () => jsonResponse(policyResult()));
    const snap = await fetchPolicy();
    await putPolicyEmails(['a@repos.test'], snap);
    const body = JSON.parse(String(calls[2].init.body));
    expect('exclude' in body).toBe(false);
    expect('require' in body).toBe(true); // it WAS present, so it is echoed
  });
});

// The PUT is a full replace (Cloudflare OpenAPI, verified 2026-07-27: it
// accepts 13 writable properties). Anything not echoed back is reset to its
// default, so a membership change must not double as a reconfiguration.
describe('the whole writable policy is preserved and compared', () => {
  const configured = (over: Record<string, unknown> = {}) =>
    policyResult({
      session_duration: '24h',
      approval_required: true,
      approval_groups: [{ approvals_needed: 1, email_addresses: ['boss@repos.test'] }],
      isolation_required: false,
      purpose_justification_required: true,
      purpose_justification_prompt: 'Why do you need access?',
      mfa_config: { mode: 'required' },
      connection_rules: { ssh: { usernames: ['jason'] } },
      ...over,
    });

  it('echoes every writable field back on PUT, replacing only include[]', async () => {
    queue.push(async () => jsonResponse(configured()));
    queue.push(async () => jsonResponse(configured()));
    queue.push(async () => jsonResponse(policyResult()));
    const snap = await fetchPolicy();
    await putPolicyEmails(['a@repos.test'], snap);

    const body = JSON.parse(String(calls[2].init.body));
    expect(body.session_duration).toBe('24h');
    expect(body.approval_required).toBe(true);
    expect(body.approval_groups).toEqual([
      { approvals_needed: 1, email_addresses: ['boss@repos.test'] },
    ]);
    expect(body.isolation_required).toBe(false);
    expect(body.purpose_justification_required).toBe(true);
    expect(body.purpose_justification_prompt).toBe('Why do you need access?');
    expect(body.mfa_config).toEqual({ mode: 'required' });
    expect(body.connection_rules).toEqual({ ssh: { usernames: ['jason'] } });
    // ...and include[] IS replaced.
    expect(body.include).toEqual([{ email: { email: 'a@repos.test' } }]);
    // Read-only fields are never sent back.
    expect('app_count' in body).toBe(false);
    expect('id' in body).toBe(false);
  });

  it('Q19: aborts when session_duration changed between the reads', async () => {
    queue.push(async () => jsonResponse(configured()));
    queue.push(async () => jsonResponse(configured({ session_duration: '1h' })));
    const snap = await fetchPolicy();
    await expect(putPolicyEmails(['a@repos.test'], snap)).rejects.toMatchObject({
      code: 'policy_changed',
    });
    expect(calls).toHaveLength(2); // no PUT was issued
  });

  it('Q19: aborts when approval_required was turned off between the reads', async () => {
    queue.push(async () => jsonResponse(configured()));
    queue.push(async () => jsonResponse(configured({ approval_required: false })));
    const snap = await fetchPolicy();
    await expect(putPolicyEmails(['a@repos.test'], snap)).rejects.toMatchObject({
      code: 'policy_changed',
    });
  });

  it('Q19: aborts when mfa_config changed between the reads', async () => {
    queue.push(async () => jsonResponse(configured()));
    queue.push(async () => jsonResponse(configured({ mfa_config: { mode: 'optional' } })));
    const snap = await fetchPolicy();
    await expect(putPolicyEmails(['a@repos.test'], snap)).rejects.toMatchObject({
      code: 'policy_changed',
    });
  });

  it('key ORDER alone is not a change — the compare is canonical', async () => {
    queue.push(async () => jsonResponse(policyResult()));
    // Same content, different property order in the JSON body.
    queue.push(async () =>
      jsonResponse({
        success: true,
        errors: [],
        result: {
          require: [],
          exclude: [],
          app_count: 1,
          include: [{ email: { email: 'a@repos.test' } }, { email: { email: 'b@repos.test' } }],
          decision: 'allow',
          name: 'Owner Only',
          id: POLICY,
        },
      }),
    );
    queue.push(async () => jsonResponse(policyResult()));
    const snap = await fetchPolicy();
    await expect(putPolicyEmails(['a@repos.test'], snap)).resolves.toBeUndefined();
    expect(calls).toHaveLength(3); // the PUT DID happen
  });
});
