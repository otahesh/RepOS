import { describe, it, expect } from 'vitest';

describe('runtime deps', () => {
  // Radix import coverage removed — the build/validate steps fail loudly if
  // a bundled dep is missing. Only the babel deps stay: they're consumed by
  // scripts/check-term-coverage.mjs, which no build step exercises.
  it('imports babel parser + traverse for term-coverage script', async () => {
    const parser = await import('@babel/parser');
    const traverse = await import('@babel/traverse');
    expect(parser.parse).toBeDefined();
    expect(traverse.default).toBeDefined();
  });
});
