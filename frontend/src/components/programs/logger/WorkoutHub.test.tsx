import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkoutHub, type HubBlock } from './WorkoutHub';

const BLOCKS: HubBlock[] = [
  { blockIdx: 0, exerciseName: 'Goblet Squat', muscle: 'quads', setsTotal: 2, setsDone: 2 },
  { blockIdx: 1, exerciseName: 'DB Bench Press', muscle: 'chest', setsTotal: 2, setsDone: 0 },
  { blockIdx: 2, exerciseName: 'Chest-Supported Row', muscle: 'back', setsTotal: 2, setsDone: 0 },
];

function renderHub(blocks: HubBlock[], onOpenBlock = vi.fn()) {
  return { onOpenBlock, ...render(
    <WorkoutHub dayName="Full Body A" blocks={blocks} onOpenBlock={onOpenBlock} />,
  ) };
}

describe('<WorkoutHub>', () => {
  it('renders one row per block with done counts', () => {
    renderHub(BLOCKS);
    expect(screen.getByTestId('hub-row-0')).toHaveTextContent('2/2 sets');
    expect(screen.getByTestId('hub-row-1')).toHaveTextContent('0/2 sets');
    expect(screen.getByTestId('hub-row-2')).toHaveTextContent('0/2 sets');
  });

  it('marks first unfinished block as up next', () => {
    renderHub(BLOCKS);
    expect(screen.getByTestId('hub-row-1')).toHaveTextContent(/up next/i);
    expect(screen.getByTestId('hub-row-2')).not.toHaveTextContent(/up next/i);
  });

  it('CONTINUE targets the first unfinished block', async () => {
    const user = userEvent.setup();
    const { onOpenBlock } = renderHub(BLOCKS);
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(onOpenBlock).toHaveBeenCalledWith(1);
  });

  it('tapping any row opens that block', async () => {
    const user = userEvent.setup();
    const { onOpenBlock } = renderHub(BLOCKS);
    await user.click(screen.getByTestId('hub-row-2'));
    expect(onOpenBlock).toHaveBeenCalledWith(2);
  });

  it('all done → complete banner, no continue', () => {
    const allDone = BLOCKS.map((b) => ({ ...b, setsDone: b.setsTotal }));
    renderHub(allDone);
    expect(screen.getByText(/workout complete/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue/i })).not.toBeInTheDocument();
  });
});
