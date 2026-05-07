# API Schemas

This directory is the **single source of truth** for all request/response shapes in the RepOS API. Every schema is a Zod object; TypeScript types are derived from them via `z.infer<>` and re-exported.

## When to add a schema

Add a schema for every distinct request body, query-string shape, and response body your route handles. If a route returns multiple possible shapes (201 vs 200 dedup, 409 rate-limited), define a schema for each. Schemas live here; route handlers import and use them.

## Naming convention

Use `<Entity><Action>Schema` for I/O types:

| Kind | Example |
|---|---|
| Request body — POST | `WeightSampleSchema` |
| Request body — backfill | `WeightBackfillSchema` |
| Query string | `WeightRangeQuerySchema` |
| Response body | `WeightSampleResponseSchema`, `WeightRangeResponseSchema` |
| Standalone response | `SyncStatusResponseSchema` |

Exported inferred types follow the same pattern without `Schema`: `WeightSampleResponse`, `WeightRangeQuery`, etc.

## How the API routes use schemas

Route handlers import the schema and call `schema.safeParse()` or `schema.parse()` on inbound data. For validation errors that need a specific error shape (e.g. the `{ error, field }` contract required by the existing tests), a thin adapter translates the first Zod issue into that shape. Return types are annotated with `z.infer<typeof Schema>` so TypeScript catches shape drift at compile time.

```typescript
import { WeightSampleSchema, type WeightSampleResponse } from '../schemas/healthWeight.js';

const result = WeightSampleSchema.safeParse(req.body);
if (!result.success) { /* translate to { error, field } */ }
const typed = result.data; // WeightSampleInput
```

## How the frontend imports types

The frontend does not install zod (it has no runtime schema validation need for the v1 health surface). Types are maintained in `frontend/src/lib/api/health.ts` as plain TypeScript interfaces that are **structurally identical** to the `z.infer<>` types produced by the schemas here.

The contract test suite (`api/tests/contract/healthWeight.contract.test.ts`) closes the API↔schema gap. The schema↔frontend-type gap is closed manually — when a response shape changes, both this file and `frontend/src/lib/api/health.ts` must be updated together.

A future improvement is to add zod to the frontend and use a tsconfig path alias (`"@repos/schemas": ["../api/src/schemas/*"]`) so the frontend imports `z.infer<typeof WeightRangeResponseSchema>` directly. That eliminates the manual mirror entirely. It was evaluated for this POC but deferred because it requires bundling zod into the frontend and adjusting the Vite config.

## Contract tests

`api/tests/contract/healthWeight.contract.test.ts` contains round-trip tests for every endpoint on the `health/weight` surface. Each test:

1. Hits a real route handler via Fastify `inject()`
2. Parses the raw response JSON through the Zod schema
3. Asserts `parsed.success === true`

If a route handler ever changes its response shape without updating the schema, the contract test fails loudly on the next CI run.

## Migration of other routes

This pattern is currently applied to the `health/weight` surface only as a proof-of-concept. Other route surfaces (mesocycles, user\_programs, programs, exercises, planned\_sets, etc.) are intentionally out of scope for this thread. The follow-up migration should add schemas to `api/src/schemas/` for each surface and wire them in exactly as done here — one surface at a time, with contract tests before merging.
