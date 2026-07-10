#!/usr/bin/env bash
# repos-redeploy.sh — one-command production redeploy for RepOS on Unraid.
#
# Runs ON THE UNRAID HOST (it orchestrates `docker`); it is NOT an in-container
# script. The canonical copy lives in the repo at scripts/redeploy.sh; the
# running copy is installed on the box at /mnt/user/appdata/repos/repos-redeploy.sh.
# After editing here, reinstall on the box (see "install" at the bottom of this file).
#
# Invoke from the dev mac:
#   ssh unraid /mnt/user/appdata/repos/repos-redeploy.sh           # redeploy :latest
#   ssh unraid /mnt/user/appdata/repos/repos-redeploy.sh rollback  # undo: recreate from newest rollback-* tag
#   ssh unraid /mnt/user/appdata/repos/repos-redeploy.sh rollback rollback-20260626T161549Z  # specific tag
#
# Redeploy flow: tag rollback point -> pull :latest -> verify target SHA -> backup
# DB (integrity-checked) -> stop+rm+run -> wait healthy -> verify (SHA, rows, /health)
# -> prune rollback-* tags beyond the newest $ROLLBACK_KEEP (default 3).
#
# Safety: the destructive stop+rm+run only runs AFTER the image pull AND a verified
# DB backup both succeed, so any earlier failure leaves the old container running.
# A failed health check does NOT auto-rollback — it prints logs + the exact rollback
# command and exits non-zero, so a human decides (a code rollback is unsafe to
# automate once a migration may have run).
set -euo pipefail

# ---- config (edit if topology changes) -------------------------------------
CONTAINER="${REPOS_CONTAINER:-RepOS}"
IMAGE_REPO="${REPOS_IMAGE_REPO:-ghcr.io/otahesh/repos}"
IMAGE="${IMAGE_REPO}:latest"
NETWORK="${REPOS_NETWORK:-br0}"
IP="${REPOS_IP:-192.168.88.65}"
APPDATA="${REPOS_APPDATA:-/mnt/user/appdata/repos}"
ENV_FILE="${REPOS_ENV_FILE:-${APPDATA}/.env}"
CONFIG_MOUNT="${REPOS_CONFIG_MOUNT:-${APPDATA}/config:/config}"
HEALTH_TIMEOUT="${REPOS_HEALTH_TIMEOUT:-90}"   # seconds to wait for "healthy"
ROLLBACK_KEEP="${REPOS_ROLLBACK_KEEP:-3}"      # rollback-* tags retained after a deploy

# ---- helpers ---------------------------------------------------------------
log()  { printf '\n\033[1;34m=== %s ===\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mFATAL: %s\033[0m\n' "$*" >&2; exit 1; }

# Recreate the container from an image ref ($1) with the canonical run config.
run_container() {
  # --memory/--cpus match docker/scripts/rollback.sh (G10 recipe) so a routine
  # redeploy doesn't silently drop the prod resource caps.
  docker run -d --name "$CONTAINER" --restart unless-stopped \
    --network "$NETWORK" --ip "$IP" \
    --memory=2g --cpus=2 \
    -v "$CONFIG_MOUNT" \
    --env-file "$ENV_FILE" \
    "$1" >/dev/null
}

# Poll the container healthcheck until healthy / unhealthy / timeout.
wait_healthy() {
  local waited=0 s
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    s="$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo missing)"
    printf '  health=%s (%ds)\n' "$s" "$waited"
    [ "$s" = healthy ]   && return 0
    [ "$s" = unhealthy ] && return 1
    sleep 3; waited=$((waited + 3))
  done
  return 1
}

