import { z } from 'zod';
import { EQUIPMENT_KEYS } from '../services/equipmentRegistry.js';

const LoadRange = z.object({
  min_lb: z.number().int().min(1).max(500),
  max_lb: z.number().int().min(1).max(500),
  increment_lb: z.number().int().min(1).max(50),
}).refine(o => o.max_lb >= o.min_lb, { message: 'max_lb must be >= min_lb' });

const AdjBench = z.object({ incline: z.boolean().optional(), decline: z.boolean().optional() });
const Recumbent = z.object({ resistance_levels: z.number().int().min(1).max(50) });
const OutdoorWalking = z.object({ loop_mi: z.number().min(0).max(100) });
const Machines = z.object({
  leg_press: z.boolean().optional(), lat_pulldown: z.boolean().optional(),
  chest_press: z.boolean().optional(), leg_extension: z.boolean().optional(),
  leg_curl: z.boolean().optional(),
});

export const EquipmentProfileSchema = z.object({
  _v: z.literal(1),
  dumbbells: z.union([z.literal(false), LoadRange]).optional(),
  kettlebells: z.union([z.literal(false), LoadRange]).optional(),
  adjustable_bench: z.union([z.literal(false), AdjBench]).optional(),
  recumbent_bike: z.union([z.literal(false), Recumbent]).optional(),
  outdoor_walking: z.union([z.literal(false), OutdoorWalking]).optional(),
  machines: Machines.optional(),
  barbell: z.boolean().optional(),
  ez_bar: z.boolean().optional(),
  trap_bar: z.boolean().optional(),
  flat_bench: z.boolean().optional(),
  squat_rack: z.boolean().optional(),
  pullup_bar: z.boolean().optional(),
  dip_station: z.boolean().optional(),
  cable_stack: z.boolean().optional(),
  treadmill: z.boolean().optional(),
  stationary_bike: z.boolean().optional(),
  rowing_erg: z.boolean().optional(),
  outdoor_cycling: z.boolean().optional(),
}).passthrough()
  .superRefine((val, ctx) => {
    for (const key of Object.keys(val)) {
      if (key === '_v') continue;
      if (!EQUIPMENT_KEYS.includes(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key],
          message: `unknown equipment key: ${key}` });
      }
    }
  });

export type EquipmentProfile = z.infer<typeof EquipmentProfileSchema>;
