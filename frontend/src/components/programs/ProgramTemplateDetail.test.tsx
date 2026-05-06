import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgramTemplateDetail } from './ProgramTemplateDetail';
import * as api from '../../lib/api/programs';

describe('<ProgramTemplateDetail>', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getProgramTemplate').mockResolvedValue({
      id: '1', slug: 'upper-lower-4-day', name: 'Upper/Lower 4-Day', description: '', weeks: 5, days_per_week: 4, version: 1,
      structure: { _v: 1, days: [
        { idx: 0, day_offset: 0, kind: 'strength', name: 'Upper Heavy', blocks: [
          { exercise_slug: 'barbell-bench-press', mev: 8, mav: 14, target_reps_low: 6, target_reps_high: 8, target_rir: 2, rest_sec: 180 },
        ]},
        { idx: 1, day_offset: 1, kind: 'strength', name: 'Lower Heavy', blocks: [] },
        { idx: 2, day_offset: 3, kind: 'strength', name: 'Upper Volume', blocks: [] },
        { idx: 3, day_offset: 4, kind: 'strength', name: 'Lower Volume', blocks: [] },
      ]},
    } as any);
  });
  it('renders 4 day cards with day_offset → weekday labels', async () => {
    render(<ProgramTemplateDetail slug="upper-lower-4-day" onFork={vi.fn()} />);
    expect(await screen.findByText(/Upper Heavy/)).toBeInTheDocument();
    expect(screen.getByText(/Lower Heavy/)).toBeInTheDocument();
    expect(screen.getByText(/Upper Volume/)).toBeInTheDocument();
    expect(screen.getByText(/Lower Volume/)).toBeInTheDocument();
    expect(screen.getByText(/barbell bench press/i)).toBeInTheDocument();
  });
});
