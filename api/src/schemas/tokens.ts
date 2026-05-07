import { z } from 'zod';

// ---------------------------------------------------------------------------
// POST /api/tokens — request body
// ---------------------------------------------------------------------------

export const TokenMintRequestSchema = z.object({
  user_id: z.string().uuid().optional(),
  label: z.string().max(100).nullable().optional(),
});

export type TokenMintRequest = z.infer<typeof TokenMintRequestSchema>;

// POST /api/tokens — response body (201)
export const TokenMintResponseSchema = z.object({
  id: z.string(), // BIGSERIAL returned as string by pg
  token: z.string(), // plaintext "<prefix>.<secret>", show once
  created_at: z.string(), // ISO-8601 timestamp
});

export type TokenMintResponse = z.infer<typeof TokenMintResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/tokens — single row in the list
// ---------------------------------------------------------------------------

export const TokenRowSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
});

export type TokenRow = z.infer<typeof TokenRowSchema>;

// GET /api/tokens — response body (array of rows)
export const TokenListResponseSchema = z.array(TokenRowSchema);
export type TokenListResponse = z.infer<typeof TokenListResponseSchema>;

// ---------------------------------------------------------------------------
// DELETE /api/tokens/:id — 204 no body; no schema needed
// ---------------------------------------------------------------------------
