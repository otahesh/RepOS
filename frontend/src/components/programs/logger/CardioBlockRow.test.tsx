import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardioBlockRow } from './CardioBlockRow';
import type { TodayCardio } from '../../../lib/api/mesocycles';

const { postCardioLogMock } = vi.hoisted(() => ({ postCardioLogMock: vi.fn() }));
vi.mock('../../../lib/api/cardioLogs', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../lib/api/cardioLogs')>();
  return { ...orig, postCardioLog: postCardioLogMock };
});

const BLOCK: TodayCardio = {
  id: 'pc-1',
  block_idx: 0,
  exercise: { id: 'e-walk', slug: 'outdoor-walking-z2', name: 'Outdoor Walk' },
  target_duration_sec: 2700,
  target_distance_m: null,
  target_zone: 2,
  logged: null,
};

describe('<CardioBlockRow>', () => {
  beforeEach(() => {
    postCardioLogMock.mockReset();
  });

  it('renders name, target chips, and prefills duration from the target', () => {
    render(<CardioBlockRow block={BLOCK} />);
    expect(screen.getByText('Outdoor Walk')).toBeInTheDocument();
    expect(screen.getByText('45 min · Z2')).toBeInTheDocument();
    expect(screen.getByLabelText(/duration in minutes/i)).toHaveValue(45);
    expect(screen.getByRole('button', { name: /log cardio/i })).toBeEnabled();
  });

  it('POSTs seconds (+ optional km→m) and shows the logged state', async () => {
    const user = userEvent.setup();
    postCardioLogMock.mockResolvedValueOnce({ deduped: false, cardio_log: { id: 'cl-1' } });
    render(<CardioBlockRow block={BLOCK} />);
    await user.type(screen.getByLabelText(/distance in kilometers/i), '4.2');
    await user.click(screen.getByRole('button', { name: /log cardio/i }));
    expect(postCardioLogMock).toHaveBeenCalledTimes(1);
    const body = postCardioLogMock.mock.calls[0][0];
    expect(body.planned_cardio_block_id).toBe('pc-1');
    expect(body.duration_sec).toBe(2700);
    expect(body.distance_m).toBe(4200);
    expect(await screen.findByRole('button', { name: /cardio logged/i })).toBeDisabled();
  });

  it('failure shows an actionable retry that replays the SAME client_request_id', async () => {
    const user = userEvent.setup();
    postCardioLogMock.mockRejectedValueOnce(new Error('network'));
    postCardioLogMock.mockResolvedValueOnce({ deduped: false, cardio_log: { id: 'cl-1' } });
    render(<CardioBlockRow block={BLOCK} />);
    await user.click(screen.getByRole('button', { name: /log cardio/i }));
    expect(await screen.findByText(/save failed.*retry/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry log cardio/i }));
    expect(postCardioLogMock).toHaveBeenCalledTimes(2);
    // Idempotent retry: identical client_request_id both attempts.
    expect(postCardioLogMock.mock.calls[0][0].client_request_id).toBe(
      postCardioLogMock.mock.calls[1][0].client_request_id,
    );
    expect(await screen.findByRole('button', { name: /cardio logged/i })).toBeDisabled();
  });

  it('renders already-logged state from block.logged', () => {
    render(
      <CardioBlockRow block={{ ...BLOCK, logged: { duration_sec: 2820, distance_m: 4000 } }} />,
    );
    expect(screen.getByRole('button', { name: /cardio logged/i })).toBeDisabled();
    expect(screen.getByLabelText(/duration in minutes/i)).toHaveValue(47);
  });
});
