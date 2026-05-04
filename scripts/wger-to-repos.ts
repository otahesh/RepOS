// File: scripts/wger-to-repos.ts
// One-time: read Wger CC-BY-SA exercise CSV (downloaded manually) and emit
// a draft typed seed file at api/src/seed/exercises.ts.
//
// Usage:
//   curl -L https://wger.de/api/v2/exerciseinfo/?language=2&format=csv -o /tmp/wger.csv
//   tsx scripts/wger-to-repos.ts /tmp/wger.csv > api/src/seed/exercises.draft.ts
//
// Output is a STARTING POINT — every entry MUST be hand-reviewed before
// inclusion in the production seed. See docs/exercise-library-curation.md.

import { readFileSync } from 'fs';

const path = process.argv[2];
if (!path) { console.error('usage: tsx scripts/wger-to-repos.ts <wger.csv>'); process.exit(1); }

const HIGH_RISK_EXCLUDES = [
  /behind[- ]the[- ]neck/i,
  /upright row/i,         // exclude entirely; curator can re-add wide-grip variants
  /jefferson curl/i,
  /sissy squat/i,
  /dragon flag/i,
  /kipping/i,
];

const lines = readFileSync(path, 'utf8').trim().split('\n');
const [header, ...rows] = lines;
const cols = header.split(',').map(c => c.trim());
const colIdx = (name: string) => cols.indexOf(name);

const out: any[] = [];
for (const r of rows) {
  const cells = r.split(',');
  const name = cells[colIdx('name')]?.trim();
  if (!name || HIGH_RISK_EXCLUDES.some(re => re.test(name))) continue;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  out.push({
    slug, name,
    // ALL OF THESE ARE PLACEHOLDER — must be hand-corrected per curation guide
    primary_muscle: 'chest',
    muscle_contributions: { chest: 1.0 },
    movement_pattern: 'push_horizontal',
    peak_tension_length: 'mid',
    required_equipment: { _v: 1, requires: [] },
    skill_complexity: 3, loading_demand: 3, systemic_fatigue: 3,
    joint_stress_profile: { _v: 1 },
    eccentric_overload_capable: false, contraindications: [],
    requires_shoulder_flexion_overhead: false, loads_spine_in_flexion: false,
    loads_spine_axially: false, requires_hip_internal_rotation: false,
    requires_ankle_dorsiflexion: false, requires_wrist_extension_loaded: false,
    _wger_source: name, // <— delete after curation
  });
}

console.log(`// AUTO-GENERATED DRAFT — DO NOT COMMIT WITHOUT HAND-CORRECTION`);
console.log(`// Source: Wger.de (CC-BY-SA-4.0)`);
console.log(`// See docs/exercise-library-curation.md`);
console.log(`import type { ExerciseSeed } from '../schemas/exerciseSeed.js';`);
console.log(`export const draft: ExerciseSeed[] = ${JSON.stringify(out, null, 2)};`);
