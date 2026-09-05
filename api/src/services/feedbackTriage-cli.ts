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

Every verb is idempotent. 'email' cannot send a 'resolved' notice; that kind is
created only by deployment verification.
`;

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function runCli(argv: string[], out: (s: string) => void): Promise<number> {
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    out(USAGE);
    return cmd ? 0 : 1;
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
