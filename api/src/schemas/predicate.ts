import { z } from 'zod';
import { EQUIPMENT_KEYS } from '../services/equipmentRegistry.js';

// Each predicate type is a discriminated union member.
// Add new predicate types here AND in predicateCompiler.ts in lockstep.

export const DumbbellPredicate = z.object({
  type: z.literal('dumbbells'),
  min_pair_lb: z.number().int().min(1).max(500),
});

export const BarbellPredicate = z.object({ type: z.literal('barbell') });
export const FlatBenchPredicate = z.object({ type: z.literal('flat_bench') });
export const SquatRackPredicate = z.object({ type: z.literal('squat_rack') });
export const PullupBarPredicate = z.object({ type: z.literal('pullup_bar') });
export const DipStationPredicate = z.object({ type: z.literal('dip_station') });
export const CableStackPredicate = z.object({ type: z.literal('cable_stack') });
export const RowingErgPredicate = z.object({ type: z.literal('rowing_erg') });
export const TreadmillPredicate = z.object({ type: z.literal('treadmill') });
export const RecumbentBikePredicate = z.object({ type: z.literal('recumbent_bike') });
export const OutdoorWalkingPredicate = z.object({ type: z.literal('outdoor_walking') });

export const AdjustableBenchPredicate = z.object({
  type: z.literal('adjustable_bench'),
  incline: z.boolean().optional(),
  decline: z.boolean().optional(),
});

export const MachinePredicate = z.object({
  type: z.literal('machine'),
  name: z.enum(['leg_press','lat_pulldown','chest_press','leg_extension','leg_curl']),
});

export const Predicate = z.discriminatedUnion('type', [
  DumbbellPredicate, BarbellPredicate, FlatBenchPredicate, SquatRackPredicate,
  PullupBarPredicate, DipStationPredicate, CableStackPredicate, RowingErgPredicate,
  TreadmillPredicate, RecumbentBikePredicate, OutdoorWalkingPredicate,
  AdjustableBenchPredicate, MachinePredicate,
]);

export const RequiredEquipment = z.object({
  _v: z.literal(1),
  requires: z.array(Predicate).max(20),
});

export type PredicateT = z.infer<typeof Predicate>;
export type RequiredEquipmentT = z.infer<typeof RequiredEquipment>;

// Exhaustiveness check — every predicate type must appear in EQUIPMENT_KEYS or be a 'machine' subtype
const allTypes = ['dumbbells','barbell','flat_bench','squat_rack','pullup_bar','dip_station',
  'cable_stack','rowing_erg','treadmill','recumbent_bike','outdoor_walking','adjustable_bench','machine'];
for (const t of allTypes) {
  if (t !== 'machine' && !EQUIPMENT_KEYS.includes(t)) {
    throw new Error(`Predicate type "${t}" not in EQUIPMENT_KEYS`);
  }
}
