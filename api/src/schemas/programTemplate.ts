import { z } from 'zod';

const SLUG_RE = /^[a-z0-9-]+$/;

const StrengthBlock = z.object({
  exercise_slug: z.string().regex(SLUG_RE),
  mev: z.number().int().min(0).max(40),
  mav: z.number().int().min(0).max(40),
  target_reps_low: z.number().int().min(1).max(50),
  target_reps_high: z.number().int().min(1).max(50),
  target_rir: z.number().int().min(1).max(5),     // RIR 0 banned globally (Q4)
  rest_sec: z.number().int().min(15).max(900),
}).refine(b => b.mev <= b.mav,
  { message: 'mev must be <= mav', path: ['mev'] })
 .refine(b => b.target_reps_low <= b.target_reps_high,
  { message: 'target_reps_low must be <= target_reps_high', path: ['target_reps_low'] });

const CardioInner = z.object({
  target_duration_sec: z.number().int().min(60).max(7200).optional(),
  target_distance_m: z.number().int().min(100).max(100_000).optional(),
  target_zone: z.number().int().min(1).max(5).optional(),
}).refine(c => c.target_duration_sec != null || c.target_distance_m != null,
  { message: 'cardio block requires target_duration_sec or target_distance_m', path: ['target_duration_sec'] });

const CardioBlock = z.object({
  exercise_slug: z.string().regex(SLUG_RE),
  cardio: CardioInner,
});

const Block = z.union([StrengthBlock, CardioBlock]);

const Day = z.object({
  idx: z.number().int().min(0).max(6),
  day_offset: z.number().int().min(0).max(6),
  kind: z.enum(['strength','cardio','hybrid']),
  name: z.string().min(1).max(60),
  blocks: z.array(Block).min(1).max(20),
}).strict();

const Structure = z.object({
  _v: z.literal(1),
  days: z.array(Day).min(0).max(7),
}).superRefine((s, ctx) => {
  // day_offset must be strictly increasing within the week (no dupes, monotonic).
  const offsets = s.days.map(d => d.day_offset);
  for (let i = 1; i < offsets.length; i++) {
    if (offsets[i] <= offsets[i - 1]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['days', i, 'day_offset'],
        message: 'day_offset must be strictly increasing within a week',
      });
      break;
    }
  }
  // idx must be 0..days.length-1 in order.
  s.days.forEach((d, i) => {
    if (d.idx !== i) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['days', i, 'idx'],
        message: `day idx must equal ${i}`,
      });
    }
  });
});

export const ProgramTemplateSchema = z.object({
  slug: z.string().regex(SLUG_RE),
  name: z.string().min(1).max(100),
  description: z.string().max(2000).default(''),
  weeks: z.number().int().min(1).max(16),
  days_per_week: z.number().int().min(1).max(7),
  structure: Structure,
}).strict().refine(t => t.structure.days.length === t.days_per_week,
  { message: 'structure.days.length must equal days_per_week', path: ['days_per_week'] });

// Reconciliation-addendum aliases: D's seed adapter imports these alternative names.
export const ProgramTemplateSeedSchema = ProgramTemplateSchema;

export type ProgramTemplateInput = z.infer<typeof ProgramTemplateSchema>;
export type ProgramTemplateSeed = ProgramTemplateInput;
