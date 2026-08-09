// W9 — the Cloudflare Access policy client. Every assertion here is
// fail-closed: a refusal surfaces as drift on /settings/users rather than a
// silent partial write (Q9).
//
// Scope: this module writes ONLY to the `Owner Only` policy identified by
// CF_ACCESS_POLICY_ID, and only its include[] array. exclude[] and require[]
// are echoed back verbatim, and the app's second policy (the post-deploy-smoke
// service token) is never touched (Q22).
//
// It deliberately makes NO session-revocation call (Q17a): that endpoint
// revokes access across ALL applications in the org — suspending a RepOS user
// would also sign them out of ha.jpmtech.com and jellyseerr.jpmtech.com — and
// it needs the account-level `Access: Organizations Revoke` permission that
// Q15's narrow-token goal exists to avoid.

export type CfPolicyErrorCode =
  | 'cf_not_configured'
  | 'cf_http_error'
  | 'cf_timeout'
  | 'app_count_not_one'
  | 'non_email_selector'
  | 'malformed_policy'
  | 'policy_changed';

/**
 * Every property the reusable-policy PUT accepts, verified against the
 * Cloudflare OpenAPI spec on 2026-07-27. `name`, `decision` and `include` are
 * required; the rest are optional but MEANINGFUL — the PUT is a full replace,
 * so any writable field we fail to echo back is reset to its default.
 *
 * Sending only name/decision/include/exclude/require, as this client
 * originally did, meant every suspend or invite silently cleared
 * session_duration, approval_required, mfa_config, isolation_required and the
 * purpose-justification settings. Membership changes must not reconfigure the
 * application.
 */
const POLICY_WRITABLE_FIELDS = [
  'name',
  'decision',
  'include',
  'exclude',
  'require',
  'approval_groups',
  'approval_required',
  'connection_rules',
  'isolation_required',
  'mfa_config',
  'purpose_justification_prompt',
  'purpose_justification_required',
  'session_duration',
] as const;

export class CfPolicyError extends Error {
  readonly code: CfPolicyErrorCode;
  readonly detail?: string;
  constructor(code: CfPolicyErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'CfPolicyError';
    this.code = code;
    this.detail = detail;
  }
}

