import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DesktopDashboard from './DesktopDashboard';
import type { WeightRangeResponse } from '../../lib/api/health';

// apiFetch is the only external dependency — mock it via vi.hoisted so the
// factory can reference the spy.
const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('../../auth', () => ({ apiFetch: apiFetchMock }));

// Isolate the range-selector logic from the chart/stats presentation (and from
// recharts' jsdom layout warnings).
vi.mock('./BodyweightChart', () => ({ default: () => <div data-testid="chart" /> }));
vi.mock('./TrendStats', () => ({ default: () => <div data-testid="trendstats" /> }));

function weightResponse(): WeightRangeResponse {
  return {
    current: { weight_lbs: 293, date: '2026-06-26', time: '08:00:00' },
    samples: [
      { date: '2026-06-01', weight_lbs: 295, source: 'Apple Health' },
      { date: '2026-06-26', weight_lbs: 293, source: 'Apple Health' },
    ],
    stats: {
      trend_7d_lbs: -1,
      trend_30d_lbs: -2,
      trend_90d_lbs: -3,
      adherence_pct: 80,
      missed_days: [],
    },
    sync: { source: 'Apple Health', last_success_at: '2026-06-26T08:00:00Z', state: 'fresh' },
  };
}

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function fetchedRanges(): string[] {
  return apiFetchMock.mock.calls.map((c) => String(c[0]));
}

describe('<DesktopDashboard> range selector', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue(okResponse(weightResponse()));
  });

  it('fetches 90d by default and marks 90D as the selected range', async () => {
    render(<DesktopDashboard />);
    await waitFor(() => expect(screen.getByTestId('chart')).toBeInTheDocument());
    expect(fetchedRanges()).toContain('/api/health/weight?range=90d');
    expect(screen.getByRole('button', { name: '90D' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '7D' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking a range button refetches with that range and updates the selection', async () => {
    const user = userEvent.setup();
    render(<DesktopDashboard />);
    await waitFor(() => expect(screen.getByTestId('chart')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '30D' }));

    await waitFor(() => expect(fetchedRanges()).toContain('/api/health/weight?range=30d'));
    expect(screen.getByRole('button', { name: '30D' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '90D' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('supports every range option (7d/30d/90d/1y/all)', async () => {
    const user = userEvent.setup();
    render(<DesktopDashboard />);
    await waitFor(() => expect(screen.getByTestId('chart')).toBeInTheDocument());

    for (const [label, range] of [
      ['7D', '7d'],
      ['1Y', '1y'],
      ['ALL', 'all'],
    ] as const) {
      await user.click(screen.getByRole('button', { name: label }));
      await waitFor(() => expect(fetchedRanges()).toContain(`/api/health/weight?range=${range}`));
    }
  });
});
