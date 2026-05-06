// frontend/scripts/check-page-reachability.mjs
//
// QA gate: catches the "components shipped but unreachable" failure mode
// observed in Phase A-E (PR #1), where 22 frontend components passed unit
// tests + build but were never registered in App.tsx routes or Sidebar
// NAV_ITEMS, so the user couldn't navigate to any of them.
//
// Three checks:
//   1. Orphan components — any file under src/components/** (excluding
//      tests/fixtures/__smoke__) that is NOT transitively imported from
//      src/main.tsx is orphan and fails the gate.
//   2. Broken sidebar links — any `to="#"` (or empty) placeholder in
//      Sidebar.tsx is a dead link and fails the gate.
//   3. Sidebar→Route consistency — every `to=` path in Sidebar.tsx must
//      resolve to a registered <Route path="…"> in App.tsx.

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { glob } from 'glob';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const traverse = _traverse.default ?? _traverse;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESOLVE_EXTENSIONS = ['', '.tsx', '.ts', '.jsx', '.js'];
const RESOLVE_INDEX_FILES = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];

function parseFile(filePath) {
  const code = readFileSync(filePath, 'utf8');
  return parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });
}

function resolveRelativeImport(fromFile, source) {
  const base = path.resolve(path.dirname(fromFile), source);
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  if (existsSync(base) && statSync(base).isDirectory()) {
    for (const idx of RESOLVE_INDEX_FILES) {
      const candidate = path.join(base, idx);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * BFS from `entry` following only relative imports. Returns the set of
 * absolute file paths reachable. Skips bare-module imports ('react' etc.).
 * Skips broken/missing imports silently — TypeScript catches those.
 */
export function collectReachable(entry) {
  const visited = new Set();
  const queue = [path.resolve(entry)];
  while (queue.length > 0) {
    const filePath = queue.shift();
    if (visited.has(filePath)) continue;
    visited.add(filePath);

    let ast;
    try {
      ast = parseFile(filePath);
    } catch {
      // Parse error — let typecheck surface it; don't crash the lint.
      continue;
    }

    traverse(ast, {
      ImportDeclaration(p) {
        const source = p.node.source.value;
        if (!source.startsWith('.')) return;
        const resolved = resolveRelativeImport(filePath, source);
        if (resolved && !visited.has(resolved)) queue.push(resolved);
      },
      ExportNamedDeclaration(p) {
        const src = p.node.source?.value;
        if (!src || !src.startsWith('.')) return;
        const resolved = resolveRelativeImport(filePath, src);
        if (resolved && !visited.has(resolved)) queue.push(resolved);
      },
      ExportAllDeclaration(p) {
        const src = p.node.source?.value;
        if (!src || !src.startsWith('.')) return;
        const resolved = resolveRelativeImport(filePath, src);
        if (resolved && !visited.has(resolved)) queue.push(resolved);
      },
    });
  }
  return visited;
}

const ORPHAN_IGNORE_GLOBS = [
  '**/*.test.{ts,tsx}',
  '**/*.spec.{ts,tsx}',
  '**/__fixtures__/**',
  '**/__page-fixtures__/**',
  '**/__sanity__/**',
  '**/__smoke__/**',
];

/**
 * Returns the list of component files (absolute paths) that exist under
 * `componentsDir` but are not in the `reachable` set.
 *
 * `allow` is a Set of paths (relative to componentsDir) that are
 * intentionally not yet wired and should not fail the gate. Use sparingly:
 * each entry should have a documented unblock condition at the call site.
 */
export async function findOrphans({ entry, componentsDir, allow = new Set() }) {
  const reachable = collectReachable(entry);
  const allFiles = await glob('**/*.{ts,tsx}', {
    cwd: componentsDir,
    absolute: true,
    ignore: ORPHAN_IGNORE_GLOBS,
  });
  return allFiles
    .filter((f) => {
      if (reachable.has(f)) return false;
      const rel = path.relative(componentsDir, f);
      if (allow.has(rel)) return false;
      return true;
    })
    .sort();
}

/**
 * Walk an arbitrary expression node and collect every reachable string
 * value (StringLiteral or no-substitution TemplateLiteral). Handles
 * conditional/logical/ternary expressions like
 *   to={cond ? '/a' : '#'}    →  ['/a', '#']
 *   to={x && '/path'}         →  ['/path']
 * Anything more complex (function calls, identifiers) is skipped — those
 * read as dynamic and we can't statically resolve them.
 */
function collectStringValues(node, line) {
  if (!node) return [];
  if (node.type === 'StringLiteral') {
    return [{ value: node.value, line: node.loc?.start.line ?? line }];
  }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return [{ value: node.quasis[0].value.cooked, line: node.loc?.start.line ?? line }];
  }
  if (node.type === 'ConditionalExpression') {
    return [
      ...collectStringValues(node.consequent, line),
      ...collectStringValues(node.alternate, line),
    ];
  }
  if (node.type === 'LogicalExpression') {
    return [
      ...collectStringValues(node.left, line),
      ...collectStringValues(node.right, line),
    ];
  }
  return [];
}

/**
 * Parse a Sidebar-shaped file. Returns every `to=` string value reachable
 * from any JSX `to=` attribute (NavLink, Link, etc.), with line numbers.
 * Both branches of a conditional `to={cond ? '/a' : '#'}` are returned.
 */
export function extractSidebarLinks(sidebarPath) {
  const ast = parseFile(sidebarPath);
  const links = [];
  traverse(ast, {
    JSXAttribute(p) {
      if (p.node.name.name !== 'to') return;
      const v = p.node.value;
      if (!v) return;
      const line = v.loc?.start.line ?? 0;
      if (v.type === 'StringLiteral') {
        links.push({ value: v.value, line });
        return;
      }
      if (v.type === 'JSXExpressionContainer') {
        links.push(...collectStringValues(v.expression, line));
      }
    },
  });
  return links;
}

const PLACEHOLDER_LINK_VALUES = new Set(['#', '', '#!']);

export function findPlaceholderLinks(sidebarPath) {
  return extractSidebarLinks(sidebarPath).filter((l) =>
    PLACEHOLDER_LINK_VALUES.has(l.value),
  );
}

/**
 * Parse App.tsx: extract every <Route path="X"> string-literal path,
 * normalized to an absolute path under the root layout. Catch-all `*`
 * paths are excluded from the valid set (they don't represent destinations).
 */
export function extractRoutePaths(appPath) {
  const ast = parseFile(appPath);
  const paths = [];
  traverse(ast, {
    JSXOpeningElement(p) {
      const name = p.node.name;
      if (name.type !== 'JSXIdentifier' || name.name !== 'Route') return;
      const pathAttr = p.node.attributes.find(
        (a) => a.type === 'JSXAttribute' && a.name.name === 'path',
      );
      if (!pathAttr) return; // index route — skip; same as parent
      const v = pathAttr.value;
      if (!v || v.type !== 'StringLiteral') return;
      const raw = v.value;
      if (raw === '*' || raw.includes('*')) return; // catch-all, not a real destination
      const normalized = raw.startsWith('/') ? raw : '/' + raw;
      // Normalize trailing slashes (except for the root '/').
      const cleaned = normalized.length > 1 ? normalized.replace(/\/+$/, '') : '/';
      paths.push(cleaned);
    },
  });
  return [...new Set(paths)].sort();
}

/**
 * For each non-placeholder `to=` in Sidebar, ensure it matches a registered
 * Route path in App. Returns the list of unmatched links.
 */
export function findRouteMismatches({ sidebarPath, appPath }) {
  const placeholders = new Set(PLACEHOLDER_LINK_VALUES);
  const links = extractSidebarLinks(sidebarPath).filter(
    (l) => !placeholders.has(l.value),
  );
  const routes = new Set(extractRoutePaths(appPath));
  const mismatches = [];
  for (const link of links) {
    const cleaned =
      link.value.length > 1 ? link.value.replace(/\/+$/, '') : link.value;
    // Allow exact match, or match against a parameterized route.
    // For our purposes, simple exact match is sufficient — if Sidebar grows
    // params later, extend this.
    if (!routes.has(cleaned)) {
      mismatches.push(link);
    }
  }
  return mismatches;
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const srcRoot = path.join(root, 'src');
  const entry = path.join(srcRoot, 'main.tsx');
  const componentsDir = path.join(srcRoot, 'components');
  const sidebarPath = path.join(srcRoot, 'components', 'layout', 'Sidebar.tsx');
  const appPath = path.join(srcRoot, 'App.tsx');

  for (const p of [entry, componentsDir, sidebarPath, appPath]) {
    if (!existsSync(p)) {
      console.error(`page-reachability: expected path missing: ${p}`);
      process.exit(1);
    }
  }

  let failed = false;

  // Components with no current routed path. Each entry has a documented
  // unblock condition; remove from this set when its prerequisite lands.
  // Keep small, audited, and time-bounded — this is the gate's release valve,
  // not a graveyard.
  const KNOWN_PENDING = new Set([
    // Mid-session exercise swap UI. Needs the exercise-picker flow to
    // populate { plannedSetId, fromName, toSlug, toName } before the sheet
    // can mount. Remove when the picker lands.
    'programs/MidSessionSwapSheet.tsx',
    // End-of-mesocycle recap. Needs a /mesocycles/:id/recap-stats endpoint
    // returning { weeks, total_sets, prs }; placeholder zeros would falsely
    // tell the user "0 sets · 0 PRs". Remove when the endpoint lands.
    'programs/MesocycleRecap.tsx',
  ]);

  // 1. Orphan components.
  const orphans = await findOrphans({ entry, componentsDir, allow: KNOWN_PENDING });
  if (orphans.length > 0) {
    failed = true;
    console.error(
      `\npage-reachability: ${orphans.length} orphan component(s) — files under src/components/ that are not reachable from main.tsx:`,
    );
    for (const o of orphans) {
      console.error(`  ${path.relative(root, o)}`);
    }
    console.error(
      '\n  Either import the file from a mounted component, register it as a <Route> in App.tsx,\n' +
        '  or move it under a __fixtures__/ / __sanity__/ subdirectory if it is not a real component.',
    );
  }

  // 2. Placeholder sidebar links.
  const placeholders = findPlaceholderLinks(sidebarPath);
  if (placeholders.length > 0) {
    failed = true;
    console.error(
      `\npage-reachability: ${placeholders.length} placeholder link(s) in Sidebar.tsx (to="#" or empty):`,
    );
    for (const p of placeholders) {
      console.error(`  Sidebar.tsx:${p.line}  to="${p.value}"`);
    }
    console.error(
      '\n  Replace with a real route path, or remove the link if the destination is not yet implemented.',
    );
  }

  // 3. Sidebar→Route consistency.
  const mismatches = findRouteMismatches({ sidebarPath, appPath });
  if (mismatches.length > 0) {
    failed = true;
    console.error(
      `\npage-reachability: ${mismatches.length} sidebar link(s) point to paths not registered in App.tsx <Route>s:`,
    );
    for (const m of mismatches) {
      console.error(`  Sidebar.tsx:${m.line}  to="${m.value}"`);
    }
    console.error(
      '\n  Register a <Route path="..."> in App.tsx for each unmatched path,\n' +
        '  or correct the to= value in Sidebar.tsx.',
    );
  }

  if (failed) {
    console.error('');
    process.exit(1);
  }
  console.log('page-reachability: OK');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
