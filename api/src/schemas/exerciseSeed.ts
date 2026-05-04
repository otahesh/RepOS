import { z } from 'zod';
import { RequiredEquipment } from './predicate.js';

const MUSCLE_SLUGS = [
  'chest','lats','upper_back','front_delt','side_delt','rear_delt',
  'biceps','triceps','quads','hamstrings','glutes','calves',
] as const;

const MOVEMENT_PATTERNS = [
  'push_horizontal','push_vertical','pull_horizontal','pull_vertical',
  'squat','hinge','lunge','carry','rotation','anti_rotation','gait',
] as const;

const PEAK_TENSION = ['short','mid','long','lengthened_partial_capable'] as const;

const StressLevel = z.enum(['low','mod','high']);

export const JointStressProfile = z.object({
  _v: z.literal(1),
  shoulder: StressLevel.optional(),
  knee:     StressLevel.optional(),
  lumbar:   StressLevel.optional(),
  elbow:    StressLevel.optional(),
  wrist:    StressLevel.optional(),
});

export const ExerciseSeedSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/, 'lowercase-kebab'),
  name: z.string().min(1).max(120),
  parent_slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  primary_muscle: z.enum(MUSCLE_SLUGS),
  muscle_contributions: z.record(z.enum(MUSCLE_SLUGS), z.number().min(0.05).max(1.0)),
  movement_pattern: z.enum(MOVEMENT_PATTERNS),
  peak_tension_length: z.enum(PEAK_TENSION),
  required_equipment: RequiredEquipment,
  skill_complexity: z.number().int().min(1).max(5),
  loading_demand: z.number().int().min(1).max(5),
  systemic_fatigue: z.number().int().min(1).max(5),
  joint_stress_profile: JointStressProfile.default({ _v: 1 }),
  eccentric_overload_capable: z.boolean().default(false),
  contraindications: z.array(z.string()).default([]),
  requires_shoulder_flexion_overhead: z.boolean().default(false),
  loads_spine_in_flexion: z.boolean().default(false),
  loads_spine_axially: z.boolean().default(false),
  requires_hip_internal_rotation: z.boolean().default(false),
  requires_ankle_dorsiflexion: z.boolean().default(false),
  requires_wrist_extension_loaded: z.boolean().default(false),
}).refine(
  (e) => e.muscle_contributions[e.primary_muscle] === 1.0,
  { message: 'primary_muscle must have contribution = 1.0', path: ['muscle_contributions'] },
);

export type ExerciseSeed = z.infer<typeof ExerciseSeedSchema>;
