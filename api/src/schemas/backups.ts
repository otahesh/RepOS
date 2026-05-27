import { z } from 'zod';

export const BackupTriggerSchema = z.enum(['manual', 'auto', 'pre_restore', 'restore']);
export type BackupTrigger = z.infer<typeof BackupTriggerSchema>;

// [ABS-2] Badge tiers per master plan Appendix A W5.4.
//   'good'   — file on disk AND integrity_verified=true
//   'warn'   — audit row exists, integrity_verified=true, BUT file gone from disk
//   'danger' — file on disk but integrity_verified=false (gunzip|pg_restore -l failed)
// Restore button DISABLED for 'danger'; rendered with explanatory tooltip for 'warn'.
export const VerifiedRestorableSchema = z.enum(['good', 'warn', 'danger']);
export type VerifiedRestorable = z.infer<typeof VerifiedRestorableSchema>;

export const BackupItemSchema = z.object({
  id: z.string(), // filename (URL-safe; serves as PK in API)
  trigger: BackupTriggerSchema,
  size_bytes: z.number().int().nonnegative(),
  verified_restorable: VerifiedRestorableSchema,
  created_at: z.string(), // ISO 8601
});
export type BackupItem = z.infer<typeof BackupItemSchema>;

export const BackupListResponseSchema = z.object({
  items: z.array(BackupItemSchema),
});
export type BackupListResponse = z.infer<typeof BackupListResponseSchema>;

// Restore typed-confirmation body. Frontend types literally "RESTORE".
export const RestoreRequestSchema = z.object({
  confirm: z.literal('RESTORE'),
});
export type RestoreRequest = z.infer<typeof RestoreRequestSchema>;
