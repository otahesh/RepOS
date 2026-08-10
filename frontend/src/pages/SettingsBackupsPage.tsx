// frontend/src/pages/SettingsBackupsPage.tsx
//
// Backup management uses different compositions across breakpoints, but every
// mutation remains available on every device.
//
// Per memory feedback_user_reachability_dod: this page is reachable from `/`
// in 2 clicks (Settings nav → Backups sub-nav). Sidebar entry: W5 flips the
// pre-provisioned Backups slot in SETTINGS_SECTIONS to enabled.
import { useState } from 'react';
import { FONTS, TOKENS } from '../tokens';
import { SnapshotTable } from '../components/settings/SnapshotTable';
import { createBackup } from '../lib/api/backups';
import { pushToast } from '../components/common/ToastHost';
import { Button, Page, PageHeader } from '../components/ui';

export default function SettingsBackupsPage(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

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
    <Page width="data" style={{ fontFamily: FONTS.ui, color: TOKENS.text }}>
      <PageHeader
        eyebrow="Data and integrations"
        title="Backups"
        description="Snapshots live in /config/backups. Nightly automatic backup runs at 03:15 UTC."
        actions={
          <Button variant="primary" onClick={onBackupNow} disabled={busy}>
            {busy ? 'Backing up…' : 'Backup now'}
          </Button>
        }
      />
      <div>
        <SnapshotTable key={refreshKey} />
      </div>
    </Page>
  );
}
