#!/usr/bin/with-contenv bash
# RepOS nightly Postgres backup. Invoked by the s6 backup longrun.
# Writes gzipped pg_dump custom-format archives to /config/backups, applies
# retention, logs to /config/log/backup/. Exits 0 on success, non-zero on
# any failure.
set -euo pipefail

DB="${POSTGRES_DB:-repos}"
BACKUP_DIR="${REPOS_BACKUP_DIR:-/config/backups}"
LOG_DIR="${REPOS_BACKUP_LOG_DIR:-/config/log/backup}"
RETAIN_DAYS="${REPOS_BACKUP_RETAIN_DAYS:-14}"

mkdir -p "$BACKUP_DIR" "$LOG_DIR"
chown postgres:postgres "$BACKUP_DIR" "$LOG_DIR"
chmod 750 "$BACKUP_DIR"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
out="${BACKUP_DIR}/repos-${ts}.dump.gz"
tmp="${out}.partial"
log="${LOG_DIR}/backup-${ts}.log"

echo "[$(date -u +%FT%TZ)] start backup db=${DB} -> ${out}" | tee -a "$log"

if ! s6-setuidgid postgres /usr/bin/pg_dump \
        -h /tmp -U postgres \
        -d "$DB" \
        -Fc --no-owner --no-privileges \
     | gzip -6 > "$tmp"; then
  echo "[$(date -u +%FT%TZ)] FAIL pg_dump exited non-zero" | tee -a "$log" >&2
  rm -f "$tmp"
  exit 1
fi

mv "$tmp" "$out"
chown postgres:postgres "$out"
chmod 640 "$out"

size="$(stat -c %s "$out" 2>/dev/null || stat -f %z "$out")"
echo "[$(date -u +%FT%TZ)] ok size=${size} bytes" | tee -a "$log"

# Audit helper: run psql as the postgres superuser over the unix socket
# (same auth path as the dump above). Avoids depending on DATABASE_URL being
# present + correct in the cron env.
audit_sql() {
  s6-setuidgid postgres /usr/bin/psql -h /tmp -U postgres -d "$DB" -v ON_ERROR_STOP=1
}

# W5.1 — integrity check. gunzip | pg_restore -l must exit 0; on fail,
# delete the bad file + INSERT a failed audit row + exit non-zero.
if ! gunzip -c "$out" | pg_restore -l > /dev/null 2>>"$log"; then
  echo "[$(date -u +%FT%TZ)] FAIL integrity check (gunzip|pg_restore -l)" | tee -a "$log" >&2
  # C-AUTOBACKUP-AUDIT — even on failure, record the attempt.
  audit_sql <<SQL || true
INSERT INTO backup_runs (trigger, event_kind, status, file_path, size_bytes,
                         integrity_verified, error_message, started_at, finished_at)
VALUES ('auto', 'create', 'failed', '${out}', ${size}, false,
        'gunzip|pg_restore -l integrity check failed', now(), now());
SQL
  rm -f "$out"
  exit 2
fi

# Sidecar JSON (matches backupRunner.ts shape).
# I-SIDECAR-PERMS — 0640 to match dump permissions. Schema: metadata only,
# NO user-identifying fields ever (no usernames, no emails, no IPs).
cat > "${out%.dump.gz}.json" <<JSON
{"file":"$(basename "$out")","size_bytes":${size},"trigger":"auto","created_at":"$(date -u +%FT%TZ)"}
JSON
chown postgres:postgres "${out%.dump.gz}.json"
chmod 0640 "${out%.dump.gz}.json"

# C-AUTOBACKUP-AUDIT — INSERT the success row so the nightly backup
# appears in GET /api/backups. Without this, the API list endpoint
# filters on `status='ok' AND trigger IN ('manual','auto','pre_restore')`
# and the auto row is missing entirely. event_kind='create' is the default.
audit_sql <<SQL
INSERT INTO backup_runs (trigger, event_kind, status, file_path, size_bytes,
                         integrity_verified, started_at, finished_at)
VALUES ('auto', 'create', 'ok', '${out}', ${size}, true, now(), now());
SQL

# W5.2 — Healthchecks.io heartbeat. Quiet curl; never block backup on
# Healthchecks reachability. Both UUIDs (ABS-5) live in /config/.env.
if [ -n "${HEALTHCHECKS_BACKUP_UUID:-}" ]; then
  curl -fsS --max-time 10 -o /dev/null \
    "https://hc-ping.com/${HEALTHCHECKS_BACKUP_UUID}" || true
fi

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'repos-*.dump.gz' \
  -mtime +"$RETAIN_DAYS" -print -delete | tee -a "$log"
# Prune sidecar JSONs to match the dump-retention window (ABS-7).
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'repos-*.json' \
  -mtime +"$RETAIN_DAYS" -print -delete | tee -a "$log"
find "$LOG_DIR" -maxdepth 1 -type f -name 'backup-*.log' \
  -mtime +"$RETAIN_DAYS" -print -delete >/dev/null

echo "[$(date -u +%FT%TZ)] done" | tee -a "$log"
