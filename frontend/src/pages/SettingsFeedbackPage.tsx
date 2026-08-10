// frontend/src/pages/SettingsFeedbackPage.tsx
// Beta W7 — full-page feedback host in Settings. Admins also get a link to the
// triage view (gated client-side by is_admin; the API enforces it server-side).
import { Link } from 'react-router-dom';
import { TOKENS, FONTS } from '../tokens';
import { useCurrentUser } from '../auth';
import { FeedbackForm } from '../components/feedback/FeedbackForm';
import { Page, PageHeader } from '../components/ui';

export default function SettingsFeedbackPage() {
  const { user } = useCurrentUser();
  return (
    <Page
      width="narrow"
      style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: FONTS.ui }}
    >
      <PageHeader
        eyebrow="Administration"
        title="Feedback"
        description="Found a bug or have an idea? Send the details directly to the team."
      />
      <section
        style={{
          background: TOKENS.surface,
          border: `1px solid ${TOKENS.line}`,
          borderRadius: 12,
          padding: 20,
        }}
      >
        <FeedbackForm />
      </section>
      {user?.is_admin && (
        <Link
          to="/admin/feedback"
          style={{ color: TOKENS.accent, fontSize: 13, fontFamily: FONTS.mono, letterSpacing: 0.4 }}
        >
          VIEW ALL FEEDBACK →
        </Link>
      )}
    </Page>
  );
}
