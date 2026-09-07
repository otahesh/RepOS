import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
async function sourcesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory()
          ? sourcesIn(join(dir, e.name))
          : Promise.resolve(e.name.endsWith('.ts') ? [join(dir, e.name)] : []),
      ),
    )
  ).flat();
}

// A source-level regression guard, not a proof against computed imports or a
// substitute for Plan 3's OS boundary. Only erased type imports are ignored.
function runtimeImports(text: string): string[] {
  const source = ts.createSourceFile('module.ts', text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const literal = (node: ts.Node | undefined) => {
    if (node && ts.isStringLiteralLike(node)) found.push(node.text);
  };
  const walk = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const erased =
        clause?.isTypeOnly ||
        (!clause?.name &&
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((e) => e.isTypeOnly));
      if (!erased) literal(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      const erased =
        node.isTypeOnly ||
        (node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.length > 0 &&
          node.exportClause.elements.every((e) => e.isTypeOnly));
      if (!erased) literal(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      literal(node.arguments[0]);
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  return found;
}
async function reachable(
  roots: string[],
  read: (path: string) => Promise<string>,
): Promise<Set<string>> {
  const seen = new Set<string>();
  async function visit(path: string): Promise<void> {
    if (seen.has(path)) return;
    seen.add(path);
    for (const dependency of runtimeImports(await read(path))) {
      if (!dependency.startsWith('.')) {
        seen.add(dependency);
        continue;
      }
      await visit(resolve(dirname(path), dependency.replace(/\.js$/, '.ts')));
    }
  }
  await Promise.all(roots.map(visit));
  return seen;
}
const forbidden = (path: string) =>
  path === 'pg' ||
  /\/db\//.test(path) ||
  /\/(feedbackMailer|feedbackEmails|feedbackTriage|fixLifecycle|reconcileFixes|checkShipped)\.ts$/.test(
    path,
  );

describe('privilege boundaries', () => {
  it('walks indirect re-exports and dynamic imports while ignoring erased types', async () => {
    const files: Record<string, string> = {
      '/fixture/root.ts':
        "export * from './bridge.js'; import type { X } from './types.js'; import { type Y } from './types.js';",
      '/fixture/bridge.ts':
        "export type { X } from './types.js'; export const load = () => import('./db/client.js');",
      '/fixture/db/client.ts': "import pg from 'pg';",
    };
    const graph = await reachable(['/fixture/root.ts'], async (path) => {
      if (!(path in files)) throw new Error(`unexpected fixture dependency ${path}`);
      return files[path];
    });
    expect([...graph].filter(forbidden).sort()).toEqual(['/fixture/db/client.ts', 'pg']);
    expect(graph.has('/fixture/types.ts')).toBe(false);
  });
  it('repos-git transitively reaches neither database nor mail services', async () => {
    const graph = await reachable(await sourcesIn(join(SRC, 'reposGit')), (path) =>
      readFile(path, 'utf8'),
    );
    expect([...graph].filter(forbidden)).toEqual([]);
    expect(graph.has(join(SRC, 'services/patchApproval.ts'))).toBe(true);
  });
  it('broker services do not read the GitHub write token', async () => {
    for (const path of await sourcesIn(join(SRC, 'services'))) {
      if (!path.endsWith('-cli.ts'))
        expect(await readFile(path, 'utf8'), path).not.toContain('FEEDBACK_GITHUB_TOKEN');
    }
  });
  it('Git push invocations stay within reposGit', async () => {
    for (const path of await sourcesIn(SRC)) {
      if (!path.includes('/reposGit/'))
        expect(await readFile(path, 'utf8'), path).not.toMatch(/['"]push['"]/);
    }
  });
  it('services do not enable shell subprocess execution', async () => {
    for (const path of await sourcesIn(SRC)) {
      const text = await readFile(path, 'utf8');
      // Running the fixed restore script with argv is intentional; interpolated
      // shell command strings (-c) are the prohibited execution mode.
      expect(text, path).not.toMatch(/spawn\(\s*['"](?:ba)?sh['"]\s*,\s*\[\s*['"]-c['"]/);
      expect(text, path).not.toMatch(/\bexec\(\s*`/);
      expect(text, path).not.toMatch(/shell:\s*true/);
    }
  });
});
