import { useEffect, useMemo, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { Term } from '../Term';
import { getLandmarks, patchLandmarks, type Landmarks, type InjuryConstraint } from '../../lib/api/userLandmarks';
// Seed defaults — read-side mirror so the UI can compute soft-caps without a
// round-trip. The AUTHORITATIVE check is the server zod schema.
import { MUSCLE_LANDMARKS_SEED } from '../../lib/muscleLandmarksSeed';

type RowDraft = { mv?: string; mev: string; mav: string; mrv: string };
type Draft = Record<string, RowDraft>;

function toDraft(l: Landmarks): Draft {
  const out: Draft = {};
  for (const slug of Object.keys(l)) {
    const x = l[slug];
    out[slug] = { mv: x.mv?.toString() ?? '', mev: x.mev.toString(), mav: x.mav.toString(), mrv: x.mrv.toString() };
  }
  return out;
}

// [C-LANDMARKS-CLINICAL-FLOORS] Per-row validation mirroring the server schema.
// Collects ALL failures (not first-error-wins) so each row shows its own chip.
type FieldErrors = Record<string, string>;
function parseDraft(d: Draft): { overrides: Landmarks; fieldErrors: FieldErrors } {
  const overrides: Landmarks = {};
  const fieldErrors: FieldErrors = {};
  for (const slug of Object.keys(d)) {
    const seed = MUSCLE_LANDMARKS_SEED[slug];
    if (!seed) { fieldErrors[slug] = `unknown muscle slug`; continue; }
    const r = d[slug];
    const mev = parseInt(r.mev, 10);
    const mav = parseInt(r.mav, 10);
    const mrv = parseInt(r.mrv, 10);
    const mv = r.mv?.length ? parseInt(r.mv, 10) : undefined;
    const mevFloor = Math.max(2, Math.floor(seed.mev * 0.5));
    const mrvCeiling = Math.min(50, Math.ceil(seed.mrv * 1.5));
    const errs: string[] = [];
    if ([mev, mav, mrv].some(Number.isNaN)) errs.push('numeric values required');
    if (mv !== undefined && Number.isNaN(mv)) errs.push('MV must be numeric or blank');
    if (mv !== undefined && mv < 0) errs.push('MV must be >= 0');
    if (mv !== undefined && mv > mev) errs.push('MV must be <= MEV');
    if (mev < mevFloor) errs.push(`MEV below clinical floor ${mevFloor}`);
    if (mrv > mrvCeiling) errs.push(`MRV above clinical ceiling ${mrvCeiling}`);
    if (mav - mev < 2) errs.push('MAV - MEV must be >= 2');
    if (mrv - mav < 2) errs.push('MRV - MAV must be >= 2');
    if (errs.length > 0) { fieldErrors[slug] = errs.join('; '); continue; }
    overrides[slug] = { mev, mav, mrv, ...(mv !== undefined ? { mv } : {}) };
  }
  return { overrides, fieldErrors };
}

// [D2 + I-INJURY-OVERRIDE-CONFIRM] Soft-cap math: 80% of seeded defaults.
function softCapMav(slug: string): number {
  const seed = MUSCLE_LANDMARKS_SEED[slug];
  if (!seed) return 50;
  return Math.floor(seed.mav * 0.8);
}
function softCapMrv(slug: string): number {
  const seed = MUSCLE_LANDMARKS_SEED[slug];
  if (!seed) return 50;
  return Math.floor(seed.mrv * 0.8);
}

export function LandmarksEditor() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [topErr, setTopErr] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [parQActive, setParQActive] = useState(false);
  const [injuryConstraints, setInjuryConstraints] = useState<Record<string, InjuryConstraint>>({});
  // [I-INJURY-OVERRIDE-CONFIRM] Per-muscle override acceptance (transient).
  const [overridesAccepted, setOverridesAccepted] = useState<Set<string>>(new Set());

  useEffect(() => {
    getLandmarks()
      .then((r) => {
        setDraft(toDraft(r.landmarks));
        setParQActive(r.par_q_advisory_active);
        setInjuryConstraints(r.injury_constraints);
      })
      .catch((e) => setTopErr(e instanceof Error ? e.message : String(e)));
  }, []);

  // [D2 + I-INJURY-OVERRIDE-CONFIRM] Which muscles are CURRENTLY soft-capped?
  // PAR-Q caps ALL muscles. High-severity injury caps the constrained muscle.
  // A clicked "Override anyway?" removes that muscle from the cap set.
  const cappedMuscles = useMemo(() => {
    if (!draft) return new Set<string>();
    const out = new Set<string>();
    if (parQActive) {
      for (const slug of Object.keys(draft)) {
        if (!overridesAccepted.has(`parq:${slug}`)) out.add(slug);
      }
    }
    for (const [slug, c] of Object.entries(injuryConstraints)) {
      if (c.level === 'high' && !overridesAccepted.has(`injury:${slug}`)) out.add(slug);
    }
    return out;
  }, [draft, parQActive, injuryConstraints, overridesAccepted]);

  if (!draft) return <div style={{ padding: 24, color: TOKENS.textDim }}>Loading landmarks…</div>;

  async function save() {
    if (!draft) return;
    const { overrides, fieldErrors } = parseDraft(draft);

    // Soft-cap enforcement: when PAR-Q/high-injury is active for a muscle, its
    // MAV/MRV cannot exceed 80% of the seeded default unless the user clicks
    // "Override anyway?". Accumulate BOTH MAV and MRV breaches into one chip so
    // a MAV breach is not silently clobbered by a later MRV breach.
    for (const slug of Object.keys(overrides)) {
      const v = overrides[slug];
      if (cappedMuscles.has(slug)) {
        const caps: string[] = [];
        if (v.mav > softCapMav(slug)) caps.push(`MAV above soft-cap ${softCapMav(slug)}`);
        if (v.mrv > softCapMrv(slug)) caps.push(`MRV above soft-cap ${softCapMrv(slug)}`);
        if (caps.length > 0) {
          fieldErrors[slug] = `${caps.join('; ')} (PAR-Q/injury active — click "Override anyway?" to proceed)`;
        }
      }
    }

    if (Object.keys(fieldErrors).length > 0) { setRowErrors(fieldErrors); setTopErr('Fix the highlighted rows.'); return; }
    setRowErrors({}); setTopErr(null);
    setSaving(true);
    try {
      const updated = await patchLandmarks(overrides);
      setDraft(toDraft(updated.landmarks));
      setSaved('Saved. Applies to your next mesocycle — active runs unchanged.');
      setTimeout(() => setSaved(null), 4000);
    } catch (e) {
      const err = e as Error & { fieldErrors?: FieldErrors };
      if (err.fieldErrors) { setRowErrors(err.fieldErrors); setTopErr('Server rejected some rows — see highlighted.'); }
      else setTopErr(err.message);
    } finally { setSaving(false); }
  }

  return (
    <div style={{ padding: 24, fontFamily: FONTS.ui, color: TOKENS.text, maxWidth: 820 }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Volume <Term k="landmark" variant="abbr">landmarks</Term></h2>
      <p style={{ color: TOKENS.textDim, fontSize: 13, marginTop: 0 }}>
        Per-muscle <Term k="MEV" /> / <Term k="MAV" /> / <Term k="MRV" /> overrides.
        Changes apply to your next <Term k="mesocycle" />. Active runs are unchanged.
      </p>

      {/* [D2] PAR-Q advisory banner */}
      {parQActive && (
        <div role="note" style={{ padding: 12, background: 'rgba(255,180,40,0.10)', border: `1px solid ${TOKENS.warn}`, borderRadius: 8, color: TOKENS.text, fontSize: 13, marginBottom: 12 }}>
          <strong>PAR-Q advisory active</strong> — talk to a clinician before increasing volume landmarks above the default. <Term k="MAV" />/<Term k="MRV" /> are soft-capped at 80% of seeded defaults. Use "Override anyway?" per-muscle if your clinician has cleared higher volume.
        </div>
      )}

      {topErr && <div role="alert" style={{ padding: 12, background: 'rgba(255,80,80,0.12)', border: `1px solid ${TOKENS.danger}`, borderRadius: 8, color: TOKENS.danger, fontSize: 13, marginBottom: 12 }}>{topErr}</div>}
      {saved && <div role="status" style={{ padding: 12, background: 'rgba(120,220,160,0.10)', border: `1px solid rgba(120,220,160,0.5)`, borderRadius: 8, color: TOKENS.text, fontSize: 13, marginBottom: 12 }}>{saved}</div>}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${TOKENS.line}` }}>
            <th style={th()}>Muscle</th>
            <th style={th()}><Term k="MV" /></th>
            <th style={th()}><Term k="MEV" /></th>
            <th style={th()}><Term k="MAV" /></th>
            <th style={th()}><Term k="MRV" /></th>
            <th style={th()}>Status</th>
          </tr>
        </thead>
        <tbody>
          {Object.keys(draft).map((slug) => {
            const constraint = injuryConstraints[slug];
            const isCapped = cappedMuscles.has(slug);
            const rowErr = rowErrors[slug];
            return (
              <tr key={slug} data-slug={slug} style={{ borderBottom: `1px solid ${TOKENS.line}`, background: rowErr ? 'rgba(255,80,80,0.04)' : 'transparent' }}>
                <td style={td()}>
                  {slug.replace(/_/g, ' ')}
                  {/* [I-INJURY-OVERLAY-COPY] Named injury chip */}
                  {constraint && (
                    <span title={`Severity: ${constraint.level}. Consider conservative MAV/MRV.`} style={{ marginLeft: 8, fontSize: 10, fontFamily: FONTS.mono, color: constraint.level === 'high' ? TOKENS.danger : TOKENS.warn }} data-injury={constraint.joint}>
                      ⚠ {constraint.joint.replace(/_/g, ' ')} ({constraint.level})
                    </span>
                  )}
                </td>
                {(['mv', 'mev', 'mav', 'mrv'] as const).map((k) => (
                  <td key={k} style={td()}>
                    <input
                      aria-label={`${slug} ${k}`}
                      value={draft[slug][k] ?? ''}
                      onChange={(e) => setDraft({ ...draft, [slug]: { ...draft[slug], [k]: e.target.value } })}
                      style={{ width: 56, padding: '4px 6px', background: TOKENS.surface2, color: TOKENS.text, border: `1px solid ${rowErr ? TOKENS.danger : TOKENS.line}`, borderRadius: 4, fontFamily: FONTS.mono, fontSize: 12 }}
                    />
                  </td>
                ))}
                <td style={td()}>
                  {rowErr && <div role="alert" style={{ color: TOKENS.danger, fontSize: 11 }}>{rowErr}</div>}
                  {/* [I-INJURY-OVERRIDE-CONFIRM] Override-anyway button when capped */}
                  {isCapped && !rowErr && (
                    <button
                      type="button"
                      onClick={() => {
                        const key = constraint?.level === 'high' ? `injury:${slug}` : `parq:${slug}`;
                        const next = new Set(overridesAccepted); next.add(key); setOverridesAccepted(next);
                      }}
                      style={{ fontSize: 10, padding: '2px 8px', background: 'transparent', color: TOKENS.textDim, border: `1px solid ${TOKENS.lineStrong}`, borderRadius: 4, cursor: 'pointer' }}
                    >Override anyway?</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <button type="button" disabled={saving} onClick={save} style={{ marginTop: 16, padding: '10px 16px', background: TOKENS.accent, color: '#fff', border: 'none', borderRadius: 8, cursor: saving ? 'wait' : 'pointer', fontWeight: 600 }}>
        {saving ? 'Saving…' : 'Save landmarks'}
      </button>
    </div>
  );
}

const th = (): React.CSSProperties => ({ textAlign: 'left', padding: '8px 6px', color: TOKENS.textDim, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 });
const td = (): React.CSSProperties => ({ padding: '8px 6px', verticalAlign: 'top' });
