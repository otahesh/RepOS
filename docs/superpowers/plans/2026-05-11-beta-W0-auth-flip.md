# Beta W0 — Auth flip + cleanup + JWKS rotation test — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `CF_ACCESS_ENABLED=false` (alpha bypass) into `CF_ACCESS_ENABLED=true` (Beta default), delete every `PLACEHOLDER_USER_ID` fallback, ship 4 new startup sanity guards (DATABASE_URL unset, weak POSTGRES_PASSWORD, placeholder-row-after-cutover, persisted maintenance flag) + 1 boot log, turn the Sidebar avatar into a Radix Popover account menu with sign-out, prove JWKS cache invalidation works on key rotation, and ship a sentinel-gated cutover SQL that idempotently reattributes alpha weight history to the real CF-Access-provisioned user.

**Architecture:** Two phases. **Phase A (code, local + CI, ~1 day):** all the code changes land on a branch via TDD. **Phase B (operational, prod, ~30 min):** flip the `.env` flag + recreate the container (W0.1) + run the cutover script against live prod (W0.5-live). Phase B follows the existing Unraid recipe per memory `reference_unraid_redeploy.md`.

**Tech stack:** Unchanged. Fastify 5 + TypeScript + Postgres 16 (`api/`); Vite 5 + React 18 + TypeScript + Vitest (`frontend/`); `jose ^5.10.0` for JWT verification; `@radix-ui/react-popover ^1.1.2` (already in deps); `pg ^8.20.0`.

**Master plan:** `docs/superpowers/plans/2026-05-11-repos-beta.md`. W0 task surface is the source of truth; this per-wave plan executes it.

---

## Phase ordering (read before starting)

```
Task order:
  Pre-flight  →  W0.2  →  W0.3  →  W0.4  →  W0.6  →  W0.5-code  →  W0.1 (op)  →  W0.5-live (op)  →  Final smoke
   (test DB    (FE     (BE     (FE      (BE      (SQL +         (env flip     (run cutover         (CF
    provision)  delete) guards) Popover) JWKS)    scripts +      + redeploy    against live          Access
                                                  synthetic                    prod)                 working
                                                  test)                                              end-to-end)
```

**W0.2 through W0.6 are local code-only tasks executed via TDD.** They all land on a single branch `beta/w0-auth-flip-cleanup`. **W0.1 + W0.5-live are operational tasks** the user performs against prod once the branch is merged + GHCR builds a new `:latest`.

**Why this order:** Code phase first so the new image is ready when W0.1 redeploys. W0.5-code (cutover SQL + synthetic test) ships in the same branch so it's already on `main` when the live run happens; W0.5-live is just `psql -f scripts/cutover/001-placeholder-to-jmeyer.sql` against prod with the pre-snapshot taken first.

---

## Pre-flight (do before W0.2)

- [ ] **Pre.1 — Worktree.** This wave dispatches in an isolated worktree per `superpowers:using-git-worktrees`. Branch: `beta/w0-auth-flip-cleanup`. Working directory: the worktree, NOT `/Users/jasonmeyer.ict/Projects/RepOS`. Memory `feedback_worktree_isolation.md` applies — agent prompts must stay in the worktree.
- [ ] **Pre.2 — Provision a local test Postgres.** The standalone alpha test DB was retired. Run from the worktree:
  ```bash
  docker run -d --name repos-test-pg \
    -p 5433:5432 \
    -e POSTGRES_PASSWORD=test \
    -e POSTGRES_DB=repos_test \
    postgres:16
  ```
  Verify reachable: `docker exec repos-test-pg pg_isready -U postgres -d repos_test` → `accepting connections`.
- [ ] **Pre.3 — Configure `api/.env.test`** to point at the local test DB. Create if missing:
  ```
  DATABASE_URL=postgresql://postgres:test@127.0.0.1:5433/repos_test
  NODE_ENV=test
  ADMIN_API_KEY=test-admin-key
  ```
