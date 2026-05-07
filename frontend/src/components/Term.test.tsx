import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Term } from './Term';

// ---------------------------------------------------------------------------
// Existing button variant — must pass without modification
// ---------------------------------------------------------------------------
describe('<Term> button variant (default)', () => {
  it('renders the term short form by default', () => {
    render(<Term k="RIR" />);
    expect(screen.getByText('RIR')).toBeInTheDocument();
  });
  it('renders children when provided (override label)', () => {
    render(<Term k="RIR">reps in reserve</Term>);
    expect(screen.getByText('reps in reserve')).toBeInTheDocument();
  });
  it('shows dotted underline by default', () => {
    const { container } = render(<Term k="RIR" />);
    const trigger = container.querySelector('button');
    expect(trigger).toBeTruthy();
    expect(trigger?.style.borderBottomStyle).toBe('dotted');
  });
  it('compact mode hides underline, shows info icon', () => {
    const { container } = render(<Term k="RIR" compact />);
    const trigger = container.querySelector('button');
    expect(trigger?.style.borderBottomStyle).not.toBe('dotted');
    expect(container.textContent).toContain('ⓘ');
  });
  it('opens popover on click and shows definition', async () => {
    const user = userEvent.setup();
    render(<Term k="MEV" />);
    await user.click(screen.getByRole('button'));
    expect(await screen.findByText(/Minimum Effective Volume/)).toBeInTheDocument();
    expect(screen.getByText(/lowest weekly set count/i)).toBeInTheDocument();
    expect(screen.getByText(/Below MEV, you maintain/i)).toBeInTheDocument();
  });
  it('uses role="tooltip" on popover content when no citation', async () => {
    const user = userEvent.setup();
    render(<Term k="MEV" />);
    await user.click(screen.getByRole('button'));
    const panel = await screen.findByRole('tooltip');
    expect(panel).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// New abbr variant
// ---------------------------------------------------------------------------
describe('<Term variant="abbr">', () => {
  it('renders <abbr> element with title attribute', () => {
    const { container } = render(<Term k="RPE" variant="abbr" />);
    const abbr = container.querySelector('abbr');
    expect(abbr).toBeInTheDocument();
    expect(abbr?.getAttribute('title')).toBe('Rate of Perceived Exertion');
  });

  it('renders short form label by default', () => {
    render(<Term k="RPE" variant="abbr" />);
    expect(screen.getByText('RPE')).toBeInTheDocument();
  });

  it('renders children when provided (override label)', () => {
    render(<Term k="RPE" variant="abbr">rate of perceived exertion</Term>);
    expect(screen.getByText('rate of perceived exertion')).toBeInTheDocument();
  });

  it('does NOT render a <button>', () => {
    const { container } = render(<Term k="RPE" variant="abbr" />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('abbr has dotted underline styling', () => {
    const { container } = render(<Term k="RPE" variant="abbr" />);
    const abbr = container.querySelector('abbr');
    expect(abbr?.style.textDecoration).toMatch(/dotted/);
  });

  it('abbr has cursor: help', () => {
    const { container } = render(<Term k="RPE" variant="abbr" />);
    const abbr = container.querySelector('abbr');
    expect(abbr?.style.cursor).toBe('help');
  });

  it('abbr is focusable (tabIndex=0)', () => {
    const { container } = render(<Term k="RPE" variant="abbr" />);
    const abbr = container.querySelector('abbr');
    expect(abbr?.getAttribute('tabindex')).toBe('0');
  });

  it('shows popover on hover (mouseenter)', async () => {
    const { container } = render(<Term k="MEV" variant="abbr" />);
    const abbr = container.querySelector('abbr')!;
    fireEvent.mouseEnter(abbr);
    expect(await screen.findByText(/Minimum Effective Volume/)).toBeInTheDocument();
    expect(screen.getByText(/lowest weekly set count/i)).toBeInTheDocument();
    expect(screen.getByText(/Below MEV, you maintain/i)).toBeInTheDocument();
  });

  it('popover has role="tooltip" when no citation', async () => {
    const { container } = render(<Term k="MEV" variant="abbr" />);
    const abbr = container.querySelector('abbr')!;
    fireEvent.mouseEnter(abbr);
    const panel = await screen.findByRole('tooltip');
    expect(panel).toBeInTheDocument();
  });

  it('popover is linked via aria-describedby', async () => {
    const { container } = render(<Term k="MEV" variant="abbr" />);
    const abbr = container.querySelector('abbr')!;
    fireEvent.mouseEnter(abbr);
    await screen.findByRole('tooltip');
    const describedBy = abbr.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const panel = document.getElementById(describedBy!);
    expect(panel).toBeInTheDocument();
  });

  it('shows popover on keyboard focus', async () => {
    const { container } = render(<Term k="RPE" variant="abbr" />);
    const abbr = container.querySelector('abbr')!;
    fireEvent.focus(abbr);
    expect(await screen.findByText(/Rate of Perceived Exertion/)).toBeInTheDocument();
  });

  it('hides popover on blur', async () => {
    const { container } = render(<Term k="RPE" variant="abbr" />);
    const abbr = container.querySelector('abbr')!;
    fireEvent.focus(abbr);
    await screen.findByText(/Rate of Perceived Exertion/);
    // Blur and wait for debounce
    await act(async () => {
      fireEvent.blur(abbr);
      await new Promise((r) => setTimeout(r, 120));
    });
    expect(screen.queryByText(/Rate of Perceived Exertion/)).toBeNull();
  });

  it('dismisses on Escape key', async () => {
    const { container } = render(<Term k="MEV" variant="abbr" />);
    const abbr = container.querySelector('abbr')!;
    fireEvent.mouseEnter(abbr);
    const panel = await screen.findByRole('tooltip');
    expect(panel).toBeInTheDocument();
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('toggles on touch pointer tap', async () => {
    // jsdom doesn't implement PointerEvent natively, but setup.ts polyfills it.
    // We use dispatchEvent directly so pointerType is correctly set to 'touch'.
    const { container } = render(<Term k="MEV" variant="abbr" />);
    const abbr = container.querySelector('abbr')!;
    // First tap — opens
    await act(async () => {
      abbr.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, cancelable: true }));
    });
    expect(await screen.findByText(/Minimum Effective Volume/)).toBeInTheDocument();
    // Second tap — closes
    await act(async () => {
      abbr.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, cancelable: true }));
    });
    expect(screen.queryByText(/Minimum Effective Volume/)).toBeNull();
  });

  it('does not respond to mouse pointerDown (mouse tap should use hover)', () => {
    // Mouse pointerDown should not toggle — hover handles it
    const { container } = render(<Term k="MEV" variant="abbr" />);
    const abbr = container.querySelector('abbr')!;
    fireEvent.pointerDown(abbr, { pointerType: 'mouse' });
    // Popover should NOT be open (no mouseEnter fired)
    expect(screen.queryByText(/Minimum Effective Volume/)).toBeNull();
  });

  it('does not steal focus when popover opens', async () => {
    const { container } = render(<Term k="MEV" variant="abbr" />);
    const abbr = container.querySelector('abbr')!;
    // Both focus (triggers onFocus → setOpen) and mouseEnter cause state
    // updates — wrap both in a single act() to avoid the warning.
    await act(async () => {
      abbr.focus();
      fireEvent.mouseEnter(abbr);
    });
    await screen.findByRole('tooltip');
    // Focus should remain on the abbr element
    expect(document.activeElement).toBe(abbr);
  });
});
