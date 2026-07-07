import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SetupCardSheet } from './SetupCardSheet';
import type { ExerciseGuide } from '../../../lib/api/exerciseGuide';

const GUIDE: ExerciseGuide = {
  slug: 'incline-dumbbell-bench-press',
  setup_callout: 'Bench: 30° — usually the 2nd incline notch.',
  setup_facts: { bench_angle_deg: 30 },
  cues: ['Cue one', 'Cue two', 'Cue three'],
  donts: ['Mistake one', 'Mistake two'],
  media: {},
};

describe('SetupCardSheet', () => {
  it('renders callout, 3 cues, 2 donts, and the photo placeholder', () => {
    render(
      <SetupCardSheet exerciseName="Incline DB Bench Press" guide={GUIDE} onClose={() => {}} />,
    );
    expect(screen.getByRole('dialog', { name: /how to set up/i })).toBeInTheDocument();
    expect(screen.getByText(/Bench: 30°/)).toBeInTheDocument();
    expect(screen.getByText('Cue one')).toBeInTheDocument();
    expect(screen.getByText('Cue three')).toBeInTheDocument();
    expect(screen.getByText('Mistake two')).toBeInTheDocument();
    // W2: no photos yet — the media slot shows a placeholder, never a broken img.
    expect(screen.getByTestId('setup-photo-placeholder')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('closes on backdrop click, close button, and Escape', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <SetupCardSheet exerciseName="X" guide={GUIDE} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('dialog', { name: /how to set up/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<SetupCardSheet exerciseName="X" guide={GUIDE} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('does not propagate clicks inside the sheet to the backdrop', () => {
    const onClose = vi.fn();
    render(<SetupCardSheet exerciseName="X" guide={GUIDE} onClose={onClose} />);
    fireEvent.click(screen.getByText('Cue one'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('initial focus lands inside the dialog, and closing restores it', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = render(
      <SetupCardSheet exerciseName="X" guide={GUIDE} onClose={() => {}} />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    unmount();
    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });
});
