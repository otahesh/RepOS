// Manual batch generator (spec §5). NEVER runs in CI. Usage:
//   npm run generate                       # all guides, both frames, skip existing
//   npm run generate -- --slug a,b --force # regenerate specific exercises
//   npm run generate -- --frame end        # one frame only
//   npm run generate -- --model gemini-3-pro-image-preview
//   npm run generate -- --dry-run          # print prompts, no API calls
//   npm run generate -- --smoke            # verify key + list image models + 1 test image
import fs from 'node:fs';
import path from 'node:path';
import { STAGING_DIR, STAGING_MANIFEST, CONTACT_SHEET, readGeminiKey } from './paths.js';
import { listExerciseInfo } from './data.js';
import { buildPrompt, type Frame } from './prompt.js';
import { positionOverrides, sceneOverrides } from './promptOverrides.js';
import { generateImage, listImageModels } from './gemini.js';
import { renderContactSheet, type SheetEntry } from './contactSheet.js';

const DEFAULT_MODEL = 'gemini-2.5-flash-image';
const CALL_SPACING_MS = 2000; // stay far from per-minute rate limits

type StagingManifest = Record<
  string, // "<slug>-<frame>"
  { model: string; generatedAt: string; prompt: string; file: string }
>;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} needs a value`);
  return value;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  fs.mkdirSync(STAGING_DIR, { recursive: true });
  const model = arg('model') ?? DEFAULT_MODEL;

  if (has('smoke')) {
    const key = readGeminiKey();
    const models = await listImageModels(key);
    console.log(`key OK — image-capable models:\n  ${models.join('\n  ')}`);
    const img = await generateImage({ apiKey: key, model, prompt: 'A single black dumbbell on dark rubber gym flooring, photorealistic, no text.' });
    const out = path.join(STAGING_DIR, '_smoke.png');
    fs.writeFileSync(out, img.data);
    console.log(`smoke image written: ${out} (${img.data.length} bytes, ${img.mimeType})`);
    return;
  }

  const slugFilter = arg('slug')?.split(',').map((s) => s.trim());
  const frames: Frame[] = arg('frame') ? [arg('frame') as Frame] : ['start', 'end'];
  if (frames.some((f) => f !== 'start' && f !== 'end')) throw new Error('--frame must be start|end');

  const all = listExerciseInfo();
  const targets = slugFilter ? all.filter((e) => slugFilter.includes(e.slug)) : all;
  if (slugFilter && targets.length !== slugFilter.length) {
    const known = new Set(all.map((e) => e.slug));
    throw new Error(`unknown slug(s): ${slugFilter.filter((s) => !known.has(s)).join(', ')}`);
  }

  const manifest: StagingManifest = fs.existsSync(STAGING_MANIFEST)
    ? JSON.parse(fs.readFileSync(STAGING_MANIFEST, 'utf8'))
    : {};

  const work: Array<{ slug: string; name: string; frame: Frame; prompt: string; file: string }> = [];
  for (const ex of targets) {
    for (const frame of frames) {
      const file = `${ex.slug}-${frame}.png`;
      if (!has('force') && fs.existsSync(path.join(STAGING_DIR, file))) continue;
      work.push({
        slug: ex.slug,
        name: ex.name,
        frame,
        file,
        prompt: buildPrompt({
          name: ex.name,
          equipment: ex.equipment,
          setupCallout: ex.setupCallout,
          frame,
          positionOverride: positionOverrides[ex.slug]?.[frame],
          sceneOverride: sceneOverrides[ex.slug],
        }),
      });
    }
  }

  console.log(`${work.length} image(s) to generate with ${model} (${targets.length} exercises in scope)`);
  if (has('dry-run')) {
    for (const w of work) console.log(`\n===== ${w.file} =====\n${w.prompt}`);
    return;
  }

  const key = readGeminiKey();
  let done = 0;
  const failures: string[] = [];
  for (const w of work) {
    process.stdout.write(`[${++done}/${work.length}] ${w.file} … `);
    // Under --force, delete the old image BEFORE the attempt: if the regen
    // fails, a stale image lying around would be silently skipped by the next
    // plain re-run. A gap gets refilled; a stale file gets shipped.
    if (has('force')) fs.rmSync(path.join(STAGING_DIR, w.file), { force: true });
    try {
      const img = await generateImage({ apiKey: key, model, prompt: w.prompt });
      fs.writeFileSync(path.join(STAGING_DIR, w.file), img.data);
      manifest[`${w.slug}-${w.frame}`] = {
        model,
        generatedAt: new Date().toISOString(),
        prompt: w.prompt,
        file: w.file,
      };
      fs.writeFileSync(STAGING_MANIFEST, JSON.stringify(manifest, null, 2));
      console.log(`ok (${Math.round(img.data.length / 1024)} KB)`);
    } catch (err) {
      console.log('FAILED');
      console.error(`  ${(err as Error).message}`);
      failures.push(w.file);
    }
    await new Promise((r) => setTimeout(r, CALL_SPACING_MS));
  }

  // Rebuild the review sheet from everything currently staged.
  const entries: SheetEntry[] = all.map((ex) => ({
    slug: ex.slug,
    name: ex.name,
    frames: Object.fromEntries(
      (['start', 'end'] as const)
        .filter((f) => fs.existsSync(path.join(STAGING_DIR, `${ex.slug}-${f}.png`)))
        .map((f) => [f, `${ex.slug}-${f}.png`]),
    ),
    prompts: Object.fromEntries(
      (['start', 'end'] as const)
        .filter((f) => manifest[`${ex.slug}-${f}`])
        .map((f) => [f, manifest[`${ex.slug}-${f}`].prompt]),
    ),
  }));
  fs.writeFileSync(CONTACT_SHEET, renderContactSheet(entries));
  console.log(`\ncontact sheet: ${CONTACT_SHEET}`);
  if (failures.length) {
    console.error(`\n${failures.length} failure(s): ${failures.join(', ')} — re-run with the same flags to retry the gaps.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
