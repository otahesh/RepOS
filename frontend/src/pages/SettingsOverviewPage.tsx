import { Link } from 'react-router-dom';
import { useCurrentUser } from '../auth';
import Icon from '../components/Icon';
import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from '../components/settings/SettingsSidebar';
import { Page, PageHeader } from '../components/ui';
import { FONTS, TOKENS } from '../tokens';

const DESCRIPTIONS: Record<string, string> = {
  Account: 'Profile, security, active sessions, and account recovery.',
  Health: 'Readiness screening and clinical advisory state.',
  Injuries: 'Joint constraints used by exercise recommendations.',
  Equipment: 'Available equipment and substitution constraints.',
  'Program prefs': 'Volume landmarks and training preferences.',
  Integrations: 'Health sync credentials and connected data sources.',
  Backups: 'Create, verify, download, restore, and delete snapshots.',
  Storage: 'Local queue health and storage diagnostics.',
  Feedback: 'Send product feedback and review its state.',
  Users: 'Invite, synchronize, suspend, reinstate, and delete users.',
};

export default function SettingsOverviewPage() {
  const { user } = useCurrentUser();
  const visibleSections = SETTINGS_SECTIONS.filter(
    (section) => !section.adminOnly || user?.is_admin,
  );

  return (
    <Page width="wide">
      <PageHeader
        eyebrow="Settings"
        title="Control your RepOS workspace"
        description="Training, data, security, and recovery controls remain available on every device."
      />

      <div style={{ display: 'grid', gap: 28 }}>
        {SETTINGS_GROUPS.map((group) => {
          const sections = visibleSections.filter((section) => section.group === group);
          if (sections.length === 0) return null;
          const headingId = `settings-${group.replace(/ /g, '-').toLowerCase()}`;
          return (
            <section key={group} aria-labelledby={headingId}>
              <h2
                id={headingId}
                style={{
                  margin: '0 0 10px',
                  color: TOKENS.textDim,
                  fontFamily: FONTS.mono,
                  fontSize: 10,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                }}
              >
                {group}
              </h2>
              <div className="repos-grid-2">
                {sections.map((section) => (
                  <Link
                    key={section.to}
                    to={section.to}
                    className="repos-card repos-card--interactive"
                    style={{
                      minHeight: 112,
                      display: 'grid',
                      gridTemplateColumns: '44px minmax(0, 1fr) 24px',
                      alignItems: 'center',
                      gap: 12,
                      padding: 16,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 10,
                        display: 'grid',
                        placeItems: 'center',
                        background: TOKENS.accentGlow,
                        color: TOKENS.accent,
                      }}
                    >
                      <Icon
                        name={section.label === 'Feedback' ? 'feedback' : 'settings'}
                        size={18}
                      />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block', color: TOKENS.text, fontSize: 15 }}>
                        {section.label}
                      </strong>
                      <span
                        style={{
                          display: 'block',
                          marginTop: 4,
                          color: TOKENS.textDim,
                          fontSize: 12,
                          lineHeight: 1.4,
                        }}
                      >
                        {DESCRIPTIONS[section.label]}
                      </span>
                    </span>
                    <Icon name="chevron" size={18} color={TOKENS.textMute} />
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </Page>
  );
}
