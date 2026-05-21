import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgramPage } from './ProgramPage';
import * as mesoApi from '../../lib/api/mesocycles';

describe('<ProgramPage>', () => {
  beforeEach(() => {
    vi.spyOn(mesoApi, 'getMesocycle').mockResolvedValue({
      id: 'mr-1', user_program_id: 'up-1', start_date: '2026-05-05', start_tz: 'America/Indiana/Indianapolis',
      weeks: 5, current_week: 2, status: 'active',
    });
    vi.spyOn(mesoApi, 'getVolumeRollup').mockResolvedValue({
      run_id: 'mr-1',
      weeks: [
        { week_idx: 1, muscles: [{ muscle: 'chest', sets: 10, performed_sets: 0, mev: 10, mav: 14, mrv: 22 }], minutes_by_modality: {} },
        { week_idx: 2, muscles: [{ muscle: 'chest', sets: 12, performed_sets: 0, mev: 10, mav: 14, mrv: 22 }], minutes_by_modality: {} },
        { week_idx: 3, muscles: [{ muscle: 'chest', sets: 14, performed_sets: 0, mev: 10, mav: 14, mrv: 22 }], minutes_by_modality: {} },
        { week_idx: 4, muscles: [{ muscle: 'chest', sets: 16, performed_sets: 0, mev: 10, mav: 14, mrv: 22 }], minutes_by_modality: {} },
        { week_idx: 5, muscles: [{ muscle: 'chest', sets: 5, performed_sets: 0, mev: 10, mav: 14, mrv: 22 }], minutes_by_modality: {} },
      ],
    });
  });
  it('renders 5×N heatmap with current week marker', async () => {
    render(<ProgramPage mesocycleRunId="mr-1" />);
    expect(await screen.findByTestId('heatmap-row-chest')).toBeInTheDocument();
    expect(screen.getByText(/Week 2/)).toBeInTheDocument();
  });

  it('shows logged/planned in heatmap cell once performed_sets > 0', async () => {
    vi.spyOn(mesoApi, 'getVolumeRollup').mockResolvedValue({
      run_id: 'mr-1',
      weeks: [
        { week_idx: 1, muscles: [{ muscle: 'chest', sets: 10, performed_sets: 4, mev: 10, mav: 14, mrv: 22 }], minutes_by_modality: {} },
        { week_idx: 2, muscles: [{ muscle: 'chest', sets: 12, performed_sets: 0, mev: 10, mav: 14, mrv: 22 }], minutes_by_modality: {} },
        { week_idx: 3, muscles: [{ muscle: 'chest', sets: 14, performed_sets: 0, mev: 10, mav: 14, mrv: 22 }], minutes_by_modality: {} },
        { week_idx: 4, muscles: [{ muscle: 'chest', sets: 16, performed_sets: 0, mev: 10, mav: 14, mrv: 22 }], minutes_by_modality: {} },
        { week_idx: 5, muscles: [{ muscle: 'chest', sets: 5, performed_sets: 0, mev: 10, mav: 14, mrv: 22 }], minutes_by_modality: {} },
      ],
    });
    render(<ProgramPage mesocycleRunId="mr-1" />);
    // Wait for chest row first to ensure the heatmap rendered.
    await screen.findByTestId('heatmap-row-chest');
    expect(screen.getByTestId('heatmap-cell-chest-w1')).toHaveTextContent('4/10');
    // Untouched weeks show planned-only.
    expect(screen.getByTestId('heatmap-cell-chest-w2')).toHaveTextContent('12');
  });

  it('uses light text on the below-MEV (muted) tile so the planned count stays legible', async () => {
    // Reviewer Critical: below-MEV tier color is dark gray (#3D4048); the
    // previous build hardcoded text color to #0A0D12 across all cells, giving
    // ~1.3:1 contrast on every below-MEV cell. Most unfilled-future-week
    // cells fall in this tier — so the bulk of the heatmap was invisible.
    vi.spyOn(mesoApi, 'getVolumeRollup').mockResolvedValue({
      run_id: 'mr-1',
      weeks: [
        // sets=5 < mev=10 → below-MEV (muted) tier.
        { week_idx: 1, muscles: [{ muscle: 'chest', sets: 5, performed_sets: 0, mev: 10, mav: 14, mrv: 22 }], minutes_by_modality: {} },
        // sets=12 within [mev,mav] → good tier.
        { week_idx: 2, muscles: [{ muscle: 'chest', sets: 12, performed_sets: 0, mev: 10, mav: 14, mrv: 22 }], minutes_by_modality: {} },
        { week_idx: 3, muscles: [{ muscle: 'chest', sets: 5, performed_sets: 0, mev: 10, mav: 14, mrv: 22 }], minutes_by_modality: {} },
        { week_idx: 4, muscles: [{ muscle: 'chest', sets: 5, performed_sets: 0, mev: 10, mav: 14, mrv: 22 }], minutes_by_modality: {} },
        { week_idx: 5, muscles: [{ muscle: 'chest', sets: 5, performed_sets: 0, mev: 10, mav: 14, mrv: 22 }], minutes_by_modality: {} },
      ],
    });
    render(<ProgramPage mesocycleRunId="mr-1" />);
    await screen.findByTestId('heatmap-row-chest');

    const mutedCell = screen.getByTestId('heatmap-cell-chest-w1');
    const goodCell = screen.getByTestId('heatmap-cell-chest-w2');
    // Below-MEV cells get light text on a dark tile (WCAG-passing contrast).
    expect(mutedCell.style.color).not.toBe('rgb(10, 13, 18)');
    // Colored tiles keep the dark text — contrast is fine against accent
    // greens/ambers/reds.
    expect(goodCell.style.color).toBe('rgb(10, 13, 18)');
  });
});
