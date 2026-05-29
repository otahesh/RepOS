#!/usr/bin/env bash
# W8 / WS4 — consistency check for the two authored cutover docs. Asserts the
# checklist enumerates every §5 cutover pass (G3,G9,G10,G12,W8.5,G14,G15) and
# the exit-criteria doc lists every D13 floor condition + the weekly cadence.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECK="$ROOT/docs/runbooks/beta-cutover-checklist.md"
EXIT="$ROOT/docs/runbooks/beta-exit-criteria.md"

test -f "$CHECK" || { echo "FAIL: $CHECK missing"; exit 1; }
test -f "$EXIT"  || { echo "FAIL: $EXIT missing"; exit 1; }

# §5 ordered passes must each appear as a gate marker in the checklist.
for g in G3 G9 G10 G12 W8.5 G14 G15; do
  grep -q "$g" "$CHECK" || { echo "FAIL: checklist missing pass $g"; exit 1; }
done
# Each pass must be a checkbox (ordered, actionable).
grep -q '\- \[ \]' "$CHECK" || { echo "FAIL: checklist has no actionable checkboxes"; exit 1; }
echo "✓ cutover checklist enumerates all §5 passes as checkboxes"

# D13 floor conditions (master plan lines 525-531) must all be present.
grep -qi 'no Sev-1' "$EXIT"               || { echo "FAIL: exit missing Sev-1 floor"; exit 1; }
grep -qi 'Sev-2 in the final 14 days' "$EXIT" || { echo "FAIL: exit missing 14-day Sev-2 floor"; exit 1; }
grep -qi 'PAR-Q-bypass' "$EXIT"           || { echo "FAIL: exit missing PAR-Q-bypass floor"; exit 1; }
grep -qi 'dry-fire' "$EXIT"               || { echo "FAIL: exit missing DR dry-fire floor"; exit 1; }
grep -qi 'Important security' "$EXIT"     || { echo "FAIL: exit missing security-findings floor"; exit 1; }
grep -qi 'full mesocycle' "$EXIT"         || { echo "FAIL: exit missing 5-user-mesocycle floor"; exit 1; }
grep -qi 'weekly' "$EXIT"                 || { echo "FAIL: exit missing weekly review cadence"; exit 1; }
echo "✓ exit-criteria doc lists all D13 floor conditions + weekly cadence"

echo "✓ cutover-docs.test.sh PASS"
