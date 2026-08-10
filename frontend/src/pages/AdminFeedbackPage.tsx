// frontend/src/pages/AdminFeedbackPage.tsx
// Beta W7 — minimal admin triage list. The route is reachable but the API
// admin-gates it; a non-admin sees "Not authorized".
import { useEffect, useState } from 'react';
import { TOKENS, FONTS } from '../tokens';
import { listAdminFeedback, triageFeedback, type AdminFeedbackItem } from '../lib/api/feedback';
import { pushToast } from '../components/common/ToastHost';
import { Button, Card, DataState, Page, PageHeader, StatusBadge } from '../components/ui';

export default function AdminFeedbackPage() {
  const [items, setItems] = useState<AdminFeedbackItem[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load(): void {
    setError(null);
    setItems(null);
    listAdminFeedback()
      .then((r) => setItems(r.items))
      .catch((err: { status?: number }) => {
        if (err?.status === 403 || err?.status === 401) setDenied(true);
        // Anything else (5xx, network, parse) must surface an actionable,
        // retryable error — never a spinner that never resolves.
        else
          setError(
            `Could not load feedback — GET /api/admin/feedback${err?.status ? ` returned HTTP ${err.status}` : ' failed (network)'}.`,
          );
      });
  }

  useEffect(() => {
    load();
  }, []);

  async function handleTriage(id: string): Promise<void> {
    try {
      const updated = await triageFeedback(id);
      setItems((prev) => prev?.map((i) => (i.id === id ? updated : i)) ?? null);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      pushToast({
        severity: 'error',
        body: `Triage failed${status ? ` — HTTP ${status}` : ''}. Try again.`,
      });
    }
  }

  if (denied) {
    return (
      <Page width="standard">
        <DataState
          kind="error"
          title="Not authorized"
          body="Feedback triage is available to RepOS administrators."
        />
      </Page>
    );
  }

  return (
    <Page width="standard" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <PageHeader
        eyebrow="Administration"
        title="Feedback triage"
        description="Review product reports and mark resolved items without losing delivery context."
      />
      {error && (
        <DataState
          kind="error"
          title="Feedback could not be loaded"
          body={error}
          action={
            <Button variant="secondary" onClick={load}>
              Retry
            </Button>
          }
        />
      )}
      {!error && items === null && <DataState kind="loading" title="Loading…" />}
      {items?.length === 0 && (
        <DataState
          kind="empty"
          title="No feedback yet"
          body="New reports will appear here with route and delivery details."
        />
      )}
      {items?.map((i) => (
        <Card
          key={i.id}
          style={{
            padding: 14,
            opacity: i.triaged_at ? 0.55 : 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 14, color: TOKENS.text, whiteSpace: 'pre-wrap' }}>{i.body}</div>
          <div
            style={{
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
              fontFamily: FONTS.mono,
              fontSize: 11,
              color: TOKENS.textMute,
            }}
          >
            <span>{i.user_email_at_submit ?? 'unknown'}</span>
            <span>{i.route ?? '—'}</span>
            <span>{i.app_sha ?? 'dev'}</span>
            <StatusBadge tone={i.webhook_delivered_at ? 'good' : 'warning'}>
              {i.webhook_delivered_at ? 'delivered' : 'not delivered'}
            </StatusBadge>
            <span>{i.created_at}</span>
          </div>
          {!i.triaged_at && (
            <Button
              variant="secondary"
              type="button"
              onClick={() => void handleTriage(i.id)}
              style={{ alignSelf: 'flex-start' }}
            >
              Mark triaged
            </Button>
          )}
        </Card>
      ))}
    </Page>
  );
}
