#!/usr/bin/env bash
# W8 / WS4 — rollback.sh unit test. Exercises the no-op paths ONLY (--help,
# missing-arg, DRY_RUN). NEVER touches prod: asserts the dry-run path neither
# ssh-es nor invokes docker, and that the printed recipe carries the resource
# caps and the :sha tag.
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/docker/scripts/rollback.sh"
test -x "$SCRIPT" || { echo "FAIL: $SCRIPT missing or not executable"; exit 1; }

# 1. --help exits 0 and prints usage, touches nothing.
OUT=$("$SCRIPT" --help)
echo "$OUT" | grep -q 'Usage:' || { echo "FAIL: --help has no Usage line"; exit 1; }
echo "$OUT" | grep -q 'rollback.sh <sha>' || { echo "FAIL: --help missing invocation"; exit 1; }
echo "✓ --help prints usage and exits 0"

# 2. Missing sha → non-zero exit + error on stderr.
if "$SCRIPT" >/dev/null 2>&1; then
  echo "FAIL: missing-sha call exited 0 (should reject)"; exit 1
fi
echo "✓ missing sha argument is rejected"

# 3. DRY_RUN must print the recipe and NOT call ssh/docker. We shadow ssh and
#    docker with failing stubs on PATH; if the script invokes either, the stub
#    makes it fail and we catch it.
STUBS=$(mktemp -d)
# shellcheck disable=SC2064  # expand $STUBS now: it is set above and never reassigned.
trap "rm -rf '$STUBS'" EXIT
# shellcheck disable=SC2016  # the literal $0/$* must land in the stub script, not expand here.
printf '#!/usr/bin/env bash\necho "STUB-INVOKED: $0 $*" >&2\nexit 99\n' > "$STUBS/ssh"
# shellcheck disable=SC2016
printf '#!/usr/bin/env bash\necho "STUB-INVOKED: $0 $*" >&2\nexit 99\n' > "$STUBS/docker"
chmod +x "$STUBS/ssh" "$STUBS/docker"

DRY_OUT=$(PATH="$STUBS:$PATH" DRY_RUN=1 "$SCRIPT" abc1234 2>&1) || {
  echo "FAIL: DRY_RUN path invoked ssh/docker (exit non-zero): $DRY_OUT"; exit 1; }
echo "$DRY_OUT" | grep -q 'STUB-INVOKED' && { echo "FAIL: DRY_RUN reached ssh/docker"; exit 1; }
echo "$DRY_OUT" | grep -q 'ghcr.io/otahesh/repos:sha-abc1234' || { echo "FAIL: DRY_RUN recipe missing :sha tag"; exit 1; }
echo "$DRY_OUT" | grep -q -- '--memory=2g' || { echo "FAIL: DRY_RUN recipe missing --memory=2g cap"; exit 1; }
echo "$DRY_OUT" | grep -q -- '--cpus=2' || { echo "FAIL: DRY_RUN recipe missing --cpus=2 cap"; exit 1; }
echo "$DRY_OUT" | grep -q -- '--network br0' || { echo "FAIL: DRY_RUN recipe missing --network br0"; exit 1; }
echo "$DRY_OUT" | grep -q -- '--ip 192.168.88.65' || { echo "FAIL: DRY_RUN recipe missing pinned IP"; exit 1; }
echo "✓ DRY_RUN prints the capped :sha recipe without touching ssh/docker"

echo "✓ rollback.test.sh PASS"
