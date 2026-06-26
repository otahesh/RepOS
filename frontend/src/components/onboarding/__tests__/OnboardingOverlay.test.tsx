import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import { OnboardingOverlay } from '../OnboardingOverlay';
import * as onboardingApi from '../../../lib/api/onboarding';
import * as equipmentApi from '../../../lib/api/equipment';
import * as programsApi from '../../../lib/api/programs';

function renderOverlay(onComplete = vi.fn()) {
  return render(
    <MemoryRouter>
      <OnboardingOverlay onComplete={onComplete} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.spyOn(onboardingApi, 'completeOnboarding').mockResolvedValue({
    onboarding_completed_at: '2026-06-01T00:00:00.000Z',
  });
  vi.spyOn(equipmentApi, 'applyPreset').mockResolvedValue({ _v: 1 } as any);
  vi.spyOn(programsApi, 'listProgramTemplates').mockResolvedValue([
    {
      id: '1',
      slug: 'full-body-3-day',
      name: 'Full Body 3-Day',
      description: 'x',
      weeks: 5,
      days_per_week: 3,
      version: 1,
    },
  ] as any);
});

describe('<OnboardingOverlay>', () => {
  it('step 1 shows the Welcome heading with the mesocycle Term wrapper', () => {
    renderOverlay();
    expect(screen.getByText('Welcome to RepOS')).toBeInTheDocument();
    expect(screen.getByText(/ONBOARDING · STEP 1 \/ 5/)).toBeInTheDocument();
    // The Term wrapper renders "mesocycles" as interactive text.
    expect(screen.getAllByText(/mesocycle/i).length).toBeGreaterThan(0);
  });

  it('clicking Get Started advances to step 2', () => {
    renderOverlay();
    fireEvent.click(screen.getByText('GET STARTED'));
    expect(screen.getByText(/ONBOARDING · STEP 2 \/ 5/)).toBeInTheDocument();
  });

  it('steps 2/3/4 expose a Skip control that advances', () => {
    renderOverlay();
    fireEvent.click(screen.getByText('GET STARTED')); // → 2
    fireEvent.click(screen.getByText('Skip for now')); // → 3
    expect(screen.getByText(/STEP 3 \/ 5/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Skip for now')); // → 4
    expect(screen.getByText(/STEP 4 \/ 5/)).toBeInTheDocument();
  });

  it('final Start calls completeOnboarding with the selected goal then onComplete', async () => {
    const onComplete = vi.fn();
    renderOverlay(onComplete);
    fireEvent.click(screen.getByText('GET STARTED')); // 1 → 2
    fireEvent.click(screen.getByText('Skip for now')); // 2 → 3
    fireEvent.click(screen.getByText('BULK')); // select goal
    fireEvent.click(screen.getByText('NEXT')); // 3 → 4
    fireEvent.click(screen.getByText('Skip for now')); // 4 → 5
    fireEvent.click(screen.getByText('START TRAINING'));
    await waitFor(() => expect(onboardingApi.completeOnboarding).toHaveBeenCalledWith('bulk'));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });

  // ── A11y ──────────────────────────────────────────────────────────────────
  it('A11y-1: initial focus lands inside the dialog', () => {
    renderOverlay();
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('A11y-2: Shift+Tab from the first focusable wraps to the last', () => {
    renderOverlay();
    const dialog = screen.getByRole('dialog');
    const focusables = dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href]');
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('A11y-3: closing the dialog returns focus to the previously-focused element', async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <MemoryRouter>
          <button data-testid="trigger" onClick={() => setOpen(true)}>
            open
          </button>
          {open && <OnboardingOverlay onComplete={() => setOpen(false)} />}
        </MemoryRouter>
      );
    }
    const trigger = document.createElement('button');
    trigger.setAttribute('data-testid', 'outer-trigger');
    document.body.appendChild(trigger);
    trigger.focus();
    render(<Harness />);
    // Walk to the final step and finish.
    fireEvent.click(screen.getByText('GET STARTED'));
    fireEvent.click(screen.getByText('Skip for now'));
    fireEvent.click(screen.getByText('NEXT'));
    fireEvent.click(screen.getByText('Skip for now'));
    fireEvent.click(screen.getByText('START TRAINING'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Focus returns to whatever was focused before mount (the outer trigger).
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
