#!/usr/bin/env bash
# WS5 / G13 — external post-deploy smoke for repos.jpmtech.com.
#
# Verifies, from OUTSIDE the Cloudflare Tunnel, that a fresh deploy is correct:
#   (a) logged-out GET /            -> 302  (CF Access whole-host gate fires)
#   (b) public  GET /api/health/sync/status -> 401  (edge bypass + origin bearer gate)
#   (c) deployed bundle fingerprint == the build artifact's fingerprint
#       (proves the running container serves the SHA we think it does)
# Exits non-zero on ANY mismatch so the deploy is failed.
#
# Pure assertion functions (assert_*, extract_bundle_fingerprint) take their
# inputs as arguments and do no network I/O — unit-tested by
# tests/smoke/post-deploy-smoke.test.sh. `main` does the real curl/build.
#
# Usage (CI / operator, after recreating the container on Unraid):
#   BASE_URL=https://repos.jpmtech.com \
#   EXPECTED_FINGERPRINT="$(...)" \
#   CF_ACCESS_SVC_CLIENT_ID=... CF_ACCESS_SVC_CLIENT_SECRET=... \
#     bash scripts/post-deploy-smoke.sh
set -euo pipefail

# ── pure assertion helpers (unit-tested) ───────────────────────────────

# Extract the sorted set of /assets/* paths referenced by an index.html body.
# This is the bundle fingerprint: Vite hashes asset filenames, so two builds
# of the same source share it and any source change rotates it.
extract_bundle_fingerprint() {
  local html="$1"
  printf '%s' "$html" | grep -oE '/assets/[A-Za-z0-9._-]+' | sort -u
}

# (a) logged-out root must redirect to CF Access.
assert_root_redirect() {
  local code="$1"
  if [ "$code" = "302" ]; then
    return 0
  fi
  echo "FAIL: logged-out GET / returned ${code}, expected 302 (CF Access gate)" >&2
  return 1
}

# (b) public sync/status must be unauthorized (no bearer, no CF cookie).
assert_sync_unauthorized() {
  local code="$1"
  if [ "$code" = "401" ]; then
    return 0
  fi
  echo "FAIL: public GET /api/health/sync/status returned ${code}, expected 401" >&2
  return 1
}

# (c) deployed fingerprint must equal the build-artifact fingerprint.
assert_bundle_match() {
  local expected="$1" deployed="$2"
  if [ -z "$deployed" ]; then
    echo "FAIL: deployed bundle fingerprint is empty (CF Access challenge or wrong path?)" >&2
    return 1
  fi
  if [ "$expected" = "$deployed" ]; then
    return 0
  fi
  echo "FAIL: bundle drift — deployed bundle != build artifact" >&2
  echo "  expected: ${expected//$'\n'/ }" >&2
  echo "  deployed: ${deployed//$'\n'/ }" >&2
  return 1
}

# ── orchestration (skipped when sourced as a library) ──────────────────
main() {
  : "${BASE_URL:?BASE_URL must be set, e.g. https://repos.jpmtech.com}"
  : "${EXPECTED_FINGERPRINT:?EXPECTED_FINGERPRINT must be set (sorted /assets/* paths from the build artifact)}"
  : "${CF_ACCESS_SVC_CLIENT_ID:?CF_ACCESS_SVC_CLIENT_ID must be set (CF Access service token)}"
  : "${CF_ACCESS_SVC_CLIENT_SECRET:?CF_ACCESS_SVC_CLIENT_SECRET must be set}"

  local fail=0

  echo "→ (a) logged-out GET ${BASE_URL}/ — expect 302 to CF Access"
  local root_code
  # `|| true`: keep the assert_* helpers the single failure-reporting surface.
  # Under `set -euo pipefail` a transport-level curl failure would otherwise
  # abort main before assert_root_redirect emits its actionable diagnostic.
  root_code="$(curl -s -o /dev/null -w '%{http_code}' --max-redirs 0 "${BASE_URL}/" || true)"
  assert_root_redirect "$root_code" || fail=1

  echo "→ (b) public GET ${BASE_URL}/api/health/sync/status — expect 401"
  local sync_code
  sync_code="$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/api/health/sync/status" || true)"
  assert_sync_unauthorized "$sync_code" || fail=1

  echo "→ (c) deployed bundle fingerprint == build artifact"
  local deployed_html deployed_fp
  deployed_html="$(curl -s \
    -H "CF-Access-Client-Id: ${CF_ACCESS_SVC_CLIENT_ID}" \
    -H "CF-Access-Client-Secret: ${CF_ACCESS_SVC_CLIENT_SECRET}" \
    "${BASE_URL}/index.html" || true)"
  # `|| true`: extract_bundle_fingerprint's grep exits non-zero when no
  # /assets/* match (CF Access challenge page or wrong path). Without this,
  # pipefail aborts main here and assert_bundle_match's empty-fingerprint
  # diagnostic — the exact production failure mode — never runs.
  deployed_fp="$(extract_bundle_fingerprint "$deployed_html" || true)"
  assert_bundle_match "$EXPECTED_FINGERPRINT" "$deployed_fp" || fail=1

  if [ "$fail" -ne 0 ]; then
    echo "✗ post-deploy smoke FAILED — deploy is bad, roll back (docker/scripts/rollback.sh)" >&2
    exit 1
  fi
  echo "✓ post-deploy smoke PASS"
}

# Run main only when executed directly, not when sourced by the test.
if [ -z "${POST_DEPLOY_SMOKE_LIB:-}" ]; then
  main "$@"
fi
