// frontend/src/pages/SettingsBackupsPage.tsx
//
// W5 — desktop-primary backups page. Mobile renders the snapshot table
// read-only (no Backup Now / Restore / Delete affordances). The maintenance
// banner is wired in AppShell, not here, so it surfaces across every page
// when the flag is set.
//
// Per memory feedback_user_reachability_dod: this page is reachable from `/`
// in 2 clicks (Settings nav → Backups sub-nav). Sidebar entry: W5 flips the
// pre-provisioned Backups slot in SETTINGS_SECTIONS to enabled.
import { useState } from 'react';
import { FONTS, TOKENS } from '../tokens';
import { SnapshotTable } from '../components/settings/SnapshotTable';
import { createBackup } from '../lib/api/backups';
import { useIsMobile } from '../lib/useIsMobile';
import { pushToast } from '../components/common/ToastHost';

export default function SettingsBackupsPage(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const isMobile = useIsMobile();

  const onBackupNow = async (): Promise<void> => {
    setBusy(true);
    try {
      const created = await createBackup();
      pushToast({ severity: 'success', body: `Backup created: ${created.id}.` });
      setRefreshKey((k) => k + 1); // remount SnapshotTable → refetch the list
    } catch (e) {
      pushToast({
        severity: 'error',
        body: `Backup failed — ${(e as Error).message}. Check API logs at /config/log/api.`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ padding: 16, color: TOKENS.text, fontFamily: FONTS.ui }}>
      <h1 style={{ fontSize: 22, marginBottom: 12 }}>Backups</h1>
      {!isMobile && (
        <>
          <p style={{ color: TOKENS.textDim, fontSize: 13, marginBottom: 16 }}>
            Snapshots live in /config/backups. Nightly auto-backup runs at 03:15 UTC.
          </p>
          <button onClick={onBackupNow} disabled={busy}>
            {busy ? 'Backing up…' : 'Backup now'}
          </button>
        </>
      )}
      <div style={{ marginTop: 24 }}>
        <SnapshotTable key={refreshKey} />
        {/* I-MOBILE-AFFORDANCE — message lives inline below the table (row
            footer), NOT as a banner above. SnapshotTable omits the action
            column on mobile; the page adds the trailing footer note. */}
        {isMobile && (
          <p
            style={{
              color: TOKENS.textDim,
              fontSize: 12,
              marginTop: 8,
              paddingTop: 8,
              borderTop: `1px solid ${TOKENS.line}`,
              textAlign: 'center',
            }}
          >
            Backups must be managed from desktop. Tap "Settings → Backups" on desktop to take or
            restore a snapshot.
          </p>
        )}
      </div>
    </main>
  );
}
