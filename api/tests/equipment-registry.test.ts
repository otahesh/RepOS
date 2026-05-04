import { describe, it, expect } from 'vitest';
import {
  EQUIPMENT_KEYS, isLegalEquipmentKey, equipmentKeyShape,
} from '../src/services/equipmentRegistry.js';

describe('equipmentRegistry', () => {
  it('exports the v1 key set', () => {
    expect(EQUIPMENT_KEYS).toContain('dumbbells');
    expect(EQUIPMENT_KEYS).toContain('adjustable_bench');
    expect(EQUIPMENT_KEYS).toContain('recumbent_bike');
    expect(EQUIPMENT_KEYS).toContain('outdoor_walking');
    expect(EQUIPMENT_KEYS).not.toContain('Dumbbells'); // case sensitive
  });

  it('isLegalEquipmentKey rejects unknown keys', () => {
    expect(isLegalEquipmentKey('dumbbells')).toBe(true);
    expect(isLegalEquipmentKey('dumbells')).toBe(false); // typo
  });

  it('exposes a shape descriptor per key', () => {
    expect(equipmentKeyShape('dumbbells')).toEqual({
      kind: 'load_range', fields: ['min_lb','max_lb','increment_lb'],
    });
    expect(equipmentKeyShape('barbell')).toEqual({ kind: 'boolean' });
    expect(equipmentKeyShape('adjustable_bench')).toEqual({
      kind: 'object', fields: ['incline','decline'],
    });
  });
});
