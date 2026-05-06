// frontend/scripts/check-term-coverage.mjs
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { readFileSync } from 'node:fs';
import { glob } from 'glob';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const traverse = _traverse.default ?? _traverse;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadTerms() {
  const tsPath = path.resolve(__dirname, '..', 'src', 'lib', 'terms.ts');
  const src = readFileSync(tsPath, 'utf8');
  // Pull TERMS keys + short/full strings via simple regex over the dictionary literal.
  const keys = [...src.matchAll(/^\s{2}([A-Za-z_]\w*):\s*\{/gm)].map(m => m[1]);
  const shorts = [...src.matchAll(/short:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  const fulls = [...src.matchAll(/full:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  if (keys.length < 5 || shorts.length !== keys.length || fulls.length !== keys.length) {
    throw new Error(
      `term-coverage: regex parse of terms.ts produced inconsistent results ` +
      `(${keys.length} keys / ${shorts.length} shorts / ${fulls.length} fulls). ` +
      `terms.ts may have been refactored — update loadTerms() in scripts/check-term-coverage.mjs.`
    );
  }
  return { keys, shorts, fulls };
}

function isAcronym(s) { return /^[A-Z0-9]{2,}$/.test(s); }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function buildMatchers(tokens) {
  return tokens.map(tok => {
    const acr = isAcronym(tok);
    const flags = acr ? '' : 'i';
    return { token: tok, re: new RegExp(`(^|[^A-Za-z0-9_])(${escapeRe(tok)})(?=$|[^A-Za-z0-9_])`, flags) };
  });
}

function inTermWrapper(jsxPath) {
  // Walk up to find the nearest JSXElement; if its opening name is 'Term', skip.
  let p = jsxPath;
  while (p) {
    if (p.isJSXElement && p.isJSXElement()) {
      const name = p.node.openingElement?.name;
      if (name?.type === 'JSXIdentifier' && name.name === 'Term') return true;
    }
    p = p.parentPath;
  }
  return false;
}

export async function findOffenders(files) {
  const { shorts, fulls } = await loadTerms();
  const tokens = [...new Set([...shorts, ...fulls])];
  const matchers = buildMatchers(tokens);
  const offenders = [];

  for (const file of files) {
    const code = readFileSync(file, 'utf8');
    let ast;
    try {
      ast = parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      });
    } catch (err) {
      // Soft-fail-then-fail-loudly: record the parse error as an offender so the CI
      // gate exits non-zero. Without this, a syntax error masks all term offenders.
      console.error(`parse error: ${file}: ${err.message}`);
      offenders.push({ file, line: 0, token: '<parse error>' });
      continue;
    }

    traverse(ast, {
      JSXText(p) {
        if (inTermWrapper(p)) return;
        const text = p.node.value;
        for (const { token, re } of matchers) {
          if (re.test(text)) {
            offenders.push({ file, line: p.node.loc?.start.line ?? 0, token });
          }
        }
      },
      JSXAttribute(p) {
        if (inTermWrapper(p)) return;
        const v = p.node.value;
        if (!v || v.type !== 'StringLiteral') return;
        for (const { token, re } of matchers) {
          if (re.test(v.value)) {
            offenders.push({ file, line: v.loc?.start.line ?? 0, token });
          }
        }
      },
    });
  }
  return offenders;
}

async function main() {
  const root = path.resolve(__dirname, '..', 'src');
  const files = await glob('**/*.tsx', { cwd: root, absolute: true, ignore: ['**/*.test.tsx', '**/lib/terms.ts'] });
  const offenders = await findOffenders(files);
  if (offenders.length === 0) {
    console.log('term coverage: OK');
    return;
  }
  console.error('Unwrapped term-of-art occurrences:');
  for (const o of offenders) {
    const rel = path.relative(path.resolve(__dirname, '..', '..'), o.file);
    console.error(`  ${rel}:${o.line}  ${o.token}`);
  }
  console.error(`\n${offenders.length} offender(s). Wrap with <Term k="…"> or move out of JSX.`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
