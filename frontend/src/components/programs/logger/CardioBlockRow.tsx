import { useState } from 'react';
import { TOKENS, FONTS } from '../../../tokens';
import type { TodayCardio } from '../../../lib/api/mesocycles';
import { postCardioLog, ApiError } from '../../../lib/api/cardioLogs';

// =============================================================================
// CardioBlockRow — inline cardio completion in the session logger (measurement
// model phase 2). The reviewers' acceptance criterion: cardio's schema
// separation must never become UI separation — the block logs from the same
// screen as the lifts. Duration prefills from the target; distance optional.
// Direct idempotent POST with an inline retry affordance (see
// lib/api/cardioLogs.ts for why this doesn't ride the offline queue).
// =============================================================================

type Phase = 'input' | 'logging' | 'logged' | 'error';

export function CardioBlockRow({ block }: { block: TodayCardio }) {
  const targetMin =
    block.target_duration_sec != null ? Math.round(block.target_duration_sec / 60) : null;
  const [minutes, setMinutes] = useState<string>(
    block.logged?.duration_sec != null
      ? String(Math.round(block.logged.duration_sec / 60))
      : targetMin != null
        ? String(targetMin)
        : '',
  );
  const [distanceKm, setDistanceKm] = useState<string>(
    block.logged?.distance_m != null ? String(block.logged.distance_m / 1000) : '',
  );
  const [phase, setPhase] = useState<Phase>(block.logged ? 'logged' : 'input');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  // One client_request_id per input-session: retries after a failure replay
  // the SAME id, so a POST that actually landed dedupes instead of duplicating.
  const [clientRequestId] = useState<string>(() => crypto.randomUUID());

  const mins = parseInt(minutes, 10);
  const canLog = phase !== 'logging' && phase !== 'logged' && Number.isFinite(mins) && mins > 0;

  const handleLog = async (): Promise<void> => {
    if (!canLog) return;
    setPhase('logging');
    setErrorDetail(null);
    const km = parseFloat(distanceKm);
    try {
      await postCardioLog({
        client_request_id: clientRequestId,
        planned_cardio_block_id: block.id,
        duration_sec: mins * 60,
        ...(Number.isFinite(km) && km > 0 ? { distance_m: Math.round(km * 1000) } : {}),
        performed_at: new Date().toISOString(),
      });
      setPhase('logged');
    } catch (err) {
      setPhase('error');
      setErrorDetail(
        err instanceof ApiError
          ? `Save failed (${err.status}) — check connection and retry`
          : 'Save failed — check connection and retry',
      );
    }
  };

  const targetChips: string[] = [];
  if (targetMin != null) targetChips.push(`${targetMin} min`);
  if (block.target_distance_m != null) targetChips.push(`${block.target_distance_m / 1000} km`);
  if (block.target_zone != null) targetChips.push(`Z${block.target_zone}`);

  return (
    <div
      data-testid={`cardio-block-${block.block_idx}`}
      style={{
        background: TOKENS.bg,
        border: `1px solid ${TOKENS.line}`,
        borderRadius: 8,
        padding: 10,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <span style={{ fontFamily: FONTS.ui, fontWeight: 600, fontSize: 14, color: TOKENS.text }}>
          {block.exercise.name}
        </span>
        <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: TOKENS.textDim }}>
          {targetChips.join(' · ')}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: TOKENS.textDim, fontFamily: FONTS.ui }}>
            Duration (min)
          </span>
          <input
            type="number"
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            aria-label={`${block.exercise.name} duration in minutes`}
            disabled={phase === 'logged'}
            style={{
              background: TOKENS.surface,
              border: `1px solid ${TOKENS.line}`,
              borderRadius: 6,
              padding: '10px 10px',
              color: TOKENS.text,
              fontFamily: FONTS.mono,
              fontSize: 16,
              width: '100%',
              boxSizing: 'border-box',
            }}
          />
        </label>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: TOKENS.textDim, fontFamily: FONTS.ui }}>
            Distance (km, optional)
          </span>
          <input
            type="number"
            inputMode="decimal"
            value={distanceKm}
            onChange={(e) => setDistanceKm(e.target.value)}
            aria-label={`${block.exercise.name} distance in kilometers`}
            disabled={phase === 'logged'}
            style={{
              background: TOKENS.surface,
              border: `1px solid ${TOKENS.line}`,
              borderRadius: 6,
              padding: '10px 10px',
              color: TOKENS.text,
              fontFamily: FONTS.mono,
              fontSize: 16,
              width: '100%',
              boxSizing: 'border-box',
            }}
          />
        </label>
      </div>

      <button
        onClick={() => void handleLog()}
        disabled={!canLog}
        style={{
          marginTop: 10,
          width: '100%',
          padding: 10,
          background:
            phase === 'logged' ? TOKENS.surface3 : canLog ? TOKENS.accent : TOKENS.surface3,
          color: TOKENS.text,
          border: 'none',
          borderRadius: 6,
          fontFamily: FONTS.ui,
          fontWeight: 600,
          letterSpacing: 1,
          textTransform: 'uppercase',
          fontSize: 12,
          cursor: canLog ? 'pointer' : 'not-allowed',
        }}
      >
        {phase === 'logged'
          ? 'Cardio logged'
          : phase === 'logging'
            ? 'Saving…'
            : phase === 'error'
              ? 'Retry log cardio'
              : 'Log cardio'}
      </button>

      <div
        role="status"
        aria-live="polite"
        style={{
          marginTop: 8,
          minHeight: 14,
          fontFamily: FONTS.mono,
          fontSize: 11,
          color: phase === 'error' ? TOKENS.danger : TOKENS.good,
        }}
      >
        {phase === 'error'
          ? errorDetail
          : phase === 'logged'
            ? 'Done — counts toward weekly cardio minutes.'
            : ''}
      </div>
    </div>
  );
}
