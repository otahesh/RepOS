import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Term } from './Term';

describe('<Term>', () => {
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
    expect(trigger?.style.borderBottomStyle).toBe('none');
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
