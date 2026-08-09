import { STATUS_CODES } from 'node:http';
import type { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from 'fastify';

// Global error handler.
//
// Without one, Fastify 5's default serializer emits `error.message` on 5xx
// responses — so any unguarded `db.query` throw leaks raw pg internals
// (constraint names, column names, SQL fragments, the connection string on a
// connect failure) to the client. This handler:
//
//   - 5xx (or no statusCode): logs the full error SERVER-SIDE and returns a
//     sanitized, still-actionable envelope (method + path + a request_id to
//     quote when reporting). No internals reach the client.
//   - <500: deliberate client errors (validation, auth, @fastify/sensible
//     httpErrors) whose message is safe — preserve Fastify's default
//     `{ statusCode, error, message }` shape so existing clients/tests are
//     unaffected.
//
// Note: routes that respond via `reply.code(n).send(...)` never reach here;
// this only governs THROWN/uncaught errors.
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    const statusCode = err.statusCode ?? 500;

    if (statusCode >= 500) {
      req.log.error({ err, reqId: req.id }, 'unhandled_error');
      return reply.code(statusCode).send({
        statusCode,
        error: STATUS_CODES[statusCode] ?? 'Internal Server Error',
        message:
          `Something went wrong handling ${req.method} ${req.url.split('?')[0]}. ` +
          `Reference ${req.id} — retry, and report this reference if it persists.`,
        request_id: req.id,
      });
    }

    // Only echo err.message for errors that are explicitly client-facing:
    // Fastify validation errors (`.validation`), http-errors/@fastify/sensible
    // httpErrors (`.expose === true`), and Fastify's own errors (FST_* codes,
    // whose messages are public). Anything else with a manually-set 4xx
    // statusCode (e.g. a caught pg error tagged `err.statusCode = 400`) is
    // sanitized to the generic status text — defense-in-depth against a future
    // caller leaking internals through the 4xx path.
    const code = (err as { code?: unknown }).code;
    const exposeMessage =
      !!err.validation ||
      (err as { expose?: unknown }).expose === true ||
      (typeof code === 'string' && code.startsWith('FST_'));
    return reply.code(statusCode).send({
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Error',
      message: exposeMessage ? err.message : (STATUS_CODES[statusCode] ?? 'Error'),
      ...(err.validation ? { validation: err.validation } : {}),
    });
  });
}
