import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('renders a comparable grid with experience filters and badges', async () => {
    render(<ProgramCatalog onPick={vi.fn()} />);
    expect(await screen.findByText(/Full Body 2-Day Foundation/)).toBeInTheDocument();
    expect(screen.getByText(/Full Body 3-Day Foundation/)).toBeInTheDocument();
    expect(screen.getByText(/Upper\/Lower 4-Day Hypertrophy/)).toBeInTheDocument();
    expect(screen.getByText(/Strength \+ Z2 3\+2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Beginner/i })).toBeInTheDocument();
    expect(screen.getAllByText('Beginner').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Intermediate').length).toBeGreaterThan(1);
    expect(screen.getByTestId('program-template-grid')).toBeInTheDocument();
  });

  it('shows a useful empty state when a selected level has no templates', async () => {
    vi.spyOn(api, 'listProgramTemplates').mockImplementation(async (track) =>
      track === 'advanced' ? [] : ([] as any),
    );
    render(<ProgramCatalog onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Advanced/i }));
    await waitFor(() => expect(api.listProgramTemplates).toHaveBeenCalledWith('advanced'));
    expect(await screen.findByText(/No advanced templates yet/i)).toBeInTheDocument();
  });
});
