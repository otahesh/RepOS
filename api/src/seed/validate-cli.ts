// File: api/src/seed/validate-cli.ts
// CLI entry point for CI: validates the production seed file.
// Exits 0 on success, 1 on validation failure.

import { exercises } from './exercises.js';
import { validateSeed } from './validate.js';

const result = validateSeed(exercises);
if (!result.ok) {
  console.error(`Seed validation failed (${result.errors.length} errors):`);
  for (const e of result.errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`Seed OK · ${exercises.length} entries`);
