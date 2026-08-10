// frontend/src/components/settings/SnapshotTable.tsx
//
// Backups list. Desktop uses a dense table; phone and tablet use cards. Every
// action is reachable in both compositions.
//
// [ABS-2] Verified-restorable badge tiers good/warn/danger; Restore disabled
// when badge=danger; Download disabled (greyed) when badge=warn
// (I-BADGE-WARN-DOWNLOAD — file missing → 404).
//
// I-WINDOW-PROMPT — no window.prompt EVER. The Restore flow uses W6's
// ConfirmDialog (heavy tier, requireTyped="RESTORE") — the canonical
// destructive-confirm primitive. Delete uses W6's pushToast (light feedback).
import { useCallback, useEffect, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { listBackups, deleteBackup, restoreBackup, type BackupItem } from '../../lib/api/backups';
import { useIsBelowTablet } from '../../lib/useIsMobile';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { pushToast } from '../common/ToastHost';
import { Button, DataState } from '../ui';

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
  const [items, setItems] = useState<BackupItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const isCompact = useIsBelowTablet();

  const load = useCallback(() => {
    setError(null);
    setItems(null);
    listBackups()
      .then((r) => setItems(r.items))
      .catch((e: Error) =>
        setError(`Couldn't load snapshots — ${e.message}. Check API logs at /config/log/api.`),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  const onDeleteConfirm = async (): Promise<void> => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    await deleteBackup(id)
      .then(() => {
        setItems((prev) => (prev ?? []).filter((x) => x.id !== id));
        pushToast({ severity: 'success', body: `Deleted ${id}.` });
      })
      .catch((e: Error) => pushToast({ severity: 'error', body: `Delete failed — ${e.message}.` }));
  };

  if (error) {
    return (
      <DataState
        kind="error"
        title="Backups could not be loaded"
        body={error}
        action={
          <Button variant="secondary" onClick={load}>
            Retry
          </Button>
        }
      />
    );
  }

  if (items === null) return <DataState kind="loading" title="Loading backups" />;

  if (items.length === 0) {
    return (
      <DataState
        title="No snapshots yet"
        body="Create a backup before a major program, integration, or administration change."
      />
    );
  }

  return (
    <>
      {isCompact ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {items.map((it) => (
            <article key={it.id} className="repos-data-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <strong
                  style={{
                    minWidth: 0,
                    overflowWrap: 'anywhere',
                    fontFamily: FONTS.mono,
                    fontSize: 12,
                  }}
                >
                  {it.id}
                </strong>
                <Badge tier={it.verified_restorable} />
              </div>
              <dl
                style={{
                  margin: 0,
                  display: 'grid',
                  gridTemplateColumns: '86px minmax(0, 1fr)',
                  gap: '7px 12px',
                  color: TOKENS.textDim,
                  fontSize: 12,
                }}
              >
                <dt>Trigger</dt>
                <dd style={{ margin: 0 }}>{it.trigger}</dd>
                <dt>Size</dt>
                <dd style={{ margin: 0, fontFamily: FONTS.mono }}>
                  {Math.round(it.size_bytes / 1024)} KiB
                </dd>
                <dt>Created</dt>
                <dd style={{ margin: 0, fontFamily: FONTS.mono }}>{it.created_at}</dd>
              </dl>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <Button
                  variant="warning"
                  onClick={() => setPendingRestoreId(it.id)}
                  disabled={it.verified_restorable === 'danger'}
                >
                  Restore
                </Button>
                {it.verified_restorable === 'warn' ? (
                  <span className="repos-button repos-button--quiet" aria-disabled="true">
                    Download unavailable
                  </span>
                ) : (
                  <a
                    className="repos-button repos-button--secondary"
                    href={`/api/backups/${encodeURIComponent(it.id)}/download`}
                  >
                    Download
                  </a>
                )}
                <Button variant="danger" onClick={() => setPendingDeleteId(it.id)}>
                  Delete
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: `1px solid ${TOKENS.line}`, borderRadius: 12 }}>
          <table
            style={{
              width: '100%',
              minWidth: 840,
              fontFamily: FONTS.ui,
              color: TOKENS.text,
              borderCollapse: 'collapse',
            }}
          >
            <thead>
              <tr style={{ textAlign: 'left', color: TOKENS.textDim, fontSize: 11 }}>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>FILE</th>
                <th style={{ padding: '10px 12px' }}>TRIGGER</th>
                <th style={{ padding: '10px 12px' }}>SIZE</th>
                <th style={{ padding: '10px 12px' }}>CREATED</th>
                <th style={{ padding: '10px 12px' }}>STATUS</th>
                <th style={{ padding: '10px 12px' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} style={{ borderTop: `1px solid ${TOKENS.line}`, fontSize: 13 }}>
                  <td style={{ padding: 12, fontFamily: FONTS.mono, fontSize: 12 }}>{it.id}</td>
                  <td style={{ padding: 12 }}>{it.trigger}</td>
                  <td style={{ padding: 12, fontFamily: FONTS.mono }}>
                    {Math.round(it.size_bytes / 1024)} KiB
                  </td>
                  <td style={{ padding: 12, fontFamily: FONTS.mono, fontSize: 11 }}>
                    {it.created_at}
                  </td>
                  <td style={{ padding: 12 }}>
                    <Badge tier={it.verified_restorable} />
                  </td>
                  <td style={{ padding: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Button
                      variant="warning"
                      onClick={() => setPendingRestoreId(it.id)}
                      disabled={it.verified_restorable === 'danger'}
                    >
                      Restore
                    </Button>
                    {/* I-BADGE-WARN-DOWNLOAD — disable Download when file missing on disk */}
                    {it.verified_restorable === 'warn' ? (
                      <span
                        title="File missing on disk"
                        style={{ color: TOKENS.textMute, opacity: 0.5 }}
                      >
                        Download
                      </span>
                    ) : (
                      <a
                        className="repos-button repos-button--quiet"
                        href={`/api/backups/${encodeURIComponent(it.id)}/download`}
                      >
                        Download
                      </a>
                    )}
                    <Button variant="danger" onClick={() => setPendingDeleteId(it.id)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
      <ConfirmDialog
        open={pendingDeleteId !== null}
        tier="medium"
        severity="danger"
        title="Delete this snapshot?"
        body={
          pendingDeleteId
            ? `${pendingDeleteId} will be permanently removed. It cannot be used for download or recovery afterward.`
            : ''
        }
        confirmLabel="Delete snapshot"
        onConfirm={() => void onDeleteConfirm()}
        onCancel={() => setPendingDeleteId(null)}
      />
    </>
  );
}
