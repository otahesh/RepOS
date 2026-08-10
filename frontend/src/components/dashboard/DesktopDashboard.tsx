import { useEffect, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { apiFetch } from '../../auth';
import BodyweightChart from './BodyweightChart';
import TrendStats from './TrendStats';
import type { WeightRange, WeightRangeResponse } from '../../lib/api/health';
import { Button, DataState, SegmentedControl } from '../ui';

type WeightData = WeightRangeResponse;

const RANGES: readonly WeightRange[] = ['7d', '30d', '90d', '1y', 'all'];

export default function DesktopDashboard() {
  const [data, setData] = useState<WeightData | null>(null);
  const [range, setRange] = useState<WeightRange>('90d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

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
      .catch(() => {
        if (cancelled) return;
        setError('Weight data could not be refreshed. Your existing measurements are unchanged.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, retryKey]);

  // Full-screen loader only on the initial load. Range switches keep the
  // existing chart visible (dimmed) so the layout doesn't flash.
  if (loading && !data) {
    return <DataState kind="loading" title="Loading bodyweight progress" />;
  }

  const hasData = data && data.samples && data.samples.length > 0;

  return (
    <div
      className="repos-card"
      style={{
        padding: 20,
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
          <h3
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: -0.4,
              color: TOKENS.text,
            }}
          >
            Bodyweight
          </h3>
        </div>
        <SegmentedControl
          label="Chart date range"
          value={range}
          options={RANGES.map((value) => ({ value, label: value.toUpperCase() }))}
          onChange={setRange}
        />
      </div>

      {/* Error state */}
      {error && (
        <div
          role="alert"
          style={{
            background: `rgba(255, 106, 106, 0.1)`,
            border: `1px solid ${TOKENS.danger}`,
            borderRadius: 10,
            padding: '12px 16px',
            fontFamily: FONTS.ui,
            fontSize: 13,
            color: TOKENS.danger,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span>{error}</span>
          <Button
            type="button"
            variant="danger"
            onClick={() => setRetryKey((key) => key + 1)}
            disabled={loading}
          >
            {loading ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      )}

      {/* Empty state */}
      {!hasData && !error && (
        <DataState
          title="No bodyweight data yet"
          body="Connect a source or add a manual measurement to begin tracking trends."
          action={
            <a className="repos-button repos-button--primary" href="/settings/integrations">
              Set up an integration
            </a>
          }
        />
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
            range={range}
          />
        </div>
      )}
    </div>
  );
}
