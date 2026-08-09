import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { ParQGate } from '../ParQGate';
import * as parQApi from '../../../lib/api/parQ';

const QUESTIONS = [
  'Q1 heart',
  'Q2 chest pain activity',
  'Q3 chest pain rest',
  'Q4 balance',
  'Q5 bone or joint problem',
  'Q6 bp drugs',
  'Q7 pregnant',
  'Q8 chronic condition',
  'Q9 other reason',
];

function mockStatus(over: Partial<parQApi.ParQStatus> = {}) {
  vi.spyOn(parQApi, 'getParQStatus').mockResolvedValue({
    current_version: 2,
    acknowledged_version: 0,
    needs_prompt: true,
    questions: QUESTIONS,
    advisory_active: false,
    ...over,
  });
}

beforeEach(() => {
  mockStatus();
});

describe('<ParQGate>', () => {
  it('renders all 9 questions after async load', async () => {
    render(<ParQGate onComplete={vi.fn()} />);
    expect(await screen.findByTestId('parq-questions')).toBeInTheDocument();
    const list = screen.getByTestId('parq-questions');
    expect(within(list).getAllByRole('listitem')).toHaveLength(9);
  });

  it('all-No → POST with q5_joints=[] → any_yes=false → onComplete, no banner', async () => {
    const accept = vi
      .spyOn(parQApi, 'acceptParQ')
      .mockResolvedValue({ any_yes: false, advisory_active: false, injuries_created: 0 });
    const onComplete = vi.fn();
    render(<ParQGate onComplete={onComplete} />);
    await screen.findByTestId('parq-questions');
    fireEvent.click(screen.getByText('CONFIRM'));
    await waitFor(() => expect(accept).toHaveBeenCalledWith(2, new Array(9).fill(false), []));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('one Yes (not Q5) → banner with MEV/RIR copy, click-through closes', async () => {
    vi.spyOn(parQApi, 'acceptParQ').mockResolvedValue({
      any_yes: true,
      advisory_active: true,
      injuries_created: 0,
    });
    const onComplete = vi.fn();
    render(<ParQGate onComplete={onComplete} />);
    await screen.findByTestId('parq-questions');
    // Answer Q1 = Yes.
    const q1 = within(screen.getByTestId('parq-questions')).getAllByRole('listitem')[0];
    fireEvent.click(within(q1).getByText('Yes'));
    fireEvent.click(screen.getByText('CONFIRM'));
    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toMatch(/conservative volume/i);
    expect(banner.textContent).toMatch(/RIR/);
    fireEvent.click(screen.getByText('CONTINUE'));
    expect(onComplete).toHaveBeenCalled();
  });

  it('Q5=Yes reveals the joint picker; selected joints are sent', async () => {
    const accept = vi
      .spyOn(parQApi, 'acceptParQ')
      .mockResolvedValue({ any_yes: true, advisory_active: true, injuries_created: 2 });
    render(<ParQGate onComplete={vi.fn()} />);
    await screen.findByTestId('parq-questions');
    const q5 = within(screen.getByTestId('parq-questions')).getAllByRole('listitem')[4];
    fireEvent.click(within(q5).getByText('Yes'));
    expect(screen.getByTestId('parq-q5-joints')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Low back'));
    fireEvent.click(screen.getByText('Right knee'));
    fireEvent.click(screen.getByText('CONFIRM'));
    await waitFor(() => {
      const answers = new Array(9).fill(false);
      answers[4] = true;
      expect(accept).toHaveBeenCalledWith(2, answers, ['low_back', 'knee_right']);
    });
  });

  it('Q8=Yes appends the chronic-condition clinician line in the banner', async () => {
    vi.spyOn(parQApi, 'acceptParQ').mockResolvedValue({
      any_yes: true,
      advisory_active: true,
      injuries_created: 0,
    });
    render(<ParQGate onComplete={vi.fn()} />);
    await screen.findByTestId('parq-questions');
    const q8 = within(screen.getByTestId('parq-questions')).getAllByRole('listitem')[7];
    fireEvent.click(within(q8).getByText('Yes'));
    fireEvent.click(screen.getByText('CONFIRM'));
    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toMatch(
      /Discuss this with your clinician before increasing volume/i,
    );
  });

  it('needs_prompt=false (non-review) → renders nothing', async () => {
    mockStatus({ needs_prompt: false });
    const { container } = render(<ParQGate onComplete={vi.fn()} />);
    // Wait a tick for the async status fetch to resolve.
    await waitFor(() => expect(parQApi.getParQStatus).toHaveBeenCalled());
    await waitFor(() =>
      expect(container.querySelector('[data-testid="parq-questions"]')).toBeNull(),
    );
  });

  it('re-review mode: ESC closes via onClose', async () => {
    mockStatus({ needs_prompt: false });
    const onClose = vi.fn();
    render(<ParQGate onComplete={vi.fn()} forceReview onClose={onClose} />);
    await screen.findByTestId('parq-questions');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  // ── A11y ──────────────────────────────────────────────────────────────────
  it('A11y-1: initial focus lands inside the dialog (on first question control)', async () => {
    render(<ParQGate onComplete={vi.fn()} />);
    await screen.findByTestId('parq-questions');
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('A11y-2: Shift+Tab from the first focusable wraps to the last', async () => {
    render(<ParQGate onComplete={vi.fn()} />);
    await screen.findByTestId('parq-questions');
    const dialog = screen.getByRole('dialog');
    // Mirror the component's own trap selector — the inline help terms render as
    // focusable <abbr tabindex="0"> and are part of the trap boundary.
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('A11y-3: closing the dialog returns focus to the previously-focused element', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    function Harness() {
      const [open, setOpen] = useState(true);
      return open ? <ParQGate onComplete={() => setOpen(false)} /> : null;
    }
    vi.spyOn(parQApi, 'acceptParQ').mockResolvedValue({
      any_yes: false,
      advisory_active: false,
      injuries_created: 0,
    });
    render(<Harness />);
    await screen.findByTestId('parq-questions');
    fireEvent.click(screen.getByText('CONFIRM'));
    await waitFor(() => expect(screen.queryByTestId('parq-questions')).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
