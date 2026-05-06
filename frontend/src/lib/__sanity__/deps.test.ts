import { describe, it, expect } from 'vitest';

describe('runtime deps', () => {
  it('imports radix popover', async () => {
    const m = await import('@radix-ui/react-popover');
    expect(m.Root).toBeDefined();
    expect(m.Trigger).toBeDefined();
    expect(m.Content).toBeDefined();
  });
  it('imports babel parser + traverse for term-coverage script', async () => {
    const parser = await import('@babel/parser');
    const traverse = await import('@babel/traverse');
    expect(parser.parse).toBeDefined();
    expect(traverse.default).toBeDefined();
  });
});
