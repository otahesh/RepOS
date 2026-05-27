// Beta W6 — authoritative Settings sidebar layout. SETTINGS_SECTIONS is the
// single source-of-truth that the rendering Sidebar reads from. Per
// master-plan §651 the W6 implementer owns the order; W4.3/W5.4/W7.2 flip
// their `disabled` flag to false in their own waves.
//
// D7 (2026-05-26): Storage + Injuries STAY top-level (already-shipped W1/W3
// surfaces; demoting would regress G7 reachability).

export interface SettingsSection {
  label: string;
  to: string;
  disabled: boolean;
  ownerWave: 'W6' | 'W1' | 'W2' | 'W3' | 'W4' | 'W5' | 'W7';
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { label: 'Account',       to: '/settings/account',       disabled: false, ownerWave: 'W6' },
  { label: 'Health',        to: '/settings/health',        disabled: false, ownerWave: 'W2' },
  { label: 'Equipment',     to: '/settings/equipment',     disabled: false, ownerWave: 'W1' },
  { label: 'Integrations',  to: '/settings/integrations',  disabled: false, ownerWave: 'W1' },
  // Program prefs (landmarks editor) stays a disabled placeholder until W4.3
  // flips it. W2 leaves W6's gating mechanism intact (see featureFlags.ts +
  // panel I-PROGRAM-PREFS-STUB note in the W2 plan).
  { label: 'Program prefs', to: '/settings/program-prefs', disabled: true,  ownerWave: 'W4' },
  { label: 'Backups',       to: '/settings/backups',       disabled: true,  ownerWave: 'W5' },
  { label: 'Feedback',      to: '/settings/feedback',      disabled: true,  ownerWave: 'W7' },
  // D7: Storage + Injuries stay top-level.
  { label: 'Storage',       to: '/settings/storage',       disabled: false, ownerWave: 'W1' },
  { label: 'Injuries',      to: '/settings/injuries',      disabled: false, ownerWave: 'W3' },
] as const;
