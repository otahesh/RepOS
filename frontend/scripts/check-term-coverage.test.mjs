import { describe, it, expect } from 'vitest';
import { findOffenders } from './check-term-coverage.mjs';
import path from 'node:path';

const fix = (name) => path.resolve(import.meta.dirname, '__fixtures__', name);

describe('check-term-coverage', () => {
  it('reports zero offenders for fully-wrapped file', async () => {
    const out = await findOffenders([fix('wrapped.tsx')]);
    expect(out).toEqual([]);
  });
  it('reports MEV, MAV, RIR offenders for unwrapped file', async () => {
    const out = await findOffenders([fix('unwrapped.tsx')]);
    const tokens = out.map(o => o.token).sort();
    expect(tokens).toEqual(['MAV', 'MEV', 'RIR']);
  });
  it('does not flag identifier substring (mavRamp ≠ MAV)', async () => {
    const out = await findOffenders([fix('identifier-substring.tsx')]);
    expect(out).toEqual([]);
  });
});
