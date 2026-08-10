import { TOKENS, FONTS } from '../../tokens';
import Icon from '../Icon';
import { formatShortDate } from '../../lib/formatDate';
import { useIsBelowTablet } from '../../lib/useIsMobile';
import { Button, DataState } from '../ui';

export interface TokenRow {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

interface Props {
  tokens: TokenRow[];
  onRevoke: (id: string) => void;
  revoking: string | null;
}

function formatDate(isoString: string | null): string {
  if (!isoString) return 'Never';
  return formatShortDate(new Date(isoString), { year: true });
}

export default function TokenTable({ tokens, onRevoke, revoking }: Props) {
  const isCompact = useIsBelowTablet();
  if (tokens.length === 0) {
    return (
      <DataState
        title="No access tokens"
        body="Generate one to connect your Shortcut. The secret is shown once."
      />
    );
  }

  if (isCompact) {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        {tokens.map((token) => (
          <article key={token.id} className="repos-data-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="key" size={15} color={TOKENS.accent} />
              <strong style={{ color: TOKENS.text, fontSize: 14 }}>{token.label}</strong>
            </div>
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: '88px minmax(0, 1fr)',
                gap: '6px 10px',
                margin: 0,
                color: TOKENS.textDim,
                fontFamily: FONTS.mono,
                fontSize: 10,
              }}
            >
              <dt>Created</dt>
              <dd style={{ margin: 0 }}>{formatDate(token.created_at)}</dd>
              <dt>Last used</dt>
              <dd style={{ margin: 0 }}>{formatDate(token.last_used_at)}</dd>
            </dl>
            <Button
              variant="danger"
              onClick={() => onRevoke(token.id)}
              disabled={revoking === token.id}
            >
              <Icon name="trash" size={13} color={TOKENS.danger} />
              {revoking === token.id ? 'Revoking…' : 'Revoke token'}
            </Button>
          </article>
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        background: TOKENS.bg,
        borderRadius: 8,
        border: `1px solid ${TOKENS.line}`,
        overflowX: 'auto',
      }}
    >
      {/* Table header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 140px 140px 80px',
          padding: '8px 16px',
          borderBottom: `1px solid ${TOKENS.line}`,
          minWidth: 480,
        }}
      >
        {['LABEL', 'CREATED', 'LAST USED', ''].map((col) => (
          <div
            key={col}
            style={{
              fontFamily: FONTS.mono,
              fontSize: 9,
              color: TOKENS.textMute,
              letterSpacing: 1.2,
            }}
          >
            {col}
          </div>
        ))}
      </div>

      {/* Rows */}
      {tokens.map((token, i) => (
        <div
          key={token.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 140px 140px 80px',
            padding: '12px 16px',
            alignItems: 'center',
            borderTop: i > 0 ? `1px solid ${TOKENS.line}` : 'none',
            background: 'transparent',
            minWidth: 480,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="key" size={13} color={TOKENS.textMute} />
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: TOKENS.text,
                }}
              >
                {token.label}
              </div>
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 10,
                  color: TOKENS.textMute,
                  marginTop: 1,
                }}
              >
                ••••••••••••••••
              </div>
            </div>
          </div>

          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 11,
              color: TOKENS.textDim,
            }}
          >
            {formatDate(token.created_at)}
          </div>

          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 11,
              color: token.last_used_at ? TOKENS.textDim : TOKENS.textMute,
            }}
          >
            {formatDate(token.last_used_at)}
          </div>

          <div>
            <Button
              variant="danger"
              onClick={() => onRevoke(token.id)}
              disabled={revoking === token.id}
              style={{
                minHeight: 34,
                paddingInline: 10,
              }}
            >
              <Icon name="trash" size={10} color={TOKENS.danger} />
              {revoking === token.id ? '...' : 'Revoke'}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
