import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DesktopSwapSheet } from './DesktopSwapSheet';
import * as exApi from '../../lib/api/exercises';
import * as eqApi from '../../lib/api/equipment';

// Auto-mock (no factory). The repo's vitest config sets `restoreMocks: true`,
// which wipes factory-set mockResolvedValue between tests — so resolved values
// MUST be (re)set in beforeEach, after the restore. Mirrors the proven
// MidSessionSwapPicker.test.tsx pattern.
vi.mock('../../lib/api/exercises');
vi.mock('../../lib/api/equipment');

const EXERCISES = [
  { id: '1', slug: 'bb-bench-press', name: 'BB Bench Press', primary_muscle: 'chest', primary_muscle_name: 'Chest', movement_pattern: 'push_horizontal', peak_tension_length: 'mid', skill_complexity: 2, loading_demand: 3, systemic_fatigue: 3, required_equipment: { _v: 1, requires: [] }, muscle_contributions: { chest: 1 } },
  { id: '2', slug: 'db-bench-press', name: 'DB Bench Press', primary_muscle: 'chest', primary_muscle_name: 'Chest', movement_pattern: 'push_horizontal', peak_tension_length: 'mid', skill_complexity: 2, loading_demand: 3, systemic_fatigue: 3, required_equipment: { _v: 1, requires: [] }, muscle_contributions: { chest: 1 } },
];

describe('<DesktopSwapSheet>', () => {
  beforeEach(() => {
    vi.mocked(exApi.listExercises).mockResolvedValue(EXERCISES as any);
    vi.mocked(eqApi.getEquipmentProfile).mockResolvedValue({ _v: 1 } as any);
  });

  it('renders side-sheet with ExercisePicker inside', async () => {
    render(<DesktopSwapSheet
      open
      context="program_edit"
      fromSlug="bb-bench-press"
      onClose={() => {}}
      onApply={() => {}}
    />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/DB Bench Press/)).toBeInTheDocument());
  });

  it('defaults to "every occurrence" radio in program_edit context', () => {
    render(<DesktopSwapSheet open context="program_edit" fromSlug="bb-bench-press" onClose={() => {}} onApply={() => {}} />);
    const radio = screen.getByRole('radio', { name: /every occurrence/i }) as HTMLInputElement;
    expect(radio.checked).toBe(true);
  });

  it('defaults to "this block" radio in mid_session context', () => {
    render(<DesktopSwapSheet open context="mid_session" fromSlug="bb-bench-press" onClose={() => {}} onApply={() => {}} />);
    const radio = screen.getByRole('radio', { name: /this block/i }) as HTMLInputElement;
    expect(radio.checked).toBe(true);
  });

  it('calls onApply with scope=this and selected exercise', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<DesktopSwapSheet open context="program_edit" fromSlug="bb-bench-press" onClose={() => {}} onApply={onApply} />);
    await waitFor(() => expect(screen.getByText(/DB Bench Press/)).toBeInTheDocument());
    await user.click(screen.getByRole('radio', { name: /this block/i }));
    await user.click(screen.getByText(/DB Bench Press/));
    await user.click(screen.getByRole('button', { name: /apply/i }));
    expect(onApply).toHaveBeenCalledWith({ scope: 'this', toExerciseSlug: 'db-bench-press' });
  });

  it('ESC closes the sheet via onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<DesktopSwapSheet open context="program_edit" fromSlug="bb-bench-press" onClose={onClose} onApply={() => {}} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  // [C-DESKTOPSWAPSHEET-A11Y] 3 missing a11y tests.
  it('initial-focus lands inside the dialog', () => {
    render(<DesktopSwapSheet open context="program_edit" fromSlug="bb-bench-press" onClose={() => {}} onApply={() => {}} />);
    const dialog = screen.getByRole('dialog');
    // The active element after mount must be inside the dialog.
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Shift+Tab from the first focusable wraps to the last', async () => {
    const user = userEvent.setup();
    render(<DesktopSwapSheet open context="program_edit" fromSlug="bb-bench-press" onClose={() => {}} onApply={() => {}} />);
    await waitFor(() => expect(screen.getByText(/DB Bench Press/)).toBeInTheDocument());
    const dialog = screen.getByRole('dialog');
    const focusables = dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])');
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    first.focus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(last);
  });

  it('return-focus restores to the previously-focused element on close', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    const { unmount } = render(<DesktopSwapSheet open context="program_edit" fromSlug="bb-bench-press" onClose={() => {}} onApply={() => {}} />);
    expect(document.activeElement).not.toBe(trigger);
    unmount();
    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });
});
