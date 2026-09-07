#!/usr/bin/env node
// Feedback triage — the OPERATOR command line.
//
// Run by a human at the same trust level as psql. The agent does NOT use this:
// its path is a broker socket with no credentials on the agent side (Plan 3).
//
// DATABASE_URL is not ambient under `docker exec` — the three s6 scripts each
// build it into their own service — so this builds its own exactly as
// scripts/cutover/002-w9-cf-baseline.sh now does.

// Type-only, so it is erased at compile time and does NOT pull db/client.js in
// before DATABASE_URL is set. `await import()` gives a value binding, which
// cannot be used in type position.
import type { FeedbackCategory, FeedbackSeverity } from './feedbackTriage.js';
import type { Approval } from './patchApproval.js';

/** Built before any module that opens a pool is imported. */
export function buildDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (!env.POSTGRES_PASSWORD) return undefined;
  const user = encodeURIComponent(env.POSTGRES_USER ?? 'repos');
  const pw = encodeURIComponent(env.POSTGRES_PASSWORD);
  const dbName = env.POSTGRES_DB ?? 'repos';
  return `postgres://${user}:${pw}@127.0.0.1:5432/${dbName}`;
}

const USAGE = `feedback-triage — operator commands

  list --untriaged | --pending | --fix-pending | --dead-lettered
  triage --id ID --category bug|ux|feature|question|noise
         [--severity p1|p2|p3] --note TEXT [--dedupe-of ID]
  defer  --id ID --reason TEXT
  email  --id ID --kind ack|reply --body TEXT
  replay-pending
  check-shipped [--dry-run]
  reconcile
  link --id ID --sha SHA
  approve-patch --id ID --base SHA < patch.diff
  submit-patch --patch FILE < approval.json
  open-pr --id ID

Every verb is idempotent. 'email' cannot send a 'resolved' notice; that kind is
created only by deployment verification.
Approval/git commands do not require database credentials. FEEDBACK_REPO_DIR
must name a trusted clone for submit-patch and check-shipped. These are operator
commands, not the agent socket API; patch FILE is an operator-local path.
`;

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const MAX_INPUT = 1024 * 1024;
const ID_RE = /^[1-9][0-9]{0,18}$/;
function validId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value) && BigInt(value) <= 9223372036854775807n;
}
function required(value: string | undefined, label: string): string {
  if (!value || value.startsWith('--')) throw new Error(`${label} is required`);
  return value;
}
async function boundedText(input: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of input) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_INPUT) throw new Error('input exceeds the 1 MiB limit');
    chunks.push(bytes);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
function envelope(value: unknown): { approval: Approval; signature: string } {
  const v = value as { approval?: Partial<Approval>; signature?: unknown } | null;
  const a = v?.approval;
  if (
    !a ||
    !validId(a.feedbackId) ||
    typeof a.baseSha !== 'string' ||
    !/^[0-9a-f]{40}$/.test(a.baseSha) ||
    typeof a.patchDigest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(a.patchDigest) ||
    !Number.isSafeInteger(a.expiry) ||
    typeof v?.signature !== 'string' ||
    !/^[A-Za-z0-9+/]{86}==$/.test(v.signature)
  ) {
    throw new Error('malformed approval envelope');
  }
  return { approval: a as Approval, signature: v.signature };
}

async function runPureCommand(
  cmd: string,
  argv: string[],
  out: (s: string) => void,
): Promise<number> {
  if (cmd === 'approve-patch') {
    const id = required(flag(argv, 'id'), '--id');
    const baseSha = required(flag(argv, 'base'), '--base');
    if (!validId(id) || !/^[0-9a-f]{40}$/.test(baseSha)) throw new Error('invalid id or base SHA');
    const ttl = Number(process.env.FEEDBACK_APPROVAL_TTL_SECONDS ?? 900);
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 86400)
      throw new Error('approval TTL must be 1–86400 seconds');
    const keyPath = required(process.env.FEEDBACK_APPROVAL_KEY, 'FEEDBACK_APPROVAL_KEY');
    const { readFile } = await import('node:fs/promises');
    const { patchDigest, scanPatch, signApproval } = await import('./patchApproval.js');
    const patch = await boundedText(process.stdin);
    const reasons = scanPatch(patch);
    if (reasons.length) {
      // Do not echo untrusted filenames/content returned by the scanner.
      out(`refused: patch failed privacy/path checks (${reasons.length} reasons)`);
      return 2;
    }
    const approval = {
      feedbackId: id,
      baseSha,
      patchDigest: patchDigest(patch),
      expiry: Math.floor(Date.now() / 1000) + ttl,
    };
    const signature = signApproval(approval, await readFile(keyPath, 'utf8'));
    out(JSON.stringify({ approval, signature }));
    return 0;
  }
  if (cmd === 'submit-patch') {
    const patchPath = required(flag(argv, 'patch'), '--patch');
    const repoDir = required(process.env.FEEDBACK_REPO_DIR, 'FEEDBACK_REPO_DIR');
    const keyPath = required(process.env.FEEDBACK_APPROVAL_PUBKEY, 'FEEDBACK_APPROVAL_PUBKEY');
    const { readFile } = await import('node:fs/promises');
    const { createReadStream } = await import('node:fs');
    const parsed = envelope(JSON.parse(await boundedText(process.stdin)));
    const publicKeyPem = await readFile(keyPath, 'utf8');
    const { verifyApproval } = await import('./patchApproval.js');
    verifyApproval(parsed.approval, parsed.signature, publicKeyPem);
    const patch = await boundedText(createReadStream(patchPath));
    const { submitPatch } = await import('../reposGit/index.js');
    const res = await submitPatch({
      feedbackId: parsed.approval.feedbackId,
      patch,
      ...parsed,
      repoDir,
      publicKeyPem,
    });
    out(`pushed ${res.branch} @ ${res.headSha}${res.replaced ? ' (revision)' : ''}`);
  } else {
    const id = required(flag(argv, 'id'), '--id');
    if (!validId(id)) throw new Error('invalid feedback id');
    const { openPr } = await import('../reposGit/index.js');
    const res = await openPr({ feedbackId: id });
    out(`opened #${res.number} — ${res.url}`);
  }
  out('run `npm run feedback -- reconcile` to record the state');
  return 0;
}

