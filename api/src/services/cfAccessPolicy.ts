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
  | 'policy_changed';

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
  /** Echoed back on PUT untouched (Q22). */
  exclude: unknown[];
  /** Echoed back on PUT untouched (Q22). */
  require: unknown[];
}

const DEFAULT_TIMEOUT_MS = 8_000;

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
        throw new CfPolicyError('cf_timeout', `Cloudflare ${method} timed out after ${timeoutMs}ms`);
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
      throw new CfPolicyError('cf_http_error', `Cloudflare ${method} body read failed`, String(err));
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new CfPolicyError('cf_http_error', `Cloudflare ${method} returned non-JSON`, text.slice(0, 200));
    }
    if (!res.ok || parsed.success !== true) {
      throw new CfPolicyError(
        'cf_http_error',
        `Cloudflare ${method} returned HTTP ${res.status}`,
        JSON.stringify(parsed.errors ?? parsed).slice(0, 300),
      );
    }
    return parsed.result as Record<string, unknown>;
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
  const include = Array.isArray(result.include) ? result.include : [];
  const emails: string[] = [];
  for (const sel of include) {
    const s = sel as Record<string, unknown>;
    const keys = Object.keys(s);
    const emailObj = s.email as { email?: unknown } | undefined;
    if (keys.length !== 1 || keys[0] !== 'email' || typeof emailObj?.email !== 'string') {
      throw new CfPolicyError(
        'non_email_selector',
        `policy include[] contains a non-email selector (${keys.join(',') || 'empty'})`,
      );
    }
    emails.push(emailObj.email.toLowerCase());
  }
  return {
    emails,
    name: String(result.name ?? ''),
    decision: String(result.decision ?? 'allow'),
    exclude: Array.isArray(result.exclude) ? result.exclude : [],
    require: Array.isArray(result.require) ? result.require : [],
  };
}

/**
 * A stable, total serialization of everything we observed about the policy.
 * Used for the Q19 compare-before-write: "any difference aborts" has to mean
 * any difference, including the fields we echo back rather than compute.
 */
function fingerprint(s: CfPolicySnapshot): string {
  return JSON.stringify({
    emails: s.emails,
    name: s.name,
    decision: s.decision,
    exclude: s.exclude,
    require: s.require,
  });
}

export async function fetchPolicy(
  opts: { timeoutMs?: number } = {},
): Promise<CfPolicySnapshot> {
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
  await cfRequest(
    'PUT',
    {
      name: current.name,
      decision: current.decision,
      include: desiredEmails.map((e) => ({ email: { email: e } })),
      exclude: current.exclude,
      require: current.require,
    },
    timeoutMs,
  );
}
