#!/usr/bin/env bash
# W8 / WS4 — D10 two-step migration gate (G6).
#
# Rejects a PR that introduces a Step-2 (DESTRUCTIVE) migration unless the PR
# description links a successful dry-run output. Per D10
# (docs/superpowers/specs/beta/round2-engineering-composite.md §D10): every PR
# introducing a destructive migration step MUST link a dry-run artifact; CI
# rejects Step-2 migrations without it.
#
# "Destructive" = a migration file NEW vs origin/main containing any of:
#   DROP TABLE | DROP COLUMN | DROP CONSTRAINT | DROP INDEX
#   | ALTER ... DROP DEFAULT | ALTER ... DROP NOT NULL  (column demotions)
# A "dry-run link" = a PR-body line matching:  Dry-run: <http...>
#
# In CI, set PR_BODY="${{ github.event.pull_request.body }}". The set of changed
# files is detected via `git diff --name-only` vs BASE_REF (default origin/main),
# overridable by CHANGED_FILES (newline/space separated) for testing.
set -euo pipefail

MIGRATIONS_DIR="${MIGRATIONS_DIR:-api/src/db/migrations}"
BASE_REF="${BASE_REF:-origin/main}"
PR_BODY="${PR_BODY:-}"

# Destructive-verb pattern. Each branch anchors on `DROP <object>` so it cannot
# false-positive on the substring "drop" inside an identifier (e.g. an ADDITIVE
# `ALTER TABLE plans ADD COLUMN drop_set_enabled BOOLEAN`). The prior broad
# `ALTER[[:space:]]+TABLE.*DROP` branch did exactly that and is removed; DROP
# COLUMN/CONSTRAINT are covered explicitly below. The two ALTER ... DROP DEFAULT
# / DROP NOT NULL branches catch column demotions (also anchored on a keyword
# after DROP, so they don't trip on identifiers either).
DESTRUCTIVE_RE='DROP[[:space:]]+TABLE|DROP[[:space:]]+COLUMN|DROP[[:space:]]+CONSTRAINT|DROP[[:space:]]+INDEX|DROP[[:space:]]+DEFAULT|DROP[[:space:]]+NOT[[:space:]]+NULL'
DRYRUN_RE='[Dd]ry-run:[[:space:]]*https?://'

if [ -n "${CHANGED_FILES:-}" ]; then
  changed="$CHANGED_FILES"
else
  changed="$(git diff --name-only "${BASE_REF}"...HEAD || git diff --name-only "${BASE_REF}")"
fi

# Only the added/changed migration .sql files matter.
mig_changed=""
for f in $changed; do
  case "$f" in
    "${MIGRATIONS_DIR}"/*.sql) mig_changed="${mig_changed} ${f}" ;;
    api/src/db/migrations/*.sql) mig_changed="${mig_changed} ${f}" ;;
  esac
done

if [ -z "$(printf '%s' "$mig_changed" | tr -d ' ')" ]; then
  echo "OK: no migration changes in this PR — gate not applicable"
  exit 0
fi

destructive=""
for f in $mig_changed; do
  # Resolve to the on-disk path (CHANGED_FILES may use the repo-relative path
  # while MIGRATIONS_DIR points at a test fixture dir).
  base="$(basename "$f")"
  path="$f"
  [ -f "$path" ] || path="${MIGRATIONS_DIR}/${base}"
  [ -f "$path" ] || { echo "WARN: $f not found on disk, skipping" >&2; continue; }
  if grep -Eiq "$DESTRUCTIVE_RE" "$path"; then
    destructive="${destructive} ${base}"
  fi
done

if [ -z "$(printf '%s' "$destructive" | tr -d ' ')" ]; then
  echo "OK: migration(s) are additive (no destructive step) — dry-run link not required"
  exit 0
fi

echo "→ Step-2 (destructive) migration(s) detected:${destructive}"
if printf '%s' "$PR_BODY" | grep -Eq "$DRYRUN_RE"; then
  echo "OK: PR description links a dry-run output — D10 gate satisfied"
  exit 0
fi

echo "FAIL: Step-2 (destructive) migration without a dry-run link in the PR body." >&2
echo "      Per D10, every destructive migration PR must include a line like:" >&2
echo "        Dry-run: https://github.com/otahesh/repos/actions/runs/<id>" >&2
echo "      Rehearse forward -> restore-from-backup -> reapply-against-scratch," >&2
echo "      paste the successful run link, and re-push." >&2
exit 1