export async function runCli(argv: string[], out: (s: string) => void): Promise<number> {
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    out(USAGE);
    return cmd ? 0 : 1;
  }

  if (['approve-patch', 'submit-patch', 'open-pr'].includes(cmd)) {
    try {
      return await runPureCommand(cmd, argv, out);
    } catch {
      // Key parsers, filesystem errors and remote failures must not echo secrets.
      out('command failed: check input, approval, and trusted operator configuration');
      return 1;
    }
  }
  if (
    ![
      'list',
      'triage',
      'defer',
      'email',
      'replay-pending',
      'link',
      'check-shipped',
      'reconcile',
    ].includes(cmd)
  ) {
    out(`unknown command\n\n${USAGE}`);
    return 2;
  }
  if (cmd === 'check-shipped' && !process.env.FEEDBACK_REPO_DIR) {
    out('FEEDBACK_REPO_DIR is required');
    return 2;
  }

  const url = buildDatabaseUrl(process.env);
  if (!url) {
    out('DATABASE_URL is unset and POSTGRES_PASSWORD is not available to build one.');
    return 2;
  }
  process.env.DATABASE_URL = url;

  // Imported AFTER DATABASE_URL is set: db/client.js opens its pool on import.
  const triageSvc = await import('./feedbackTriage.js');
  const emailSvc = await import('./feedbackEmails.js');
  const { db } = await import('../db/client.js');

  try {
    switch (cmd) {
      case 'check-shipped': {
        const { checkShipped } = await import('./checkShipped.js');
        const res = await checkShipped({
          dryRun: argv.includes('--dry-run'),
          repoDir: process.env.FEEDBACK_REPO_DIR,
        });
        out(JSON.stringify(res));
        return res.diagnostics.some((d) => d.stage !== 'deployment') ? 1 : 0;
      }
      case 'reconcile': {
        const { reconcileFixes } = await import('./reconcileFixes.js');
        const res = await reconcileFixes();
        out(JSON.stringify(res));
        return res.errored ? 1 : 0;
      }
      case 'link': {
        const id = required(flag(argv, 'id'), '--id');
        const sha = required(flag(argv, 'sha'), '--sha');
        if (!validId(id) || !/^[0-9a-f]{40}$/.test(sha)) throw new Error('invalid id or SHA');
        const { link } = await import('./fixLifecycle.js');
        await link(id, sha);
        out(`linked ${id} -> ${sha} (merged)`);
        return 0;
      }
      case 'list': {
        const rows = argv.includes('--pending')
          ? await triageSvc.listPending()
          : argv.includes('--fix-pending')
            ? await triageSvc.listFixPending()
            : argv.includes('--dead-lettered')
              ? await triageSvc.listDeadLettered()
              : await triageSvc.listUntriaged();
        out(JSON.stringify(rows, null, 2));
        return 0;
      }
      case 'triage': {
        const id = flag(argv, 'id');
        const category = flag(argv, 'category');
        const note = flag(argv, 'note');
        if (!id || !category || !note) {
          out('triage requires --id, --category and --note');
          return 2;
        }
        await triageSvc.triage({
          id,
          category: category as FeedbackCategory,
          severity: (flag(argv, 'severity') as FeedbackSeverity) ?? null,
          note,
          dedupeOf: flag(argv, 'dedupe-of') ?? null,
        });
        out(`triaged ${id} as ${category}`);
        return 0;
      }
      case 'defer': {
        const id = flag(argv, 'id');
        const reason = flag(argv, 'reason');
        if (!id || !reason) {
          out('defer requires --id and --reason');
          return 2;
        }
        await triageSvc.defer(id, reason);
        out(`deferred ${id}`);
        return 0;
      }
      case 'email': {
        const id = flag(argv, 'id');
        const kind = flag(argv, 'kind');
        const body = flag(argv, 'body');
        if (!id || !kind || !body) {
          out('email requires --id, --kind and --body');
          return 2;
        }
        if (kind !== 'ack' && kind !== 'reply') {
          out(`kind must be 'ack' or 'reply' — 'resolved' is created only by check-shipped`);
          return 2;
        }
        const res = await emailSvc.sendFeedbackEmail({ id, kind, bodyText: body });
        out(JSON.stringify(res));
        return res.status === 'failed' ? 1 : 0;
      }
      case 'replay-pending': {
        const res = await emailSvc.replayPending();
        out(JSON.stringify(res));
        return res.paused ? 1 : 0;
      }
      default:
        out(`unknown command '${cmd}'\n\n${USAGE}`);
        return 2;
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    out(`error${code ? ` [${code}]` : ''}: ${(err as Error).message}`);
    return 1;
  } finally {
    await db.end().catch(() => {
      /* already closed */
    });
  }
}

// Only self-invoke when run directly, so the test can import the module.
if (process.argv[1] && process.argv[1].endsWith('feedbackTriage-cli.js')) {
  runCli(process.argv.slice(2), (s) => process.stdout.write(`${s}\n`)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`${String(err)}\n`);
      process.exit(1);
    },
  );
}
