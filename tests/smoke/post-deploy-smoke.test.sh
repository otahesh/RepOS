#!/usr/bin/env bash
# WS5 — post-deploy smoke assertion-logic unit test.
#
# Sources scripts/post-deploy-smoke.sh in library mode (POST_DEPLOY_SMOKE_LIB=1
# skips main) and exercises its three pure assertion functions against mocked
# HTTP status codes and asset fingerprints — NO network, NO prod contact.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
POST_DEPLOY_SMOKE_LIB=1 source "${REPO_ROOT}/scripts/post-deploy-smoke.sh"

# ── Check (a): logged-out root must be 302 ─────────────────────────────
assert_root_redirect 302 || { echo "FAIL: 302 should pass root-redirect check"; exit 1; }
echo "✓ root-redirect accepts 302"

if assert_root_redirect 200 2>/dev/null; then
  echo "FAIL: 200 must NOT pass root-redirect check (host should be CF-Access gated)"; exit 1
fi
echo "✓ root-redirect rejects 200 (un-gated host)"

if assert_root_redirect 401 2>/dev/null; then
  echo "FAIL: 401 must NOT pass root-redirect check"; exit 1
fi
echo "✓ root-redirect rejects 401"

# ── Check (b): public sync/status must be 401 ──────────────────────────
assert_sync_unauthorized 401 || { echo "FAIL: 401 should pass sync-unauthorized check"; exit 1; }
echo "✓ sync-unauthorized accepts 401"

if assert_sync_unauthorized 200 2>/dev/null; then
  echo "FAIL: 200 must NOT pass sync-unauthorized check (public data leak!)"; exit 1
fi
echo "✓ sync-unauthorized rejects 200 (data leak)"

if assert_sync_unauthorized 302 2>/dev/null; then
  echo "FAIL: 302 must NOT pass sync-unauthorized check (edge bypass missing)"; exit 1
fi
echo "✓ sync-unauthorized rejects 302 (edge-bypass misconfig)"

# ── Check (c): deployed bundle fingerprint == build artifact fingerprint
GOOD='/assets/index-BmHn1KwR.js
/assets/index-C9CzTpy9.css'
DRIFT='/assets/index-OLDOLDOL.js
/assets/index-C9CzTpy9.css'

assert_bundle_match "$GOOD" "$GOOD" || { echo "FAIL: identical fingerprints should match"; exit 1; }
echo "✓ bundle-match accepts identical fingerprints"

if assert_bundle_match "$GOOD" "$DRIFT" 2>/dev/null; then
  echo "FAIL: differing fingerprints must NOT match (stale deploy)"; exit 1
fi
echo "✓ bundle-match rejects drift (stale deploy)"

if assert_bundle_match "$GOOD" "" 2>/dev/null; then
  echo "FAIL: empty deployed fingerprint must NOT match (CF Access ate the body)"; exit 1
fi
echo "✓ bundle-match rejects empty deployed fingerprint"

# ── fingerprint extractor is deterministic + sorted ────────────────────
HTML='<script type="module" crossorigin src="/assets/index-BmHn1KwR.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-C9CzTpy9.css">'
FP="$(extract_bundle_fingerprint "$HTML")"
[ "$FP" = "$GOOD" ] || { echo "FAIL: extractor output mismatch: got [$FP]"; exit 1; }
echo "✓ extract_bundle_fingerprint returns sorted /assets paths"

# fonts.googleapis links must NOT pollute the fingerprint
HTML_WITH_FONTS='<link href="https://fonts.googleapis.com/css2?x" rel="stylesheet">
<script type="module" crossorigin src="/assets/index-BmHn1KwR.js"></script>'
FP2="$(extract_bundle_fingerprint "$HTML_WITH_FONTS")"
[ "$FP2" = "/assets/index-BmHn1KwR.js" ] || { echo "FAIL: extractor leaked non-asset URL: [$FP2]"; exit 1; }
echo "✓ extract_bundle_fingerprint ignores external (font) URLs"

echo "✓ post-deploy-smoke.test.sh PASS"
