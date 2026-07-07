import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)); // scripts/exercise-media/src
export const REPO_ROOT = path.resolve(HERE, '../../..');
export const STAGING_DIR = path.join(REPO_ROOT, 'scripts/exercise-media/staging');
export const STAGING_MANIFEST = path.join(STAGING_DIR, 'manifest.json');
export const CONTACT_SHEET = path.join(STAGING_DIR, 'index.html');
export const MEDIA_DIR = path.join(REPO_ROOT, 'frontend/public/exercise-media');
export const SEED_MANIFEST = path.join(REPO_ROOT, 'api/src/seed/exerciseMediaManifest.ts');

/**
 * GEMINI_API_KEY comes from the environment or the repo-root .env (git-ignored).
 * Never log or embed the key anywhere (parent CLAUDE.md security rules).
 */
export function readGeminiKey(): string {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const envPath = path.join(REPO_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^GEMINI_API_KEY=["']?([^"'\r]+?)["']?\s*$/);
      if (m) return m[1];
    }
  }
  throw new Error(
    `GEMINI_API_KEY not set and not found in ${envPath}. ` +
      'Add it to the repo-root .env (it is git-ignored). If a key existed before, it may have been rotated.',
  );
}
