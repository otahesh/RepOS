#!/usr/bin/env bash
# G8 reintroduction guard. Fails if the placeholder user UUID appears in
# non-test production source. The boot-time enforcement file legitimately
# names the UUID and is the ONLY allowlisted occurrence.
#
# Decision (W8 design #6): grep guard, not ESLint — no lint toolchain exists.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PLACEHOLDER='00000000-0000-0000-0000-000000000001'
ALLOWLIST='api/src/bootstrap-runtime.ts'

# Search production source only: api/src + frontend/src. Exclude tests,
# __tests__, *.test.*, *.spec.*, and the allowlisted enforcement file.
hits="$(grep -rIn --include='*.ts' --include='*.tsx' \
          --exclude-dir='__tests__' \
          --exclude='*.test.ts' --exclude='*.test.tsx' \
          --exclude='*.spec.ts' --exclude='*.spec.tsx' \
          "$PLACEHOLDER" \
          "$ROOT/api/src" "$ROOT/frontend/src" 2>/dev/null \
        | grep -v "/$ALLOWLIST" || true)"

if [[ -n "$hits" ]]; then
  echo "FAIL: placeholder user UUID ($PLACEHOLDER) found outside the allowlist:" >&2
  echo "$hits" >&2
  echo "If this is the legitimate enforcement file, add it to ALLOWLIST in $0." >&2
  exit 1
fi
echo "OK: no placeholder UUID outside $ALLOWLIST"
