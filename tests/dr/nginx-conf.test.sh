#!/usr/bin/env bash
# Pre-cutover 2026-07-11 — nginx repos.conf invariants. The W5 backup-path
# location `/api/backups/` (trailing slash + proxy_pass) triggered nginx's
# implicit 301 for the bare `/api/backups` request, redirecting to
# http://<host>/api/backups/ — scheme-downgraded because TLS terminates at
# Cloudflare — which the CSP (connect-src 'self') then blocked. Net effect:
# the Backups page could never list snapshots in prod. CI and dev have no
# nginx in front, so only these greps pin the fix.
set -euo pipefail

CONF="$(cd "$(dirname "$0")/../.." && pwd)/docker/nginx/repos.conf"
test -f "$CONF" || { echo "FAIL: $CONF missing"; exit 1; }

# 1. Exact-match location for the bare list/create path — pre-empts the
#    implicit trailing-slash redirect of the /api/backups/ prefix block.
grep -qE '^\s*location = /api/backups\s*\{' "$CONF" \
  || { echo "FAIL: no exact-match 'location = /api/backups' block"; exit 1; }
echo "✓ exact-match /api/backups location present"

# 2. Belt-and-braces: any future implicit redirect must stay relative so it
#    can never downgrade the scheme behind the TLS-terminating edge.
grep -qE '^\s*absolute_redirect\s+off;' "$CONF" \
  || { echo "FAIL: absolute_redirect off missing"; exit 1; }
echo "✓ absolute_redirect off present"

echo "PASS: nginx-conf invariants hold"
