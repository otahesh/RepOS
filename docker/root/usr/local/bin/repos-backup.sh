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

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'repos-*.dump.gz' \
  -mtime +"$RETAIN_DAYS" -print -delete | tee -a "$log"
find "$LOG_DIR" -maxdepth 1 -type f -name 'backup-*.log' \
  -mtime +"$RETAIN_DAYS" -print -delete >/dev/null

echo "[$(date -u +%FT%TZ)] done" | tee -a "$log"
