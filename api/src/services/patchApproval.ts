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

/** Paths a feedback patch may never touch, whatever it claims to fix. */
const FORBIDDEN_PATHS = [
  /^\.github\//,
  /^\.git\//,
  /^\.githooks\//,
  /(^|\/)\.env($|\.)/,
  /^docker\/entrypoint/,
  /(^|\/)id_(rsa|ed25519)/,
];

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'an email address'],
  [/\bre_[A-Za-z0-9_-]{16,}/, 'a Resend-shaped API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, 'a GitHub-shaped token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key block'],
  [/(?:API_KEY|SECRET|PASSWORD|TOKEN|WEBHOOK_URL)\s*[=:]\s*\S{3,}/i, 'an assigned secret'],
  [/\b[a-z]+:\/\/[^\s/@]+:[^\s/@]+@/, 'a URL with inline credentials'],
];

/**
 * Reasons this patch must not be pushed. Empty means clean.
 *
 * Only ADDED lines are scanned. Deleting a secret is exactly the change we
 * want to encourage, and flagging removals would block it.
 *
 * This runs on the broker side, before an approval exists. Putting it inside
 * repos-git would place the check in the process that holds the write
 * credential, one edit away from a push.
 */
export function scanPatch(patch: string): string[] {
  const reasons: string[] = [];

  for (const line of patch.split('\n')) {
    const m = /^diff --git a\/(\S+) b\/(\S+)/.exec(line);
    if (!m) continue;
    for (const path of [m[1], m[2]]) {
      for (const rule of FORBIDDEN_PATHS) {
        if (rule.test(path)) reasons.push(`touches a forbidden path: ${path}`);
      }
    }
  }

  for (const line of patch.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const added = line.slice(1);
    for (const [rule, label] of SECRET_PATTERNS) {
      if (rule.test(added)) reasons.push(`added line contains ${label}`);
    }
  }

  return [...new Set(reasons)];
}
