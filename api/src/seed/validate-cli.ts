// File: api/src/seed/validate-cli.ts
// CLI entry point for CI: validates the production seed files.
// Exits 0 on success, 1 on validation failure.
// Structural validation only — exercise_slug ref-resolution requires DB and runs at seed time.

import { z } from 'zod';
import { exercises } from './exercises.js';
import { validateSeed } from './validate.js';
import { programTemplates } from './programTemplates.js';
import { ProgramTemplateSeedSchema } from '../schemas/programTemplate.js';

const exResult = validateSeed(exercises);
if (!exResult.ok) {
  console.error(`exercises validation failed (${exResult.errors.length} errors):`);
  for (const e of exResult.errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`exercises OK · ${exercises.length} entries`);

const tplResult = z.array(ProgramTemplateSeedSchema).safeParse(programTemplates);
if (!tplResult.success) {
  console.error(`program_templates validation failed (${tplResult.error.issues.length} issues):`);
  for (const i of tplResult.error.issues) console.error(`  - ${i.path.join('.')}: ${i.message}`);
  process.exit(1);
}

const slugs = new Set<string>();
for (const t of programTemplates) {
  if (slugs.has(t.slug)) { console.error(`duplicate template slug: ${t.slug}`); process.exit(1); }
  slugs.add(t.slug);
}
console.log(`program_templates OK · ${programTemplates.length} entries`);
