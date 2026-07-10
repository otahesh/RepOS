#!/usr/bin/env bash
# W8 / WS4 — production image rollback (G10).
#
# Pins the RepOS container to a specific GHCR image tag, preserving the
# container's network, IP, mounts, restart policy, and env, and applying the
# --memory=2g --cpus=2 resource caps. This is the env-preserving, capped form
# of the reference_unraid_redeploy recipe — use it instead of `docker restart`
# (which keeps the old image) when rolling prod back to a known-good build.
#
# Usage:
#   docker/scripts/rollback.sh <sha>     # roll prod to ghcr.io/otahesh/repos:sha-<sha>
#   docker/scripts/rollback.sh --help    # print usage, touch nothing
#
# Env:
#   UNRAID_SSH   SSH alias/host for the Unraid docker host (default: unraid)
#   CONTAINER    container name (default: RepOS)
#   IMAGE_REPO   image repo (default: ghcr.io/otahesh/repos)
#   DRY_RUN=1    print the docker recipe and exit; do NOT ssh or run docker
#
# shellcheck disable=SC2029  # CONTAINER/IMAGE/UNRAID_SSH are local-trusted defaults;
#   expanding them client-side in the ssh command strings is intended (the host shares
#   the same names) and keeps the recipe greppable for the dry-run test.
set -euo pipefail

UNRAID_SSH="${UNRAID_SSH:-unraid}"
CONTAINER="${CONTAINER:-RepOS}"
IMAGE_REPO="${IMAGE_REPO:-ghcr.io/otahesh/repos}"

usage() {
  cat <<'USAGE'
Usage: rollback.sh <sha>

Pin the production RepOS container to ghcr.io/otahesh/repos:sha-<sha>,
preserving network/IP/mounts/env and applying --memory=2g --cpus=2 caps.

  <sha>        short commit sha matching a pushed image tag (sha-<sha>)
  --help       print this usage and exit

Env: UNRAID_SSH (default unraid), CONTAINER (default RepOS),
     IMAGE_REPO (default ghcr.io/otahesh/repos), DRY_RUN=1 (print only).
USAGE
}

case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  "") echo "ERROR: missing <sha> argument" >&2; usage >&2; exit 2 ;;
esac

SHA="$1"
# Accept short or full hex sha only.
if ! printf '%s' "$SHA" | grep -Eq '^[0-9a-f]{7,40}$'; then
  echo "ERROR: <sha> must be 7-40 hex chars (got: $SHA)" >&2
  exit 2
fi

IMAGE="${IMAGE_REPO}:sha-${SHA}"

# The env-preserving recreate recipe. In a real run we capture the live env via
# `docker inspect` over SSH into a temp file, then recreate with --env-file.
# In DRY_RUN we just show the shape so the operator (and the test) can confirm
# the caps + pinned tag + IP are present.
print_recipe() {
  cat <<RECIPE
# 1. pull the pinned image on the host
ssh ${UNRAID_SSH} docker pull ${IMAGE}
# 2. capture the existing container env (don't lose secrets) — but drop the
#    old image's baked APP_SHA so the pinned image's own value shows through
ssh ${UNRAID_SSH} "docker inspect ${CONTAINER} --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -v '^APP_SHA=' > /tmp/repos.env"
# 3. stop + remove (volumes on /mnt/user/appdata/repos/config survive)
ssh ${UNRAID_SSH} "docker stop ${CONTAINER} && docker rm ${CONTAINER}"
# 4. recreate, pinned to ${IMAGE}, env-preserving, with resource caps
ssh ${UNRAID_SSH} docker run -d \\
  --name ${CONTAINER} \\
  --network br0 --ip 192.168.88.65 \\
  --restart unless-stopped \\
  --memory=2g --cpus=2 \\
  -v /mnt/user/appdata/repos/config:/config \\
  --env-file /tmp/repos.env \\
  ${IMAGE}
RECIPE
}

if [ "${DRY_RUN:-}" = "1" ]; then
  echo "DRY_RUN — would roll ${CONTAINER} to ${IMAGE}:"
  print_recipe
  exit 0
fi

echo "→ Rolling ${CONTAINER} back to ${IMAGE} on ${UNRAID_SSH}..."

ssh "${UNRAID_SSH}" docker pull "${IMAGE}"
# Drop the captured APP_SHA: it's baked into each image, and carrying the old
# one over via --env-file masks the pinned image's own APP_SHA — during the
# 2026-07-10 G10 dry-fire this made the rolled-back container report the NEW
# sha, defeating the operator's verification signal.
ssh "${UNRAID_SSH}" "docker inspect ${CONTAINER} --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -v '^APP_SHA=' > /tmp/repos.env"
ssh "${UNRAID_SSH}" "docker stop ${CONTAINER} && docker rm ${CONTAINER}"
ssh "${UNRAID_SSH}" docker run -d \
  --name "${CONTAINER}" \
  --network br0 --ip 192.168.88.65 \
  --restart unless-stopped \
  --memory=2g --cpus=2 \
  -v /mnt/user/appdata/repos/config:/config \
  --env-file /tmp/repos.env \
  "${IMAGE}"

echo "→ Waiting for healthy..."
for i in $(seq 1 25); do
  s=$(ssh "${UNRAID_SSH}" "docker inspect --format '{{.State.Health.Status}}' ${CONTAINER}" 2>/dev/null || true)
  echo "tick $i: ${s:-unknown}"
  [ "$s" = "healthy" ] && break
  sleep 3
done

echo "✓ rolled ${CONTAINER} to ${IMAGE}. Run the post-deploy smoke or curl https://repos.jpmtech.com/health to confirm."
