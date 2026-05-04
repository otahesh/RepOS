import type { EquipmentProfile } from '../schemas/equipmentProfile.js';

export const PRESETS: Record<string, EquipmentProfile> = {
  home_minimal: {
    _v: 1,
    outdoor_walking: { loop_mi: 0 },
  },
  garage_gym: {
    _v: 1,
    dumbbells: { min_lb: 5, max_lb: 50, increment_lb: 5 },
    adjustable_bench: { incline: true, decline: true },
    pullup_bar: true,
  },
  commercial_gym: {
    _v: 1,
    dumbbells: { min_lb: 5, max_lb: 150, increment_lb: 5 },
    barbell: true,
    ez_bar: true,
    flat_bench: true,
    squat_rack: true,
    pullup_bar: true,
    dip_station: true,
    cable_stack: true,
    machines: { leg_press: true, lat_pulldown: true, chest_press: true, leg_extension: true, leg_curl: true },
    treadmill: true,
    stationary_bike: true,
    rowing_erg: true,
  },
};

export function isPreset(name: string): name is keyof typeof PRESETS {
  return Object.prototype.hasOwnProperty.call(PRESETS, name);
}
