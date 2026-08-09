// frontend/src/pages/SettingsFeedbackPage.tsx
// Beta W7 — full-page feedback host in Settings. Admins also get a link to the
// triage view (gated client-side by is_admin; the API enforces it server-side).
import { Link } from 'react-router-dom';
import { TOKENS, FONTS } from '../tokens';
import { useCurrentUser } from '../auth';
import { FeedbackForm } from '../components/feedback/FeedbackForm';

export default function SettingsFeedbackPage() {
  const { user } = useCurrentUser();
  return (
    <div
      style={{
        maxWidth: 560,
        margin: '0 auto',
        padding: '24px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontFamily: FONTS.ui, color: TOKENS.text }}>
          Feedback
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: TOKENS.textDim }}>
          Found a bug or have an idea? Tell us — it goes straight to the team.
        </p>
      </header>
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
    </div>
  );
}
