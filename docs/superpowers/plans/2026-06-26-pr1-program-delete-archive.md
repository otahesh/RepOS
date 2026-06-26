# PR1 — Program Delete + Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a user permanent delete and reversible archive control over their own programs, surfaced in the My Programs library.

**Architecture:** Add a nullable `user_programs.archived_at` column (mirrors `program_templates.archived_at`) so archive is reversible and non-lossy. Delete is a single `DELETE` that cascades the whole subtree via existing FKs. Three new endpoints (`DELETE`, `POST /archive`, `POST /unarchive`) plus an `include=archived` list filter. The library gains an Archived tab and per-card Delete/Archive/Restore actions.

**Tech Stack:** Fastify 5 + TypeScript + node-postgres (`api/`), Vite + React 18 + TypeScript + Vitest + Testing Library (`frontend/`). SQL migrations run by `tsx src/db/migrate.ts`.

**Branch:** `feat/program-mgmt` (already created; the design spec is the first commit).

**Spec correction discovered during planning:** the spec said "archive disallowed on `active`/`paused` status." But `user_programs.status` is only ever mutated to `abandoned` in the codebase — starting a mesocycle does NOT flip it to `active`. So the 409 guard keys off **an active/paused `mesocycle_run` existing for the program**, not off `user_programs.status`.

---

## File Structure

**Backend (`api/`):**
- Create: `src/db/migrations/071_user_programs_archived_at.sql` — new nullable column + index swap.
- Modify: `src/schemas/userPrograms.ts` — extend `UserProgramListQuerySchema` enum with `archived`.
- Modify: `src/routes/userPrograms.ts` — rewrite list filter for `archived_at`; add `DELETE`, `POST /archive`, `POST /unarchive`.
- Modify: `tests/userPrograms.test.ts` — list-filter, delete-cascade, ownership, archive/unarchive, 409 tests.

**Frontend (`frontend/`):**
- Modify: `src/lib/api/userPrograms.ts` — add `deleteUserProgram`, `archiveUserProgram`, `unarchiveUserProgram`; extend `listMyPrograms` with `includeArchived`.
- Modify: `src/components/programs/MyLibrary.tsx` — Archived tab, Delete/Archive/Restore actions, heavy delete confirm, toasts.
- Modify: `src/components/programs/MyLibrary.test.tsx` — new behavior tests.

---

## Task 1: Migration — `user_programs.archived_at`

**Files:**
- Create: `api/src/db/migrations/071_user_programs_archived_at.sql`

- [ ] **Step 1: Write the migration**

Create `api/src/db/migrations/071_user_programs_archived_at.sql`:

```sql
-- 071_user_programs_archived_at.sql
-- Reversible "archive" for user programs: a nullable timestamp, mirroring
-- program_templates.archived_at. Non-lossy (unlike overloading status='archived'),
-- so unarchive restores the program to its real status.
ALTER TABLE user_programs ADD COLUMN archived_at TIMESTAMPTZ NULL;

-- Carry over any rows previously archived via the enum value so the new column
-- is the single source of truth. (None expected in prod — single user, lifting
-- data still wipe-recreatable — but keep the migration correct regardless.)
UPDATE user_programs SET archived_at = now() WHERE status = 'archived';

-- Swap the partial "active list" index off the enum value onto the new column.
DROP INDEX IF EXISTS idx_user_programs_user;
CREATE INDEX idx_user_programs_user ON user_programs (user_id) WHERE archived_at IS NULL;
```

- [ ] **Step 2: Run the migration against the local test/dev DB**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run migrate`
Expected: output ends with `✓ 071_user_programs_archived_at.sql` then `Migrations complete.`

- [ ] **Step 3: Verify the column and index exist**

Run:
```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx tsx -e "import {db} from './src/db/client.js'; const c=await db.query(\"SELECT column_name FROM information_schema.columns WHERE table_name='user_programs' AND column_name='archived_at'\"); console.log('col:', c.rows); const i=await db.query(\"SELECT indexdef FROM pg_indexes WHERE indexname='idx_user_programs_user'\"); console.log('idx:', i.rows); await db.end();"
```
Expected: `col: [ { column_name: 'archived_at' } ]` and the `idx:` line includes `WHERE (archived_at IS NULL)`.

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/src/db/migrations/071_user_programs_archived_at.sql && git commit -m "feat(programs): add user_programs.archived_at for reversible archive"
```

