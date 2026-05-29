import { describe, it, expect } from 'vitest';
import { SETTINGS_SECTIONS } from './SettingsSidebar';

describe('SETTINGS_SECTIONS authoritative layout (D7 + W2 Health)', () => {
  it('ships the W6 lineup plus the W2 Health entry (slotted after Account)', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
      'Account','Health','Equipment','Integrations','Program prefs','Backups','Feedback','Storage','Injuries',
    ]);
  });

  it('Health is a live W2 entry (navigable, not a disabled placeholder)', () => {
    const health = SETTINGS_SECTIONS.find((s) => s.label === 'Health');
    expect(health?.disabled).toBe(false);
    expect(health?.ownerWave).toBe('W2');
    expect(health?.to).toBe('/settings/health');
  });

  it('marks zero slots disabled (W2 Health + W4 Program prefs + W5 Backups + W7 Feedback all landed)', () => {
    const byLabel = new Map(SETTINGS_SECTIONS.map((s) => [s.label, s]));
    // W4.3 + W5 + W7 have landed — every settings slot is now navigable.
    expect(byLabel.get('Program prefs')?.disabled).toBe(false);
    expect(byLabel.get('Backups')?.disabled).toBe(false);
    expect(byLabel.get('Feedback')?.disabled).toBe(false);
    expect(byLabel.get('Account')?.disabled).toBe(false);
    expect(byLabel.get('Equipment')?.disabled).toBe(false);
    expect(byLabel.get('Integrations')?.disabled).toBe(false);
    expect(byLabel.get('Storage')?.disabled).toBe(false);
    expect(byLabel.get('Injuries')?.disabled).toBe(false);
    // No remaining disabled slots once W7 lands.
    expect(SETTINGS_SECTIONS.every((s) => s.disabled === false)).toBe(true);
  });

  it('every entry has a route under /settings/', () => {
    for (const s of SETTINGS_SECTIONS) expect(s.to.startsWith('/settings/')).toBe(true);
  });

  it('does NOT demote Storage or Injuries to secondary entries (D7 — G7 must not regress)', () => {
    for (const s of SETTINGS_SECTIONS) {
      expect((s as unknown as Record<string, unknown>).tier ?? 'top').toBe('top');
    }
  });
});
