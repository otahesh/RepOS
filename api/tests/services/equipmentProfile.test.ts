// Direct unit coverage for services/equipmentProfile.ts (quality pass Q8) —
// the presets are user-facing onboarding options; guard that every preset
// still parses against the schema so a schema change can't silently strand
// an unparseable preset.
import { describe, it, expect } from 'vitest';
import { PRESETS, isPreset } from '../../src/services/equipmentProfile.js';
import { EquipmentProfileSchema } from '../../src/schemas/equipmentProfile.js';

describe('equipmentProfile presets', () => {
  it('exposes the three onboarding presets', () => {
    expect(Object.keys(PRESETS).sort()).toEqual(['commercial_gym', 'garage_gym', 'home_minimal']);
  });

  it('every preset parses against EquipmentProfileSchema at _v:1', () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      const r = EquipmentProfileSchema.safeParse(preset);
      expect(r.success, `preset '${name}' failed schema parse`).toBe(true);
      expect(preset._v).toBe(1);
    }
  });

  it('isPreset accepts known names and rejects unknown/prototype keys', () => {
    expect(isPreset('garage_gym')).toBe(true);
    expect(isPreset('commercial_gym')).toBe(true);
    expect(isPreset('peloton_studio')).toBe(false);
    // hasOwnProperty guard: prototype chain names must not count as presets
    expect(isPreset('toString')).toBe(false);
    expect(isPreset('constructor')).toBe(false);
  });
});