---

## Task 2: API — `include=archived` list filter

**Files:**
- Modify: `api/src/schemas/userPrograms.ts:34-38`
- Modify: `api/src/routes/userPrograms.ts:30-58`
- Test: `api/tests/userPrograms.test.ts`

- [ ] **Step 1: Write the failing test**

Append this `describe` block to `api/tests/userPrograms.test.ts` (after the existing `GET /api/user-programs` describe block):

```ts
describe('GET /api/user-programs — archived filter', () => {
  it('archived programs appear only under include=archived', async () => {
    const fork = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: auth(),
    });
    const upId = fork.json<{ id: string }>().id;

    // Archive it directly in the DB (archive endpoint lands in Task 4).
    await db.query(`UPDATE user_programs SET archived_at=now() WHERE id=$1`, [upId]);

    const def = await app.inject({ method: 'GET', url: '/api/user-programs', headers: auth() });
    expect(def.json<{ programs: { id: string }[] }>().programs.map((p) => p.id)).not.toContain(
      upId,
    );

    const past = await app.inject({
      method: 'GET',
      url: '/api/user-programs?include=past',
      headers: auth(),
    });
    expect(past.json<{ programs: { id: string }[] }>().programs.map((p) => p.id)).not.toContain(
      upId,
    );

    const arc = await app.inject({
      method: 'GET',
      url: '/api/user-programs?include=archived',
      headers: auth(),
    });
    expect(arc.json<{ programs: { id: string }[] }>().programs.map((p) => p.id)).toContain(upId);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/userPrograms.test.ts -t "archived filter"`
Expected: FAIL — the archived program still appears in the default list (filter not yet keyed on `archived_at`).

- [ ] **Step 3: Extend the query schema**

In `api/src/schemas/userPrograms.ts`, replace:

```ts
export const UserProgramListQuerySchema = z.object({
  include: z.enum(['past']).optional(),
});
```

with:

```ts
export const UserProgramListQuerySchema = z.object({
  include: z.enum(['past', 'archived']).optional(),
});
```

- [ ] **Step 4: Rewrite the list handler**

In `api/src/routes/userPrograms.ts`, replace the entire `app.get<{ Querystring: { include?: string } }>('/user-programs', ...)` handler (the first route, lines 30-58) with:

```ts
  // default          → active programs only: archived_at IS NULL AND status IN (draft,active,paused)
  // ?include=past     → all non-archived (client filters to completed/abandoned)
  // ?include=archived → archived programs only (archived_at IS NOT NULL)
  app.get<{ Querystring: { include?: string } }>(
    '/user-programs',
    { preHandler: requireBearerOrCfAccess },
    async (req, _reply) => {
      const userId = requireUserId(req);
      const include = req.query.include;
      // LEFT JOIN program_templates to carry template_slug through to the client
      // so the fork-wizard "Restart" action can navigate to /programs/:slug.
      const cols = `up.id, up.template_id, pt.slug AS template_slug, up.template_version,
                    up.name, up.customizations, up.status, up.created_at, up.updated_at`;
      let where: string;
      if (include === 'archived') {
        where = `up.user_id=$1 AND up.archived_at IS NOT NULL`;
      } else if (include === 'past') {
        where = `up.user_id=$1 AND up.archived_at IS NULL`;
      } else {
        where = `up.user_id=$1 AND up.archived_at IS NULL AND up.status IN ('draft','active','paused')`;
      }
      const { rows } = await db.query(
        `SELECT ${cols}
         FROM user_programs up
         LEFT JOIN program_templates pt ON pt.id = up.template_id
         WHERE ${where}
         ORDER BY up.created_at DESC`,
        [userId],
      );
      const listResp: UserProgramListResponse = { programs: rows };
      return listResp;
    },
  );
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/userPrograms.test.ts -t "archived filter"`
Expected: PASS.

- [ ] **Step 6: Run the full file to confirm no regression**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/userPrograms.test.ts`
Expected: all tests PASS (existing list tests still green — `archived_at IS NULL` is equivalent to the old `status <> 'archived'` for non-archived rows).

- [ ] **Step 7: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/src/schemas/userPrograms.ts api/src/routes/userPrograms.ts api/tests/userPrograms.test.ts && git commit -m "feat(programs): add include=archived list filter keyed on archived_at"
```

---

## Task 3: API — `DELETE /user-programs/:id`

