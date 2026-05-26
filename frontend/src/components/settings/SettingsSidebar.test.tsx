import { describe, it, expect } from 'vitest';
import { SETTINGS_SECTIONS } from './SettingsSidebar';

describe('SETTINGS_SECTIONS authoritative layout (D7 — 8 top-level entries)', () => {
  it('ships exactly 8 top-level entries (Storage + Injuries stay top-level per D7)', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
      'Account','Equipment','Integrations','Program prefs','Backups','Feedback','Storage','Injuries',
    ]);
  });

  it('marks slots W4/W5/W7 will populate as disabled until those waves land', () => {
    const byLabel = new Map(SETTINGS_SECTIONS.map((s) => [s.label, s]));
    expect(byLabel.get('Program prefs')?.disabled).toBe(true);
    expect(byLabel.get('Backups')?.disabled).toBe(true);
    expect(byLabel.get('Feedback')?.disabled).toBe(true);
    expect(byLabel.get('Account')?.disabled).toBe(false);
    expect(byLabel.get('Equipment')?.disabled).toBe(false);
    expect(byLabel.get('Integrations')?.disabled).toBe(false);
    expect(byLabel.get('Storage')?.disabled).toBe(false);
    expect(byLabel.get('Injuries')?.disabled).toBe(false);
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
