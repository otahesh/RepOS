-- Beta W6 — display_name bounds. Units is CUT from W6 (per D6 2026-05-26):
-- a units selector without full-pipeline conversion through every render site
-- (weight_lbs, performed_load_lbs, BodyweightChart, set_logs) creates a worse
-- UX than the lbs-everywhere default. See reference_w3_tuning_candidates.md
-- §"Deferred from W6" for the future-wave plan.
--
-- display_name length cap: existing column has no upper bound, so a malicious
-- (or curious) user could land a 1MB string and DoS the AccountProfileEditor
-- render. 80 chars is the longest common-real-name (covers double-barrelled
-- names with middle initials and titles); matches the iCloud upper bound
-- jmeyer hit empirically during alpha.
--
-- length(trim(...)) >= 1: rejects empty-string and whitespace-only display
-- names (per I-DISPLAY-NAME-NORMALIZE). NFKC normalization + zero-width-space
-- strip lives at the zod schema layer (api/src/schemas/account.ts), not in
-- SQL — Postgres has no native NFKC normalizer.

ALTER TABLE users
  ADD CONSTRAINT users_display_name_length_chk
  CHECK (
    display_name IS NULL
    OR (length(display_name) <= 80 AND length(trim(display_name)) >= 1)
  );
