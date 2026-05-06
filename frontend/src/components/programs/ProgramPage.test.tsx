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
      sets_by_week_by_muscle: { chest: [10, 12, 14, 16, 5] },
      landmarks: { chest: { mev: 10, mav: 14, mrv: 22 } },
      cardio_minutes_by_modality: {},
    });
  });
  it('renders 5×N heatmap with current week marker', async () => {
    render(<ProgramPage mesocycleRunId="mr-1" />);
    expect(await screen.findByText(/chest/i)).toBeInTheDocument();
    expect(screen.getByText(/Week 2/)).toBeInTheDocument();
  });
});
