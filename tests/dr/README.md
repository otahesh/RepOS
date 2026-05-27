# DR — Disaster Recovery Tests

## restore-into-ephemeral.sh

SCPs the latest prod dump, restores into an ephemeral Postgres (docker if
available, otherwise the dev `repos_dr` DB), and smoke-checks table count +
users count. CI-runnable, not a manual procedure.

```
PROD_HOST=192.168.88.65 tests/dr/restore-into-ephemeral.sh
```

On success it `date`-stamps `last-run.txt`. **Commit the updated `last-run.txt`**
so the cadence gate stays current (it reads the file's git commit time, not
filesystem mtime).

## integrity-check.test.sh

Unit-style check that the `gunzip | pg_restore -l` integrity gate
(`docker/root/usr/local/bin/repos-backup.sh` + `api/src/services/backupRunner.ts`)
correctly rejects non-gzip and valid-gzip-but-not-an-archive input. No prod
access required.

```
bash tests/dr/integrity-check.test.sh
```

## check-cadence.sh

Fails the build if `last-run.txt` is > 100 days old (by git commit time, per
I-LAST-RUN-CI). Wire into CI (W8.6).

```
bash tests/dr/check-cadence.sh
```

## Cadence

A full DR test runs every 100 days during steady-state Beta, and a production
DR dry-fire (`docs/runbooks/dr-dry-fire.md`) runs within 7 days before each
cutover.
