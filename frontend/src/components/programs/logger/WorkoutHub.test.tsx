import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkoutHub, type HubBlock } from './WorkoutHub';

const BLOCKS: HubBlock[] = [
  { blockIdx: 0, exerciseName: 'Goblet Squat', muscle: 'quads', setsTotal: 2, setsDone: 2 },
  { blockIdx: 1, exerciseName: 'DB Bench Press', muscle: 'chest', setsTotal: 2, setsDone: 0 },
  { blockIdx: 2, exerciseName: 'Chest-Supported Row', muscle: 'back', setsTotal: 2, setsDone: 0 },
];

function renderHub(blocks: HubBlock[], onOpenBlock = vi.fn(), onFinish = vi.fn()) {
  return {
    onOpenBlock,
    onFinish,
    ...render(
      <WorkoutHub
        dayName="Full Body A"
        blocks={blocks}
        onOpenBlock={onOpenBlock}
        onFinish={onFinish}
      />,
    ),
  };
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

  it('all done → FINISH WORKOUT is the primary action, no continue', () => {
    const allDone = BLOCKS.map((b) => ({ ...b, setsDone: b.setsTotal }));
    renderHub(allDone);
    expect(screen.getByRole('button', { name: /finish workout/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue/i })).not.toBeInTheDocument();
  });

  it('FINISH WORKOUT is always available (spec §2 partial completion) and reports intent', async () => {
    const user = userEvent.setup();
    const { onFinish } = renderHub(BLOCKS); // not all done
    // Both continue and finish are present, but finish never targets a block.
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /finish workout/i }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('FINISH WORKOUT shows a busy label and is disabled while finishing', () => {
    render(
      <WorkoutHub
        dayName="Full Body A"
        blocks={BLOCKS}
        onOpenBlock={vi.fn()}
        onFinish={vi.fn()}
        finishing
      />,
    );
    expect(screen.getByRole('button', { name: /finishing/i })).toBeDisabled();
  });

  it('does not render an empty muscle chip when metadata has not loaded yet', () => {
    const blocks: HubBlock[] = [
      { blockIdx: 0, exerciseName: 'Goblet Squat', muscle: '', setsTotal: 2, setsDone: 0 },
    ];
    renderHub(blocks);
    expect(screen.queryByTestId('muscle-chip')).not.toBeInTheDocument();
  });
});
