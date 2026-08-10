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
  group: 'Profile' | 'Training' | 'Data and Integrations' | 'Administration';
  ownerWave: 'W6' | 'W1' | 'W2' | 'W3' | 'W4' | 'W5' | 'W7' | 'W9';
  /** W9 — rendered only when /api/me reports is_admin. The API enforces it server-side regardless. */
  adminOnly?: boolean;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { label: 'Account', to: '/settings/account', disabled: false, ownerWave: 'W6', group: 'Profile' },
  { label: 'Health', to: '/settings/health', disabled: false, ownerWave: 'W2', group: 'Profile' },
  {
    label: 'Injuries',
    to: '/settings/injuries',
    disabled: false,
    ownerWave: 'W3',
    group: 'Profile',
  },
  {
    label: 'Equipment',
    to: '/settings/equipment',
    disabled: false,
    ownerWave: 'W1',
    group: 'Training',
  },
  {
    label: 'Program prefs',
    to: '/settings/program-prefs',
    disabled: false,
    ownerWave: 'W4',
    group: 'Training',
  },
  {
    label: 'Integrations',
    to: '/settings/integrations',
    disabled: false,
    ownerWave: 'W1',
    group: 'Data and Integrations',
  },
  {
    label: 'Backups',
    to: '/settings/backups',
    disabled: false,
    ownerWave: 'W5',
    group: 'Data and Integrations',
  },
  {
    label: 'Storage',
    to: '/settings/storage',
    disabled: false,
    ownerWave: 'W1',
    group: 'Data and Integrations',
  },
  {
    label: 'Feedback',
    to: '/settings/feedback',
    disabled: false,
    ownerWave: 'W7',
    group: 'Administration',
  },
  {
    label: 'Users',
    to: '/settings/users',
    disabled: false,
    ownerWave: 'W9',
    adminOnly: true,
    group: 'Administration',
  },
] as const;

export const SETTINGS_GROUPS = [
  'Profile',
  'Training',
  'Data and Integrations',
  'Administration',
] as const;
