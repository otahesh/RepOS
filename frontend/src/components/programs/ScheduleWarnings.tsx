// frontend/src/components/programs/ScheduleWarnings.tsx
export type ScheduleWarning = {
  code: 'too_many_days_per_week' | 'consecutive_same_pattern' | 'cardio_interval_too_close' | 'hiit_day_before_heavy_lower';
  severity: 'warn' | 'block';
  message: string;
  day_idx?: number;
};

export function ScheduleWarnings({ warnings }: { warnings: ScheduleWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {warnings.map((w, i) => {
        const accent = w.severity === 'block' ? '#FF6A6A' : '#F5B544';
        return (
          <li key={i} style={{
            background: '#10141C',
            border: `1px solid ${accent}`,
            borderRadius: 6,
            padding: '8px 12px',
            color: accent,
            fontFamily: 'Inter Tight',
            fontSize: 13,
          }}>
            <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, letterSpacing: 1, marginRight: 8, textTransform: 'uppercase' }}>
              {w.severity}
            </span>
            {w.message}
          </li>
        );
      })}
    </ul>
  );
}
