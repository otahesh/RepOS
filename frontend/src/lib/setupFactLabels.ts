/**
 * setup_facts → annotation chip strings for the setup-card photo overlay
 * (spec §5: annotations are app-rendered, never baked into images).
 * `bench_angle_deg: 30` → "bench 30°"; `stance: 'shoulder-width'` → "stance: shoulder-width".
 * Chips render uppercase via CSS; keep these lowercase and short.
 */
export function formatSetupFacts(facts: Record<string, number | string>): string[] {
  return Object.entries(facts).map(([key, value]) => {
    const isDegrees = /_deg$/.test(key);
    const label = key.replace(/_angle_deg$|_deg$/, '').replace(/_/g, ' ');
    if (typeof value === 'number') return isDegrees ? `${label} ${value}°` : `${label} ${value}`;
    return `${label}: ${value}`;
  });
}

/**
 * Chips suitable for overlaying ON the photo: short numeric facts only.
 * Real seed data has sentence-length string facts ("just above the heels") —
 * as overlay chips those bury the lower third of the photo and duplicate the
 * setup callout rendered directly beneath. Zero-degree facts are suppressed:
 * "bench 0°" is technically true but reads odd; the callout says "flat".
 */
export function overlaySetupFactChips(facts: Record<string, number | string>): string[] {
  const numeric = Object.entries(facts).filter(
    ([key, value]) => typeof value === 'number' && !(value === 0 && /_deg$/.test(key)),
  );
  return formatSetupFacts(Object.fromEntries(numeric));
}