**Files:**
- Modify: `api/src/routes/userPrograms.ts` (add route)
- Test: `api/tests/userPrograms.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `api/tests/userPrograms.test.ts`:

```ts
describe('DELETE /api/user-programs/:id', () => {
  it('deletes the program and cascades its mesocycle data', async () => {
    const fork = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: auth(),
    });
    const upId = fork.json<{ id: string }>().id;

    // Start a mesocycle so child rows (runs, day_workouts, planned_sets) exist.
    const start = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${upId}/start`,
      headers: auth(),
      body: { start_date: '2026-06-01', start_tz: 'America/Chicago' },
    });
    expect(start.statusCode).toBeLessThan(300);

    const before = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM mesocycle_runs WHERE user_program_id=$1`,
      [upId],
    );
    expect(before.rows[0].n).toBe(1);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/user-programs/${upId}`,
      headers: auth(),
    });
    expect(del.statusCode).toBe(204);

    const prog = await db.query(`SELECT 1 FROM user_programs WHERE id=$1`, [upId]);
    expect(prog.rows.length).toBe(0);
    const runs = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM mesocycle_runs WHERE user_program_id=$1`,
      [upId],
    );
    expect(runs.rows[0].n).toBe(0);
  });

  it('returns 404 for a program the caller does not own', async () => {
    const tmpl = await db.query<{ id: string; version: number; name: string }>(
      `SELECT id, version, name FROM program_templates WHERE slug='full-body-3-day'`,
    );
    const otherUp = await db.query<{ id: string }>(
      `INSERT INTO user_programs (user_id, template_id, template_version, name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [otherUserId, tmpl.rows[0].id, tmpl.rows[0].version, tmpl.rows[0].name],
    );
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/user-programs/${otherUp.rows[0].id}`,
      headers: auth(),
    });
    expect(del.statusCode).toBe(404);
    const still = await db.query(`SELECT 1 FROM user_programs WHERE id=$1`, [otherUp.rows[0].id]);
    expect(still.rows.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/userPrograms.test.ts -t "DELETE /api/user-programs"`
Expected: FAIL — route returns 404/405 (no DELETE handler yet).

- [ ] **Step 3: Add the DELETE route**

In `api/src/routes/userPrograms.ts`, add this route inside `userProgramRoutes`, immediately after the PATCH `/user-programs/:id` handler:

```ts
  app.delete<{ Params: { id: string } }>(
    '/user-programs/:id',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      if (!UuidParamSchema.safeParse(req.params).success) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      const userId = requireUserId(req);
      // Single DELETE; all children (mesocycle_runs → day_workouts →
      // planned_sets → set_logs / planned_cardio_blocks / run_events) cascade
      // via ON DELETE CASCADE FKs. Ownership scoped in the WHERE clause.
      const { rowCount } = await db.query(
        `DELETE FROM user_programs WHERE id=$1 AND user_id=$2`,
        [req.params.id, userId],
      );
      if (rowCount === 0) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      return reply.code(204).send();
    },
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/userPrograms.test.ts -t "DELETE /api/user-programs"`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/src/routes/userPrograms.ts api/tests/userPrograms.test.ts && git commit -m "feat(programs): add DELETE /user-programs/:id with cascading delete"
```

---

## Task 4: API — `POST /archive` and `POST /unarchive`

**Files:**
- Modify: `api/src/routes/userPrograms.ts` (add two routes)
- Test: `api/tests/userPrograms.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `api/tests/userPrograms.test.ts`:

```ts
describe('POST /api/user-programs/:id/archive + /unarchive', () => {
  it('archive sets archived_at and hides from default + past lists', async () => {
    const fork = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: auth(),
    });
    const upId = fork.json<{ id: string }>().id;

    const arch = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${upId}/archive`,
      headers: auth(),
    });
    expect(arch.statusCode).toBe(200);

    const row = await db.query<{ archived_at: string | null }>(
      `SELECT archived_at FROM user_programs WHERE id=$1`,
      [upId],
    );
    expect(row.rows[0].archived_at).not.toBeNull();

    const def = await app.inject({ method: 'GET', url: '/api/user-programs', headers: auth() });
    expect(def.json<{ programs: { id: string }[] }>().programs.map((p) => p.id)).not.toContain(
      upId,
    );
  });

  it('archive is rejected with 409 when an active mesocycle run exists', async () => {
    const fork = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: auth(),
    });
    const upId = fork.json<{ id: string }>().id;
    const start = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${upId}/start`,
      headers: auth(),
      body: { start_date: '2026-06-01', start_tz: 'America/Chicago' },
    });
    expect(start.statusCode).toBeLessThan(300);

    const arch = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${upId}/archive`,
      headers: auth(),
    });
    expect(arch.statusCode).toBe(409);
  });

  it('unarchive clears archived_at', async () => {
    const fork = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: auth(),
    });
    const upId = fork.json<{ id: string }>().id;
    await app.inject({ method: 'POST', url: `/api/user-programs/${upId}/archive`, headers: auth() });

    const un = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${upId}/unarchive`,
      headers: auth(),
    });
    expect(un.statusCode).toBe(200);
    const row = await db.query<{ archived_at: string | null }>(
      `SELECT archived_at FROM user_programs WHERE id=$1`,
      [upId],
    );
    expect(row.rows[0].archived_at).toBeNull();
  });

  it('archive returns 404 for a program the caller does not own', async () => {
    const tmpl = await db.query<{ id: string; version: number; name: string }>(
      `SELECT id, version, name FROM program_templates WHERE slug='full-body-3-day'`,
    );
    const otherUp = await db.query<{ id: string }>(
      `INSERT INTO user_programs (user_id, template_id, template_version, name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [otherUserId, tmpl.rows[0].id, tmpl.rows[0].version, tmpl.rows[0].name],
    );
    const arch = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${otherUp.rows[0].id}/archive`,
      headers: auth(),
    });
    expect(arch.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/userPrograms.test.ts -t "archive"`
Expected: FAIL — no archive/unarchive routes yet (404/405).

- [ ] **Step 3: Add the archive + unarchive routes**

In `api/src/routes/userPrograms.ts`, add immediately after the DELETE route from Task 3:

```ts
  app.post<{ Params: { id: string } }>(
    '/user-programs/:id/archive',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      if (!UuidParamSchema.safeParse(req.params).success) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      const userId = requireUserId(req);
      const owned = await db.query(`SELECT 1 FROM user_programs WHERE id=$1 AND user_id=$2`, [
        req.params.id,
        userId,
      ]);
      if (owned.rows.length === 0) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      // Guard on a live RUN, not user_programs.status: starting a mesocycle does
      // not flip the program's status, so status is an unreliable signal here.
      const live = await db.query(
        `SELECT 1 FROM mesocycle_runs
         WHERE user_program_id=$1 AND status IN ('active','paused') LIMIT 1`,
        [req.params.id],
      );
      if (live.rows.length > 0) {
        reply.code(409);
        return {
          error: 'Finish or abandon the in-progress mesocycle before archiving this program.',
          field: 'status',
        };
      }
      await db.query(
        `UPDATE user_programs SET archived_at=now(), updated_at=now() WHERE id=$1 AND user_id=$2`,
        [req.params.id, userId],
      );
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/user-programs/:id/unarchive',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      if (!UuidParamSchema.safeParse(req.params).success) {
        reply.code(404);
        return { error: 'user_program not found', field: 'id' };
      }
      const userId = requireUserId(req);
      const { rowCount } = await db.query(
        `UPDATE user_programs SET archived_at=NULL, updated_at=now()
         WHERE id=$1 AND user_id=$2 AND archived_at IS NOT NULL`,
        [req.params.id, userId],
      );
      if (rowCount === 0) {
        reply.code(404);
        return { error: 'archived user_program not found', field: 'id' };
      }
      return { ok: true };
    },
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/userPrograms.test.ts -t "archive"`
Expected: PASS (all four).

- [ ] **Step 5: Run the whole API suite for this domain**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/userPrograms.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/src/routes/userPrograms.ts api/tests/userPrograms.test.ts && git commit -m "feat(programs): add archive/unarchive endpoints (409 on live run)"
```

---

## Task 5: Frontend API client wrappers

**Files:**
- Modify: `frontend/src/lib/api/userPrograms.ts`

(Thin pass-through wrappers over `apiFetch`; behavior is covered by the component tests in Task 6.)

- [ ] **Step 1: Extend `listMyPrograms` and add the three mutators**

In `frontend/src/lib/api/userPrograms.ts`, replace the existing `listMyPrograms` function (lines 32-41) with:

```ts
// include='past' returns all non-archived programs (client filters to
// completed/abandoned). include='archived' returns only archived programs.
// Default returns only active programs (draft/active/paused).
export async function listMyPrograms(opts?: {
  includePast?: boolean;
  includeArchived?: boolean;
}): Promise<UserProgramRecord[]> {
  const url = opts?.includeArchived
    ? '/api/user-programs?include=archived'
    : opts?.includePast
      ? '/api/user-programs?include=past'
      : '/api/user-programs';
  const res = await apiFetch(url, {});
  const data = await jsonOrThrow<{ programs: UserProgramRecord[] }>(res);
  return data.programs;
}

export async function deleteUserProgram(id: string): Promise<void> {
  const res = await apiFetch(`/api/user-programs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  // 204 No Content on success; only parse (and throw) on error.
  if (!res.ok) await jsonOrThrow(res);
}

