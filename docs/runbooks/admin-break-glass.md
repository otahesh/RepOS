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

Note the `sh -c` wrapper and the **single** outer quotes. `DATABASE_URL` must be
expanded by the shell *inside* the container; writing `docker exec repos psql
"$DATABASE_URL"` makes the Unraid host expand it first, and since the host has
no such variable psql receives an empty connection string and silently falls
back to libpq defaults instead of the container's configured database.

```bash
docker exec -it repos sh -c 'psql "$DATABASE_URL" -c \
  "UPDATE users SET role='"'"'admin'"'"', status='"'"'active'"'"' WHERE lower(email)='"'"'<email>'"'"';"'
```

If quoting that densely is uncomfortable, the equivalent heredoc form is easier
to get right and is what the runbook prefers:

```bash
docker exec -i repos sh -c 'psql "$DATABASE_URL"' <<'SQL'
UPDATE users SET role='admin', status='active' WHERE lower(email)='<email>';
SQL
```

If the identity has no row at all (deny-by-default means it cannot sign in to
create one):

```bash
docker exec -i repos sh -c 'psql "$DATABASE_URL"' <<'SQL'
INSERT INTO users (email, role, status) VALUES ('<email>','admin','active');
SQL
```

`cf_synced_at` is left NULL deliberately: the row's Cloudflare membership is
unknown until you either use **Retry sync** on `/settings/users` or run the
reconciliation script. The row is `active`, not `invited`, so the
`cf_synced_at IS NOT NULL` activation precondition (Q17b) does not apply — it
gates activation of `invited` rows only.

## Then

1. Confirm the email is in the Cloudflare Access policy — the DB gate will
   admit them, but Cloudflare must issue a JWT first. Add it in the dashboard
   or use **Retry sync**.
2. Sign in and verify `/settings/users` loads.
3. Record what happened in `docs/runbooks/beta-triage.md`; if the invariant was
   violated by code rather than by a manual DB edit, that is a bug worth a test.
