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
        { week_idx: 1, muscles: [{ muscle: 'chest', sets: 10, mev: 10, mav: 14, mrv: 22 }], minutes_by_modality: {} },
        { week_idx: 2, muscles: [{ muscle: 'chest', sets: 12, mev: 10, mav: 14, mrv: 22 }], minutes_by_modality: {} },
        { week_idx: 3, muscles: [{ muscle: 'chest', sets: 14, mev: 10, mav: 14, mrv: 22 }], minutes_by_modality: {} },
        { week_idx: 4, muscles: [{ muscle: 'chest', sets: 16, mev: 10, mav: 14, mrv: 22 }], minutes_by_modality: {} },
        { week_idx: 5, muscles: [{ muscle: 'chest', sets: 5, mev: 10, mav: 14, mrv: 22 }], minutes_by_modality: {} },
      ],
    });
  });
  it('renders 5×N heatmap with current week marker', async () => {
    render(<ProgramPage mesocycleRunId="mr-1" />);
    expect(await screen.findByText(/chest/i)).toBeInTheDocument();
    expect(screen.getByText(/Week 2/)).toBeInTheDocument();
  });
});
