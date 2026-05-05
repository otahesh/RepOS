export function computeWarmupSets(working_load_lbs: number): Array<{ pct: number; load_lbs: number; rir: 5 }> {
  if (working_load_lbs < 45) return [];
  const round5 = (n: number) => Math.round(n / 5) * 5;
  return [40, 60, 80].map(pct => ({ pct, load_lbs: round5((working_load_lbs * pct) / 100), rir: 5 as const }));
}