export interface CfPolicySnapshot {
  /** include[] flattened to lowercase emails, in policy order. */
  emails: string[];
  name: string;
  decision: string;
  /**
   * Every writable field exactly as the API returned it — nothing defaulted,
   * nothing invented, absent keys left absent. This is both what gets echoed
   * back on PUT (Q22) and what the Q19 compare fingerprints, so "any
   * difference aborts" covers the whole policy rather than a hand-picked five.
   */
  config: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = 8_000;

/** typeof null === 'object' and arrays are objects — neither is a policy. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Injection seam so tests never reach the network. Production leaves this null
// and uses the global fetch.
let fetchImpl: typeof fetch | null = null;
export function __setFetchForTesting(f: typeof fetch | null): void {
  fetchImpl = f;
}
function doFetch(url: string, init: RequestInit): Promise<Response> {
  return (fetchImpl ?? fetch)(url, init);
}

function policyUrl(): string {
  const token = process.env.CF_API_TOKEN;
  const account = process.env.CF_ACCOUNT_ID;
  const policy = process.env.CF_ACCESS_POLICY_ID;
  if (!token || !account || !policy) {
    throw new CfPolicyError(
      'cf_not_configured',
      'CF_API_TOKEN, CF_ACCOUNT_ID and CF_ACCESS_POLICY_ID must all be set',
    );
  }
  return `https://api.cloudflare.com/client/v4/accounts/${account}/access/policies/${policy}`;
}

async function cfRequest(
  method: 'GET' | 'PUT',
  body: unknown,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const url = policyUrl(); // throws cf_not_configured before any I/O
  // Q38 — every external call carries a finite abort deadline. A hung request
  // would otherwise hold both the pooled connection and the global membership
  // lock indefinitely.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  // The deadline must cover the RESPONSE BODY, not just the headers. Clearing
  // the timer at headers-received would let a stalled body hold the pooled
  // connection and the global membership lock indefinitely — precisely the
  // failure this deadline exists to prevent. Hence one try/finally around
  // both the request and the body read.
  try {
    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        signal: ac.signal,
        headers: {
          Authorization: `Bearer ${process.env.CF_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        throw new CfPolicyError(
          'cf_timeout',
          `Cloudflare ${method} timed out after ${timeoutMs}ms`,
        );
      }
      throw new CfPolicyError('cf_http_error', `Cloudflare ${method} failed`, String(err));
    }

    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        throw new CfPolicyError(
          'cf_timeout',
          `Cloudflare ${method} body stalled past ${timeoutMs}ms`,
        );
      }
      throw new CfPolicyError(
        'cf_http_error',
        `Cloudflare ${method} body read failed`,
        String(err),
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new CfPolicyError(
        'cf_http_error',
        `Cloudflare ${method} returned non-JSON`,
        text.slice(0, 200),
      );
    }
    // Validate before ANY property access. A raw TypeError escaping this module
    // is not merely untidy: callers map CfPolicyError.code onto a sync_error and
    // surface it as drift, so an unclassified throw becomes a 500 instead.
    if (!isPlainObject(parsed)) {
      throw new CfPolicyError(
        'cf_http_error',
        `Cloudflare ${method} returned a non-object envelope`,
        text.slice(0, 200),
      );
    }
    if (!res.ok || parsed.success !== true) {
      throw new CfPolicyError(
        'cf_http_error',
        `Cloudflare ${method} returned HTTP ${res.status}`,
        JSON.stringify(parsed.errors ?? parsed).slice(0, 300),
      );
    }
    if (!isPlainObject(parsed.result)) {
      throw new CfPolicyError(
        'malformed_policy',
        `Cloudflare ${method} succeeded but returned no policy object`,
        `result was ${JSON.stringify(parsed.result)?.slice(0, 80) ?? 'undefined'}`,
      );
    }
    return parsed.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Q10 — assert the policy is attached to exactly one application before we
 * are willing to write to it. `Owner Only` is reusable:true; verified
 * app_count:1 on 2026-07-26, but if it is ever attached to a second
 * application, RepOS would silently start granting access to that app.
 * Encoded in code, not just documented. Absent field => refuse (fail closed).
 *
 * Q22 — refuse unless EVERY include[] element is an email selector. Blind
 * array manipulation could drop a group selector or, worse, preserve an
 * `everyone` rule while appearing to work.
 */
function toSnapshot(result: Record<string, unknown>): CfPolicySnapshot {
  const appCount = result.app_count;
  if (typeof appCount !== 'number' || appCount !== 1) {
    throw new CfPolicyError(
      'app_count_not_one',
      `policy app_count is ${String(appCount)}, refusing to write`,
    );
  }

  // Validate, never default. Coercing a missing field to a plausible-looking
  // value (`[]`, `'allow'`, `''`) turns a truncated-but-2xx response into a
  // DESTRUCTIVE write: both reads degrade identically, the Q19 fingerprints
  // match, and the PUT then strips exclude[]/require[] and rewrites the name
  // and decision. A malformed policy must fail closed like every other refusal
  // here.
  const malformed = (field: string, saw: unknown): never => {
    throw new CfPolicyError(
      'malformed_policy',
      `policy field \`${field}\` is missing or the wrong type — refusing to write`,
      `saw ${typeof saw}: ${JSON.stringify(saw)?.slice(0, 80)}`,
    );
  };

  if (typeof result.name !== 'string') malformed('name', result.name);
  if (typeof result.decision !== 'string') malformed('decision', result.decision);
  if (!Array.isArray(result.include)) malformed('include', result.include);
  for (const k of ['exclude', 'require'] as const) {
    if (k in result && !Array.isArray(result[k])) malformed(k, result[k]);
  }

  const emails: string[] = [];
  for (const sel of result.include as unknown[]) {
    // Structurally invalid entries are malformed, not merely the wrong kind of
    // selector — and Object.keys(null) would throw a raw TypeError.
    if (!isPlainObject(sel)) {
      malformed('include[] entry', sel);
      continue; // unreachable; keeps the narrowing honest
    }
    const keys = Object.keys(sel);
    const emailObj = sel.email;
    if (
      keys.length !== 1 ||
      keys[0] !== 'email' ||
      !isPlainObject(emailObj) ||
      typeof emailObj.email !== 'string'
    ) {
      throw new CfPolicyError(
        'non_email_selector',
        `policy include[] contains a non-email selector (${keys.join(',') || 'empty'})`,
      );
    }
    emails.push(emailObj.email.toLowerCase());
  }

  // Copy writable fields verbatim, and only the ones actually present. An
  // absent key stays absent so the PUT does not assert a value Cloudflare
  // never told us about.
  const config: Record<string, unknown> = {};
  for (const k of POLICY_WRITABLE_FIELDS) {
    if (k in result) config[k] = result[k];
  }

  return {
    emails,
    name: result.name as string,
    decision: result.decision as string,
    config,
  };
}

/** Key-order-independent so a reserialized response is not read as a change. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, canonical(o[k])]),
    );
  }
  return v;
}

/**
 * A stable, total serialization of everything we observed about the policy.
 * Used for the Q19 compare-before-write: "any difference aborts" has to mean
 * any difference, including the fields we echo back rather than compute.
 *
 * Fingerprinting `config` rather than a hand-picked subset is what makes that
 * true. A five-field fingerprint missed every other mutable setting — flipping
 * session_duration from 24h to 1h, or turning off approval_required, between
 * the read and the write compared equal and the PUT went ahead.
 */
function fingerprint(s: CfPolicySnapshot): string {
  return JSON.stringify(canonical(s.config));
}

export async function fetchPolicy(opts: { timeoutMs?: number } = {}): Promise<CfPolicySnapshot> {
  const result = await cfRequest('GET', undefined, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return toSnapshot(result);
}

/**
 * Replace include[] with exactly `desiredEmails`.
 *
 * Q19 — immediately before the PUT the policy is re-fetched and compared
 * against `snapshot`. Any difference aborts the write and surfaces as drift.
 * The advisory lock serializes RepOS against itself, not against a human
 * editing the Cloudflare dashboard between our GET and PUT. Verified against
 * the Cloudflare OpenAPI spec: the Access policy PUT supports no ETag,
 * If-Match, or version field, so true optimistic concurrency is unavailable.
 * Re-fetch-and-compare narrows the window to the compare->PUT gap; it does not
 * eliminate it. Accepted residual risk (single-operator account,
 * admin-initiated, low frequency).
 */
export async function putPolicyEmails(
  desiredEmails: string[],
  snapshot: CfPolicySnapshot,
  opts: { timeoutMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Re-assert Q10 and Q22 on the fresh read, not just the original one.
  const current = await fetchPolicy({ timeoutMs });
  // Q19 says ANY difference aborts, so compare the WHOLE snapshot — not just
  // the email list. A dashboard edit that flipped `decision` to deny, renamed
  // the policy, or added an exclude[] rule would otherwise pass the compare
  // and then be silently overwritten by our PUT, since we echo those fields
  // back from `current`.
  if (fingerprint(current) !== fingerprint(snapshot)) {
    throw new CfPolicyError(
      'policy_changed',
      'the Cloudflare policy changed between read and write — aborting',
      `expected ${fingerprint(snapshot)}, found ${fingerprint(current)}`.slice(0, 300),
    );
  }
  // Echo the ENTIRE observed writable config back, replacing only include[].
  // The PUT is a full replace: anything omitted here is reset to its default,
  // so a membership change would otherwise silently reconfigure the
  // application (session_duration, approval, MFA, isolation, justification).
  await cfRequest(
    'PUT',
    {
      ...current.config,
      include: desiredEmails.map((e) => ({ email: { email: e } })),
    },
    timeoutMs,
  );
}
