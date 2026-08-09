// The two env vars W9 removes must be read NOWHERE. A stale reader would
// reintroduce exactly the redeploy coupling this wave exists to remove.
//
// CORPUS SELECTION IS THE HARD PART, NOT THE PATTERN. The first version of
// this sweep listed five subtrees (api/src, api/tests, frontend/src, docker,
// scripts) and passed with a live REPOS_ADMIN_EMAILS read sitting in
// `frontend/playwright.config.ts` — a file no root covered. (Spelling that
// read out literally here would make this very file an offender, which is the
// pattern doing its job.) A reach assertion
// over a hand-picked list only proves the list was scanned; it cannot prove
// the list is complete. So the walk is now EXCLUSION-based: everything in the
// repo is scanned unless a directory is explicitly ruled out, which fails
// toward over-scanning instead of toward a silent blind spot.
//
// The patterns are anchored on the READ, never on the bare name: migration
// 080's mapping header, the cfAccess.ts replacement comment and
// bootstrap-guards.ts all cite the removed variables on purpose, to record
// what replaced them. A bare-name assertion would force deleting that history.
import { describe, it, expect } from 'vitest';
import { readdir, readFile, stat, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, basename } from 'node:path';

const NAMES = 'CF_ACCESS_ALLOWED_EMAILS|REPOS_ADMIN_EMAILS';

/**
 * The env objects a read can come through. `process.env` is Node; Vite
 * exposes `import.meta.env` and the frontend genuinely uses it
 * (`tokens.ts`, `SettingsProgramPrefsPage.tsx`, …). Anchoring only on
 * `process.env` meant a frontend read of a removed variable was invisible to
 * a sweep whose entire job is to prove no read survives — and the frontend is
 * exactly where a `VITE_`-adjacent env read would be written.
 */
const ENV_ROOTS = ['process\\s*\\.\\s*env', 'import\\s*\\.\\s*meta\\s*\\.\\s*env'];

/**
 * JS/TS read forms, per env root. All tolerate whitespace, because a
 * formatter will happily produce `process.env[ 'X' ]` and the original
 * pattern matched only the tight form.
 */
const JS_READS = ENV_ROOTS.flatMap((root) => [
  new RegExp(`${root}\\s*\\.\\s*(${NAMES})\\b`), // <root>.X
  new RegExp(`${root}\\s*\\[\\s*['"\`]\\s*(${NAMES})`), // <root>['X']
  new RegExp(`\\{[^{}]*\\b(${NAMES})\\b[^{}]*\\}\\s*=\\s*${root}`), // const { X } = <root>
]);

/**
 * Shell / CI / container read AND declaration forms. A workflow that declares
 * `REPOS_ADMIN_EMAILS: ${{ secrets.X }}`, a Dockerfile `ENV X=`, or a
 * `export X=` in an s6 script all reintroduce the coupling just as surely as
 * a `process.env` read does.
 *
 * Applied ONLY to shell-shaped files. On .ts the declaration form would flag
 * `startup-guards.test.ts`, which passes the name as an object key precisely
 * to prove it is IGNORED — a legitimate non-read that must keep passing.
 */
const SHELL_READS = [
  new RegExp(`\\$\\{?(${NAMES})\\b`), // $X / ${X}
  new RegExp(`^\\s*(?:export\\s+|ENV\\s+|ARG\\s+)?(${NAMES})\\s*[:=]`, 'm'), // X= / X: / ENV X=
];

/** Build outputs, vendored code and VCS internals — never our source. */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  'coverage',
  'playwright-report',
  'test-results',
  '.worktrees',
  '.vite',
  'handoffs',
]);

const JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * Prose. Deliberately NOT scanned: docs may name, quote and explain both
 * variables — the plan quotes the old `.env.example` verbatim.
 */
const DOC_EXTENSIONS = new Set(['.md', '.mdx']);

/** Binary assets. Reading these as text finds nothing and costs a lot. */
const BINARY_EXTENSIONS = new Set([
  '.webp',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.gz',
  '.zip',
  '.tar',
  '.pdf',
  '.dump',
]);

/**
 * `.env` files split two ways, and blanket-skipping them was wrong.
 *
 * Genuinely LOCAL variants — `.env` itself and anything `*.local` — are
 * untracked developer machines and are skipped for the same reason a
 * developer's shell history is not the deployment. But FOUR `.env*` files are
 * TRACKED (`api/.env.example`, `frontend/.env.{example,development,production}`),
 * they ship, and a declaration in any of them is as live as one in a
 * Dockerfile. Those are scanned.
 */
function isLocalEnvFile(name: string): boolean {
  return name === '.env' || name.endsWith('.local');
}

