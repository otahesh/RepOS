// frontend/src/components/programs/MyLibrary.tsx
// My Programs library — active view + Past toggle for abandoned/completed.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listMyPrograms,
  listProgramMesocycles,
  deleteUserProgram,
  archiveUserProgram,
  unarchiveUserProgram,
  ApiError,
} from '../../lib/api/userPrograms';
import type { UserProgramRecord } from '../../lib/api/programs';
import { TOKENS, FONTS } from '../../tokens';
import { Term } from '../Term';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { pushToast } from '../common/ToastHost';

type ViewTab = 'active' | 'past' | 'archived';

// ApiError carries the server's parsed JSON on `.body` ({ error: "<sentence>" }).
// Surface that human sentence in toasts instead of the raw `HTTP 409: {...}` message.
function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    const b = e.body as { error?: string } | undefined;
    if (b?.error) return b.error;
  }
  return e instanceof Error ? e.message : String(e);
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  abandoned: 'Abandoned',
  archived: 'Archived',
};

function statusColor(status: UserProgramRecord['status']): string {
  switch (status) {
    case 'active':
      return TOKENS.good;
    case 'paused':
      return TOKENS.warn;
    case 'completed':
      return TOKENS.accent;
    case 'abandoned':
      return TOKENS.textMute;
    default:
      return TOKENS.textDim;
  }
}

