import { TOKENS, FONTS } from '../../../tokens';

// =============================================================================
// WorkoutHub — mobile day-checklist screen for the hub+focus logger.
// Pure presentational: a container computes setsDone (logged + queue state)
// and owns navigation; this component only renders and reports taps.
// =============================================================================

export type HubBlock = {
  blockIdx: number;
  exerciseName: string;
  muscle: string; // primary muscle slug for the chip label
  setsTotal: number;
  setsDone: number; // logged this session (from `logged` + live queue state)
};

export function WorkoutHub({
  dayName,
  blocks,
  onOpenBlock,
}: {
  dayName: string;
  blocks: HubBlock[];
  onOpenBlock: (blockIdx: number) => void;
}) {
  const firstUnfinishedIdx = blocks.findIndex((b) => b.setsDone < b.setsTotal);
  const allDone = firstUnfinishedIdx === -1;
  const firstUnfinished = allDone ? null : blocks[firstUnfinishedIdx];

  return (
    <div
      style={{
        padding: 16,
        fontFamily: FONTS.ui,
        color: TOKENS.text,
        maxWidth: 480,
        margin: '0 auto',
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 22 }}>{dayName}</h2>
      </header>

      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {blocks.map((block) => {
          const isDone = block.setsDone === block.setsTotal;
          const isUpNext = !allDone && block.blockIdx === firstUnfinished?.blockIdx;
          return (
            <li key={block.blockIdx}>
              <button
                type="button"
                data-testid={`hub-row-${block.blockIdx}`}
                onClick={() => onOpenBlock(block.blockIdx)}
                style={{
                  width: '100%',
                  minHeight: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '12px 14px',
                  background: TOKENS.surface,
                  border: `1px solid ${isUpNext ? TOKENS.accent : TOKENS.line}`,
                  borderRadius: 10,
                  color: TOKENS.text,
                  cursor: 'pointer',
                  textAlign: 'left',
                  opacity: isDone ? 0.6 : 1,
                  fontFamily: FONTS.ui,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      color: isDone ? TOKENS.good : isUpNext ? TOKENS.accent : TOKENS.textDim,
                      fontWeight: 700,
                      width: 16,
                      flexShrink: 0,
                      textAlign: 'center',
                    }}
                  >
                    {isDone ? '✓' : isUpNext ? '▶' : ''}
                  </span>
                  {block.muscle ? <MuscleChip muscle={block.muscle} /> : null}
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: 15,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {block.exerciseName}
                  </span>
                </div>
                <span
                  style={{
                    flexShrink: 0,
                    fontFamily: FONTS.mono,
                    fontSize: 12,
                    color: isUpNext ? TOKENS.accent : TOKENS.textDim,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {block.setsDone}/{block.setsTotal} sets
                  {isUpNext ? ' · up next' : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {allDone ? (
        <div
          style={{
            marginTop: 24,
            padding: 14,
            width: '100%',
            boxSizing: 'border-box',
            textAlign: 'center',
            background: 'rgba(107,226,139,0.1)',
            border: `1px solid ${TOKENS.good}`,
            borderRadius: 8,
            color: TOKENS.good,
            fontWeight: 600,
            letterSpacing: 1,
            textTransform: 'uppercase',
            fontSize: 14,
          }}
        >
          Workout complete
        </div>
      ) : (
        <button
          type="button"
          aria-label="Continue workout"
          onClick={() => onOpenBlock(firstUnfinished!.blockIdx)}
          style={{
            marginTop: 24,
            padding: 14,
            width: '100%',
            background: TOKENS.accent,
            border: 'none',
            borderRadius: 8,
            color: TOKENS.text,
            fontWeight: 600,
            letterSpacing: 1,
            textTransform: 'uppercase',
            fontSize: 14,
            cursor: 'pointer',
            fontFamily: FONTS.ui,
          }}
        >
          {`Continue → ${firstUnfinished!.exerciseName}`}
        </button>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// MuscleChip — inline, non-linkable variant of the TrackChip pattern: a small
// mono-font pill labeling the block's primary muscle.
// -----------------------------------------------------------------------------

function MuscleChip({ muscle }: { muscle: string }) {
  return (
    <span
      data-testid="muscle-chip"
      style={{
        display: 'inline-block',
        flexShrink: 0,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.6,
        fontFamily: FONTS.mono,
        color: TOKENS.textDim,
        background: TOKENS.surface2,
        border: `1px solid ${TOKENS.line}`,
        textTransform: 'uppercase',
      }}
    >
      {muscle}
    </span>
  );
}