export async function archiveUserProgram(id: string): Promise<void> {
  const res = await apiFetch(`/api/user-programs/${encodeURIComponent(id)}/archive`, {
    method: 'POST',
  });
  await jsonOrThrow<{ ok: boolean }>(res);
}

export async function unarchiveUserProgram(id: string): Promise<void> {
  const res = await apiFetch(`/api/user-programs/${encodeURIComponent(id)}/unarchive`, {
    method: 'POST',
  });
  await jsonOrThrow<{ ok: boolean }>(res);
}
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add frontend/src/lib/api/userPrograms.ts && git commit -m "feat(programs): add delete/archive/unarchive api client wrappers"
```

---

## Task 6: Frontend — Archived tab + Delete/Archive/Restore actions

**Files:**
- Modify: `frontend/src/components/programs/MyLibrary.tsx`
- Test: `frontend/src/components/programs/MyLibrary.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `frontend/src/components/programs/MyLibrary.test.tsx`, add a `DRAFT_PROGRAM` and `ARCHIVED_PROGRAM` fixture after `COMPLETED_PROGRAM` (line 51):

```ts
const DRAFT_PROGRAM = {
  id: 'up-draft',
  name: 'Draft Block',
  status: 'draft' as const,
  user_id: 'u1',
  template_id: 't1',
  template_slug: 'full-body-3x',
  template_version: 1,
  customizations: {},
  created_at: '2026-05-01T10:00:00Z',
  updated_at: '2026-05-01T10:00:00Z',
};

const ARCHIVED_PROGRAM = {
  id: 'up-shelved',
  name: 'Shelved Block',
  status: 'completed' as const,
  user_id: 'u1',
  template_id: 't1',
  template_slug: 'full-body-3x',
  template_version: 1,
  customizations: {},
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-02-01T10:00:00Z',
};
```

