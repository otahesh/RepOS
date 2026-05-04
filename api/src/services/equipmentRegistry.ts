export type EquipmentKeyShape =
  | { kind: 'boolean' }
  | { kind: 'load_range'; fields: ['min_lb', 'max_lb', 'increment_lb'] }
  | { kind: 'object'; fields: string[] };

const REGISTRY: Record<string, EquipmentKeyShape> = {
  // Free weights
  dumbbells:        { kind: 'load_range', fields: ['min_lb','max_lb','increment_lb'] },
  barbell:          { kind: 'boolean' },
  ez_bar:           { kind: 'boolean' },
  trap_bar:         { kind: 'boolean' },
  kettlebells:      { kind: 'load_range', fields: ['min_lb','max_lb','increment_lb'] },
  // Benches & racks
  adjustable_bench: { kind: 'object', fields: ['incline','decline'] },
  flat_bench:       { kind: 'boolean' },
  squat_rack:       { kind: 'boolean' },
  pullup_bar:       { kind: 'boolean' },
  dip_station:      { kind: 'boolean' },
  // Machines
  cable_stack:      { kind: 'boolean' },
  machines:         { kind: 'object', fields: ['leg_press','lat_pulldown','chest_press','leg_extension','leg_curl'] },
  // Cardio
  treadmill:        { kind: 'boolean' },
  stationary_bike:  { kind: 'boolean' },
  recumbent_bike:   { kind: 'object', fields: ['resistance_levels'] },
  rowing_erg:       { kind: 'boolean' },
  outdoor_walking:  { kind: 'object', fields: ['loop_mi'] },
  outdoor_cycling:  { kind: 'boolean' },
};

export const EQUIPMENT_KEYS: readonly string[] = Object.freeze(Object.keys(REGISTRY));

export function isLegalEquipmentKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, key);
}

export function equipmentKeyShape(key: string): EquipmentKeyShape | null {
  return REGISTRY[key] ?? null;
}
