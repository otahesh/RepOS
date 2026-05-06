import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgramCatalog } from './ProgramCatalog';
import * as api from '../../lib/api/programs';

describe('<ProgramCatalog>', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listProgramTemplates').mockResolvedValue([
      { id: '1', slug: 'full-body-3-day', name: 'Full Body 3-Day Foundation', description: 'Beginner / time-limited', weeks: 5, days_per_week: 3, version: 1 },
      { id: '2', slug: 'upper-lower-4-day', name: 'Upper/Lower 4-Day Hypertrophy', description: 'Canonical RP shape', weeks: 5, days_per_week: 4, version: 1 },
      { id: '3', slug: 'strength-cardio-3+2', name: 'Strength + Z2 3+2', description: 'Hybrid trainees', weeks: 5, days_per_week: 5, version: 1 },
    ] as any);
  });
  it('renders 3 cards', async () => {
    render(<ProgramCatalog onPick={vi.fn()} />);
    expect(await screen.findByText(/Full Body 3-Day Foundation/)).toBeInTheDocument();
    expect(screen.getByText(/Upper\/Lower 4-Day Hypertrophy/)).toBeInTheDocument();
    expect(screen.getByText(/Strength \+ Z2 3\+2/)).toBeInTheDocument();
  });
});