db_counts() {
  docker exec "$CONTAINER" bash -c '
    for pair in users:users weight_samples:health_weight_samples sync_status:health_sync_status; do
      label=${pair%%:*}; tbl=${pair##*:}
      n=$(s6-setuidgid postgres /usr/bin/psql -h /tmp -U postgres -d "$POSTGRES_DB" -tAc "select count(*) from $tbl")
      printf "  %s=%s\n" "$label" "$n"
    done'
}

verify() {
  log "VERIFY"
  printf 'running APP_SHA: %s\n' "$(docker exec "$CONTAINER" sh -lc 'echo "$APP_SHA"')"
  echo "row counts:"; db_counts
  # Informational only (the Docker healthcheck already gated health); -f omitted
  # so a non-2xx prints its code instead of aborting a successful deploy.
  docker exec "$CONTAINER" sh -lc \
    'curl -sS -o /dev/null -w "  GET /health -> %{http_code}\n" http://localhost/health'
}

# ---- rollback subcommand ---------------------------------------------------
if [ "${1:-}" = rollback ]; then
  TAG="${2:-$(docker images "$IMAGE_REPO" --format '{{.Tag}}' | grep '^rollback-' | sort | tail -1)}"
  [ -n "$TAG" ] || die "no rollback-* image tag found for $IMAGE_REPO"
  REF="${IMAGE_REPO}:${TAG}"
  docker image inspect "$REF" >/dev/null 2>&1 || die "image $REF is not present locally"
  log "ROLLBACK -> $REF"
  echo "NOTE: this restores CODE only. If a DB migration ran since that image,"
  echo "      restore a dump from /config/backups separately (see scripts/run-restore.sh)."
  docker stop "$CONTAINER" 2>/dev/null || true
  docker rm   "$CONTAINER" 2>/dev/null || true
  run_container "$REF"
  wait_healthy || die "container not healthy after rollback — inspect: docker logs --tail 50 $CONTAINER"
  verify
  log "ROLLBACK COMPLETE -> $REF"
  exit 0
fi

# ---- redeploy flow ---------------------------------------------------------
TS="$(date -u +%Y%m%dT%H%M%SZ)"

log "PREFLIGHT"
docker inspect "$CONTAINER" >/dev/null 2>&1 || die "container $CONTAINER not found"
[ -f "$ENV_FILE" ] || die "env file $ENV_FILE not found"
ok "container present; env file present"

log "TAG ROLLBACK POINT (image the running container uses)"
CURRENT_IMG="$(docker inspect --format '{{.Image}}' "$CONTAINER")"
docker tag "$CURRENT_IMG" "${IMAGE_REPO}:rollback-${TS}"
ok "tagged ${IMAGE_REPO}:rollback-${TS} -> ${CURRENT_IMG}"

log "PULL ${IMAGE}"
docker pull "$IMAGE" | tail -2

NEW_SHA="$(docker image inspect "$IMAGE" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^APP_SHA=//p')"
NEW_SHA="${NEW_SHA:-unknown}"
printf 'target APP_SHA: %s\n' "$NEW_SHA"

log "BACKUP DB (pre-redeploy-${NEW_SHA:0:7}-${TS})"
docker exec -e OUT="/config/backups/pre-redeploy-${NEW_SHA:0:7}-${TS}.dump.gz" "$CONTAINER" bash -c '
  set -eo pipefail
  s6-setuidgid postgres /usr/bin/pg_dump -h /tmp -U postgres -d "$POSTGRES_DB" \
    -Fc --no-owner --no-privileges | gzip -6 > "$OUT"
  chown postgres:postgres "$OUT"; chmod 640 "$OUT"
  # Integrity check: decompress to a temp file then pg_restore -l it. NOT a
  # pipe — pg_restore -l reads the TOC and exits early, which SIGPIPEs gunzip
  # (exit 141) and trips pipefail. The temp file avoids that and still catches
  # both a corrupt gzip (gunzip fails) and an unreadable archive (pg_restore fails).
  gunzip -c "$OUT" > "$OUT.toc"
  pg_restore -l "$OUT.toc" >/dev/null
  rm -f "$OUT.toc"
  printf "backup OK: %s (%s bytes, integrity verified)\n" "$OUT" "$(stat -c %s "$OUT")"
' || die "DB backup failed — NOT redeploying. Old container is untouched and still serving."

log "RECREATE (stop + rm + run — NOT restart, which keeps the old image)"
docker stop "$CONTAINER" && docker rm "$CONTAINER"
run_container "$IMAGE"

log "WAIT HEALTHY (timeout ${HEALTH_TIMEOUT}s)"
if ! wait_healthy; then
  echo "--- last 40 log lines ---"; docker logs --tail 40 "$CONTAINER" 2>&1 || true
  die "new container did not become healthy. Roll back with:
    $0 rollback rollback-${TS}"
fi

verify

# Prune only AFTER a verified-healthy deploy: a failed deploy must leave every
# rollback point in place for the human deciding how far back to go. Timestamped
# tag names sort chronologically, so `sort -r | tail -n +N` is oldest-first
# beyond the keep window. `|| true`: pruning is housekeeping, never a deploy failure.
log "PRUNE ROLLBACK TAGS (keep newest ${ROLLBACK_KEEP})"
docker images "$IMAGE_REPO" --format '{{.Tag}}' | grep '^rollback-' | sort -r \
  | tail -n "+$((ROLLBACK_KEEP + 1))" \
  | xargs -r -n1 -I{} sh -c "docker rmi '${IMAGE_REPO}:{}' >/dev/null && echo 'pruned {}'" || true
ok "retained: $(docker images "$IMAGE_REPO" --format '{{.Tag}}' | grep -c '^rollback-') rollback tag(s)"

log "REDEPLOY COMPLETE"
ok "live APP_SHA=$(docker exec "$CONTAINER" sh -lc 'echo "$APP_SHA"')  |  rollback tag=rollback-${TS}"
echo "Outside-in check (run from a LAN host or the dev mac, NOT the Unraid host — macvlan):"
echo "    curl -sI https://repos.jpmtech.com   # expect: HTTP/2 302 -> jpmtech.cloudflareaccess.com"

# ---- install (reference) ---------------------------------------------------
# To (re)install this script onto the Unraid box from the dev mac:
#   scp scripts/redeploy.sh unraid:/mnt/user/appdata/repos/repos-redeploy.sh
#   ssh unraid chmod +x /mnt/user/appdata/repos/repos-redeploy.sh
