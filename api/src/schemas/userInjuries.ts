import { z } from 'zod';

// ---------------------------------------------------------------------------
// Beta W3.4 — user_injuries request / response schemas.
//
// Source-of-truth for the 7 supported joints and 3 severity tiers. The same
// const arrays back:
//   - the migration 032 CHECK constraint on user_injuries.joint / severity,
//   - the frontend chip grid (Task 20 — InjuryChipsEditor),
//   - the injury ranker JOINT_ROOT + SEVERITY_FACTOR maps (Task 14).
// ---------------------------------------------------------------------------

export const INJURY_JOINTS = [
  'shoulder_left',
  'shoulder_right',
  'low_back',
  'knee_left',
  'knee_right',
  'elbow',
  'wrist',
] as const;
export type InjuryJoint = (typeof INJURY_JOINTS)[number];

export const INJURY_SEVERITIES = ['low', 'mod', 'high'] as const;
export type InjurySeverity = (typeof INJURY_SEVERITIES)[number];

// ---------------------------------------------------------------------------
// POST /api/user/injuries — upsert request body
// Defaults mirror migration 032: severity DEFAULT 'mod', notes DEFAULT ''.
// onset_at is optional + nullable to match the nullable DATE column.
// ---------------------------------------------------------------------------

export const UserInjuryUpsertRequestSchema = z.object({
  joint:    z.enum(INJURY_JOINTS),
  severity: z.enum(INJURY_SEVERITIES).default('mod'),
  notes:    z.string().max(500).default(''),
  onset_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});
export type UserInjuryUpsertRequest = z.infer<typeof UserInjuryUpsertRequestSchema>;

// ---------------------------------------------------------------------------
// PATCH /api/user/injuries/:joint — partial update; joint comes from path
// ---------------------------------------------------------------------------

export const UserInjuryPatchRequestSchema = UserInjuryUpsertRequestSchema
  .omit({ joint: true })
  .partial();
export type UserInjuryPatchRequest = z.infer<typeof UserInjuryPatchRequestSchema>;

// ---------------------------------------------------------------------------
// GET /api/user/injuries — list item + response envelope
// ---------------------------------------------------------------------------

export const UserInjuryItemSchema = z.object({
  joint:      z.enum(INJURY_JOINTS),
  severity:   z.enum(INJURY_SEVERITIES),
  notes:      z.string(),
  onset_at:   z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type UserInjuryItem = z.infer<typeof UserInjuryItemSchema>;

export const UserInjuryListResponseSchema = z.object({
  injuries: z.array(UserInjuryItemSchema),
});
export type UserInjuryListResponse = z.infer<typeof UserInjuryListResponseSchema>;
