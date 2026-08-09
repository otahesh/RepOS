import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgramCatalog } from './ProgramCatalog';
import * as api from '../../lib/api/programs';

describe('<ProgramCatalog>', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listProgramTemplates').mockResolvedValue([
      {
        id: '1',
        slug: 'full-body-2-day',
        name: 'Full Body 2-Day Foundation',
        description: 'b',
        weeks: 5,
        days_per_week: 2,
        version: 1,
        track: 'beginner',
      },
      {
        id: '2',
        slug: 'full-body-3-day',
        name: 'Full Body 3-Day Foundation',
        description: 'b',
        weeks: 5,
        days_per_week: 3,
        version: 1,
        track: 'beginner',
      },
      {
        id: '3',
        slug: 'upper-lower-4-day',
        name: 'Upper/Lower 4-Day Hypertrophy',
        description: 'i',
        weeks: 5,
        days_per_week: 4,
        version: 1,
        track: 'intermediate',
      },
      {
        id: '4',
        slug: 'strength-cardio-3-2',
        name: 'Strength + Z2 3+2',
        description: 'i',
        weeks: 5,
        days_per_week: 5,
        version: 1,
        track: 'intermediate',
      },
    ] as any);
  });

  it('renders all template cards grouped under track headings', async () => {
    render(<ProgramCatalog onPick={vi.fn()} />);
    expect(await screen.findByText(/Full Body 2-Day Foundation/)).toBeInTheDocument();
    expect(screen.getByText(/Full Body 3-Day Foundation/)).toBeInTheDocument();
    expect(screen.getByText(/Upper\/Lower 4-Day Hypertrophy/)).toBeInTheDocument();
    expect(screen.getByText(/Strength \+ Z2 3\+2/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Beginner/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Intermediate/i })).toBeInTheDocument();
  });

  it('shows a "More coming" state for the empty Advanced track', async () => {
    render(<ProgramCatalog onPick={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: /Advanced/i })).toBeInTheDocument();
    expect(screen.getByText(/More coming/i)).toBeInTheDocument();
  });
});
