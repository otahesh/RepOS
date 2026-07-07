// Promote approved staging images to the repo. Usage:
//   npm run promote -- --slug barbell-back-squat,lat-pulldown
//   npm run promote -- --all
//   npm run promote -- --rebuild   # regenerate the manifest from disk only,
//                                   # no slug/staging involved (e.g. after
//                                   # manually deleting a retired photo's webp)
// Converts staging PNGs → frontend/public/exercise-media/*.webp, then rebuilds
// api/src/seed/exerciseMediaManifest.ts by scanning that folder.
import fs from 'node:fs';
import path from 'node:path';
import { STAGING_DIR, MEDIA_DIR, SEED_MANIFEST } from './paths.js';
import { listExerciseInfo } from './data.js';
import { convertToWebp } from './webp.js';
import { renderManifestModule, FILE_RE } from './manifestModule.js';
import { arg, has } from './cliArgs.js';

function rebuildManifest(): void {
  const files = fs.existsSync(MEDIA_DIR)
    ? fs.readdirSync(MEDIA_DIR).filter((f) => FILE_RE.test(f))
    : [];
  fs.writeFileSync(SEED_MANIFEST, renderManifestModule(files));
  console.log(`manifest rebuilt: ${SEED_MANIFEST} (${files.length} files)`);
  console.log('next: cd api && npm run format:check   # manifest must satisfy prettier');
}

async function main(): Promise<void> {
  if (has('rebuild')) {
    if (has('slug') || has('all')) throw new Error('--rebuild takes no other flags');
    rebuildManifest();
    return;
  }

  const known = new Set(listExerciseInfo().map((e) => e.slug));
  const slugs = has('all')
    ? [...known].filter((s) =>
        (['start', 'end'] as const).some((f) => fs.existsSync(path.join(STAGING_DIR, `${s}-${f}.png`))),
      )
    : arg('slug')?.split(',').map((s) => s.trim()) ?? [];
  if (slugs.length === 0) throw new Error('nothing to promote: pass --slug a,b or --all');
  const unknown = slugs.filter((s) => !known.has(s));
  if (unknown.length) throw new Error(`unknown slug(s): ${unknown.join(', ')}`);

  // Validate everything BEFORE converting anything: a mid-loop throw would
  // leave orphan WebPs on disk with no manifest regeneration (the api
  // invariant test catches it and a re-run heals, but fail fast instead).
  for (const slug of slugs) {
    const staged = (['start', 'end'] as const).filter((f) =>
      fs.existsSync(path.join(STAGING_DIR, `${slug}-${f}.png`)),
    );
    if (staged.length === 0) throw new Error(`${slug}: nothing staged to promote`);
    if (staged.length === 1) console.warn(`WARN ${slug}: only the ${staged[0]} frame is staged`);
  }

  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  for (const slug of slugs) {
    for (const frame of ['start', 'end'] as const) {
      const src = path.join(STAGING_DIR, `${slug}-${frame}.png`);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(MEDIA_DIR, `${slug}-${frame}.webp`);
      const { bytes, quality } = await convertToWebp(src, dest);
      console.log(`${slug}-${frame}.webp  ${Math.round(bytes / 1024)} KB (q${quality})`);
    }
  }

  rebuildManifest();
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
