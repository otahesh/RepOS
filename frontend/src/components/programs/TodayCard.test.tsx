import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TodayCard } from './TodayCard';
import * as api from '../../lib/api/mesocycles';

describe('<TodayCard>', () => {
  beforeEach(() => {});
  it('shows no-active-run state', async () => {
    vi.spyOn(api, 'getTodayWorkout').mockResolvedValue({ state: 'no_active_run' });
    render(<TodayCard onStart={vi.fn()} />);
    expect(await screen.findByText(/Pick a program/i)).toBeInTheDocument();
  });
  it('shows rest day', async () => {
    vi.spyOn(api, 'getTodayWorkout').mockResolvedValue({ state: 'rest', run_id: 'mr-1', scheduled_date: '2026-05-05' });
    render(<TodayCard onStart={vi.fn()} />);
    expect(await screen.findByText(/Rest day/i)).toBeInTheDocument();
  });
  it('shows workout day with START WORKOUT CTA', async () => {
    vi.spyOn(api, 'getTodayWorkout').mockResolvedValue({
      state: 'workout', run_id: 'mr-1',
      day: { id: 'dw-1', kind: 'strength', name: 'Upper Heavy', week_idx: 1, day_idx: 0 } as any,
      sets: [],
      cardio: [],
    });
    render(<TodayCard onStart={vi.fn()} />);
    expect(await screen.findByText(/Upper Heavy/)).toBeInTheDocument();
    expect(screen.getByText(/start workout/i)).toBeInTheDocument();
  });
});
