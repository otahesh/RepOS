import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Composition test: the recovery-flag advisories must be reachable on Today
// for BOTH viewports (no desktop-exclusive surfaces). Children are stubbed —
// each has its own tests; this pins the page wiring only.
vi.mock('../../lib/useIsMobile');
vi.mock('../../lib/api/recoveryFlags');
vi.mock('../../components/programs/TodayCard', () => ({
  TodayCard: () => <div data-testid="today-card" />,
}));
vi.mock('../../components/programs/TodayWorkoutMobile', () => ({
  TodayWorkoutMobile: () => <div data-testid="today-mobile" />,
}));
vi.mock('../../components/MobileWeightChip', () => ({
  default: () => <div data-testid="weight-chip" />,
}));
vi.mock('../../components/dashboard/DesktopDashboard', () => ({
  default: () => <div data-testid="desktop-dashboard" />,
}));

import { useIsMobile } from '../../lib/useIsMobile';
import * as recoveryApi from '../../lib/api/recoveryFlags';
import TodayPage from '../TodayPage';

beforeEach(() => {
  vi.clearAllMocks();
  (recoveryApi.listRecoveryFlags as any).mockResolvedValue({
    flags: [{ flag: 'overreaching', message: 'Heavy week — consider a deload' }],
  });
});

describe('TodayPage recovery-flag reachability', () => {
  it('shows recovery advisories on desktop', async () => {
    (useIsMobile as any).mockReturnValue(false);
    render(<TodayPage />);
    expect(await screen.findByText(/Heavy week/)).toBeInTheDocument();
    expect(screen.getByTestId('desktop-dashboard')).toBeInTheDocument();
  });

  it('shows recovery advisories on mobile', async () => {
    (useIsMobile as any).mockReturnValue(true);
    render(<TodayPage />);
    expect(await screen.findByText(/Heavy week/)).toBeInTheDocument();
    expect(screen.getByTestId('today-mobile')).toBeInTheDocument();
  });
});
