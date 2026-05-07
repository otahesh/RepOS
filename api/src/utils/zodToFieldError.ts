import type { ZodError } from 'zod';

/**
 * Translates the first issue from a ZodError into the project-standard
 * `{ error: string; field: string }` shape used by all route handlers.
 *
 * Usage:
 *   const result = MySchema.safeParse(req.body);
 *   if (!result.success) return reply.code(400).send(zodToFieldError(result.error));
 */
export function zodToFieldError(err: ZodError): { error: string; field: string } {
  const issue = err.issues[0];
  const field = issue?.path.join('.') || 'unknown';
  return { error: issue?.message ?? 'validation error', field };
}
