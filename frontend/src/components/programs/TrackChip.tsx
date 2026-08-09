import { Link } from 'react-router-dom';
import { FONTS } from '../../tokens';
import { TRACK_META, type ProgramTrack } from '../../lib/programTracks';

/** Color-coded track badge. Links to the catalog scoped to this track
 *  ("see other Beginner/Intermediate/Advanced programs") unless disabled. */
export function TrackChip({ track, linkable = true }: { track: ProgramTrack; linkable?: boolean }) {
  const meta = TRACK_META[track];
  const chip = (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.6,
        fontFamily: FONTS.mono,
        color: meta.color,
        background: `${meta.color}22`,
        border: `1px solid ${meta.color}55`,
      }}
    >
      {meta.label.toUpperCase()}
    </span>
  );
  if (!linkable) return chip;
  return (
    <Link to={`/programs?track=${track}`} style={{ textDecoration: 'none' }} title={meta.blurb}>
      {chip}
    </Link>
  );
}
