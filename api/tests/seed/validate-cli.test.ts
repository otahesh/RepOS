import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

describe('validate-cli (program templates)', () => {
  it('exits 0 with the production templates', () => {
    const r = spawnSync('npx', ['tsx', 'src/seed/validate-cli.ts'], { cwd: '.', encoding: 'utf-8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/program_templates OK · 3 entries/);
  });
});
