// Shared CLI arg helpers for the exercise-media scripts (generate.ts, promote.ts).

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} needs a value`);
  return value;
}

export const has = (name: string): boolean => process.argv.includes(`--${name}`);