/**
 * EXCLUSION, APPLIED TO EXTENSIONS TOO — the same lesson as the directory
 * walk, learned twice. The previous version allow-listed the extensions it
 * understood (`.sh|.yml|.json|.conf|.sql` + extensionless) and returned null
 * for everything else, so the exclusion-based *directory* walk fed an
 * enumeration-based *file* filter and the blind spot simply moved down a
 * level. A root-level `.toml` holding a live `REPOS_ADMIN_EMAILS = "..."`
 * declaration was scanned by the walk and then silently dropped here; all
 * four cases stayed green. Dotfiles were invisible for a subtler reason:
 * `extname('.nvmrc')` is `''`, but `basename('.nvmrc').includes('.')` is
 * true, so they matched neither the extension sets nor the extensionless
 * escape hatch.
 *
 * So the default is now SCANNED. Only prose and binaries are ruled out, and
 * an unrecognised extension fails toward over-scanning — a false positive
 * someone must look at — rather than toward a variable nobody can see.
 */
function classify(name: string): 'js' | 'shell' | null {
  // Tracked templates are shell-shaped (KEY=value); only local ones are skipped.
  if (name.startsWith('.env')) return isLocalEnvFile(name) ? null : 'shell';
  const ext = extname(name).toLowerCase();
  if (DOC_EXTENSIONS.has(ext)) return null;
  if (BINARY_EXTENSIONS.has(ext)) return null;
  if (JS_EXTENSIONS.has(ext)) return 'js';
  // Everything else is treated as shell-shaped config and gets BOTH pattern
  // families: .toml/.ini/.conf/.yml/.sql, dotfiles like .nvmrc and
  // .dockerignore, and extensionless files — docker/Dockerfile and
  // docker/root/etc/s6-overlay/scripts/* (run-api, init-migrations,
  // wait-for-postgres…), which is exactly where a container env var is
  // plumbed.
  return 'shell';
}

const repoRoot = join(process.cwd(), '..');

interface Scan {
  files: string[];
  offenders: string[];
}

async function walk(dir: string, acc: Scan): Promise<void> {
  for (const entry of await readdir(dir)) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    if ((await stat(p)).isDirectory()) {
      await walk(p, acc);
      continue;
    }
    const kind = classify(entry);
    if (kind === null) continue;
    acc.files.push(p);
    const body = await readFile(p, 'utf8');
    const patterns = kind === 'js' ? JS_READS : [...JS_READS, ...SHELL_READS];
    if (patterns.some((re) => re.test(body))) acc.offenders.push(p);
  }
}

// One walk for the whole file — it now covers the entire repo.
const scan: Promise<Scan> = (async () => {
  const acc: Scan = { files: [], offenders: [] };
  await walk(repoRoot, acc);
  return acc;
})();

