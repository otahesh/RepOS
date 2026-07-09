import { Term } from '../Term';
import type { TodayPacing } from '../../lib/api/mesocycles';

// Sequence-workouts pacing indicator. Dates are hints, not gates: AHEAD / ON
// PACE read good-green; falling behind reads warn-amber — never danger-red,
// because being behind never blocks training. The chip carries the shared
// <Term> tooltip so the reader learns what pacing means and that it's advisory.

export function pacingLabel(pacing: TodayPacing): string {
  if (pacing.status === 'ahead') return 'AHEAD';
  if (pacing.status === 'on_pace') return 'ON PACE';
  const n = pacing.days_behind ?? 0;
  return `${n} DAY${n === 1 ? '' : 'S'} BEHIND`;
}

export function PacingChip({ pacing }: { pacing: TodayPacing }) {
  const color = pacing.status === 'behind' ? '#F5B544' : '#6BE28B';
  return (
    <span
      data-testid="pacing-chip"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        background: `${color}1A`,
        border: `1px solid ${color}66`,
        color,
        fontFamily: 'JetBrains Mono',
        fontSize: 10,
        letterSpacing: 1,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      <Term k="pacing" compact>
        {pacingLabel(pacing)}
      </Term>
    </span>
  );
}
