#!/usr/bin/env bash
# Test harness for check-no-placeholder.sh. Self-contained: no framework.
# Each case prints PASS/FAIL; the script exits non-zero if any case fails.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GUARD="$ROOT/scripts/check-no-placeholder.sh"
fail=0

# Case 1: clean tree (allowlisted bootstrap-runtime.ts is the only occurrence) -> exit 0
if bash "$GUARD" >/dev/null 2>&1; then
  echo "PASS: clean tree passes"
else
  echo "FAIL: clean tree should pass but guard exited non-zero"; fail=1
fi

# Case 2: synthetic reintroduction in a non-allowlisted file -> exit non-zero
TMP="$ROOT/api/src/__placeholder_probe__.ts"
trap 'rm -f "$TMP"' EXIT
printf 'const x = "00000000-0000-0000-0000-000000000001";\n' > "$TMP"
if bash "$GUARD" >/dev/null 2>&1; then
  echo "FAIL: synthetic reintroduction should fail but guard passed"; fail=1
else
  echo "PASS: synthetic reintroduction fails the guard"
fi
rm -f "$TMP"; trap - EXIT

# Case 3: the allowlisted file alone must NOT trip the guard
if bash "$GUARD" >/dev/null 2>&1; then
  echo "PASS: bootstrap-runtime.ts allowlist holds"
else
  echo "FAIL: allowlist for bootstrap-runtime.ts is not working"; fail=1
fi

exit "$fail"