- [ ] **Pre.4 — Apply existing migrations to the test DB:** `cd api && npm run migrate` (or whatever the repo's migrate script is). Run once. Verify `psql $DATABASE_URL -c '\dt'` shows the alpha schema.
- [ ] **Pre.5 — Confirm baseline test green:** `cd api && npm test` and `cd frontend && npm test` both pass before any W0 change lands. **This is the "all green starting point" — any pre-existing flake gets investigated before W0.2 begins.**

---

## W0.2 — Delete PLACEHOLDER_USER_ID from frontend

**Files:**
- Modify: `frontend/src/auth.tsx:25-50, 116-121` — remove `PLACEHOLDER_USER_ID`, `PLACEHOLDER_USER`, and the `'disabled'` AuthStatus branch.
- Modify: `frontend/src/auth.tsx:37` — `AuthStatus` type: drop `'disabled'`.
- Modify: `frontend/src/components/layout/Sidebar.tsx:53-60` — remove `isPlaceholder` branch + "GUEST" / "placeholder mode" fallback.
- Modify: `frontend/src/__smoke__/navigation.smoke.test.tsx:23` — replace mock that returns `'disabled'` with one that returns `'authenticated'` + a fake user.
- Modify: `frontend/src/components/layout/AppShell.test.tsx:21` — same.
- New: `frontend/src/auth.test.tsx` — covers the AuthProvider state machine. The 503 → 'disabled' branch is gone; 503 from `/api/me` now goes to 'error' OR gets re-redirected via 401 path (we'll keep 503 as a hard error since post-flip a 503 means something else is wrong).

### Steps

- [ ] **W0.2.1 — Write failing test for AuthProvider 503 handling.**

  Create `frontend/src/auth.test.tsx`:
  ```tsx
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
  import { render, waitFor, screen } from '@testing-library/react'
  import { AuthProvider, useCurrentUser } from './auth'

  function Probe() {
    const { status, user, error } = useCurrentUser()
    return (
      <>
        <span data-testid="status">{status}</span>
        <span data-testid="user-id">{user?.id ?? 'none'}</span>
        <span data-testid="error">{error ?? 'none'}</span>
      </>
    )
  }

  describe('AuthProvider', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    beforeEach(() => { fetchSpy.mockReset() })
    afterEach(() => { fetchSpy.mockRestore() })

    it('lands on "authenticated" when /api/me returns 200', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(
        JSON.stringify({ id: 'u1', email: 'a@b.c', display_name: 'A', timezone: 'UTC' }),
        { status: 200 },
      ))
      render(<AuthProvider><Probe /></AuthProvider>)
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
      expect(screen.getByTestId('user-id').textContent).toBe('u1')
    })

    it('lands on "error" when /api/me returns 503 (post-flag-flip a 503 is broken, not transitional)', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(
        JSON.stringify({ error: 'cf_access_disabled' }),
        { status: 503 },
      ))
      render(<AuthProvider><Probe /></AuthProvider>)
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'))
      expect(screen.getByTestId('user-id').textContent).toBe('none')
    })

    it('lands on "error" on 500', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 500 }))
      render(<AuthProvider><Probe /></AuthProvider>)
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'))
    })
  })
  ```

- [ ] **W0.2.2 — Run test, observe failure.**
  `cd frontend && npm test -- auth.test`
  Expected: 2nd case fails — current code returns `'disabled'` on 503, test expects `'error'`.

- [ ] **W0.2.3 — Delete PLACEHOLDER_USER_ID + 'disabled' branch.**

  Edit `frontend/src/auth.tsx`:
  - Delete lines 25–28 (`PLACEHOLDER_USER_ID` constant + comment).
  - Delete lines 45–50 (`PLACEHOLDER_USER` object).
  - Change line 37 to: `export type AuthStatus = 'loading' | 'authenticated' | 'error'`
  - Delete lines 116–121 (the `if (res.status === 503)` block — let it fall through to the `'error'` branch).

- [ ] **W0.2.4 — Run test, observe pass.**
  `cd frontend && npm test -- auth.test`
  Expected: all 3 cases pass.

- [ ] **W0.2.5 — Update Sidebar to remove placeholder branch.**

  Edit `frontend/src/components/layout/Sidebar.tsx:49-60`. Replace:
  ```tsx
  const { user, status } = useCurrentUser()

  // AuthGate blocks render until status leaves 'loading', so user is non-null
  // here in both 'authenticated' and 'disabled' (placeholder) modes.
  const isPlaceholder = status === 'disabled'
  const trimmedName = user?.display_name?.trim() ?? ''
  const emailLocal = user?.email.split('@')[0]?.trim() ?? ''
  const primary = isPlaceholder
    ? 'GUEST'
    : (trimmedName || emailLocal || 'USER').toUpperCase()
  const secondary = isPlaceholder ? 'placeholder mode' : (user?.email ?? '')
  const initials = isPlaceholder ? 'G' : monogram(user?.display_name, user?.email ?? '')
  ```
  with:
  ```tsx
  const { user } = useCurrentUser()

  // AuthGate blocks render until status === 'authenticated', so user is non-null here.
  const trimmedName = user?.display_name?.trim() ?? ''
  const emailLocal = user?.email.split('@')[0]?.trim() ?? ''
  const primary = (trimmedName || emailLocal || 'USER').toUpperCase()
  const secondary = user?.email ?? ''
  const initials = monogram(user?.display_name, user?.email ?? '')
  ```

- [ ] **W0.2.6 — Update AuthGate to gate harder.** Edit `frontend/src/auth.tsx:149-179`. Currently `AuthGate` only blocks on `'loading'`. After the flip there are only 4 states (`loading` / `authenticated` / `error`); add a "not authenticated yet" block path so a transient `error` status doesn't leak to the Sidebar (which would render with `user=null`). Add at line 152 (between `if (status === 'loading')` and `if (status === 'error')`):
  ```tsx
    if (status !== 'authenticated') {
      // Defensive — any non-authenticated, non-loading status (just 'error') is handled below.
      // Sidebar reads `user` and depends on it being non-null.
    }
  ```
  Actually, simpler: ensure the `'error'` branch returns the error UI (already does) and the only fall-through is `'authenticated'`. The existing structure is fine; just verify the test still passes.

- [ ] **W0.2.7 — Update test fixtures.** Edit `frontend/src/__smoke__/navigation.smoke.test.tsx:23` and `frontend/src/components/layout/AppShell.test.tsx:21`. Search for mocks that return `status: 'disabled'` or import `PLACEHOLDER_USER_ID`. Replace with `status: 'authenticated'` and a synthetic user:
  ```tsx
  vi.mock('../../auth', () => ({
    useCurrentUser: () => ({
      status: 'authenticated',
      user: { id: 'test-user', email: 'test@example.com', display_name: 'Test User', timezone: 'UTC' },
      error: null,
    }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    AuthGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }))
  ```

- [ ] **W0.2.8 — Grep for residual `PLACEHOLDER_USER_ID` in frontend.** Run from worktree root:
  ```bash
  grep -rn "PLACEHOLDER_USER_ID\|'disabled'\|status === 'disabled'" frontend/src/ | grep -v node_modules
  ```
  Expected: zero hits, OR only in commented-out historical notes. If any code path matches, fix it.

- [ ] **W0.2.9 — Run full frontend test suite.**
  `cd frontend && npm test`
  Expected: all green.

- [ ] **W0.2.10 — Run typecheck.**
  `cd frontend && npm run typecheck` (or `npx tsc --noEmit`)
  Expected: no errors.

- [ ] **W0.2.11 — Commit.**
  ```bash
  git add frontend/src/auth.tsx frontend/src/auth.test.tsx \
          frontend/src/components/layout/Sidebar.tsx \
          frontend/src/__smoke__/navigation.smoke.test.tsx \
          frontend/src/components/layout/AppShell.test.tsx
  git commit -m "$(cat <<'EOF'
  refactor(frontend): drop PLACEHOLDER_USER_ID and 'disabled' AuthStatus branch

  Beta W0.2. Removes the cf-access-disabled transitional fallback to the
  placeholder user. AuthStatus collapses to loading | authenticated | error;
  503 from /api/me is now a hard error (post-flip, it means something is
  genuinely wrong, not "feature off"). Sidebar avatar drops the GUEST /
  placeholder-mode branch — user is non-null by AuthGate guarantee.

  Test fixtures in navigation.smoke + AppShell.test updated to mock
  status='authenticated'.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## W0.3 — Startup sanity guards (6 total: 2 existing + 4 new + 1 boot log)

**Files:**
- Modify: `api/src/index.ts:1-25` — extend the existing guard block.
- Modify: `api/src/db/client.ts` (or wherever the db is initialized) — surface `DATABASE_URL` unset early; or add to `index.ts` before the import.
- New: `api/tests/unit/startup-guards.test.ts` — covers the 4 new guards in isolation.

### Steps

- [ ] **W0.3.1 — Write failing tests for the new guards.**

  Create `api/tests/unit/startup-guards.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { validateStartupEnv, type StartupGuardResult } from '../../src/bootstrap-guards.js'

  describe('startup guards', () => {
    function envBase(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
      return {
        NODE_ENV: 'production',
        ADMIN_API_KEY: 'set',
        DATABASE_URL: 'postgresql://x',
        POSTGRES_PASSWORD: 'real-password',
        CF_ACCESS_ENABLED: 'true',
        CF_ACCESS_AUD: 'aud',
        CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
        CF_ACCESS_ALLOWED_EMAILS: 'a@b.c',
        ...overrides,
      } as NodeJS.ProcessEnv
    }

    it('passes a fully-valid prod env', () => {
      const r = validateStartupEnv(envBase())
      expect(r.fatal).toEqual([])
    })

    it('fails when CF_ACCESS_ENABLED=true but CF_ACCESS_AUD is missing', () => {
      const r = validateStartupEnv(envBase({ CF_ACCESS_AUD: undefined }))
      expect(r.fatal).toContain('CF_ACCESS_AUD must be set when CF_ACCESS_ENABLED=true')
    })

    it('fails when DATABASE_URL is unset', () => {
      const r = validateStartupEnv(envBase({ DATABASE_URL: undefined }))
      expect(r.fatal).toContain('DATABASE_URL must be set')
    })

    it('fails when POSTGRES_PASSWORD is the placeholder "changeme"', () => {
      const r = validateStartupEnv(envBase({ POSTGRES_PASSWORD: 'changeme' }))
      expect(r.fatal).toContain('POSTGRES_PASSWORD must not be the placeholder "changeme"')
    })

    it('passes when POSTGRES_PASSWORD is unset (dev path)', () => {
      const r = validateStartupEnv(envBase({ POSTGRES_PASSWORD: undefined }))
      expect(r.fatal).toEqual([])
    })

    it('emits an info log entry for allow-list count', () => {
      const r = validateStartupEnv(envBase({ CF_ACCESS_ALLOWED_EMAILS: 'a@b.c, b@b.c, c@b.c' }))
      expect(r.info).toContainEqual({ allowListCount: 3 })
    })

    it('emits 0 allow-list count when CF_ACCESS_ALLOWED_EMAILS unset', () => {
      const r = validateStartupEnv(envBase({ CF_ACCESS_ALLOWED_EMAILS: undefined }))
      expect(r.info).toContainEqual({ allowListCount: 0 })
    })
  })
  ```

- [ ] **W0.3.2 — Run test, observe failure.**
  `cd api && npm test -- startup-guards`
  Expected: module `../../src/bootstrap-guards.js` does not exist → test file fails to import.

- [ ] **W0.3.3 — Extract guard logic to a testable module.**

  Create `api/src/bootstrap-guards.ts`:
  ```ts
  // Pure env validation. No DB calls — those happen in `bootstrap-runtime.ts`.

  export interface StartupGuardResult {
    fatal: string[]
    info: Array<Record<string, unknown>>
  }

  export function validateStartupEnv(env: NodeJS.ProcessEnv): StartupGuardResult {
    const fatal: string[] = []
    const info: Array<Record<string, unknown>> = []

    if (env.NODE_ENV === 'production' && !env.ADMIN_API_KEY) {
      fatal.push('ADMIN_API_KEY must be set when NODE_ENV=production')
    }

    if (env.CF_ACCESS_ENABLED === 'true') {
      for (const key of ['CF_ACCESS_AUD', 'CF_ACCESS_TEAM_DOMAIN'] as const) {
        if (!env[key]) fatal.push(`${key} must be set when CF_ACCESS_ENABLED=true`)
      }
    }

    // NEW — Beta W0.3 guards
    if (!env.DATABASE_URL) {
      fatal.push('DATABASE_URL must be set')
    }
    if (env.POSTGRES_PASSWORD === 'changeme') {
      fatal.push('POSTGRES_PASSWORD must not be the placeholder "changeme"')
    }

    const allowList = (env.CF_ACCESS_ALLOWED_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    info.push({ allowListCount: allowList.length })

    return { fatal, info }
  }
  ```

- [ ] **W0.3.4 — Run test, observe pass.**
  `cd api && npm test -- startup-guards`
  Expected: 7 tests pass.

- [ ] **W0.3.5 — Wire the extracted module into `index.ts`.**

  Replace `api/src/index.ts` contents:
  ```ts
  import 'dotenv/config';
  import { validateStartupEnv } from './bootstrap-guards.js';
  import { validatePlaceholderPurge, validateMaintenanceFlag } from './bootstrap-runtime.js';
  import { buildApp } from './app.js';

  const guards = validateStartupEnv(process.env);
  for (const msg of guards.fatal) {
    console.error(`FATAL: ${msg}`);
  }
  if (guards.fatal.length > 0) process.exit(1);

  for (const entry of guards.info) {
    console.log(`[startup] ${JSON.stringify(entry)}`);
  }

  await validatePlaceholderPurge(process.env);
  await validateMaintenanceFlag(process.env);

  const app = await buildApp({ logger: true });
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen({ port, host });
  ```

- [ ] **W0.3.6 — Write failing test for placeholder-purge runtime guard.**

  Create `api/tests/integration/startup-placeholder-guard.test.ts`:
  ```ts
  import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
  import { db } from '../../src/db/client.js'
  import { validatePlaceholderPurge } from '../../src/bootstrap-runtime.js'

  const PLACEHOLDER_UUID = '00000000-0000-0000-0000-000000000001'

  describe('validatePlaceholderPurge', () => {
    afterEach(async () => {
      await db.query(`DELETE FROM users WHERE id = $1`, [PLACEHOLDER_UUID])
    })
    afterAll(async () => { await db.end() })

    it('exits non-zero when NODE_ENV=production and a placeholder user row exists', async () => {
      await db.query(
        `INSERT INTO users (id, email, timezone) VALUES ($1, 'placeholder@local', 'UTC')`,
        [PLACEHOLDER_UUID],
      )
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('exit-called')
      }) as never)
      await expect(
        validatePlaceholderPurge({ NODE_ENV: 'production' } as NodeJS.ProcessEnv),
      ).rejects.toThrow('exit-called')
      exitSpy.mockRestore()
    })

    it('passes in production when no placeholder user row exists', async () => {
      await expect(
        validatePlaceholderPurge({ NODE_ENV: 'production' } as NodeJS.ProcessEnv),
      ).resolves.toBeUndefined()
    })

    it('passes in test env even with placeholder row present', async () => {
      await db.query(
        `INSERT INTO users (id, email, timezone) VALUES ($1, 'placeholder@local', 'UTC')`,
        [PLACEHOLDER_UUID],
      )
      await expect(
        validatePlaceholderPurge({ NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      ).resolves.toBeUndefined()
    })
  })
  ```

  (Note: `vi` needs to be imported at top: `import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'`.)

- [ ] **W0.3.7 — Run test, observe failure.**
  `cd api && npm test -- startup-placeholder-guard`
  Expected: `bootstrap-runtime.js` does not exist.

- [ ] **W0.3.8 — Create the runtime-guards module.**

  Create `api/src/bootstrap-runtime.ts`:
  ```ts
  // Runtime guards that need DB or filesystem access — keep separated from
  // pure env validation so the latter stays trivially testable.

  import { existsSync } from 'node:fs';
  import { db } from './db/client.js';

  const PLACEHOLDER_UUID = '00000000-0000-0000-0000-000000000001';
  const MAINTENANCE_FLAG_PATH = process.env.MAINTENANCE_FLAG_PATH ?? '/config/maintenance.flag';

  export async function validatePlaceholderPurge(env: NodeJS.ProcessEnv): Promise<void> {
    if (env.NODE_ENV !== 'production') return;
    const { rows } = await db.query(
      `SELECT 1 FROM users WHERE id = $1 LIMIT 1`,
      [PLACEHOLDER_UUID],
    );
    if (rows.length > 0) {
      console.error(
        `FATAL: placeholder user row (id=${PLACEHOLDER_UUID}) found in production DB. ` +
        `Run scripts/cutover/001-placeholder-to-jmeyer.sql before booting.`,
      );
      process.exit(1);
    }
  }

  export async function validateMaintenanceFlag(env: NodeJS.ProcessEnv): Promise<void> {
    if (env.NODE_ENV === 'test') return;
    if (existsSync(MAINTENANCE_FLAG_PATH)) {
      console.error(
        `[startup] maintenance flag present at ${MAINTENANCE_FLAG_PATH} — ` +
        `API will boot but /api/* will return 503 (except /api/maintenance/*). ` +
        `Admin must clear the flag via /api/maintenance/clear once DB state is verified.`,
      );
      // Boot into maintenance mode — middleware (added in W5.3) reads the same path.
      // No process.exit; the API stays up but serves 503.
    }
  }
  ```

- [ ] **W0.3.9 — Run test, observe pass.**
  `cd api && npm test -- startup-placeholder-guard`
  Expected: 3 tests pass.

- [ ] **W0.3.10 — Smoke the wiring.**
  `cd api && DATABASE_URL=postgresql://postgres:test@127.0.0.1:5433/repos_test NODE_ENV=development node dist/index.js` (after `npm run build`) — should boot cleanly with `[startup] {"allowListCount":0}` in logs. Kill with Ctrl-C.

- [ ] **W0.3.11 — Commit.**
  ```bash
  git add api/src/index.ts api/src/bootstrap-guards.ts api/src/bootstrap-runtime.ts \
          api/tests/unit/startup-guards.test.ts \
          api/tests/integration/startup-placeholder-guard.test.ts
  git commit -m "$(cat <<'EOF'
  feat(api): add 4 new startup sanity guards for Beta

  Beta W0.3. Extracts startup guard logic to bootstrap-guards.ts (pure env
  validation) + bootstrap-runtime.ts (DB / FS checks) for testability.

  New guards:
  - DATABASE_URL must be set (was implicit).
  - POSTGRES_PASSWORD != "changeme" (Unraid placeholder rejection).
  - In NODE_ENV=production, no row with user_id=PLACEHOLDER_UUID may exist;
    refuses boot if cutover hasn't run.
  - Maintenance flag at MAINTENANCE_FLAG_PATH (default /config/maintenance.flag)
    causes boot into maintenance mode — API stays up, /api/* returns 503,
    /api/maintenance/* is the escape hatch (middleware lands in W5.3).

  Plus boot log: emits {"allowListCount": N} for CF_ACCESS_ALLOWED_EMAILS.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## W0.4 — Account menu (Radix Popover) on Sidebar avatar

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.tsx:222-266` — wrap the avatar block in `<Popover.Root>` / `<Popover.Trigger>` / `<Popover.Portal>` / `<Popover.Content>`.
- New: `frontend/src/components/layout/Sidebar.test.tsx` — verifies the Popover renders display name + email + "Account settings" + "Sign out" + invokes `/cdn-cgi/access/logout` on click.

### Steps

- [ ] **W0.4.1 — Write failing test.**

  Create `frontend/src/components/layout/Sidebar.test.tsx`:
  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest'
  import { render, screen, fireEvent } from '@testing-library/react'
  import { MemoryRouter } from 'react-router-dom'
  import Sidebar from './Sidebar'

  vi.mock('../../auth', () => ({
    useCurrentUser: () => ({
      status: 'authenticated',
      user: {
        id: 'u1',
        email: 'jason@jpmtech.com',
        display_name: 'Jason Meyer',
        timezone: 'America/New_York',
      },
      error: null,
    }),
  }))

  vi.mock('../../lib/useIsMobile', () => ({ useIsMobile: () => false }))

  describe('Sidebar account menu', () => {
    let assignSpy: ReturnType<typeof vi.fn>

    beforeEach(() => {
      assignSpy = vi.fn()
      Object.defineProperty(window, 'location', {
        value: { assign: assignSpy, href: 'https://repos.jpmtech.com/' },
        writable: true,
      })
    })

    it('renders the avatar and opens a popover on click revealing display name + email + Sign out', () => {
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>,
      )
      // Avatar is rendered with initials
      const trigger = screen.getByRole('button', { name: /account menu/i })
      expect(trigger).toBeInTheDocument()

      // Popover content is in a Portal — opens on click
      fireEvent.click(trigger)

      expect(screen.getByText('Jason Meyer')).toBeInTheDocument()
      expect(screen.getByText('jason@jpmtech.com')).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /account settings/i })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument()
    })

    it('navigates to /cdn-cgi/access/logout when Sign out is clicked', () => {
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>,
      )
      fireEvent.click(screen.getByRole('button', { name: /account menu/i }))
      fireEvent.click(screen.getByRole('menuitem', { name: /sign out/i }))
      expect(assignSpy).toHaveBeenCalledWith('/cdn-cgi/access/logout')
    })
  })
  ```

- [ ] **W0.4.2 — Run test, observe failure.**
  `cd frontend && npm test -- Sidebar.test`
  Expected: no `role="button"` named "account menu" exists.

- [ ] **W0.4.3 — Replace the avatar block with Radix Popover.**

  Add at the top of `Sidebar.tsx`:
  ```tsx
  import * as Popover from '@radix-ui/react-popover'
  import { NavLink, useLocation, useNavigate } from 'react-router-dom'
  ```

  Replace the avatar block (lines 222–265 of the existing file — confirm exact span before edit) with:
  ```tsx
  <Popover.Root>
    <Popover.Trigger asChild>
      <button
        aria-label="Account menu"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px',
          borderRadius: 8,
          border: `1px solid ${TOKENS.line}`,
          marginTop: 16,
          background: 'transparent',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        <div style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: `linear-gradient(135deg, ${TOKENS.heat3} 0%, ${TOKENS.accent} 100%)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: FONTS.mono,
          fontSize: 12,
          fontWeight: 700,
          color: '#fff',
          flexShrink: 0,
        }}>{initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: TOKENS.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{primary}</div>
          <div style={{
            fontSize: 10,
            color: TOKENS.textMute,
            fontFamily: FONTS.mono,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{secondary}</div>
        </div>
        <Icon name="settings" size={14} color={TOKENS.textMute} />
      </button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        align="start"
        side="top"
        sideOffset={8}
        style={{
          minWidth: 220,
          background: TOKENS.surface,
          border: `1px solid ${TOKENS.line}`,
          borderRadius: 10,
          padding: 8,
          boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
          zIndex: 60,
        }}
      >
        <div style={{ padding: '8px 10px', borderBottom: `1px solid ${TOKENS.line}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: TOKENS.text }}>
            {user?.display_name ?? user?.email ?? 'User'}
          </div>
          <div style={{ fontSize: 11, color: TOKENS.textMute, fontFamily: FONTS.mono, marginTop: 2 }}>
            {user?.email}
          </div>
        </div>
        <NavLink
          to="/settings/account"
          role="menuitem"
          style={{
            display: 'block',
            padding: '8px 10px',
            fontSize: 12,
            color: TOKENS.text,
            textDecoration: 'none',
            borderRadius: 6,
            marginTop: 4,
          }}
        >
          Account settings
        </NavLink>
        <button
          role="menuitem"
          onClick={() => { window.location.assign('/cdn-cgi/access/logout') }}
          style={{
            display: 'block',
            padding: '8px 10px',
            fontSize: 12,
            color: TOKENS.danger,
            background: 'transparent',
            border: 'none',
            borderRadius: 6,
            width: '100%',
            textAlign: 'left',
            cursor: 'pointer',
            marginTop: 2,
          }}
        >
          Sign out
        </button>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
  ```

- [ ] **W0.4.4 — Run test, observe pass.**
  `cd frontend && npm test -- Sidebar.test`
  Expected: both cases pass.

- [ ] **W0.4.5 — Run full frontend suite + typecheck.**
  ```bash
  cd frontend && npm test && npm run typecheck
  ```
  Expected: all green, no TS errors.

- [ ] **W0.4.6 — Commit.**
  ```bash
  git add frontend/src/components/layout/Sidebar.tsx \
          frontend/src/components/layout/Sidebar.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(frontend): Sidebar avatar becomes Radix Popover account menu

  Beta W0.4. Replaces the static avatar div with a Popover-triggered menu
  showing display_name + email + "Account settings" link + "Sign out"
  button that navigates to /cdn-cgi/access/logout. Mirrors the design
  spec for the post-CF-Access account surface.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

> **NOTE:** The Playwright assertion "after logout + reload, attempt to access cached SPA route → 302 to CF Access" (master plan W0.4 acceptance, G3.b/c) requires the W8.3 Playwright wiring (not yet built). That assertion ships as part of W8.3, NOT W0.4. W0.4 only ships the Vitest+RTL coverage.

---

## W0.6 — JWKS rotation test on JWT cache invalidation

**Files:**
- Modify: `api/src/middleware/cfAccess.ts:17-25` — tune `createRemoteJWKSet` options for cache TTL.
- New: `api/tests/integration/jwks-rotation.test.ts` — boot a mock JWKS HTTP server, sign JWTs with rotating keys, assert cache busts within budget.

### Steps

- [ ] **W0.6.1 — Write failing test (cache busts within 60s of key rotation).**

  Create `api/tests/integration/jwks-rotation.test.ts`:
  ```ts
  import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
  import { createServer, type Server } from 'node:http'
  import { generateKeyPair, exportJWK, SignJWT, type KeyLike, type JWK } from 'jose'
  import Fastify, { type FastifyInstance } from 'fastify'
  import { requireCfAccess } from '../../src/middleware/cfAccess.js'
  import { db } from '../../src/db/client.js'

  const TEAM_DOMAIN = 'beta-test.cloudflareaccess.com'
  const AUD = 'test-aud-beta-w0-6'
  let mockJwksServer: Server
  let mockJwksPort: number
  let activeJwk: JWK
  let activeKid: string

  async function makeJwk(kid: string): Promise<{ jwk: JWK; privateKey: KeyLike }> {
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
    const jwk = await exportJWK(publicKey)
    jwk.kid = kid
    jwk.alg = 'RS256'
    jwk.use = 'sig'
    return { jwk, privateKey }
  }

  beforeAll(async () => {
    mockJwksServer = createServer((req, res) => {
      if (req.url === '/cdn-cgi/access/certs') {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'max-age=10')
        res.end(JSON.stringify({ keys: [activeJwk] }))
        return
      }
      res.statusCode = 404
      res.end()
    })
    await new Promise<void>((resolve) => mockJwksServer.listen(0, resolve))
    mockJwksPort = (mockJwksServer.address() as { port: number }).port

    process.env.CF_ACCESS_ENABLED = 'true'
    process.env.CF_ACCESS_AUD = AUD
    process.env.CF_ACCESS_TEAM_DOMAIN = `127.0.0.1:${mockJwksPort}` // dev-only, hostname override
    process.env.CF_ACCESS_ALLOWED_EMAILS = 'a@b.c'
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      mockJwksServer.close((err) => (err ? reject(err) : resolve())),
    )
    await db.query(`DELETE FROM users WHERE email = 'a@b.c'`)
    await db.end()
  })

  async function buildHarness(): Promise<FastifyInstance> {
    const app = Fastify()
    app.addHook('preHandler', requireCfAccess)
    app.get('/probe', async () => ({ ok: true }))
    return app
  }

  it(
    'evicts the JWKS cache within 60s and accepts JWTs signed by the rotated-in key',
    async () => {
      // 1. Start with key-A
      const a = await makeJwk('kid-A')
      activeJwk = a.jwk
      activeKid = 'kid-A'

      const app = await buildHarness()
      const aJwt = await new SignJWT({ email: 'a@b.c' })
        .setProtectedHeader({ alg: 'RS256', kid: 'kid-A' })
        .setIssuer(`https://127.0.0.1:${mockJwksPort}`)
        .setAudience(AUD)
        .setExpirationTime('5m')
        .sign(a.privateKey)
      const r1 = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { 'cf-access-jwt-assertion': aJwt },
      })
      expect(r1.statusCode).toBe(200) // happy path

      // 2. Rotate: server now serves key-B only; sign new JWT with key-B
      const b = await makeJwk('kid-B')
      activeJwk = b.jwk
      activeKid = 'kid-B'

      const bJwt = await new SignJWT({ email: 'a@b.c' })
        .setProtectedHeader({ alg: 'RS256', kid: 'kid-B' })
        .setIssuer(`https://127.0.0.1:${mockJwksPort}`)
        .setAudience(AUD)
        .setExpirationTime('5m')
        .sign(b.privateKey)

      // 3. Within the JWKS cooldown window, the rotated-out kid-A JWT still
      //    works (jose has the old key cached), and kid-B fails with 401
      //    UNTIL the cache refreshes. Wait 60s budget.
      const t0 = Date.now()
      let lastB = 401
      let lastA = 200
      while (Date.now() - t0 < 60_000) {
        const rB = await app.inject({
          method: 'GET',
          url: '/probe',
          headers: { 'cf-access-jwt-assertion': bJwt },
        })
        lastB = rB.statusCode
        if (lastB === 200) break
        await new Promise((r) => setTimeout(r, 5_000))
      }
      expect(lastB).toBe(200) // new key accepted within 60s

      // 4. After rotation propagates, kid-A JWTs return 401
      //    (key not in JWKS anymore).
      const rA2 = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { 'cf-access-jwt-assertion': aJwt },
      })
      expect(rA2.statusCode).toBe(401)

      await app.close()
    },
    90_000, // test timeout
  )
  ```

  > **Implementation note:** The mock JWKS server uses HTTP (not HTTPS), so `jose`'s `createRemoteJWKSet` URL must be `http://...` not `https://...`. We override the URL construction in the middleware tune step below.

- [ ] **W0.6.2 — Run test, observe failure.**
  `cd api && npm test -- jwks-rotation`
  Expected: test times out at 90s — the cache doesn't bust within 60s with default jose settings.

- [ ] **W0.6.3 — Tune `createRemoteJWKSet` cache parameters.**

  Edit `api/src/middleware/cfAccess.ts:17-25`. Replace the `jwks()` function with:
  ```ts
  // Cache: refresh JWKS at most every 30s under normal traffic; force a refresh
  // immediately when a kid is missed (cooldownDuration=0 means "don't rate-limit
  // missed-kid refreshes"). With CF Access's documented JWKS rotation cadence
  // (occasional, low-frequency), this yields a 60s p99 budget for key rotation
  // to take effect across all replicas.
  //
  // Beta W0.6 test in api/tests/integration/jwks-rotation.test.ts proves this.
  let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  function jwks() {
    if (cachedJwks) return cachedJwks;
    const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN;
    if (!teamDomain) throw new Error('CF_ACCESS_TEAM_DOMAIN must be set');
    // Honor a non-https protocol only in NODE_ENV=test (the mock JWKS server uses HTTP).
    const proto = process.env.NODE_ENV === 'test' && teamDomain.startsWith('127.0.0.1') ? 'http' : 'https';
    cachedJwks = createRemoteJWKSet(
      new URL(`${proto}://${teamDomain}/cdn-cgi/access/certs`),
      {
        cacheMaxAge: 30_000,        // 30s soft refresh
        cooldownDuration: 0,         // immediate refresh on cache miss for a kid
      },
    );
    return cachedJwks;
  }

  // Test-only escape hatch: reset the cached JWKS between integration tests so a
  // rotation in test N doesn't leak into test N+1.
  export function resetJwksCacheForTesting(): void {
    cachedJwks = null;
  }
  ```

- [ ] **W0.6.4 — Wire `resetJwksCacheForTesting` into the test's `beforeEach`.**

  At the top of `jwks-rotation.test.ts`:
  ```ts
  import { requireCfAccess, resetJwksCacheForTesting } from '../../src/middleware/cfAccess.js'

  beforeEach(() => { resetJwksCacheForTesting() })
  ```

- [ ] **W0.6.5 — Run test, observe pass.**
  `cd api && npm test -- jwks-rotation`
  Expected: test passes within ~30-40s wall-clock.

- [ ] **W0.6.6 — Commit.**
  ```bash
  git add api/src/middleware/cfAccess.ts api/tests/integration/jwks-rotation.test.ts
  git commit -m "$(cat <<'EOF'
  feat(api): tune JWKS cache for 60s rotation propagation budget

  Beta W0.6. Adds explicit cacheMaxAge=30s + cooldownDuration=0 to the
  jose createRemoteJWKSet call so CF Access JWKS rotation propagates to
  the API within 60s p99 (was: rely on default jose / HTTP cache headers,
  which could leave a rotated-out kid serving traffic indefinitely).

  Integration test boots a mock JWKS server, signs JWTs with kid-A,
  rotates server to kid-B only, asserts: (1) kid-B JWT accepted within 60s,
  (2) kid-A JWT subsequently 401s.

  Exports resetJwksCacheForTesting() — test-only escape hatch.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## W0.5 (code) — Cutover SQL + scripts + synthetic test

**Files:**
- New: `api/src/db/migrations/028_health_weight_samples_migrated_sentinel.sql` — adds `migrated_from_placeholder_at TIMESTAMPTZ NULL` to `health_weight_samples`.
- New: `scripts/cutover/001-placeholder-to-jmeyer.sql` — idempotent reattribution.
- New: `scripts/pre-restore-snapshot.sh` — pg_dump trigger used here AND by W5.3 restore route.
- New: `tests/cutover/synthetic.test.sh` — runs the cutover against `repos_test` with seeded fixtures.
- New: `tests/cutover/alpha-clone.test.sh` — runs the cutover against an alpha-DB clone (user provides the dump path via env var).

### Steps

- [ ] **W0.5.1 — Write the synthetic test first (TDD).**

  Create `tests/cutover/synthetic.test.sh`:
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail

  # Synthetic alpha-clone test for scripts/cutover/001-placeholder-to-jmeyer.sql.
  # Seeds a placeholder user + 3 weight samples + 1 sync_status row, then runs
  # the cutover and asserts:
  #   - placeholder count after cutover = 0
  #   - jmeyer count after cutover = original placeholder count
  #   - no duplicate rows
  #   - sentinel column populated
  #   - re-run is a no-op

  : "${DATABASE_URL:?DATABASE_URL must be set (use the local test DB connection string)}"
  PSQL="psql ${DATABASE_URL} -v ON_ERROR_STOP=1"

  PLACEHOLDER_UUID='00000000-0000-0000-0000-000000000001'

  echo "→ Seeding fixtures..."
  $PSQL <<SQL
  DELETE FROM health_weight_samples WHERE user_id IN (
    '${PLACEHOLDER_UUID}',
    (SELECT id FROM users WHERE email='jason@jpmtech.com')
  );
  DELETE FROM users WHERE email IN ('placeholder@local', 'jason@jpmtech.com');

  INSERT INTO users (id, email, timezone) VALUES
    ('${PLACEHOLDER_UUID}', 'placeholder@local', 'UTC');

  INSERT INTO users (email, timezone) VALUES
    ('jason@jpmtech.com', 'America/New_York');

  INSERT INTO health_weight_samples (user_id, sample_date, sample_time, weight_lbs, source) VALUES
    ('${PLACEHOLDER_UUID}', '2026-04-15', '07:00:00', 180.0, 'Apple Health'),
    ('${PLACEHOLDER_UUID}', '2026-04-16', '07:00:00', 179.5, 'Apple Health'),
    ('${PLACEHOLDER_UUID}', '2026-04-17', '07:00:00', 179.0, 'Apple Health');
  SQL

  echo "→ Running cutover SQL..."
  $PSQL -f scripts/cutover/001-placeholder-to-jmeyer.sql -v target_email='jason@jpmtech.com'

  echo "→ Asserting..."
  PLACEHOLDER_COUNT=$($PSQL -tA -c "SELECT count(*) FROM health_weight_samples WHERE user_id='${PLACEHOLDER_UUID}'")
  JMEYER_COUNT=$($PSQL -tA -c "SELECT count(*) FROM health_weight_samples hws JOIN users u ON u.id=hws.user_id WHERE u.email='jason@jpmtech.com'")
  DUPE_COUNT=$($PSQL -tA -c "SELECT count(*) FROM (SELECT id FROM health_weight_samples GROUP BY id HAVING count(*) > 1) x")
  SENTINEL_COUNT=$($PSQL -tA -c "SELECT count(*) FROM health_weight_samples WHERE migrated_from_placeholder_at IS NOT NULL")

  test "$PLACEHOLDER_COUNT" = "0" || { echo "FAIL: placeholder rows remain: $PLACEHOLDER_COUNT"; exit 1; }
  test "$JMEYER_COUNT" = "3"      || { echo "FAIL: jmeyer count != 3: $JMEYER_COUNT"; exit 1; }
  test "$DUPE_COUNT" = "0"        || { echo "FAIL: duplicate ids: $DUPE_COUNT"; exit 1; }
  test "$SENTINEL_COUNT" = "3"    || { echo "FAIL: sentinel not populated on all migrated rows: $SENTINEL_COUNT"; exit 1; }

  echo "→ Re-running cutover (must be no-op)..."
  $PSQL -f scripts/cutover/001-placeholder-to-jmeyer.sql -v target_email='jason@jpmtech.com'
  JMEYER_AFTER_RERUN=$($PSQL -tA -c "SELECT count(*) FROM health_weight_samples hws JOIN users u ON u.id=hws.user_id WHERE u.email='jason@jpmtech.com'")
  test "$JMEYER_AFTER_RERUN" = "3" || { echo "FAIL: re-run created duplicates: $JMEYER_AFTER_RERUN"; exit 1; }

  echo "✓ synthetic cutover test PASS"
  ```

  `chmod +x tests/cutover/synthetic.test.sh`.

- [ ] **W0.5.2 — Run the test, observe failure.**
  ```bash
  DATABASE_URL=postgresql://postgres:test@127.0.0.1:5433/repos_test bash tests/cutover/synthetic.test.sh
  ```
  Expected: psql errors — neither the migration nor the cutover SQL exists yet.

- [ ] **W0.5.3 — Create the sentinel migration.**

  Create `api/src/db/migrations/028_health_weight_samples_migrated_sentinel.sql`:
  ```sql
  -- Beta W0.5 — sentinel column for idempotent placeholder → real-user cutover.
  -- Set by scripts/cutover/001-placeholder-to-jmeyer.sql; null means "not migrated."

  ALTER TABLE health_weight_samples
    ADD COLUMN IF NOT EXISTS migrated_from_placeholder_at TIMESTAMPTZ NULL;
  ```

- [ ] **W0.5.4 — Apply the migration to the test DB.**
  `cd api && npm run migrate` (or whatever runner is wired; if not yet, run `psql $DATABASE_URL -f api/src/db/migrations/028_*.sql` manually).

- [ ] **W0.5.5 — Create the cutover SQL.**

  Create `scripts/cutover/001-placeholder-to-jmeyer.sql`:
  ```sql
  -- Beta W0.5 — placeholder → real-user cutover.
  --
  -- Idempotent + sentinel-gated: reattributes rows from
  -- user_id = PLACEHOLDER_UUID to the real CF-Access-provisioned user matching
  -- :target_email. Re-runs are no-ops (sentinel filters already-migrated rows).
  --
  -- Pre-flight: scripts/pre-restore-snapshot.sh runs BEFORE this script in the
  -- ops runbook; the dump it produces is the rollback path.
  --
  -- Usage (psql):
  --   psql $DATABASE_URL -v target_email='jason@jpmtech.com' -f scripts/cutover/001-placeholder-to-jmeyer.sql

  \set placeholder_uuid '00000000-0000-0000-0000-000000000001'

  BEGIN;

  -- Resolve the real user UUID. Fail loudly if the user doesn't exist —
  -- they should be auto-provisioned by CF Access first login before this runs.
  DO $$
  DECLARE target_uuid uuid;
  BEGIN
    SELECT id INTO target_uuid FROM users WHERE lower(email) = lower(:'target_email');
    IF target_uuid IS NULL THEN
      RAISE EXCEPTION 'No user found with email %. CF Access must auto-provision them via login before cutover runs.', :'target_email';
    END IF;
  END $$;

  -- Reattribute weight samples. Sentinel-gated.
  UPDATE health_weight_samples hws
  SET
    user_id = (SELECT id FROM users WHERE lower(email) = lower(:'target_email')),
    migrated_from_placeholder_at = now()
  WHERE
    hws.user_id = :'placeholder_uuid'::uuid
    AND hws.migrated_from_placeholder_at IS NULL;

  -- Reattribute sync status (best-effort; ON CONFLICT do nothing if target user already has one).
  -- health_sync_status has UNIQUE(user_id, source) so duplicate moves would fail; merge via DELETE-then-UPDATE.
  DELETE FROM health_sync_status
  WHERE user_id = (SELECT id FROM users WHERE lower(email) = lower(:'target_email'))
    AND source IN (
      SELECT source FROM health_sync_status WHERE user_id = :'placeholder_uuid'::uuid
    );

  UPDATE health_sync_status
  SET user_id = (SELECT id FROM users WHERE lower(email) = lower(:'target_email'))
  WHERE user_id = :'placeholder_uuid'::uuid;

  -- Post-cutover: the placeholder users row no longer has any rows referencing it.
  -- Safe to delete the placeholder user itself (CASCADE is a no-op since we
  -- already moved everything). Keep the row if you want forensics — but for
  -- the W0.3 startup guard to pass, it must be deleted.
  DELETE FROM users WHERE id = :'placeholder_uuid'::uuid;

  COMMIT;

  -- Reporting (out-of-tx; helps the operator):
  SELECT 'placeholder rows remaining' AS metric, count(*) AS value
    FROM health_weight_samples WHERE user_id = :'placeholder_uuid'::uuid
  UNION ALL
  SELECT 'rows migrated this run', count(*)
    FROM health_weight_samples WHERE migrated_from_placeholder_at >= now() - interval '1 minute'
  UNION ALL
  SELECT 'jmeyer total rows', count(*)
    FROM health_weight_samples hws
    JOIN users u ON u.id = hws.user_id
    WHERE lower(u.email) = lower(:'target_email');
  ```

- [ ] **W0.5.6 — Re-run the synthetic test, observe pass.**
  ```bash
  DATABASE_URL=postgresql://postgres:test@127.0.0.1:5433/repos_test bash tests/cutover/synthetic.test.sh
  ```
  Expected: `✓ synthetic cutover test PASS`.

- [ ] **W0.5.7 — Create `scripts/pre-restore-snapshot.sh`.**

  Create `scripts/pre-restore-snapshot.sh`:
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail

  # Takes a pg_dump snapshot before a destructive operation (cutover SQL, W5.3
  # restore route). Output: /config/backups/pre-restore-<ts>.sql.gz + sidecar
  # JSON tagged trigger:'pre_restore'. 24h retention separate from nightly.
  #
  # Used by:
  #   - scripts/cutover/001-placeholder-to-jmeyer.sql (run this manually before psql)
  #   - api/src/routes/maintenance.ts (W5.3) — first step of restore flow

  : "${DATABASE_URL:?DATABASE_URL must be set}"

  BACKUPS_DIR="${BACKUPS_DIR:-/config/backups}"
  TS=$(date -u +%Y%m%dT%H%M%SZ)
  OUT_DUMP="${BACKUPS_DIR}/pre-restore-${TS}.sql.gz"
  OUT_SIDECAR="${BACKUPS_DIR}/pre-restore-${TS}.json"

  mkdir -p "${BACKUPS_DIR}"

  echo "→ Capturing pre-restore snapshot to ${OUT_DUMP}..."
  pg_dump --format=custom "${DATABASE_URL}" | gzip > "${OUT_DUMP}"
  SIZE=$(wc -c < "${OUT_DUMP}")

  cat > "${OUT_SIDECAR}" <<EOF
  {
    "file": "$(basename "${OUT_DUMP}")",
    "size_bytes": ${SIZE},
    "trigger": "pre_restore",
    "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  }
  EOF

  echo "✓ pre-restore snapshot captured: ${OUT_DUMP} (${SIZE} bytes)"
  ```
  `chmod +x scripts/pre-restore-snapshot.sh`.

- [ ] **W0.5.8 — Create the alpha-clone test stub.**

  Create `tests/cutover/alpha-clone.test.sh`:
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail

  # Beta W0.5 alpha-clone cutover test.
  #
  # PREREQUISITES (the operator provides these):
  #   1. ALPHA_DUMP_PATH points to a pg_dump --format=custom of jmeyer's actual
  #      alpha database, taken 2026-05-07 or later. Acquire via:
  #        ssh root@unraid 'docker exec repos pg_dump -Fc -U postgres repos | gzip' > alpha-dump-YYYYMMDD.sql.gz
  #   2. DATABASE_URL points to a fresh, empty Postgres (use the existing test
  #      DB; this script wipes it first).
  #
  # The test restores the alpha dump, runs the cutover, and asserts the same
  # invariants as synthetic.test.sh — but against real-shape data.

  : "${ALPHA_DUMP_PATH:?ALPHA_DUMP_PATH must point at the alpha pg_dump (custom format)}"
  : "${DATABASE_URL:?DATABASE_URL must be set}"

  echo "→ Wiping test DB..."
  psql "${DATABASE_URL}" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null

  echo "→ Restoring alpha dump (${ALPHA_DUMP_PATH})..."
  if [[ "${ALPHA_DUMP_PATH}" == *.gz ]]; then
    gunzip -c "${ALPHA_DUMP_PATH}" | pg_restore --no-owner --no-privileges --dbname="${DATABASE_URL}"
  else
    pg_restore --no-owner --no-privileges --dbname="${DATABASE_URL}" "${ALPHA_DUMP_PATH}"
  fi

  echo "→ Applying migration 028 (sentinel column)..."
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f api/src/db/migrations/028_health_weight_samples_migrated_sentinel.sql

  echo "→ Capturing before-counts..."
  PLACEHOLDER_BEFORE=$(psql "${DATABASE_URL}" -tA -c "SELECT count(*) FROM health_weight_samples WHERE user_id='00000000-0000-0000-0000-000000000001'")
  echo "  placeholder rows before: ${PLACEHOLDER_BEFORE}"

  if [ "${PLACEHOLDER_BEFORE}" = "0" ]; then
    echo "⚠ alpha dump has no placeholder rows. Either cutover was already run, or the alpha used a different user_id. Aborting."
    exit 1
  fi

  echo "→ Ensuring jason@jpmtech.com exists in the restored DB (simulates CF Access auto-provisioning)..."
  psql "${DATABASE_URL}" -c "INSERT INTO users (email, timezone) VALUES ('jason@jpmtech.com', 'America/New_York') ON CONFLICT (email) DO NOTHING;"

  echo "→ Running cutover SQL..."
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -v target_email='jason@jpmtech.com' -f scripts/cutover/001-placeholder-to-jmeyer.sql

  echo "→ Asserting invariants..."
  PLACEHOLDER_AFTER=$(psql "${DATABASE_URL}" -tA -c "SELECT count(*) FROM health_weight_samples WHERE user_id='00000000-0000-0000-0000-000000000001'")
  JMEYER_AFTER=$(psql "${DATABASE_URL}" -tA -c "SELECT count(*) FROM health_weight_samples hws JOIN users u ON u.id=hws.user_id WHERE lower(u.email)='jason@jpmtech.com'")
  DUPES=$(psql "${DATABASE_URL}" -tA -c "SELECT count(*) FROM (SELECT id FROM health_weight_samples GROUP BY id HAVING count(*) > 1) x")
  PLACEHOLDER_USER_GONE=$(psql "${DATABASE_URL}" -tA -c "SELECT count(*) FROM users WHERE id='00000000-0000-0000-0000-000000000001'")

  test "${PLACEHOLDER_AFTER}" = "0"        || { echo "FAIL: placeholder rows remain: ${PLACEHOLDER_AFTER}"; exit 1; }
  test "${JMEYER_AFTER}" = "${PLACEHOLDER_BEFORE}" || { echo "FAIL: jmeyer count ≠ before-placeholder count (${JMEYER_AFTER} vs ${PLACEHOLDER_BEFORE})"; exit 1; }
  test "${DUPES}" = "0"                     || { echo "FAIL: duplicate IDs: ${DUPES}"; exit 1; }
  test "${PLACEHOLDER_USER_GONE}" = "0"     || { echo "FAIL: placeholder users row still present"; exit 1; }

  echo "✓ alpha-clone cutover test PASS (migrated ${JMEYER_AFTER} weight samples)"
  ```
  `chmod +x tests/cutover/alpha-clone.test.sh`.

- [ ] **W0.5.9 — Commit.**
  ```bash
  git add api/src/db/migrations/028_health_weight_samples_migrated_sentinel.sql \
          scripts/cutover/001-placeholder-to-jmeyer.sql \
          scripts/pre-restore-snapshot.sh \
          tests/cutover/synthetic.test.sh \
          tests/cutover/alpha-clone.test.sh
  git commit -m "$(cat <<'EOF'
  feat(cutover): placeholder → real-user reattribution SQL + tests

  Beta W0.5 (code). Ships:

  - migration 028: health_weight_samples.migrated_from_placeholder_at
    TIMESTAMPTZ sentinel for idempotency.
  - scripts/cutover/001-placeholder-to-jmeyer.sql: takes :target_email,
    moves weight samples + sync_status rows from PLACEHOLDER_UUID to the
    real user (must already exist — auto-provisioned by CF Access), then
    deletes the placeholder users row. Sentinel-gated so re-runs are no-ops.
  - scripts/pre-restore-snapshot.sh: pg_dump trigger used here AND
    by W5.3 restore route. Outputs to /config/backups/pre-restore-<ts>.sql.gz
    + sidecar JSON.
  - tests/cutover/synthetic.test.sh: seeds fixtures in repos_test, runs
    cutover, asserts row counts + sentinel + re-run no-op.
  - tests/cutover/alpha-clone.test.sh: restores a real alpha pg_dump
    (operator provides via ALPHA_DUMP_PATH), runs cutover, asserts the
    same invariants against real-shape data.

  ND5 conditions all met: named owner (W0 implementer), alpha-clone test,
  placeholder-attribution test with row-count assertion, idempotency sentinel.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## End-of-code-phase verification

- [ ] **EOP.1 — Full local CI green.**
  ```bash
  cd api && npm test && npm run typecheck && npm run build
  cd ../frontend && npm test && npm run typecheck && npm run build
  ```
  Expected: all green.

- [ ] **EOP.2 — Synthetic cutover green.**
  ```bash
  DATABASE_URL=postgresql://postgres:test@127.0.0.1:5433/repos_test bash tests/cutover/synthetic.test.sh
  ```

- [ ] **EOP.3 — Alpha-clone cutover green (operator provides dump).**

  Operator (user) action: from a terminal with SSH access to Unraid:
  ```bash
  ssh root@192.168.88.10 'docker exec repos pg_dump -Fc -U postgres repos | gzip' > /tmp/alpha-dump-$(date +%Y%m%d).sql.gz
  ```
  Then from the worktree:
  ```bash
  ALPHA_DUMP_PATH=/tmp/alpha-dump-20260511.sql.gz \
    DATABASE_URL=postgresql://postgres:test@127.0.0.1:5433/repos_test \
    bash tests/cutover/alpha-clone.test.sh
  ```
  Expected: `✓ alpha-clone cutover test PASS (migrated N weight samples)`.

- [ ] **EOP.4 — CLAUDE.md scope update.** Edit `CLAUDE.md` "v2 (out of scope)" line — remove `GHCR + CI builds, log rotation, Postgres backups` (all already shipped per Pre-flight observations). Commit:
  ```bash
  git add CLAUDE.md
  git commit -m "$(cat <<'EOF'
  docs(claude-md): drop stale v2-out-of-scope items now shipped

  Beta W0 cleanup. GHCR + CI builds, log rotation, Postgres backups all
  shipped in the alpha monolithic-container deploy; remove from the
  out-of-scope list so future agents don't re-add them.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **EOP.5 — Push branch.**
  ```bash
  git push -u origin beta/w0-auth-flip-cleanup
  ```

- [ ] **EOP.6 — Merge to main.** Either via PR + review, or fast-forward locally if user confirms. **STOP at this checkpoint — get user confirmation before merging** (the merge triggers GHCR rebuild which is the operational kickoff).

---

## W0.1 + W0.5-live — Operational tasks (USER PASTE)

Once `main` carries the W0 commits AND GHCR has built a new `:latest` (workflow at `.github/workflows/docker.yml`), perform the cutover in this order. **These commands run on the Unraid host, not in the worktree** — per memory `feedback_command_pasting.md`, numbered steps so the operator can paste each independently and verify between.

### Step 1 — Verify GHCR image is current

On the Unraid CLI:
```bash
docker pull ghcr.io/otahesh/repos:latest
docker image inspect ghcr.io/otahesh/repos:latest --format '{{.Created}}'
```
The timestamp should be after the merge commit's timestamp.

### Step 2 — Capture pre-restore snapshot

On the Unraid CLI:
```bash
docker exec repos /scripts/pre-restore-snapshot.sh
ls -la /mnt/user/appdata/repos/config/backups/pre-restore-*.sql.gz | tail -1
```
The latest file should be a few hundred KB to a few MB. This is the cutover rollback path.

### Step 3 — Verify CF Access app + Bypass policy in CF dashboard

Open the Cloudflare dashboard → Zero Trust → Access → Applications:
- Confirm an application `RepOS` exists with policy `Owner-Only` (allow-list contains `jason@jpmtech.com`).
- Confirm a Bypass rule covers `/api/health/*` paths (so the iOS Shortcut bearer flow keeps working).

If either is missing, **STOP** and configure them before proceeding.

### Step 4 — Flip the env flag

Edit `/mnt/user/appdata/repos/.env`:
```diff
-CF_ACCESS_ENABLED=false
+CF_ACCESS_ENABLED=true
```
Save.

### Step 5 — Recreate the container with the new image + flag (per memory `reference_unraid_redeploy.md`)

On the Unraid CLI:
```bash
docker stop repos
docker rm repos
docker run -d \
  --name repos \
  --restart unless-stopped \
  --network br0 \
  --ip 192.168.88.65 \
  --memory=2g --cpus=2 \
  -v /mnt/user/appdata/repos/config:/config \
  --env-file /mnt/user/appdata/repos/.env \
  ghcr.io/otahesh/repos:latest
docker logs -f repos
```

Watch the logs for **5–10 seconds**. Expect:
- `[startup] {"allowListCount":1}` (the boot log from W0.3).
- No `FATAL:` lines.
- API listening on `:3001` (or whatever PORT is).
- (If FATAL appears — see the troubleshooting block below.)

Ctrl-C out of `docker logs -f` once the API is up.

### Step 6 — First-login as alpha tester (auto-provisions the real user)

From a browser, **not on the home network** (use cellular or a VPN that exits elsewhere — needed to actually hit CF Access challenge):

1. Open `https://repos.jpmtech.com/`.
2. CF Access challenge appears — sign in with `jason@jpmtech.com`.
3. Land on `/`. The frontend should render normally; the W0.4 account-menu popover shows your name + email.

Server-side, this first login auto-provisioned a real `users` row with a fresh UUID for `jason@jpmtech.com`.

### Step 7 — Run the cutover SQL against live prod

On the Unraid CLI:
```bash
docker exec repos psql "$DATABASE_URL" -v target_email='jason@jpmtech.com' \
  -f /scripts/cutover/001-placeholder-to-jmeyer.sql
```
*(Adjust the in-container path to wherever the image places `/scripts/cutover/`. If unsure, `docker exec repos ls /scripts/cutover/` first.)*

Expected output:
```
BEGIN
ALTER TABLE  (or UPDATE 0 if already done)
UPDATE 0     -- delete from sync_status
UPDATE N     -- move sync_status
DELETE 1     -- placeholder users row
COMMIT
            metric            | value
------------------------------+-------
 placeholder rows remaining   |     0
 rows migrated this run       |     N
 jmeyer total rows            |     N
```

If `placeholder rows remaining != 0`, **STOP** and surface immediately — the cutover didn't fully apply, and the W0.3 boot guard will reject the next container restart.

### Step 8 — Restart container so the W0.3 placeholder guard runs against the clean state

```bash
docker restart repos
docker logs -n 30 repos
```

Expect no `FATAL:` lines. If the placeholder guard fires (it shouldn't — we just deleted the row), restore from the pre-restore snapshot (Step 2):
```bash
gunzip -c /mnt/user/appdata/repos/config/backups/pre-restore-<ts>.sql.gz | \
  docker exec -i repos pg_restore --clean --no-owner --no-privileges -d repos
```

### Step 9 — Smoke test from outside

From cellular / VPN-exit:
- `curl -I https://repos.jpmtech.com/` → expect `302` to `https://<team>.cloudflareaccess.com/cdn-cgi/access/login/...`.
- `curl -I https://repos.jpmtech.com/api/health/sync/status` → expect `401` (no bearer + no CF Access JWT).
- Browser flow: sign in via CF Access → land on `/` → click avatar → popover shows name + email → "Sign out" → redirected to CF Access logout → page reloads through CF Access challenge again.

### Step 10 — iOS Shortcut smoke

On the iPhone, run the existing weight-sync Shortcut. Expect:
- POST to `/api/health/weight` with the bearer token.
- Response `200 {"deduped": ...}` or `201`.
- Weight row appears in `/` chart on the next page load.

If the Shortcut fails with 401, the CF Access **Bypass** policy for `/api/health/*` is not configured correctly. Fix in CF dashboard.

### Step 11 — Mark W0 complete in PASSDOWN.md

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS  # (back on the dev machine)
# Edit PASSDOWN.md, add a Beta W0 entry with timestamp + commit shas
git commit -am "docs(passdown): mark Beta W0 complete

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

### Troubleshooting

| Symptom | Likely cause | Recovery |
|---------|--------------|----------|
| `FATAL: DATABASE_URL must be set` at boot | `.env` typo | Edit `.env`, fix, recreate |
| `FATAL: placeholder user row found in production DB` | Cutover SQL didn't run | Run Step 7 |
| `FATAL: CF_ACCESS_AUD must be set` | `.env` missing the CF Access fields | Pull from CF dashboard; add to `.env` |
| `/api/health/weight` returns 401 from Shortcut | CF Access Bypass policy missing | Add Bypass rule for `/api/health/*` in CF dashboard |
| Browser stuck on CF Access loop | Allow-list mismatch | Check `CF_ACCESS_ALLOWED_EMAILS` vs sign-in email |
| API serves 503 from `/api/*` (except `/api/maintenance/*`) | Maintenance flag file present at `/config/maintenance.flag` | `rm /mnt/user/appdata/repos/config/maintenance.flag`; restart |

---

## W0 wave-completion gate (matches master plan acceptance)

- [ ] From outside the home network, `https://repos.jpmtech.com/` 302s to CF Access.
- [ ] After login, user lands on `/`. Their `req.userId` is the real CF-Access-provisioned UUID, never the placeholder.
- [ ] `curl -H 'Authorization: Bearer <admin_key>'` to admin endpoints still works.
- [ ] iOS Shortcut bearer flow against `/api/health/weight` still works.
- [ ] Grep across `api/` + `frontend/` for `PLACEHOLDER_USER_ID` returns hits only in test files (and maybe historical comments).
- [ ] Runtime guard rejects `INSERT` with `user_id = '00000000-0000-0000-0000-000000000001'` in `NODE_ENV=production` (verified by the W0.3 integration test).
- [ ] `scripts/cutover/001-placeholder-to-jmeyer.sql` ran cleanly against alpha data with documented before/after row counts (captured in PASSDOWN).
- [ ] CLAUDE.md "v2-out-of-scope" list updated.
- [ ] JWKS rotation test (W0.6) green: mocked-rotated-out key returns 401 within 60s; new key returns 200.

When all 9 boxes tick: W0 is shipped. Move to W1 per-wave plan.

---

*End of W0 plan. ~30 step-blocks. Code phase ~1 day; operational phase ~30 min.*
