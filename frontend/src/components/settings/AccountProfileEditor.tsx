// frontend/src/components/settings/AccountProfileEditor.tsx
// Beta W6.2 — editable profile form on /settings/account.
//
// Per D6 (2026-05-26): NO units selector. Units conversion is deferred to a
// future wave that wires through every render site.
//
// Per memory feedback_terms_of_art_tooltips: "time zone" wraps in <Term k="IANA_timezone">.
//
// Per C-PROFILE-CONTROLLED: ControlledField pattern from W3 InjuryChipsEditor.tsx
// (lines 33-55). Local state is seeded from props AND re-synced via useEffect
// when the parent re-renders with a new `user` (avoids stale state on parent
// refetch). Save calls patchProfile only for fields that actually diff against
// the current props.
//
// Per CLAUDE.md "rollback-on-error": optimistic update + restore prior value if
// patchProfile() rejects, with pushToast({severity:'error', ...}).
//
// Timezones loaded from frontend/src/lib/timezones.ts (mirror of API list) —
// NOT from Intl.supportedValuesOf, per I-IANA-TIMEZONES + project_alpine_smallicu.

import { useEffect, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { patchProfile, type ProfileResponse } from '../../lib/api/account';
import { pushToast } from '../common/ToastHost';
import { Term } from '../Term';
import { IANA_TIMEZONES } from '../../lib/timezones';

interface Props {
  user: ProfileResponse;
}

export function AccountProfileEditor({ user }: Props): JSX.Element {
  // ControlledField pattern (per C-PROFILE-CONTROLLED): useState seeds from
  // props on first render, then useEffect re-syncs on prop change.
  const [displayName, setDisplayName] = useState(user.display_name ?? '');
  const [timezone, setTimezone] = useState(user.timezone);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDisplayName(user.display_name ?? '');
  }, [user.display_name]);
  useEffect(() => {
    setTimezone(user.timezone);
  }, [user.timezone]);

  const handleSave = async (): Promise<void> => {
    // Commit-on-save diff-check (per C-PROFILE-CONTROLLED): only PATCH fields
    // that actually changed from props (not from initial mount state).
    const patch: Parameters<typeof patchProfile>[0] = {};
    if (displayName !== (user.display_name ?? '')) patch.display_name = displayName;
    if (timezone !== user.timezone) patch.timezone = timezone;
    if (Object.keys(patch).length === 0) {
      // No-op: no toast, no API call (clean save UX).
      return;
    }
    setSaving(true);
    try {
      const updated = await patchProfile(patch);
      // Server is the source of truth; reflect what came back (e.g. NFKC
      // normalization may have stripped invisible chars).
      setDisplayName(updated.display_name ?? '');
      setTimezone(updated.timezone);
      pushToast({ severity: 'success', body: 'Profile saved.' });
    } catch (err) {
      // Rollback to props (server state, NOT mount state).
      setDisplayName(user.display_name ?? '');
      setTimezone(user.timezone);
      pushToast({
        severity: 'error',
        body: 'Save failed. ' + (err instanceof Error ? err.message : 'Try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="profile-section-title" style={{
      background: TOKENS.surface, border: `1px solid ${TOKENS.line}`,
      borderRadius: 12, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <h3 id="profile-section-title" style={{ fontSize: 14, fontWeight: 600, color: TOKENS.text, margin: 0 }}>Profile</h3>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: TOKENS.textMute, letterSpacing: 1.2 }}>DISPLAY NAME</span>
        <input
          aria-label="Display name"
          value={displayName}
          maxLength={80}
          onChange={(e) => setDisplayName(e.target.value)}
          style={{
            padding: '8px 10px', background: TOKENS.bg, color: TOKENS.text,
            border: `1px solid ${TOKENS.lineStrong}`, borderRadius: 6, fontSize: 13,
          }}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: TOKENS.textMute, letterSpacing: 1.2 }}>
          <Term k="IANA_timezone">TIME ZONE</Term>
        </span>
        <select
          aria-label="Time zone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          style={{
            padding: '8px 10px', background: TOKENS.bg, color: TOKENS.text,
            border: `1px solid ${TOKENS.lineStrong}`, borderRadius: 6, fontSize: 13,
          }}
        >
          {IANA_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
        </select>
      </label>

      {/* NO units selector — deferred per D6. */}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          style={{
            padding: '8px 16px', borderRadius: 6, border: 'none',
            background: saving ? TOKENS.surface3 : TOKENS.accent, color: '#fff',
            fontFamily: FONTS.ui, fontSize: 13, fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >{saving ? 'SAVING…' : 'SAVE'}</button>
      </div>
    </section>
  );
}
