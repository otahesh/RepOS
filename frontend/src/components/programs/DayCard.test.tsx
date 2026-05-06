import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DayCard } from './DayCard';

const day = { idx: 0, day_offset: 0, kind: 'strength' as const, name: 'Upper', blocks: [
  { exercise_slug: 'barbell-bench-press', mev: 8, mav: 14, target_reps_low: 6, target_reps_high: 8, target_rir: 2, rest_sec: 180 },
]};

describe('<DayCard>', () => {
  it('add-set fires onAddSet', async () => {
    const onAddSet = vi.fn();
    const user = userEvent.setup();
    render(<DayCard day={day} onAddSet={onAddSet} onRemoveSet={vi.fn()} onSwap={vi.fn()} />);
    await user.click(screen.getByText(/\+ set/i));
    expect(onAddSet).toHaveBeenCalledWith(0, 0);
  });
  it('remove-set fires onRemoveSet', async () => {
    const onRemoveSet = vi.fn();
    const user = userEvent.setup();
    render(<DayCard day={day} onAddSet={vi.fn()} onRemoveSet={onRemoveSet} onSwap={vi.fn()} />);
    await user.click(screen.getByText(/− set/i));
    expect(onRemoveSet).toHaveBeenCalledWith(0, 0, day.blocks[0].mav - 1);
  });
});
