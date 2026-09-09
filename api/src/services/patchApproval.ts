// Approval for a patch that is about to cross a privilege boundary.
//
// repos-git holds a write credential and no judgement; it will push whatever
// carries a valid approval. So the approval binds four things at once —
// (feedback_id, base_sha, patch_digest, expiry) — and every one of them is
// inside the signed bytes. Signing the digest alone would let an approved
// patch be replayed against a different base, where the same diff means
// something else, or reused forever.
//
// This module imports nothing but node:crypto. In particular it does not
// import ../db/client.js (which opens a pg.Pool at import time) or any other
// service module — repos-git's submitPatch.ts imports this module, and it
// must never gain a live database handle by doing so. SHA_RE is duplicated
// from fixLifecycle.ts rather than imported for the same reason.
import { createHash, createPublicKey, createPrivateKey, sign, verify } from 'node:crypto';

const SHA_RE = /^[0-9a-f]{40}$/;

export type ApprovalErrorCode = 'bad_signature' | 'expired' | 'malformed';

export class ApprovalError extends Error {
  readonly code: ApprovalErrorCode;
  constructor(code: ApprovalErrorCode, message: string) {
    super(message);
    this.name = 'ApprovalError';
    this.code = code;
  }
}

export interface Approval {
  feedbackId: string;
  baseSha: string;
  patchDigest: string;
  expiry: number; // unix seconds
}

export function patchDigest(patch: string): string {
  return createHash('sha256').update(patch, 'utf8').digest('hex');
}

/**
 * Length-prefixed encoding so no field value can be shifted across a
 * delimiter into its neighbour. A naive join lets ("5|aaa","bbb") and
 * ("5","aaa|bbb") produce identical bytes — one signature, two meanings.
 *
 * Known limit: this defends field *boundaries* within one Approval, not
 * cross-message collisions in general — it is a line/field-based scheme,
 * not a self-delimiting one at the byte level beyond the length prefixes
 * themselves. That is sufficient for the four fixed fields here.
 */
