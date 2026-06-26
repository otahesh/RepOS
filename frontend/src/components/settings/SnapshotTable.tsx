// frontend/src/components/settings/SnapshotTable.tsx
//
// W5 — Backups list. Desktop-primary surface (per project memory
// project_device_split.md). Mobile renders a read-only list — no
// Backup Now / Restore / Delete affordances (the action column is omitted).
//
// [ABS-2] Verified-restorable badge tiers good/warn/danger; Restore disabled
// when badge=danger; Download disabled (greyed) when badge=warn
// (I-BADGE-WARN-DOWNLOAD — file missing → 404).
//
// I-WINDOW-PROMPT — no window.prompt EVER. The Restore flow uses W6's
// ConfirmDialog (heavy tier, requireTyped="RESTORE") — the canonical
// destructive-confirm primitive. Delete uses W6's pushToast (light feedback).
import { useEffect, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { listBackups, deleteBackup, restoreBackup, type BackupItem } from '../../lib/api/backups';
import { useIsMobile } from '../../lib/useIsMobile';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { pushToast } from '../common/ToastHost';

function Badge({ tier }: { tier: BackupItem['verified_restorable'] }): JSX.Element {
  const palette = {
    good: { bg: 'rgba(107,226,139,0.15)', fg: TOKENS.good, label: 'Verified restorable' },
    warn: { bg: 'rgba(245,181,68,0.15)', fg: TOKENS.warn, label: 'Snapshot file missing on disk' },
    danger: {
      bg: 'rgba(255,106,106,0.15)',
      fg: TOKENS.danger,
      label: 'Integrity check failed — not safe to restore',
    },
  }[tier];
  return (
    <span
      aria-label={palette.label}
      title={palette.label}
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 4,
        background: palette.bg,
        color: palette.fg,
        fontFamily: FONTS.mono,
        fontSize: 10,
        letterSpacing: 1,
      }}
    >
      {tier.toUpperCase()}
    </span>
  );
}

export function SnapshotTable(): JSX.Element {
  const [items, setItems] = useState<BackupItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    listBackups()
      .then((r) => setItems(r.items))
      .catch((e: Error) =>
        setError(`Couldn't load snapshots — ${e.message}. Check API logs at /config/log/api.`),
      );
  }, []);

  const onRestoreConfirm = async (): Promise<void> => {
    if (!pendingRestoreId) return;
    const id = pendingRestoreId;
    setPendingRestoreId(null);
    try {
      await restoreBackup(id);
      pushToast({ severity: 'success', body: `Restore started from ${id}.` });
    } catch (e) {
      pushToast({ severity: 'error', body: `Restore failed — ${(e as Error).message}.` });
    }
  };

  // I-DELETE-CONFIRM — light-tier feedback via W6's ToastHost.
  const onDeleteClick = (id: string): void => {
    deleteBackup(id)
      .then(() => {
        setItems((prev) => prev.filter((x) => x.id !== id));
        pushToast({ severity: 'success', body: `Deleted ${id}.` });
      })
      .catch((e: Error) => pushToast({ severity: 'error', body: `Delete failed — ${e.message}.` }));
  };

  if (error) return <div style={{ color: TOKENS.danger }}>{error}</div>;

  return (
    <>
      <table
        style={{
          width: '100%',
          fontFamily: FONTS.ui,
          color: TOKENS.text,
          borderCollapse: 'collapse',
        }}
      >
        <thead>
          <tr style={{ textAlign: 'left', color: TOKENS.textDim, fontSize: 11 }}>
            <th style={{ textAlign: 'left', padding: '6px 8px' }}>FILE</th>
            <th style={{ padding: '6px 8px' }}>TRIGGER</th>
            <th style={{ padding: '6px 8px' }}>SIZE</th>
            <th style={{ padding: '6px 8px' }}>CREATED</th>
            <th style={{ padding: '6px 8px' }}>STATUS</th>
            {!isMobile && <th style={{ padding: '6px 8px' }}>ACTIONS</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} style={{ borderTop: `1px solid ${TOKENS.line}`, fontSize: 13 }}>
              <td style={{ padding: '8px', fontFamily: FONTS.mono, fontSize: 12 }}>{it.id}</td>
              <td style={{ padding: '8px' }}>{it.trigger}</td>
              <td style={{ padding: '8px', fontFamily: FONTS.mono }}>
                {Math.round(it.size_bytes / 1024)} KiB
              </td>
              <td style={{ padding: '8px', fontFamily: FONTS.mono, fontSize: 11 }}>
                {it.created_at}
              </td>
              <td style={{ padding: '8px' }}>
                <Badge tier={it.verified_restorable} />
              </td>
              {!isMobile && (
                <td style={{ padding: '8px', display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button
                    onClick={() => setPendingRestoreId(it.id)}
                    disabled={it.verified_restorable === 'danger'}
                  >
                    Restore
                  </button>
                  {/* I-BADGE-WARN-DOWNLOAD — disable Download when file missing on disk */}
                  {it.verified_restorable === 'warn' ? (
                    <span
                      title="File missing on disk"
                      style={{ color: TOKENS.textMute, opacity: 0.5 }}
                    >
                      Download
                    </span>
                  ) : (
                    <a href={`/api/backups/${encodeURIComponent(it.id)}/download`}>Download</a>
                  )}
                  <button onClick={() => onDeleteClick(it.id)}>Delete</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {/* I-WINDOW-PROMPT — typed-RESTORE confirm via W6's ConfirmDialog. */}
      <ConfirmDialog
        open={pendingRestoreId !== null}
        tier="heavy"
        severity="danger"
        title="Restore this snapshot?"
        body={
          pendingRestoreId
            ? `RepOS will go into maintenance mode and replace the entire database with ${pendingRestoreId}. This cannot be undone except by rolling back to the pre-restore snapshot.`
            : ''
        }
        requireTyped="RESTORE"
        confirmLabel="Confirm restore"
        onConfirm={onRestoreConfirm}
        onCancel={() => setPendingRestoreId(null)}
      />
    </>
  );
}
