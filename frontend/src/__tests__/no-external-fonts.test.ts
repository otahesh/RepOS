import { describe, it, expect } from 'vitest';
// Vite ?raw imports — the app tsconfig has no node types, so no fs here.
import indexHtml from '../../index.html?raw';
import mainTsx from '../main.tsx?raw';
import viteConfig from '../../vite.config.ts?raw';

// Production CSP is `style-src 'self' 'unsafe-inline'` (docker/nginx/repos.conf)
// — any external stylesheet is silently blocked in prod and the app falls back
// to system fonts. CI can't see that (no CSP in dev/preview), so this guard
// pins the invariant at the source: fonts must be self-hosted (@fontsource
// imports in main.tsx), never loaded from a third-party origin.
describe('font self-hosting invariant', () => {
  it('index.html references no external font origins', () => {
    expect(indexHtml).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  });

  it('main.tsx imports the self-hosted font faces', () => {
    expect(mainTsx).toMatch(/@fontsource\/inter-tight/);
    expect(mainTsx).toMatch(/@fontsource\/jetbrains-mono/);
  });

  it('vite does not inline assets as data: URIs (CSP has no font-src/data: allowance)', () => {
    expect(viteConfig).toMatch(/assetsInlineLimit:\s*0/);
  });
});
