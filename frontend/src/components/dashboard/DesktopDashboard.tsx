import { useEffect, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { apiFetch } from '../../auth';
import BodyweightChart from './BodyweightChart';
import TrendStats from './TrendStats';
import type { WeightRange, WeightRangeResponse } from '../../lib/api/health';

type WeightData = WeightRangeResponse;

const RANGES: readonly WeightRange[] = ['7d', '30d', '90d', '1y', 'all'];

export default function DesktopDashboard() {
  const [data, setData] = useState<WeightData | null>(null);
  const [range, setRange] = useState<WeightRange>('90d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Refetch whenever the selected range changes. The `cancelled` flag makes the
  // effect race-safe: switching range quickly discards a previous, possibly
  // out-of-order response instead of letting it clobber the latest selection.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch(`/api/health/weight?range=${range}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: WeightData = await res.json();
        if (cancelled) return;
        setData(json);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  // Full-screen loader only on the initial load. Range switches keep the
  // existing chart visible (dimmed) so the layout doesn't flash.
  if (loading && !data) {
    return (
      <div
        style={{
          padding: '40px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
        }}
      >
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 12,
            color: TOKENS.textMute,
            letterSpacing: 1.2,
          }}
        >
          LOADING...
        </div>
      </div>
    );
  }

  const hasData = data && data.samples && data.samples.length > 0;

  return (
    <div
      style={{
        padding: '24px 32px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        minHeight: '100%',
      }}
    >
      {/* Page header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              color: TOKENS.textMute,
              letterSpacing: 1.4,
              marginBottom: 4,
            }}
          >
            HEALTH · BODYWEIGHT
          </div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: -0.4,
              color: TOKENS.text,
            }}
          >
            Weight Tracking
          </h1>
        </div>
        <div role="group" aria-label="Chart date range" style={{ display: 'flex', gap: 8 }}>
          {RANGES.map((r) => {
            const selected = r === range;
            return (
              <button
                key={r}
                type="button"
                aria-pressed={selected}
                onClick={() => setRange(r)}
                style={{
                  height: 32,
                  padding: '0 12px',
                  borderRadius: 6,
                  border: `1px solid ${selected ? TOKENS.accent : TOKENS.line}`,
                  background: selected ? TOKENS.accentGlow : 'transparent',
                  color: selected ? TOKENS.accent : TOKENS.textDim,
                  fontFamily: FONTS.mono,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: 0.4,
                  cursor: 'pointer',
                }}
              >
                {r.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div
          style={{
            background: `rgba(255, 106, 106, 0.1)`,
            border: `1px solid ${TOKENS.danger}`,
            borderRadius: 10,
            padding: '12px 16px',
            fontFamily: FONTS.mono,
            fontSize: 12,
            color: TOKENS.danger,
            letterSpacing: 0.4,
          }}
        >
          API ERROR: {error}
        </div>
      )}

      {/* Empty state */}
      {!hasData && !error && (
        <div
          style={{
            background: TOKENS.surface,
            borderRadius: 12,
            border: `1px solid ${TOKENS.line}`,
            padding: '48px 32px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              color: TOKENS.textMute,
              letterSpacing: 1.4,
            }}
          >
            NO DATA YET
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: TOKENS.textDim,
              letterSpacing: -0.3,
            }}
          >
            No weight data yet. Set up Apple Health sync in Settings.
          </div>
          <a
            href="/settings/integrations"
            style={{
              marginTop: 8,
              height: 36,
              padding: '0 16px',
              borderRadius: 8,
              border: 'none',
              background: TOKENS.accent,
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              fontFamily: FONTS.ui,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 0.3,
              textTransform: 'uppercase',
              textDecoration: 'none',
            }}
          >
            SET UP APPLE HEALTH
          </a>
        </div>
      )}

      {/* Data views */}
      {hasData && data && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            opacity: loading ? 0.5 : 1,
            transition: 'opacity 0.15s ease',
          }}
        >
          <TrendStats
            stats={
              data.stats ?? {
                trend_7d_lbs: null,
                trend_30d_lbs: null,
                trend_90d_lbs: null,
                adherence_pct: null,
                missed_days: [],
              }
            }
            current={data.current}
          />
          <BodyweightChart
            samples={data.samples}
            current={data.current}
            stats={data.stats ?? null}
          />
        </div>
      )}
    </div>
  );
}
