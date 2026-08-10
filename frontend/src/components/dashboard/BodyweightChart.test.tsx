import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BodyweightChart from './BodyweightChart';

const stats = {
  trend_7d_lbs: -0.4,
  trend_30d_lbs: -1.2,
  trend_90d_lbs: -2.8,
  adherence_pct: 92,
  missed_days: [],
};

describe('<BodyweightChart>', () => {
  it('labels the selected range and derives mixed sources from returned samples', () => {
    render(
      <BodyweightChart
        range="30d"
        current={{ weight_lbs: 182.4, date: '2026-08-10', time: '08:00:00' }}
        stats={stats}
        samples={[
          { date: '2026-08-09', weight_lbs: 182.8, source: 'Apple Health' },
          { date: '2026-08-10', weight_lbs: 182.4, source: 'Manual' },
        ]}
      />,
    );

    expect(screen.getByText('BODYWEIGHT · 30D · MIXED SOURCES')).toBeInTheDocument();
    expect(screen.getByText('RAW MEASUREMENTS')).toBeInTheDocument();
    expect(screen.queryByText(/GOAL 180/i)).not.toBeInTheDocument();
  });

  it('shows a goal only when a configured value is supplied', () => {
    render(
      <BodyweightChart
        range="7d"
        goalLbs={181}
        current={{ weight_lbs: 182.4, date: '2026-08-10', time: '08:00:00' }}
        stats={stats}
        samples={[
          { date: '2026-08-09', weight_lbs: 182.8, source: 'Apple Health' },
          { date: '2026-08-10', weight_lbs: 182.4, source: 'Apple Health' },
        ]}
      />,
    );

    expect(screen.getByText('BODYWEIGHT · 7D · APPLE HEALTH')).toBeInTheDocument();
    expect(screen.getByText('GOAL 181.0 lb')).toBeInTheDocument();
  });
});