function ProgramCard({
  program,
  onResume,
  onOpen,
  onViewRecap,
  onArchive,
  onRestore,
  onDelete,
  faded,
  busy = false,
}: {
  program: UserProgramRecord;
  onResume?: (id: string) => void;
  onOpen?: (id: string) => void;
  onViewRecap?: (id: string) => void;
  onArchive?: (id: string) => void;
  onRestore?: (id: string) => void;
  onDelete?: (id: string) => void;
  faded: boolean;
  busy?: boolean;
}) {
  // A live run means the program is active even though its row status stays
  // 'draft' — read it as Active, not Draft.
  const badgeLabel = program.has_live_run
    ? 'Active'
    : (STATUS_LABEL[program.status] ?? program.status);
  const badgeColor = program.has_live_run ? TOKENS.good : statusColor(program.status);
  return (
    <article
      style={{
        background: faded ? 'rgba(16,20,28,0.5)' : TOKENS.surface,
        border: `1px solid ${faded ? TOKENS.line : TOKENS.lineStrong}`,
        borderRadius: 12,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        opacity: faded ? 0.65 : 1,
        transition: 'opacity 150ms',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: TOKENS.text,
              fontFamily: FONTS.ui,
            }}
          >
            {program.name}
          </h3>
        </div>
        <span
          style={{
            fontFamily: FONTS.mono,
            fontSize: 10,
            letterSpacing: 0.8,
            textTransform: 'uppercase',
            color: badgeColor,
            border: `1px solid ${badgeColor}`,
            borderRadius: 4,
            padding: '2px 6px',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {badgeLabel}
        </span>
      </header>

      <div
        style={{ fontFamily: FONTS.mono, fontSize: 10, color: TOKENS.textMute, letterSpacing: 0.5 }}
      >
        {new Date(program.created_at).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
        {onOpen && (
          <button
            onClick={() => onOpen(program.id)}
            style={{
              padding: '8px 14px',
              background: TOKENS.surface3,
              border: `1px solid ${TOKENS.lineStrong}`,
              borderRadius: 6,
              color: TOKENS.text,
              fontFamily: FONTS.ui,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            View
          </button>
        )}
        {onResume && (
          <button
            onClick={() => onResume(program.id)}
            style={{
              padding: '8px 14px',
              background: TOKENS.accentGlow,
              border: `1px solid ${TOKENS.accentDim}`,
              borderRadius: 6,
              color: TOKENS.accent,
              fontFamily: FONTS.ui,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              letterSpacing: 0.5,
            }}
          >
            Restart
          </button>
        )}
        {onViewRecap && (
          <button
            onClick={() => onViewRecap(program.id)}
            style={{
              padding: '8px 14px',
              background: TOKENS.surface3,
              border: `1px solid ${TOKENS.lineStrong}`,
              borderRadius: 6,
              color: TOKENS.text,
              fontFamily: FONTS.ui,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            View recap
          </button>
        )}
        {onRestore && (
          <button
            onClick={() => onRestore(program.id)}
            disabled={busy}
            style={{
              padding: '8px 14px',
              background: TOKENS.accentGlow,
              border: `1px solid ${TOKENS.accentDim}`,
              borderRadius: 6,
              color: TOKENS.accent,
              fontFamily: FONTS.ui,
              fontSize: 12,
              fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
              letterSpacing: 0.5,
            }}
          >
            Restore
          </button>
        )}
        {onArchive && (
          <button
            onClick={() => onArchive(program.id)}
            disabled={busy}
            style={{
              padding: '8px 14px',
              background: TOKENS.surface3,
              border: `1px solid ${TOKENS.lineStrong}`,
              borderRadius: 6,
              color: TOKENS.text,
              fontFamily: FONTS.ui,
              fontSize: 12,
              fontWeight: 500,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            Archive
          </button>
        )}
        {onDelete && (
          <button
            onClick={() => onDelete(program.id)}
            style={{
              padding: '8px 14px',
              background: 'transparent',
              border: `1px solid ${TOKENS.danger}`,
              borderRadius: 6,
              color: TOKENS.danger,
              fontFamily: FONTS.ui,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Delete
          </button>
        )}
      </div>
    </article>
  );
}

export function MyLibrary({
  onRestartProgram,
}: {
  onRestartProgram: (templateSlug: string) => void;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<ViewTab>('active');
  const [programs, setPrograms] = useState<UserProgramRecord[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [recapErr, setRecapErr] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<UserProgramRecord | null>(null);
  // Bumped after a mutation to force the current tab to refetch.
  const [reloadKey, setReloadKey] = useState(0);
  // The program id with an archive/restore in flight — guards double-fire.
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    setPrograms(null);
    setErr(null);
    setRecapErr(null);
    const opts = tab === 'archived' ? { includeArchived: true } : { includePast: tab === 'past' };
    listMyPrograms(opts)
      .then((rows) => {
        if (!ignore) setPrograms(rows);
      })
      .catch((e) => {
        if (!ignore) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      ignore = true;
    };
  }, [tab, reloadKey]);

  // Server already scopes the archived tab to archived_at IS NOT NULL, so show
  // everything it returns there. Active/Past filter client-side by status.
  const filtered =
    programs?.filter((p) => {
      if (tab === 'archived') return true;
      if (tab === 'past') return p.status === 'abandoned' || p.status === 'completed';
      return p.status !== 'abandoned' && p.status !== 'completed' && p.status !== 'archived';
    }) ?? null;

  async function handleArchive(id: string) {
    if (busyId !== null) return;
    setBusyId(id);
    try {
      await archiveUserProgram(id);
      pushToast({ severity: 'success', body: 'Program archived.' });
      setReloadKey((k) => k + 1);
    } catch (e) {
      pushToast({
        severity: 'error',
        body: `Archive failed — ${errMsg(e)}.`,
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(id: string) {
    if (busyId !== null) return;
    setBusyId(id);
    try {
      await unarchiveUserProgram(id);
      pushToast({ severity: 'success', body: 'Program restored.' });
      setReloadKey((k) => k + 1);
    } catch (e) {
      pushToast({
        severity: 'error',
        body: `Restore failed — ${errMsg(e)}.`,
      });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const prog = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteUserProgram(prog.id);
      pushToast({ severity: 'success', body: `Deleted "${prog.name}".` });
      setReloadKey((k) => k + 1);
    } catch (e) {
      pushToast({
        severity: 'error',
        body: `Delete failed — ${errMsg(e)}.`,
      });
    }
  }

  function handleOpen(_id: string) {
    // Active program → live workout page.
    navigate('/today');
  }

  async function handleViewRecap(id: string) {
    setRecapErr(null);
    try {
      const runs = await listProgramMesocycles(id);
      // Endpoint returns newest-first; the first completed run is the most
      // recent recap. (A completed program always has at least one.)
      const target = runs.find((r) => r.status === 'completed') ?? runs[0];
      if (target) navigate(`/my-programs/${target.id}`);
      else setRecapErr('No completed mesocycle for this program yet.');
    } catch (e) {
      setRecapErr(e instanceof Error ? e.message : String(e));
    }
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 16px',
    border: 'none',
    borderRadius: 6,
    fontFamily: FONTS.ui,
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    cursor: 'pointer',
    background: active ? TOKENS.surface3 : 'transparent',
    color: active ? TOKENS.text : TOKENS.textDim,
    borderBottom: active ? `2px solid ${TOKENS.accent}` : '2px solid transparent',
  });

  return (
    <section style={{ padding: '0 0 24px', fontFamily: FONTS.ui }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 700,
            color: TOKENS.text,
            letterSpacing: -0.3,
          }}
        >
          My Programs
        </h2>
        <div
          style={{
            display: 'flex',
            gap: 2,
            background: TOKENS.surface,
            border: `1px solid ${TOKENS.line}`,
            borderRadius: 8,
            padding: 3,
          }}
        >
          <button style={tabStyle(tab === 'active')} onClick={() => setTab('active')}>
            Active
          </button>
          <button style={tabStyle(tab === 'past')} onClick={() => setTab('past')}>
            Past
          </button>
          <button style={tabStyle(tab === 'archived')} onClick={() => setTab('archived')}>
            Archived
          </button>
        </div>
      </div>

      {err && (
        <div style={{ color: TOKENS.danger, fontSize: 13, padding: '8px 0' }}>
          Couldn't load programs: {err}
        </div>
      )}

      {recapErr && (
        <div style={{ color: TOKENS.danger, fontSize: 13, padding: '8px 0' }}>
          Couldn't load recap stats: {recapErr}
        </div>
      )}

      {!err && !filtered && <div style={{ color: TOKENS.textDim, fontSize: 13 }}>Loading…</div>}

      {!err && filtered && filtered.length === 0 && (
        <div style={{ color: TOKENS.textMute, fontSize: 13, padding: '16px 0' }}>
          {tab === 'archived' ? (
            'No archived programs. Archive a program to tuck it away here — it stays restorable.'
          ) : tab === 'past' ? (
            'No past programs yet. Abandoned or completed programs appear here.'
          ) : (
            <>
              No active programs. Pick a <Term k="mesocycle" /> template below to get started.
            </>
          )}
        </div>
      )}

      {!err && filtered && filtered.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 12,
          }}
        >
          {filtered.map((p) => (
            <ProgramCard
              key={p.id}
              program={p}
              faded={tab !== 'active'}
              busy={busyId === p.id}
              onOpen={tab === 'active' ? handleOpen : undefined}
              onResume={
                tab === 'past' && p.template_slug
                  ? () => onRestartProgram(p.template_slug!)
                  : undefined
              }
              onViewRecap={
                tab === 'past' && p.status === 'completed'
                  ? (id) => void handleViewRecap(id)
                  : undefined
              }
              onArchive={
                tab !== 'archived' && !p.has_live_run ? (id) => void handleArchive(id) : undefined
              }
              onRestore={tab === 'archived' ? (id) => void handleRestore(id) : undefined}
              onDelete={(id) => setPendingDelete(programs?.find((x) => x.id === id) ?? null)}
            />
          ))}
        </div>
      )}

      {/* Medium tier by product decision (2026-07-06): gym-program data isn't
          critical enough to justify typed-name friction — a plain confirm is
          enough. */}
      <ConfirmDialog
        open={pendingDelete !== null}
        tier="medium"
        severity="danger"
        title="Delete this program?"
        body={
          pendingDelete
            ? `This permanently deletes "${pendingDelete.name}" and all of its logged sets and mesocycle history. This cannot be undone.${
                pendingDelete.has_live_run
                  ? ' This program has an in-progress mesocycle that will be ended.'
                  : ''
              }`
            : ''
        }
        confirmLabel="Delete program"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