export function approvalMessage(a: Approval): Buffer {
  const parts = [a.feedbackId, a.baseSha, a.patchDigest, String(a.expiry)];
  const chunks: Buffer[] = [Buffer.from('repos-feedback-approval-v1\n', 'utf8')];
  for (const p of parts) {
    const b = Buffer.from(p, 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(b.length);
    chunks.push(len, b);
  }
  return Buffer.concat(chunks);
}

export function signApproval(a: Approval, privateKeyPem: string): string {
  // Ed25519 signs the message directly; the digest algorithm argument is null.
  return sign(null, approvalMessage(a), createPrivateKey(privateKeyPem)).toString('base64');
}

export function verifyApproval(
  a: Approval,
  signatureB64: string,
  publicKeyPem: string,
  now: number = Math.floor(Date.now() / 1000),
): void {
  if (!SHA_RE.test(a.baseSha)) {
    throw new ApprovalError('malformed', `base sha is not 40-hex: ${a.baseSha}`);
  }
  if (!/^[0-9a-f]{64}$/.test(a.patchDigest)) {
    throw new ApprovalError('malformed', 'patch digest is not sha256 hex');
  }
  if (!Number.isSafeInteger(a.expiry)) {
    throw new ApprovalError('malformed', 'expiry is not an integer');
  }

  let sigBytes: Buffer;
  try {
    sigBytes = Buffer.from(signatureB64, 'base64');
  } catch {
    throw new ApprovalError('bad_signature', 'bad signature: not base64');
  }
  if (sigBytes.length !== 64) {
    throw new ApprovalError('bad_signature', 'bad signature: not 64 bytes');
  }

  // Signature is verified BEFORE expiry is checked, so a caller cannot tell
  // a forged approval apart from a merely expired one by which error comes
  // back first.
  let good: boolean;
  try {
    good = verify(null, approvalMessage(a), createPublicKey(publicKeyPem), sigBytes);
  } catch {
    throw new ApprovalError('bad_signature', 'bad signature: verification failed');
  }
  if (!good) throw new ApprovalError('bad_signature', 'bad signature for this approval');

  if (a.expiry <= now) {
    throw new ApprovalError('expired', `approval expired at ${a.expiry}`);
  }
}

/**
 * Paths a feedback patch may never touch, whatever it claims to fix.
 *
 * `docker/root/etc/s6-overlay/` covers every startup-executed service script
 * (`s6-rc.d/{api,nginx,postgres,backup,*-log}/run`), not just a fictional
 * `docker/entrypoint`. `docker/Dockerfile` and the package manifests are
 * equally privileged: a `RUN curl … | sh` or a `postinstall` hook runs with
 * the same authority as a CI workflow change.
 */
const FORBIDDEN_PATHS = [
  /^\.github\//,
  /^\.git\//,
  /^\.githooks\//,
  /(^|\/)\.env($|\.)/,
  /^docker\/root\/etc\/s6-overlay\//,
  /^docker\/Dockerfile$/,
  // Anchored on either end so this matches the real manifests
  // (api/package.json, frontend/package-lock.json, …), not just a
  // hypothetical root-level package.json this repo does not have.
  /(^|\/)package(-lock)?\.json$/,
  /(^|\/)\.ssh\//,
  /(^|\/)id_(rsa|ed25519|ecdsa)/,
];

/**
 * Strip the C-style quoting `git` applies to a header path that contains a
 * space, a double quote, a backslash, or a non-ASCII byte. `git apply`
 * accepts a quoted header even when the quoting was unnecessary, so any
 * consumer that only matches the unquoted form is trivially bypassed.
 */
function unquoteGitPath(raw: string): string {
  if (raw.length < 2 || raw[0] !== '"' || raw[raw.length - 1] !== '"') return raw;
  const inner = raw.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c !== '\\') {
      for (const b of Buffer.from(c, 'utf8')) bytes.push(b);
      continue;
    }
    const next = inner[i + 1];
    if (next === '\\' || next === '"') {
      bytes.push(next.charCodeAt(0));
      i++;
    } else if (next === 'n') {
      bytes.push(0x0a);
      i++;
    } else if (next === 't') {
      bytes.push(0x09);
      i++;
    } else if (next === 'r') {
      bytes.push(0x0d);
      i++;
    } else if (next >= '0' && next <= '7') {
      bytes.push(parseInt(inner.slice(i + 1, i + 4), 8) & 0xff);
      i += 3;
    } else if (next !== undefined) {
      bytes.push(next.charCodeAt(0));
      i++;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Matches one path token: a C-quoted string, or a run of non-space bytes. */
const PATH_TOKEN = '(?:"(?:[^"\\\\]|\\\\.)*"|\\S+)';

/**
 * Parses a `diff --git a/<path> b/<path>` header into its two paths.
 * Returns null if the header cannot be split unambiguously into exactly two
 * tokens — e.g. an unquoted path containing a space, which is a real,
 * demonstrated `git apply` behavior, not a hypothetical. Callers must treat
 * null as "refuse", never as "skip": failing open here is the exact bug
 * this function replaces.
 */
function parseDiffGitHeader(line: string): [string, string] | null {
  const rest = line.slice('diff --git '.length);
  const re = new RegExp(`^(${PATH_TOKEN})\\s+(${PATH_TOKEN})$`);
  const m = re.exec(rest);
  if (!m) return null;
  const a = canonicalHeaderPath(m[1], 'a/');
  const b = canonicalHeaderPath(m[2], 'b/');
  if (a === null || b === null) return null;
  return [a, b];
}

/**
 * Support only Git's standard a/ and b/ prefixes. `git apply` strips one
 * component even for old/ and new/; retaining those components here would
 * check a different path from the one Git writes. Refuse noncanonical
 * components too, rather than depending on Git's path normalization.
 */
function canonicalHeaderPath(raw: string, prefix: 'a/' | 'b/'): string | null {
  const decoded = unquoteGitPath(raw);
  if (!decoded.startsWith(prefix)) return null;
  const path = decoded.slice(prefix.length);
  // eslint-disable-next-line no-control-regex -- Deliberately reject control characters in patch paths.
  if (/[\x00-\x1f\x7f]/.test(path)) return null;
  if (path.split('/').some((part) => part === '' || part === '.' || part === '..')) return null;
  return path;
}

/**
 * Result of parsing a `--- `/`+++ ` line. `devnull` (the legitimate marker
 * for an added or deleted file) and `invalid` (anything else that fails to
 * parse) are kept distinct so callers can skip the former and must refuse
 * the latter — collapsing them back to a single nullable value is exactly
 * the "unparseable header, so skip it" bug this type prevents.
 */
type SingleGitPathResult =
  | { kind: 'path'; path: string }
  | { kind: 'devnull' }
  | { kind: 'invalid' };

/**
 * Parses a `--- a/<path>` or `+++ b/<path>` line into its single path.
 * `git apply` prefers these over the `diff --git` header when they disagree,
 * so both must be checked against FORBIDDEN_PATHS independently.
 *
 * Traditional unified-diff headers (as `diff -u` emits, and as `git apply`
 * still accepts) append a tab-separated timestamp after the path, e.g.
 * `--- a/x.yml\t2026-01-01 00:00:00.000000000 +0000`. That must be stripped
 * before parsing, or the timestamp defeats the path-token match and the
 * header looks unparseable even though the path itself is plain.
 */
function parseSingleGitPath(line: string, prefix: 'a/' | 'b/'): SingleGitPathResult {
  const marker = line.startsWith('--- ') ? '--- ' : line.startsWith('+++ ') ? '+++ ' : null;
  if (!marker) return { kind: 'invalid' };
  let rest = line.slice(marker.length);
  const tabIdx = rest.indexOf('\t');
  if (tabIdx !== -1) rest = rest.slice(0, tabIdx);
  rest = rest.trim();
  if (rest === '/dev/null') return { kind: 'devnull' };
  const re = new RegExp(`^(${PATH_TOKEN})$`);
  const m = re.exec(rest);
  if (!m) return { kind: 'invalid' };
  const path = canonicalHeaderPath(m[1], prefix);
  return path === null ? { kind: 'invalid' } : { kind: 'path', path };
}

function checkForbiddenPath(path: string, reasons: string[]): void {
  for (const rule of FORBIDDEN_PATHS) {
    if (rule.test(path)) reasons.push(`touches a forbidden path: ${path}`);
  }
}

/** Reserved domains that can never be a real submitter's address. */
const EXEMPT_EMAIL_DOMAIN_RE =
  /(?:^|\.)(?:example\.com|example\.org|example\.net|localhost)$|\.(?:invalid|test)$/i;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bre_[A-Za-z0-9_-]{16,}/, 'a Resend-shaped API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, 'a GitHub-shaped token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key block'],
  // Case-sensitive and uppercase-only on purpose: env-var-style secrets are
  // ALL_CAPS; lowercase TypeScript identifiers like `token: string` or
  // `password: form.password` are not, and must not trip this rule.
  [/(?:API_KEY|SECRET|PASSWORD|TOKEN|WEBHOOK_URL)\s*[=:]\s*\S{3,}/, 'an assigned secret'],
  [/\b[a-z]+:\/\/[^\s/@]+:[^\s/@]+@/, 'a URL with inline credentials'],
];

/**
 * Reasons this patch must not be pushed. Empty means clean.
 *
 * Only ADDED lines are scanned for secrets. Deleting a secret is exactly the
 * change we want to encourage, and flagging removals would block it. Path
 * rules apply to diff headers regardless of add/remove.
 *
 * This runs on the broker side, before an approval exists. Putting it inside
 * repos-git would place the check in the process that holds the write
 * credential, one edit away from a push.
 */
export function scanPatch(patch: string): string[] {
  const reasons: string[] = [];
  const lines = patch.split('\n');
  let remaining: { old: number; next: number } | null = null;

  for (const line of lines) {
    // A hunk can contain literal ---/+++ lines. Only its declared counts,
    // not adjacent line prefixes, tell us when file headers resume.
    let added: string | null = null;
    if (remaining !== null) {
      if (line.startsWith('+')) {
        remaining.next--;
        added = line.slice(1);
      } else if (line.startsWith('-')) {
        remaining.old--;
      } else if (line.startsWith(' ')) {
        remaining.old--;
        remaining.next--;
      } else if (line !== '\\ No newline at end of file' && line !== '') {
        reasons.push('unparseable hunk, refusing');
      }
      if (remaining.old < 0 || remaining.next < 0) reasons.push('invalid hunk counts, refusing');
      if (remaining.old === 0 && remaining.next === 0) remaining = null;
    } else if (line.startsWith('@@')) {
      const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@(?:.*)$/.exec(line);
      if (!header) {
        reasons.push('unparseable hunk header, refusing');
      } else {
        const old = Number(header[1] ?? 1);
        const next = Number(header[2] ?? 1);
        if (!Number.isSafeInteger(old) || !Number.isSafeInteger(next) || old + next === 0) {
          reasons.push('invalid hunk counts, refusing');
        } else {
          remaining = { old, next };
        }
      }
    } else if (line.startsWith('diff --git ')) {
      const parsed = parseDiffGitHeader(line);
      if (!parsed) {
        reasons.push(`unparseable diff header, refusing: ${line}`);
        continue;
      }
      for (const path of parsed) checkForbiddenPath(path, reasons);
    } else if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      const r = parseSingleGitPath(line, line.startsWith('--- ') ? 'a/' : 'b/');
      if (r.kind === 'path') {
        checkForbiddenPath(r.path, reasons);
      } else if (r.kind === 'invalid') {
        // Fail closed, same as an unparseable `diff --git` header: a
        // traditional unified-diff header with a timestamp, or anything
        // else that doesn't reduce to one clean path, must be refused,
        // not silently skipped.
        reasons.push(`unparseable diff header, refusing: ${line}`);
        if (line.startsWith('+')) added = line.slice(1);
      }
      // 'devnull' is the legitimate marker for an added/deleted file — skip.
    } else if (line.startsWith('+')) {
      // Also scan additions in abbreviated patches. Only parsed file
      // headers outside a hunk may bypass the content checks.
      added = line.slice(1);
    }
    if (added === null) continue;

    for (const m of added.matchAll(EMAIL_RE)) {
      if (!EXEMPT_EMAIL_DOMAIN_RE.test(m[1])) {
        reasons.push('added line contains an email address');
      }
    }
    for (const [rule, label] of SECRET_PATTERNS) {
      if (rule.test(added)) reasons.push(`added line contains ${label}`);
    }
  }

  if (remaining !== null) reasons.push('truncated hunk, refusing');

  return [...new Set(reasons)];
}
