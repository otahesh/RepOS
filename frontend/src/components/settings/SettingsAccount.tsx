// frontend/src/components/settings/SettingsAccount.tsx
// Beta W6.2 — Account page layout. No units selector per D6.
//
// Profile source (Task 16): GET /api/me already returns the exact
// ProfileResponse shape { id, email, display_name, timezone } (api/src/app.ts),
// so we fetch it directly via apiFetch rather than adding a new route. The
// `user` from useCurrentUser drives the effect dependency so the profile
// refetches if the authenticated identity changes.
import { useEffect, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { useCurrentUser, apiFetch } from '../../auth';
import { AccountProfileEditor } from './AccountProfileEditor';
import { ActiveSessionsTable } from './ActiveSessionsTable';
import { SignOutEverywhereButton } from './SignOutEverywhereButton';
import { AccountEventsTimeline } from './AccountEventsTimeline';
import { DeleteAccountSection } from './DeleteAccountSection';
import type { ProfileResponse } from '../../lib/api/account';

export default function SettingsAccount(): JSX.Element {
  const { user } = useCurrentUser();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);

  useEffect(() => {
    void apiFetch('/api/me').then(async (r) => {
      if (!r.ok) return;
      const me = (await r.json()) as ProfileResponse;
      setProfile(me);
    });
  }, [user]);

  if (!profile) {
    return (
      <div style={{ padding: 24, color: TOKENS.textDim, fontFamily: FONTS.mono, fontSize: 11 }}>
        LOADING…
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '24px 32px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 720,
      }}
    >
      <div>
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 10,
            color: TOKENS.textMute,
            letterSpacing: 1.2,
            marginBottom: 4,
          }}
        >
          SETTINGS
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5, color: TOKENS.text }}>
          Account
        </h2>
      </div>

      <AccountProfileEditor user={profile} />

      <ActiveSessionsTable />

      <section
        style={{
          background: TOKENS.surface,
          border: `1px solid ${TOKENS.line}`,
          borderRadius: 12,
          padding: '20px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 600, color: TOKENS.text, margin: 0 }}>Security</h3>
        <SignOutEverywhereButton />
      </section>

      <AccountEventsTimeline />

      <DeleteAccountSection email={profile.email} />
    </div>
  );
}
