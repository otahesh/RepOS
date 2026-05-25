import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MidSessionSwapPicker } from './MidSessionSwapPicker';
import * as exApi from '../../lib/api/exercises';

vi.mock('../../lib/api/exercises');

const props = {
  plannedSetId: 'ps-1',
  fromName: 'Back Squat',
  fromSlug: 'back-squat',
  onClose: vi.fn(),
};

describe('<MidSessionSwapPicker>', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists candidates and renders injury_advisory copy on tagged rows', async () => {
    vi.mocked(exApi.getSubstitutions).mockResolvedValueOnce({
      from: { slug: 'back-squat', name: 'Back Squat' },
      subs: [
        { id: 'a', slug: 'leg-press', name: 'Leg Press', score: 500, reason: '' },
        {
          id: 'b', slug: 'bss', name: 'BSS', score: 250, reason: '',
          injury_advisory: { joint: 'knee_left', level: 'mod' },
        },
      ],
      truncated: false,
    });
    render(<MidSessionSwapPicker {...props} />);
    await waitFor(() => screen.getByText('Leg Press'));
    expect(screen.getByText(/moderate knee load — you noted left knee/i)).toBeInTheDocument();
    expect(screen.queryByText(/leg press.*knee load/i)).not.toBeInTheDocument();
  });

  it('clicking a demoted candidate opens the confirm sheet (advisory ≠ block)', async () => {
    vi.mocked(exApi.getSubstitutions).mockResolvedValueOnce({
      from: { slug: 'back-squat', name: 'Back Squat' },
      subs: [
        {
          id: 'b', slug: 'bss', name: 'BSS', score: 250, reason: '',
          injury_advisory: { joint: 'knee_left', level: 'high' },
        },
      ],
      truncated: false,
    });
    render(<MidSessionSwapPicker {...props} />);
    await waitFor(() => screen.getByRole('button', { name: /BSS/i }));
    fireEvent.click(screen.getByRole('button', { name: /BSS/i }));
    expect(await screen.findByRole('dialog', { name: /swap/i })).toBeInTheDocument();
  });
});
