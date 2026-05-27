#!/usr/bin/env bash
# W5.1 — backup integrity-check unit test.
#
# Injects a known-bad gzip into a temp dir and asserts that the same
# integrity check repos-backup.sh runs on its own output
# (gunzip | pg_restore -l) correctly REJECTS non-gzip input.
set -euo pipefail

TMP=$(mktemp -d)
trap "rm -rf '$TMP'" EXIT

BAD="$TMP/repos-bad.dump.gz"
printf 'not a gzip' > "$BAD"

if gunzip -c "$BAD" 2>/dev/null | pg_restore -l > /dev/null 2>&1; then
  echo "FAIL: integrity check passed on bad input"
  exit 1
fi
echo "✓ integrity check correctly rejects non-gzip input"

# Positive control: a valid gzip that is NOT a pg_dump archive should also be
# rejected by pg_restore -l (proves the check tests archive validity, not just
# gzip validity).
NOT_ARCHIVE="$TMP/repos-notarchive.dump.gz"
printf 'hello world' | gzip > "$NOT_ARCHIVE"
if gunzip -c "$NOT_ARCHIVE" 2>/dev/null | pg_restore -l > /dev/null 2>&1; then
  echo "FAIL: integrity check passed on valid-gzip-but-not-a-pg_dump-archive"
  exit 1
fi
echo "✓ integrity check correctly rejects valid gzip that isn't a pg_dump archive"

echo "✓ integrity-check.test.sh PASS"
