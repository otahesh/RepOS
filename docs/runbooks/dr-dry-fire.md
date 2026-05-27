# DR Dry-Fire — Production Restore Rehearsal

**Cadence:** within 7 days before each cutover, and every 100 days during
steady-state Beta (per G5 + `tests/dr/last-run.txt`).

**Pre-cutover scheduling:** the orchestrator schedules this 5–7 days before
cutover-day (the pre-cutover prod window per memory `project_beta_no_staging`).
The window is the validation surface: alpha data is already wiped, no real Beta
user has signed in yet.

**ZERO DATA LOSS RULE (C-DR-DRY-FIRE-DATA-SAFETY):** the rehearsal MUST restore
from a backup taken AT the rehearsal moment, NOT an older snapshot. Restoring an
older snapshot would erase alpha-tester or Beta-tester data captured since that
snapshot. Step 1 below is non-negotiable — take the backup FIRST, then restore
THAT FILE.

## Steps

1. **Take a fresh manual backup RIGHT NOW.** Navigate to `/settings/backups`,
   click "Backup now", wait for badge=good. **Note the exact filename** (e.g.
   `repos-20260526T140530Z.dump.gz`). This is the file the dry-fire restores
   from.
2. SSH to unraid and verify the new file + sidecar:
   `ssh unraid 'ls -la /mnt/user/appdata/repos/config/backups/repos-2026*'`.
   Copy the filename into the PASSDOWN entry below.
3. Run `tests/dr/restore-into-ephemeral.sh` locally against prod. Expect green;
   `tests/dr/last-run.txt` updates — git add + commit it.
4. Verify the maintenance-mode flow on production:
   - On `/settings/backups`, locate **the file from Step 1** (NOT an older one).
   - Click Restore on that row.
   - Confirm the typed-RESTORE dialog (W6 ConfirmDialog, heavy tier).
   - Confirm the MaintenanceBanner appears site-wide within 5 seconds.
   - Wait for the restore to complete (~60 seconds).
   - Confirm `POST /api/maintenance/clear` succeeds and the banner disappears.
   - Confirm a smoke set-log POST works post-clear.
   - Confirm `device_tokens` were wiped (C-DEVICE-TOKENS-RESTORE): the iOS
     Shortcut bearer must 401 until re-minted.
   - NOTE (residual-risk #11): the `pg_restore -l` schema-rev preflight cannot
     read the rev from a pre-W0.0 dump (no `_migrations` in the TOC) and
     defaults to "allow." The `safeBackupPath()` filename allow-list already
     blocks anything that old, so this is a documented gap, not a live hole.
5. Capture timing in PASSDOWN:

```
## DR dry-fire YYYY-MM-DD
- Backup taken at: HH:MM:SS UTC  (filename: repos-........Z.dump.gz)
- Restore kicked off at: HH:MM:SS UTC
- Maintenance flag observed by frontend at: HH:MM:SS UTC
- pg_restore completed at: HH:MM:SS UTC
- Migrations applied at: HH:MM:SS UTC
- /api/maintenance/clear succeeded at: HH:MM:SS UTC
- Total downtime: NN seconds
- Result: [GREEN | RED — see notes]
- Notes: <any anomaly>
```

6. If RED: file a Sev-2 bug, slip cutover until resolved.

## Restoring from a local file (off-box backup)

Per I-RESTORE-FROM-LOCAL — no multipart upload route exists in Beta. To restore
from a file you have locally (downloaded from another container or an off-box
backup):

1. SCP the file into the prod container's backups directory:
   ```
   scp ./repos-YYYYMMDDTHHMMSSZ.dump.gz unraid:/mnt/user/appdata/repos/config/backups/
   ```
   The filename MUST match `repos-\d{8}T\d{6}Z\.dump\.gz` — `safeBackupPath()`
   rejects anything else.
2. SSH to unraid and match ownership + permissions to other dumps:
   ```
   ssh unraid 'chown 99:100 /mnt/user/appdata/repos/config/backups/repos-YYYYMMDDTHHMMSSZ.dump.gz; \
               chmod 0640 /mnt/user/appdata/repos/config/backups/repos-YYYYMMDDTHHMMSSZ.dump.gz'
   ```
3. On `/settings/backups`, the file appears with `verified_restorable='warn'`
   (no audit row joined). Click Restore — the restore preflight re-runs the
   integrity check anyway (I-INTEGRITY-AT-RESTORE), so a bad file is rejected
   before any destructive op.
4. Typed-RESTORE dialog → same flow.

**Note:** this is a manual operator path. Beta does not expose multipart
upload. Post-Beta, file-upload is a candidate add to W7+.