describe('W9 env-var removal is complete', () => {
  it('no file READS CF_ACCESS_ALLOWED_EMAILS or REPOS_ADMIN_EMAILS', async () => {
    const { offenders } = await scan;
    expect(offenders.map((f) => f.slice(repoRoot.length + 1))).toEqual([]);
  });

  // `expect([]).toEqual([])` is also what a sweep that scanned NOTHING
  // returns. These paths are the specific blind spots the five-root version
  // had — config and CI files that live beside the source, not under it.
  it('the sweep reaches config and CI files, not just the source trees', async () => {
    const { files } = await scan;
    expect(files.length).toBeGreaterThan(400);
    for (const expected of [
      'frontend/playwright.config.ts', // outside every original root
      'api/vitest.integration.config.ts', // ditto
      '.github/workflows/test.yml', // ditto
      'api/package.json', // ditto (npm scripts)
      'docker/root/etc/s6-overlay/scripts/run-api', // extensionless
      'docker/Dockerfile', // extensionless
      'api/src/middleware/cfAccess.ts',
      'frontend/src/lib/api/adminUsers.ts',
      'scripts/run-restore.sh',
      'api/.env.example', // tracked env templates ship — only local .env is skipped
      'frontend/.env.production',
      'frontend/src/tokens.ts', // a real import.meta.env reader
    ]) {
      expect(
        files.some((f) => f.endsWith(expected)),
        `never scanned ${expected}`,
      ).toBe(true);
    }
  });

  // Pins the classifier against the blind spot that actually shipped. A
  // root-level `.toml` carrying a live declaration was walked and then
  // dropped by the extension allow-list, and all four other cases stayed
  // green. This runs the REAL walk over a fixture tree rather than asserting
  // on classify() in isolation, so it pins corpus selection end-to-end.
  //
  // `innocent.toml` is the non-vacuity control: it must appear in `files`.
  // Without it, a classifier that skipped every .toml would still satisfy the
  // offender assertion for the wrong reason.
  it('scans unfamiliar config extensions and dotfiles, skipping only docs and binaries', async () => {
    // Assembled at runtime so this file never LITERALLY spells a read form.
    // The sweep scans the whole repo including itself, and a fixture that
    // wrote `import.meta.env.<NAME>` as a source literal would make this test
    // an offender — the pattern working correctly, but on the wrong file.
    const RAE = ['REPOS_ADMIN', 'EMAILS'].join('_');
    const CAAE = ['CF_ACCESS_ALLOWED', 'EMAILS'].join('_');
    const fixture = await mkdtemp(join(tmpdir(), 'repos-sweep-fixture-'));
    try {
      await writeFile(join(fixture, 'evil.toml'), `[deploy]\n${RAE} = "boss@repos.test"\n`);
      await writeFile(join(fixture, '.nvmrc'), `export ${CAAE}=a@b.c\n`);
      // All three Vite read forms — the frontend uses import.meta.env, and
      // anchoring only on process.env made every one of these invisible.
      await writeFile(join(fixture, 'vite-dot.ts'), `export const a = import.meta.env.${RAE};\n`);
      await writeFile(
        join(fixture, 'vite-bracket.ts'),
        `export const b = import.meta.env['${CAAE}'];\n`,
      );
      await writeFile(
        join(fixture, 'vite-destructure.ts'),
        `const { ${RAE} } = import.meta.env;\n`,
      );
      // A tracked template ships; a local .env does not.
      await writeFile(join(fixture, '.env.production'), `${CAAE}=a@b.c\n`);
      await writeFile(join(fixture, '.env'), `${RAE}=local@dev.test\n`);
      await writeFile(join(fixture, 'innocent.toml'), '[deploy]\nOTHER = 1\n');
      await writeFile(join(fixture, 'notes.md'), 'REPOS_ADMIN_EMAILS=boss@repos.test\n');
      await writeFile(join(fixture, 'logo.webp'), 'REPOS_ADMIN_EMAILS=boss@repos.test\n');

      const acc: Scan = { files: [], offenders: [] };
      await walk(fixture, acc);
      const rel = (xs: string[]) => xs.map((f) => f.slice(fixture.length + 1)).sort();

      // Unfamiliar extension, dotfile, all three import.meta.env forms, and a
      // tracked env template are all caught.
      expect(rel(acc.offenders)).toEqual([
        '.env.production',
        '.nvmrc',
        'evil.toml',
        'vite-bracket.ts',
        'vite-destructure.ts',
        'vite-dot.ts',
      ]);
      // Prose, binaries and the LOCAL .env stay out of the corpus; the clean
      // .toml is in it (the non-vacuity control).
      expect(rel(acc.files)).toEqual([
        '.env.production',
        '.nvmrc',
        'evil.toml',
        'innocent.toml',
        'vite-bracket.ts',
        'vite-destructure.ts',
        'vite-dot.ts',
      ]);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  // The stricter bare-name rule, applied to every tracked env template rather
  // than the one path someone remembered. The set is DISCOVERED from the
  // walk, so a future `.env.staging` is held to it automatically — an
  // enumerated list here would be the same mistake this file has now made
  // twice at other levels.
  it('no tracked .env template so much as names either removed variable', async () => {
    const { files } = await scan;
    const templates = files.filter((f) => basename(f).startsWith('.env'));
    // Reach: api/.env.example + frontend/.env.{example,development,production}.
    expect(templates.length).toBeGreaterThanOrEqual(4);
    for (const f of templates) {
      const rel = f.slice(repoRoot.length + 1);
      const body = await readFile(f, 'utf8');
      expect(body, `${rel} names CF_ACCESS_ALLOWED_EMAILS`).not.toMatch(/CF_ACCESS_ALLOWED_EMAILS/);
      expect(body, `${rel} names REPOS_ADMIN_EMAILS`).not.toMatch(/REPOS_ADMIN_EMAILS/);
    }
  });

  // The history mentions must SURVIVE the sweep — if they ever start failing
  // it, the patterns have stopped being anchored on the read.
  it('deliberate history mentions are not offenders', async () => {
    const { offenders } = await scan;
    for (const historical of [
      'api/src/db/migrations/080_users_roles_status.sql',
      'api/src/middleware/cfAccess.ts',
      'api/src/bootstrap-guards.ts',
      'api/tests/unit/startup-guards.test.ts', // passes the name as an IGNORED input
    ]) {
      const body = await readFile(join(repoRoot, historical), 'utf8');
      expect(body).toMatch(new RegExp(NAMES)); // still records it
      expect(offenders.some((f) => f.endsWith(historical))).toBe(false);
    }
  });

  // The reader sweep matches read syntax in code files, so it can never catch
  // the tracked env template — `.env.example` declares rather than reads, and
  // is held to the STRICTER bare-name rule: an operator copies it to `.env`,
  // so a name there is an invitation to set it. Cite migration 080 instead.
  it('api/.env.example advertises the five new vars and neither removed one', async () => {
    const tpl = await readFile(join(process.cwd(), '.env.example'), 'utf8');
    expect(tpl).not.toMatch(/CF_ACCESS_ALLOWED_EMAILS/);
    expect(tpl).not.toMatch(/REPOS_ADMIN_EMAILS/);
    for (const v of [
      'CF_API_TOKEN',
      'CF_ACCOUNT_ID',
      'CF_ACCESS_POLICY_ID',
      'RESEND_API_KEY',
      'INVITE_FROM_EMAIL',
    ]) {
      expect(tpl).toContain(v);
    }
  });
});
