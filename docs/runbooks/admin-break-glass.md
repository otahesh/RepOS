# Break-glass: recovering admin access

W9 removed `REPOS_ADMIN_EMAILS`, so there is no env var that can grant admin.
There is deliberately no `BOOTSTRAP_ADMIN_EMAIL` either — a bootstrap env var
would reintroduce exactly the redeploy-coupled config W9 removed (Q11).

Deny-by-default (Q2) makes admin lockout unrecoverable except by this
procedure, which is why the invariant "at least one `active` admin must always
remain" (Q13, I2) is enforced on every route and by migration 080's data step
(Q35).

## When you need this

- Every admin was suspended or deleted despite the invariant (a bug).
- A restore landed a dump whose admin identity no longer matches reality.
- You need to promote a second admin and cannot sign in to do it.

You do **not** need this after a routine restore: migration 080 guarantees an
active admin on every schema-entry path with no Cloudflare dependency.

## Procedure

SSH to Unraid, then:

Note the `sh -c` wrapper and the **single** outer quotes: the variables must be
expanded by the shell *inside* the container. Writing them in double quotes
makes the Unraid host expand them first, and since the host has no such
variables psql receives an empty connection string and silently falls back to
libpq defaults instead of the container's configured database.

**Do not use `$DATABASE_URL` here.** It is not part of the container
environment — the three s6 scripts that need it each construct it and export it
into their own service (`run-api:6`, `init-migrations:8`, `init-seed:8`), and
`docker exec` inherits none of that. Verified on the live container
2026-08-09: `docker exec RepOS sh -c 'echo ${DATABASE_URL:-<UNSET>}'` prints
`<UNSET>`, and the earlier form of these commands failed with
`connection to server on socket "/run/postgresql/.s.PGSQL.5432" failed`. The
connection string below is built from `POSTGRES_*`, which *are* in the
environment, the same way those three scripts build it.

The container is named **`RepOS`**, capitalised. `docker exec ... repos`
targets a container that does not exist.

```bash
docker exec -it RepOS sh -c 'psql "postgres://${POSTGRES_USER:-repos}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB:-repos}" -c \
  "UPDATE users SET role='"'"'admin'"'"', status='"'"'active'"'"', cf_synced_at=NULL WHERE lower(email)='"'"'<email>'"'"';"'
```

If quoting that densely is uncomfortable, the equivalent heredoc form is easier
to get right and is what the runbook prefers:

```bash
docker exec -i RepOS sh -c 'psql "postgres://${POSTGRES_USER:-repos}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB:-repos}"' <<'SQL'
UPDATE users SET role='admin', status='active', cf_synced_at=NULL WHERE lower(email)='<email>';
SQL
```

`cf_synced_at=NULL` is not optional. Q24 defines the stamp as "this row's intent
is reflected in the CF policy", and it must be cleared by **any** status change
that alters CF membership. Promoting a `suspended` or `deleting` row to `active`
does exactly that: the row should now be *present* in the policy, and nothing
here has put it there. Without the clear, a stamp from before the suspension
survives the promotion and `/settings/users` reports the row as synced when its
membership is in fact unverified — the same stale-stamp defect fixed in
`retrySync` (Q17b/Q24).

If the identity has no row at all (deny-by-default means it cannot sign in to
create one):

```bash
docker exec -i RepOS sh -c 'psql "postgres://${POSTGRES_USER:-repos}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB:-repos}"' <<'SQL'
INSERT INTO users (email, role, status) VALUES ('<email>','admin','active');
SQL
```

Either way the row ends with `cf_synced_at` NULL — cleared by the UPDATE, or
never set on the INSERT. That is the honest state: its Cloudflare membership is
unknown until something establishes it. The row is `active`, not `invited`, so
the `cf_synced_at IS NOT NULL` activation precondition (Q17b) does not apply —
it gates activation of `invited` rows only, so a NULL stamp does not stop the
recovered admin signing in.

**Do not expect to fix the sync state with Retry sync during a total lockout.**
`POST /api/admin/users/:id/retry-sync` refuses self-targeting outright (Q13) and
returns `409 self_target_forbidden` *before* any policy read or write — so the
sole recovered admin cannot reconcile their own row. Retry sync is only
available when a *second* operational admin targets the recovered row. In a
total lockout, add the address to the Cloudflare Access policy in the dashboard
(next section); the reconciliation script can stamp agreement afterwards, once
dashboard membership exists.

## Then

1. Confirm the email is in the Cloudflare Access policy — the DB gate will
   admit them, but Cloudflare must issue a JWT first. **Add it in the
   dashboard**: during a total lockout this is the only route, since retry-sync
   cannot target your own row (Q13). If another admin is still operational,
   they can use **Retry sync** against the recovered row instead.
2. Sign in and verify `/settings/users` loads.
3. Record what happened in `docs/runbooks/beta-triage.md`; if the invariant was
   violated by code rather than by a manual DB edit, that is a bug worth a test.
