import { useEffect, useState } from 'react';
import { TOKENS } from '../../tokens';
import {
  listInjuries, upsertInjury, deleteInjury,
  type UserInjury, type InjuryJoint,
} from '../../lib/api/userInjuries';

// W3.4 Q3 — InjuryChipsEditor (base chip-toggle behavior).
// Task 21 will layer the expanded per-row panel (severity / notes / onset_at)
// on top of this; Task 22 mounts the editor on /settings/injuries.
// Hex literals deliberately routed through TOKENS (FIX-18) to keep the
// design-token discipline consistent with sibling settings components.

const CHIPS: InjuryJoint[] = [
  'shoulder_left', 'shoulder_right', 'low_back',
  'knee_left', 'knee_right', 'elbow', 'wrist',
];

export function InjuryChipsEditor(): JSX.Element {
  const [items, setItems] = useState<UserInjury[]>([]);
  const [pending, setPending] = useState<Set<InjuryJoint>>(new Set());

  useEffect(() => {
    listInjuries().then(setItems);
  }, []);

  function isActive(j: InjuryJoint): boolean {
    return items.some((i) => i.joint === j);
  }

  async function toggle(j: InjuryJoint): Promise<void> {
    if (pending.has(j)) return;
    setPending((p) => new Set(p).add(j));
    try {
      if (isActive(j)) {
        await deleteInjury(j);
        setItems((prev) => prev.filter((i) => i.joint !== j));
      } else {
        const created = await upsertInjury({ joint: j });
        setItems((prev) => [...prev, created]);
      }
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(j);
        return n;
      });
    }
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {CHIPS.map((j) => {
        const active = isActive(j);
        const isPending = pending.has(j);
        return (
          <button
            key={j}
            type="button"
            aria-pressed={active}
            disabled={isPending}
            onClick={() => { void toggle(j); }}
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
  );
}
