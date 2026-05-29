// frontend/src/lib/api/feedback.ts
// Beta W7 — typed client for the feedback surfaces. State-changing calls carry
// X-RepOS-CSRF:1 (the csrfOrigin middleware requires it on the CF Access path).
import { apiFetch } from '../../auth';
import { jsonOrThrow } from './_http';

export type FeedbackSubmit = { body: string; route?: string };
export type FeedbackCreated = { id: string };

export async function submitFeedback(input: FeedbackSubmit): Promise<FeedbackCreated> {
  const res = await apiFetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-RepOS-CSRF': '1' },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<FeedbackCreated>(res);
}

export type AdminFeedbackItem = {
  id: string;
  body: string;
  route: string | null;
  app_sha: string | null;
  user_email_at_submit: string | null;
  created_at: string;
  triaged_at: string | null;
  webhook_delivered_at: string | null;
};

export async function listAdminFeedback(): Promise<{ items: AdminFeedbackItem[] }> {
  const res = await apiFetch('/api/admin/feedback');
  return jsonOrThrow<{ items: AdminFeedbackItem[] }>(res);
}

export async function triageFeedback(id: string): Promise<AdminFeedbackItem> {
  const res = await apiFetch(`/api/admin/feedback/${id}/triage`, {
    method: 'PATCH',
    headers: { 'X-RepOS-CSRF': '1' },
  });
  return jsonOrThrow<AdminFeedbackItem>(res);
}
