// frontend/src/components/settings/SettingsAccount.tsx
// Beta W6.2 — Account page layout. No units selector per D6.
//
// Profile source (Task 16): GET /api/me already returns the exact
// ProfileResponse shape { id, email, display_name, timezone } (api/src/app.ts),
// so we fetch it directly via apiFetch rather than adding a new route. The
// `user` from useCurrentUser drives the effect dependency so the profile
// refetches if the authenticated identity changes.
import { useEffect, useState } from 'react';
import { TOKENS } from '../../tokens';
import { useCurrentUser, apiFetch } from '../../auth';
import { AccountProfileEditor } from './AccountProfileEditor';
import { ActiveSessionsTable } from './ActiveSessionsTable';
import { SignOutEverywhereButton } from './SignOutEverywhereButton';
import { AccountEventsTimeline } from './AccountEventsTimeline';
import { DeleteAccountSection } from './DeleteAccountSection';
import type { ProfileResponse } from '../../lib/api/account';
import { Button, DataState, Page, PageHeader } from '../ui';

export default function SettingsAccount(): JSX.Element {
  const { user } = useCurrentUser();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setError(false);
    void apiFetch('/api/me')
      .then(async (r) => {
        if (!r.ok) throw new Error('profile unavailable');
        const me = (await r.json()) as ProfileResponse;
        setProfile(me);
      })
      .catch(() => setError(true));
  }, [user, retryKey]);

  if (error) {
    return (
      <Page width="standard">
        <DataState
          kind="error"
          title="Account settings could not be loaded"
          body="Your profile and security settings were not changed."
          action={
            <Button variant="secondary" onClick={() => setRetryKey((key) => key + 1)}>
              Retry
            </Button>
          }
        />
      </Page>
    );
  }

  if (!profile) {
    return (
      <Page width="standard">
        <DataState kind="loading" title="Loading account settings" />
      </Page>
    );
  }

  return (
    <Page
      width="standard"
      style={{ display: 'flex', flexDirection: 'column', gap: 16, color: TOKENS.text }}
    >
      <PageHeader
        eyebrow="Profile"
        title="Account"
        description="Manage your profile, active sessions, security history, and account recovery."
      />

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
    </Page>
  );
}
