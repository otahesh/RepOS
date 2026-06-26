// frontend/src/lib/featureFlags.ts
// Beta feature flags. W4.3 flips BETA_LANDMARKS_EDITOR to true when the
// per-program landmarks editor (/settings/program-prefs) lands.
//
// NOTE (W2, panel I-PROGRAM-PREFS-STUB): the Settings → Program prefs entry is
// currently gated by W6's `disabled: true` flag in SETTINGS_SECTIONS — that is
// the live mechanism the Sidebar reads. This flag is published now so W4.3 has
// a single named switch to consume; W4.3 should both flip the SETTINGS_SECTIONS
// `disabled` flag AND set this to true (or migrate the Sidebar to read this).
export const FEATURE_FLAGS = {
  BETA_LANDMARKS_EDITOR: false, // W4.3 flips to true
} as const;