Then add this `describe` block at the end of the file:

```ts
describe('<MyLibrary> — delete / archive / restore', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it('Delete on a program requires typing the name, then calls deleteUserProgram', async () => {
    const delSpy = vi.spyOn(api, 'deleteUserProgram').mockResolvedValue();
    vi.spyOn(api, 'listMyPrograms').mockResolvedValue([ACTIVE_PROGRAM]);

    renderLibrary();
    await screen.findByText('My Full Body');

    fireEvent.click(screen.getByRole('button', { name: /^Delete$/i }));
    // Heavy confirm: the typed-confirm field must match the program name exactly.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My Full Body' } });
    fireEvent.click(screen.getByRole('button', { name: /Delete program/i }));

    await waitFor(() => expect(delSpy).toHaveBeenCalledWith('up-active'));
  });

  it('Archive on a draft program calls archiveUserProgram', async () => {
    const archiveSpy = vi.spyOn(api, 'archiveUserProgram').mockResolvedValue();
    vi.spyOn(api, 'listMyPrograms')
      .mockResolvedValueOnce([DRAFT_PROGRAM]) // initial active fetch
      .mockResolvedValueOnce([]); // reload after archive

    renderLibrary();
    await screen.findByText('Draft Block');

    fireEvent.click(screen.getByRole('button', { name: /^Archive$/i }));
    await waitFor(() => expect(archiveSpy).toHaveBeenCalledWith('up-draft'));
  });

  it('does not show Archive on an active (live-run) program', async () => {
    vi.spyOn(api, 'listMyPrograms').mockResolvedValue([ACTIVE_PROGRAM]);
    renderLibrary();
    await screen.findByText('My Full Body');
    expect(screen.queryByRole('button', { name: /^Archive$/i })).not.toBeInTheDocument();
  });

  it('Archived tab fetches with includeArchived and shows a Restore action', async () => {
    const spy = vi
      .spyOn(api, 'listMyPrograms')
      .mockResolvedValueOnce([ACTIVE_PROGRAM]) // active
      .mockResolvedValueOnce([ARCHIVED_PROGRAM]); // archived

    renderLibrary();
    await screen.findByText('My Full Body');

    fireEvent.click(screen.getByRole('button', { name: /^Archived$/i }));

    expect(await screen.findByText('Shelved Block')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Restore$/i })).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith({ includeArchived: true });
  });

  it('Restore calls unarchiveUserProgram', async () => {
    const unSpy = vi.spyOn(api, 'unarchiveUserProgram').mockResolvedValue();
    vi.spyOn(api, 'listMyPrograms')
      .mockResolvedValueOnce([ACTIVE_PROGRAM])
      .mockResolvedValueOnce([ARCHIVED_PROGRAM])
      .mockResolvedValueOnce([]); // reload after restore

    renderLibrary();
    await screen.findByText('My Full Body');
    fireEvent.click(screen.getByRole('button', { name: /^Archived$/i }));
    await screen.findByText('Shelved Block');

    fireEvent.click(screen.getByRole('button', { name: /^Restore$/i }));
    await waitFor(() => expect(unSpy).toHaveBeenCalledWith('up-shelved'));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs/MyLibrary.test.tsx -t "delete / archive / restore"`
