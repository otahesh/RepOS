import { useEffect, useState } from 'react';
import { TOKENS } from '../../tokens';
import {
  listInjuries, upsertInjury, patchInjury, deleteInjury,
  type UserInjury, type InjuryJoint, type InjurySeverity,
} from '../../lib/api/userInjuries';

// W3.4 Q3 — InjuryChipsEditor with expanded per-row panel (Task 21).
// Semantics:
//   - Tap inactive chip → activates (upsertInjury) AND expands the panel.
//   - Tap active chip   → toggles the expanded panel only (does NOT deactivate).
//   - Deactivation is an explicit Remove button inside the expanded panel.
// Reviewer fixes inline:
//   [FIX-18] Use TOKENS not hardcoded hexes.
//   [FIX-19] Optimistic update with rollback on PATCH error; surface error via role=alert.
//   [FIX-22] Expanded panel uses role=region + aria-labelledby pointing to chip id.
//   [FIX-23] Severity-button queries in tests are scoped via within(panel).

const CHIPS: InjuryJoint[] = [
  'shoulder_left', 'shoulder_right', 'low_back',
  'knee_left', 'knee_right', 'elbow', 'wrist',
];
const SEVERITIES: InjurySeverity[] = ['low', 'mod', 'high'];

export function InjuryChipsEditor(): JSX.Element {
  const [items, setItems] = useState<UserInjury[]>([]);
  const [expanded, setExpanded] = useState<InjuryJoint | null>(null);
  const [pending, setPending] = useState<Set<InjuryJoint>>(new Set());
  const [error, setError] = useState<string | null>(null); // [FIX-19]

  useEffect(() => {
    listInjuries().then(setItems);
  }, []);

  function isActive(j: InjuryJoint): boolean {
    return items.some((i) => i.joint === j);
  }

  function find(j: InjuryJoint): UserInjury | undefined {
    return items.find((i) => i.joint === j);
  }

  async function tap(j: InjuryJoint): Promise<void> {
    if (pending.has(j)) return;
    if (!isActive(j)) {
      setPending((p) => new Set(p).add(j));
      try {
        const created = await upsertInjury({ joint: j });
        setItems((prev) => [...prev, created]);
        setExpanded(j);
      } finally {
        setPending((p) => {
          const n = new Set(p);
          n.delete(j);
          return n;
        });
      }
    } else {
      setExpanded((prev) => (prev === j ? null : j));
    }
  }

  // [FIX-19] Optimistic update + rollback on error
  async function patchWithRollback(
    j: InjuryJoint,
    patch: { severity?: InjurySeverity; notes?: string; onset_at?: string | null },
  ): Promise<void> {
    const prior = items.find((i) => i.joint === j);
    if (!prior) return;
    const optimistic: UserInjury = { ...prior, ...patch };
    setItems((prev) => prev.map((i) => (i.joint === j ? optimistic : i)));
    try {
      const updated = await patchInjury(j, patch);
      setItems((prev) => prev.map((i) => (i.joint === j ? updated : i)));
    } catch (err) {
      setItems((prev) => prev.map((i) => (i.joint === j ? prior : i)));
      setError(err instanceof Error ? err.message : 'Save failed — change reverted');
    }
  }

  const updateSeverity = (j: InjuryJoint, severity: InjurySeverity): Promise<void> =>
    patchWithRollback(j, { severity });
  const updateNotes = (j: InjuryJoint, notes: string): Promise<void> =>
    patchWithRollback(j, { notes });
  const updateOnset = (j: InjuryJoint, onset_at: string | null): Promise<void> =>
    patchWithRollback(j, { onset_at });

  async function remove(j: InjuryJoint): Promise<void> {
    await deleteInjury(j);
    setItems((prev) => prev.filter((i) => i.joint !== j));
    setExpanded(null);
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {CHIPS.map((j) => {
          const active = isActive(j);
          const isPending = pending.has(j);
          return (
            <button
              key={j}
              id={`injury-chip-${j}`} // [FIX-22] target for panel aria-labelledby
              type="button"
              aria-pressed={active}
              aria-expanded={expanded === j}
              aria-controls={active ? `injury-panel-${j}` : undefined}
              disabled={isPending}
              onClick={() => { void tap(j); }}
              style={{
                padding: '6px 12px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                cursor: isPending ? 'wait' : 'pointer',
                background: active ? TOKENS.accent : 'transparent',
                color: active ? TOKENS.bg : TOKENS.text,
                border: `1px solid ${active ? TOKENS.accent : TOKENS.lineStrong}`,
              }}
            >
              {j}{active ? ' ✓' : ''}
            </button>
          );
        })}
      </div>

      {error !== null && (
        <div
          role="alert"
          style={{
            marginTop: 8,
            padding: 8,
            borderRadius: 4,
            background: 'rgba(255,106,106,0.1)',
            color: TOKENS.danger,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {expanded !== null && (() => {
        const item = find(expanded);
        if (!item) return null;
        const panelId = `injury-panel-${expanded}`;
        const chipId = `injury-chip-${expanded}`;
        return (
          // [FIX-22] role=region + aria-labelledby pointing to the chip
          <section
            id={panelId}
            role="region"
            aria-labelledby={chipId}
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 8,
              background: TOKENS.accentGlow,
              borderLeft: `2px solid ${TOKENS.accent}`,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 8, color: TOKENS.text }}>{item.joint}</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {SEVERITIES.map((s) => {
                const activeBg = s === 'low' ? TOKENS.accent : s === 'mod' ? TOKENS.warn : TOKENS.danger;
                const isOn = item.severity === s;
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={isOn}
                    onClick={() => { void updateSeverity(item.joint, s); }}
                    style={{
                      padding: '4px 10px',
                      fontSize: 12,
                      fontWeight: 600,
                      background: isOn ? activeBg : 'rgba(255,255,255,0.05)',
                      color: isOn ? TOKENS.bg : TOKENS.text,
                      border: 0,
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            <input
              defaultValue={item.notes}
              placeholder="Notes (optional)"
              onBlur={(e) => { void updateNotes(item.joint, e.target.value); }}
              style={{
                width: '100%',
                background: TOKENS.surface,
                border: `1px solid ${TOKENS.line}`,
                color: TOKENS.text,
                padding: 6,
                borderRadius: 4,
                fontSize: 12,
              }}
            />
            <input
              type="date"
              defaultValue={item.onset_at ?? ''}
              onBlur={(e) => { void updateOnset(item.joint, e.target.value || null); }}
              style={{
                marginTop: 6,
                background: TOKENS.surface,
                border: `1px solid ${TOKENS.line}`,
                color: TOKENS.text,
                padding: 4,
                borderRadius: 4,
                fontSize: 12,
              }}
            />
            <div>
              <button
                type="button"
                onClick={() => { void remove(item.joint); }}
                style={{
                  marginTop: 8,
                  padding: '4px 10px',
                  background: 'transparent',
                  border: `1px solid ${TOKENS.danger}`,
                  color: TOKENS.danger,
                  borderRadius: 4,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Remove
              </button>
            </div>
          </section>
        );
      })()}
    </div>
  );
}
