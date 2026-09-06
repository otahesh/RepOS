import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync, createHash } from 'node:crypto';
import {
  patchDigest,
  scanPatch,
  signApproval,
  verifyApproval,
  approvalMessage,
  type Approval,
} from '../../src/services/patchApproval.js';

let priv: string;
let pub: string;
let otherPriv: string;

beforeAll(() => {
  const a = generateKeyPairSync('ed25519');
  priv = a.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  pub = a.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  otherPriv = generateKeyPairSync('ed25519')
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
});

const CLEAN = `diff --git a/api/src/routes/programs.ts b/api/src/routes/programs.ts
--- a/api/src/routes/programs.ts
+++ b/api/src/routes/programs.ts
@@ -1,3 +1,3 @@
-  const limit = 10;
+  const limit = 25;
`;

const base = (): Approval => ({
  feedbackId: '5',
  baseSha: 'a'.repeat(40),
  patchDigest: patchDigest(CLEAN),
  expiry: Math.floor(Date.now() / 1000) + 600,
});

describe('patchDigest', () => {
  it('is sha256 of the exact bytes', () => {
    expect(patchDigest(CLEAN)).toBe(createHash('sha256').update(CLEAN, 'utf8').digest('hex'));
  });

  it('changes with a single whitespace edit', () => {
    expect(patchDigest(CLEAN)).not.toBe(patchDigest(`${CLEAN} `));
  });
});

describe('scanPatch', () => {
  it('passes a clean patch', () => {
    expect(scanPatch(CLEAN)).toEqual([]);
  });

  it('catches an added email address', () => {
    const p = `${CLEAN}+const owner = 'someone@example.com';\n`;
    expect(scanPatch(p).join(' ')).toMatch(/email/i);
  });

  it('catches secret-shaped material', () => {
    for (const line of [
      `+const k = 're_1234567890abcdefghijklmnop';`,
      `+RESEND_API_KEY=abc123`,
      `+-----BEGIN OPENSSH PRIVATE KEY-----`,
      `+const t = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz';`,
      `+DATABASE_URL=postgres://repos:hunter2@10.0.0.1:5432/repos`,
    ]) {
      expect(scanPatch(`${CLEAN}${line}\n`).length).toBeGreaterThan(0);
    }
  });

  it('ignores matches on REMOVED lines', () => {
    // Deleting a secret is exactly what we want to encourage.
    expect(scanPatch(`${CLEAN}-const k = 're_1234567890abcdefghijklmnop';\n`)).toEqual([]);
  });

  it('ignores matches in context lines', () => {
    expect(scanPatch(`${CLEAN} someone@example.com\n`)).toEqual([]);
  });

  it('refuses a patch that touches a forbidden path', () => {
    const p = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml\n+    run: curl evil\n`;
    expect(scanPatch(p).join(' ')).toMatch(/\.github/);
  });

  it('refuses a patch touching git config or hooks', () => {
    for (const path of ['.git/config', '.githooks/pre-commit', 'api/.env']) {
      const p = `diff --git a/${path} b/${path}\n+x\n`;
      expect(scanPatch(p).length).toBeGreaterThan(0);
    }
  });
});

describe('signApproval / verifyApproval', () => {
  it('round-trips', () => {
    const a = base();
    expect(() => verifyApproval(a, signApproval(a, priv), pub)).not.toThrow();
  });

  it('produces a 64-byte signature', () => {
    expect(Buffer.from(signApproval(base(), priv), 'base64')).toHaveLength(64);
  });

  it('rejects a signature from a different key', () => {
    const a = base();
    expect(() => verifyApproval(a, signApproval(a, otherPriv), pub)).toThrow(/bad signature/i);
  });

  it('rejects a changed patch digest — the approval is for one patch', () => {
    const a = base();
    const sig = signApproval(a, priv);
    expect(() => verifyApproval({ ...a, patchDigest: patchDigest('other') }, sig, pub)).toThrow(
      /bad signature/i,
    );
  });

  it('rejects a changed base SHA — the same diff means something else elsewhere', () => {
    const a = base();
    const sig = signApproval(a, priv);
    expect(() => verifyApproval({ ...a, baseSha: 'b'.repeat(40) }, sig, pub)).toThrow(
      /bad signature/i,
    );
  });

  it('rejects a changed feedback id', () => {
    const a = base();
    const sig = signApproval(a, priv);
    expect(() => verifyApproval({ ...a, feedbackId: '6' }, sig, pub)).toThrow(/bad signature/i);
  });

  it('rejects an expired approval', () => {
    const a = { ...base(), expiry: Math.floor(Date.now() / 1000) - 1 };
    expect(() => verifyApproval(a, signApproval(a, priv), pub)).toThrow(/expired/i);
  });

  it('rejects an extended expiry — expiry is signed, not advisory', () => {
    const a = base();
    const sig = signApproval(a, priv);
    expect(() => verifyApproval({ ...a, expiry: a.expiry + 86_400 }, sig, pub)).toThrow(
      /bad signature/i,
    );
  });

  it('rejects garbage in the signature slot without throwing a raw crypto error', () => {
    for (const bad of ['', 'not-base64!!', 'AAAA']) {
      expect(() => verifyApproval(base(), bad, pub)).toThrow(/bad signature/i);
    }
  });

  it('signs unambiguously — field values cannot be shifted across the delimiter', () => {
    // A naive join would let ("5|aaa", "bbb") and ("5", "aaa|bbb") collide.
    const m1 = approvalMessage({ ...base(), feedbackId: '5' }).toString('hex');
    const m2 = approvalMessage({ ...base(), feedbackId: '5\n' + 'a'.repeat(40) }).toString('hex');
    expect(m1).not.toBe(m2);
  });
});
