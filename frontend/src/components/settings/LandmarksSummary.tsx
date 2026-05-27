import { useEffect, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { Term } from '../Term';
import { getLandmarks, type Landmarks } from '../../lib/api/userLandmarks';

export function LandmarksSummary() {
  const [l, setL] = useState<Landmarks | null>(null);
  useEffect(() => { getLandmarks().then((r) => setL(r.landmarks)).catch(() => setL({})); }, []);
  return (
    <div style={{ padding: 16, color: TOKENS.text, fontFamily: FONTS.ui }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Volume <Term k="landmark" variant="abbr">landmarks</Term></h2>
      <p style={{ color: TOKENS.textDim, fontSize: 12, marginTop: 0 }}>
        Edit on desktop. Mobile view is read-only.
      </p>
      {!l ? <div>Loading…</div> : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {Object.keys(l).map((m) => (
            <li key={m} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${TOKENS.line}`, fontSize: 13 }}>
              <span>{m.replace(/_/g, ' ')}</span>
              <span style={{ fontFamily: FONTS.mono, color: TOKENS.textDim }}>
                {l[m].mev}/{l[m].mav}/{l[m].mrv}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
