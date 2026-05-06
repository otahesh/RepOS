import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  findOrphans,
  findPlaceholderLinks,
  extractRoutePaths,
  findRouteMismatches,
} from './check-page-reachability.mjs';

const fix = (...parts) =>
  path.resolve(import.meta.dirname, '__page-fixtures__', ...parts);

describe('check-page-reachability', () => {
  describe('findOrphans', () => {
    it('returns the orphan when a component is not imported from the entry', async () => {
      const out = await findOrphans({
        entry: fix('with-orphan', 'main.tsx'),
        componentsDir: fix('with-orphan', 'components'),
      });
      const rels = out.map((p) => path.basename(p)).sort();
      expect(rels).toEqual(['Orphan.tsx']);
    });

    it('returns no orphans when every component is imported', async () => {
      const out = await findOrphans({
        entry: fix('no-orphan', 'main.tsx'),
        componentsDir: fix('no-orphan', 'components'),
      });
      expect(out).toEqual([]);
    });
  });

  describe('findPlaceholderLinks', () => {
    it('flags `to="#"` and `to=""` placeholders', () => {
      const out = findPlaceholderLinks(fix('sidebar-broken.tsx'));
      const values = out.map((l) => l.value).sort();
      expect(values).toEqual(['', '#']);
    });

    it('returns empty when every link has a real path', () => {
      const out = findPlaceholderLinks(fix('sidebar-good.tsx'));
      expect(out).toEqual([]);
    });

    it('flags the placeholder branch of a conditional `to={cond ? "/path" : "#"}`', () => {
      const out = findPlaceholderLinks(fix('sidebar-conditional.tsx'));
      const values = out.map((l) => l.value);
      expect(values).toEqual(['#']);
    });
  });

  describe('extractRoutePaths', () => {
    it('returns absolute, deduped, non-catch-all paths', () => {
      const paths = extractRoutePaths(fix('app-routes.tsx'));
      expect(paths).toEqual(['/', '/programs', '/settings/integrations']);
    });
  });

  describe('findRouteMismatches', () => {
    it('flags sidebar links not present in App.tsx routes', () => {
      const out = findRouteMismatches({
        sidebarPath: fix('sidebar-with-mismatch.tsx'),
        appPath: fix('app-routes.tsx'),
      });
      const values = out.map((l) => l.value);
      expect(values).toEqual(['/library']);
    });

    it('returns empty when every sidebar link has a matching route', () => {
      const out = findRouteMismatches({
        sidebarPath: fix('sidebar-good.tsx'),
        appPath: fix('app-routes.tsx'),
      });
      expect(out).toEqual([]);
    });

    it('ignores placeholder links (handled by findPlaceholderLinks)', () => {
      const out = findRouteMismatches({
        sidebarPath: fix('sidebar-broken.tsx'),
        appPath: fix('app-routes.tsx'),
      });
      // sidebar-broken has to="#", to="", to="/" — only "/" is a non-placeholder
      // and it IS a registered route, so no mismatches.
      expect(out).toEqual([]);
    });
  });
});
