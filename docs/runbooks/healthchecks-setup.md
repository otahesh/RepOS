# Healthchecks.io Setup (W5 ABS-5)

Two checks back the W5 alerting: a backup-job heartbeat and a host-side health
ping. Both are alerting-only — neither gates the API.

## 1. Account + project

1. Create (or reuse) a Healthchecks.io account. Free tier is sufficient.
2. Create a project "RepOS prod".

## 2. Create the two checks

### `HEALTHCHECKS_BACKUP_UUID` — nightly backup heartbeat

- **Schedule:** Cron mode, `15 3 * * *` (matches `REPOS_BACKUP_HOUR/MIN` =
  03:15 UTC). Grace: 30 min.
- **Behavior:** `repos-backup.sh` curls `https://hc-ping.com/<uuid>` on a
  successful + integrity-verified nightly backup. No ping within 24h + 30m
  grace ⇒ alert.

### `HEALTHCHECKS_HEALTH_UUID` — host-side liveness ping

- **Schedule:** Cron mode, `*/10 * * * *`. Grace: 5 min.
- **Behavior:** an Unraid host cron pings this every 10 min ONLY when the
  container's `/health/user-facing` returns 200 (so a restore window or a down
  container surfaces as a missed ping). Example host cron line:
  ```
  */10 * * * * curl -fsS --max-time 8 http://192.168.88.65/health/user-facing \
    && curl -fsS --max-time 8 https://hc-ping.com/<HEALTHCHECKS_HEALTH_UUID> >/dev/null
  ```
  The `&&` means a 503 (maintenance) or unreachable container skips the ping →
  Healthchecks alerts after the 5-min grace.

## 3. Notifications

Wire an email + (optional) ntfy/Pushover integration in the Healthchecks
project. Test each via the "Send Test Notification" button.

## 4. Write the UUIDs to prod

On the Unraid host, edit the container secrets file (per `reference_deployment`):

```
nano /mnt/user/appdata/repos/.env
```

Add:
```
HEALTHCHECKS_BACKUP_UUID=<uuid-1>
HEALTHCHECKS_HEALTH_UUID=<uuid-2>
```

Recreate the container (per `reference_unraid_redeploy` — stop + rm + run, NOT
restart) so the new env is picked up.

## 5. Smoke test

- Trigger a manual backup from `/settings/backups` (or run `repos-backup.sh`
  via docker exec). Confirm the backup check flips to "up" in Healthchecks.
- Temporarily stop the container; confirm the health check alerts after the
  grace window; restart and confirm recovery.