Expected: FAIL — no Delete/Archive/Restore/Archived controls exist yet.

- [ ] **Step 3: Update imports and the ViewTab/STATUS_LABEL declarations**

In `frontend/src/components/programs/MyLibrary.tsx`, replace the import + `ViewTab` + `STATUS_LABEL` header (lines 3-18) with:

```ts
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listMyPrograms,
  listProgramMesocycles,
  deleteUserProgram,
  archiveUserProgram,
  unarchiveUserProgram,
} from '../../lib/api/userPrograms';
import type { UserProgramRecord } from '../../lib/api/programs';
import { TOKENS, FONTS } from '../../tokens';
import { Term } from '../Term';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { pushToast } from '../common/ToastHost';

type ViewTab = 'active' | 'past' | 'archived';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  abandoned: 'Abandoned',
  archived: 'Archived',
};
```

- [ ] **Step 4: Add Delete/Archive/Restore props + buttons to `ProgramCard`**

In `ProgramCard`, replace the props destructuring + type (lines 35-47) with:

```ts
function ProgramCard({
  program,
  onResume,
  onOpen,
  onViewRecap,
  onArchive,
  onRestore,
  onDelete,
  faded,
}: {
  program: UserProgramRecord;
  onResume?: (id: string) => void;
  onOpen?: (id: string) => void;
  onViewRecap?: (id: string) => void;
  onArchive?: (id: string) => void;
  onRestore?: (id: string) => void;
  onDelete?: (id: string) => void;
  faded: boolean;
}) {
```

Then, inside the actions `<div>` (currently lines 111-167), add these three buttons immediately before its closing `</div>` (i.e. after the `onViewRecap` button block, before line 167's `</div>`):

```tsx
        {onRestore && (
          <button
            onClick={() => onRestore(program.id)}
            style={{
              padding: '8px 14px',
              background: TOKENS.accentGlow,
              border: `1px solid ${TOKENS.accentDim}`,
              borderRadius: 6,
              color: TOKENS.accent,
              fontFamily: FONTS.ui,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              letterSpacing: 0.5,
            }}
          >
            Restore
          </button>
        )}
        {onArchive && (
          <button
            onClick={() => onArchive(program.id)}
            style={{
              padding: '8px 14px',
              background: TOKENS.surface3,
              border: `1px solid ${TOKENS.lineStrong}`,
              borderRadius: 6,
              color: TOKENS.text,
              fontFamily: FONTS.ui,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Archive
          </button>
        )}
        {onDelete && (
          <button
            onClick={() => onDelete(program.id)}
            style={{
              padding: '8px 14px',
              background: 'transparent',
              border: `1px solid ${TOKENS.danger}`,
              borderRadius: 6,
              color: TOKENS.danger,
              fontFamily: FONTS.ui,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Delete
          </button>
        )}
```

- [ ] **Step 5: Add state, handlers, reload, and the third tab in `MyLibrary`**

In the `MyLibrary` function, replace the state declarations + load effect + filter (lines 177-209) with:

```ts
  const navigate = useNavigate();
  const [tab, setTab] = useState<ViewTab>('active');
  const [programs, setPrograms] = useState<UserProgramRecord[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [recapErr, setRecapErr] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<UserProgramRecord | null>(null);
  // Bumped after a mutation to force the current tab to refetch.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    setPrograms(null);
    setErr(null);
    setRecapErr(null);
    const opts =
      tab === 'archived' ? { includeArchived: true } : { includePast: tab === 'past' };
    listMyPrograms(opts)
      .then((rows) => {
        if (!ignore) setPrograms(rows);
      })
      .catch((e) => {
        if (!ignore) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      ignore = true;
    };
  }, [tab, reloadKey]);

  // Server already scopes the archived tab to archived_at IS NOT NULL, so show
  // everything it returns there. Active/Past filter client-side by status.
  const filtered =
    programs?.filter((p) => {
      if (tab === 'archived') return true;
      if (tab === 'past') return p.status === 'abandoned' || p.status === 'completed';
      return p.status !== 'abandoned' && p.status !== 'completed' && p.status !== 'archived';
    }) ?? null;

  async function handleArchive(id: string) {
    try {
      await archiveUserProgram(id);
      pushToast({ severity: 'success', body: 'Program archived.' });
      setReloadKey((k) => k + 1);
    } catch (e) {
      pushToast({
        severity: 'error',
        body: `Archive failed — ${e instanceof Error ? e.message : String(e)}.`,
      });
    }
  }

  async function handleRestore(id: string) {
    try {
      await unarchiveUserProgram(id);
      pushToast({ severity: 'success', body: 'Program restored.' });
      setReloadKey((k) => k + 1);
    } catch (e) {
      pushToast({
        severity: 'error',
        body: `Restore failed — ${e instanceof Error ? e.message : String(e)}.`,
      });
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const prog = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteUserProgram(prog.id);
      pushToast({ severity: 'success', body: `Deleted "${prog.name}".` });
      setReloadKey((k) => k + 1);
    } catch (e) {
      pushToast({
        severity: 'error',
        body: `Delete failed — ${e instanceof Error ? e.message : String(e)}.`,
      });
    }
  }
```

- [ ] **Step 6: Add the Archived tab button**

In the tab bar, replace the two-button group (lines 274-279) with:

```tsx
          <button style={tabStyle(tab === 'active')} onClick={() => setTab('active')}>
            Active
          </button>
          <button style={tabStyle(tab === 'past')} onClick={() => setTab('past')}>
            Past
          </button>
          <button style={tabStyle(tab === 'archived')} onClick={() => setTab('archived')}>
            Archived
          </button>
```

- [ ] **Step 7: Extend the empty state and wire the new card props**

Replace the empty-state block (lines 297-307) with:

```tsx
      {!err && filtered && filtered.length === 0 && (
        <div style={{ color: TOKENS.textMute, fontSize: 13, padding: '16px 0' }}>
          {tab === 'archived' ? (
            'No archived programs. Archive a program to tuck it away here — it stays restorable.'
          ) : tab === 'past' ? (
            'No past programs yet. Abandoned or completed programs appear here.'
          ) : (
            <>
              No active programs. Pick a <Term k="mesocycle" /> template below to get started.
            </>
          )}
        </div>
      )}
```

Then replace the `filtered.map(...)` card render (lines 317-333) with:

```tsx
          {filtered.map((p) => (
            <ProgramCard
              key={p.id}
              program={p}
              faded={tab !== 'active'}
              onOpen={tab === 'active' ? handleOpen : undefined}
              onResume={
                tab === 'past' && p.template_slug
                  ? () => onRestartProgram(p.template_slug!)
                  : undefined
              }
              onViewRecap={
                tab === 'past' && p.status === 'completed'
                  ? (id) => void handleViewRecap(id)
                  : undefined
              }
              onArchive={
                tab !== 'archived' && p.status !== 'active' && p.status !== 'paused'
                  ? (id) => void handleArchive(id)
                  : undefined
              }
              onRestore={tab === 'archived' ? (id) => void handleRestore(id) : undefined}
              onDelete={(id) => setPendingDelete(programs?.find((x) => x.id === id) ?? null)}
            />
          ))}
```

- [ ] **Step 8: Add the delete confirm dialog**

Immediately before the closing `</section>` of the `MyLibrary` return (currently line 337), add:

```tsx
      <ConfirmDialog
        open={pendingDelete !== null}
        tier="heavy"
        severity="danger"
        title="Delete this program?"
        body={
          pendingDelete
            ? `This permanently deletes "${pendingDelete.name}" and all of its logged sets and mesocycle history. This cannot be undone.`
            : ''
        }
        requireTyped={pendingDelete?.name ?? ''}
        confirmLabel="Delete program"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
```

- [ ] **Step 9: Run the new tests to verify they pass**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs/MyLibrary.test.tsx`
Expected: all PASS (new block + the pre-existing tests — note `faded` is now `tab !== 'active'`, which is unchanged for the active/past tabs the old tests exercise).

- [ ] **Step 10: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add frontend/src/components/programs/MyLibrary.tsx frontend/src/components/programs/MyLibrary.test.tsx && git commit -m "feat(programs): archived tab + delete/archive/restore actions in library"
```

---

## Task 7: Full validation + PR

- [ ] **Step 1: Run the full API suite**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm test`
Expected: all PASS. (If unrelated `programs.test.ts` failures appear, reset the shared test DB per memory `reference_test_db_cruft` — orphan `program_templates` rows from interrupted runs — then re-run.)

- [ ] **Step 2: Run the full frontend validation gate**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npm run validate`
Expected: PASS — tsc + eslint + prettier --check + vitest all green. (Running `npm run validate` — not just tsc/eslint/vitest — is required; it includes `prettier --check`, which CI runs.)

- [ ] **Step 3: Push and open the PR**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git push -u origin feat/program-mgmt
gh pr create --base main --title "feat(programs): delete + archive programs" --body "$(cat <<'EOF'
## Summary
- Add reversible **archive** (`user_programs.archived_at`) + permanent **delete** (cascading) for user programs.
- New endpoints: `DELETE /api/user-programs/:id`, `POST /api/user-programs/:id/archive`, `POST /api/user-programs/:id/unarchive`, and `GET /api/user-programs?include=archived`.
- My Programs library: **Archived** tab + per-card **Delete** (heavy typed confirm), **Archive**, **Restore**.
- Archive is blocked (409) when a live (active/paused) mesocycle run exists — keyed on the run, not `user_programs.status` (which never flips to active).

First of three PRs from `docs/superpowers/specs/2026-06-26-program-experience-batch-design.md`.

## Test plan
- API: list-filter, delete-cascade (incl. set_logs), ownership 404, archive/unarchive round-trip, 409-on-live-run.
- Frontend: archived tab fetch, delete typed-confirm, archive/restore actions.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Confirm CI is green**

Run: `gh pr checks` (re-run explicitly — do NOT trust `--watch` alone; per memory it can exit 0 with a check still failing).
Expected: all 8 required checks pass.

---

## Post-merge (ops, not part of the PR)

After this merges and deploys, clear the May program cruft so the smoke test starts clean. Options:
- In the live UI (now that Delete exists): delete each stale program with the typed confirm; **or**
- One-shot SQL on prod (lifting data is wipe-recreatable pre-launch):
  `DELETE FROM user_programs WHERE user_id = '<your-user-id>';` (cascades all runs/day_workouts/planned_sets/set_logs).

Then proceed to PR2 (duration estimation) — its own plan.

---

## Self-Review (completed by author)

- **Spec coverage:** delete ✓ (Task 3), archive ✓ (Task 4), unarchive/Archived-view ✓ (Tasks 4, 6), `archived_at` column ✓ (Task 1), heavy confirm ✓ (Task 6), one-time cleanup ✓ (Post-merge). Logged-set cascade gate ✓ (verified `set_logs.planned_set_id ON DELETE CASCADE` during planning — no migration needed).
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `deleteUserProgram` / `archiveUserProgram` / `unarchiveUserProgram` / `listMyPrograms({ includeArchived })` names match between client (Task 5), tests (Task 6), and component wiring (Task 6). `ConfirmDialog` props (`tier`, `requireTyped`, `confirmLabel`, `severity`, `onConfirm`, `onCancel`) match the component's interface.
- **Deviation from spec:** archive 409 keyed on a live `mesocycle_run`, not `user_programs.status` (status never flips to active in the codebase). Documented at top.
