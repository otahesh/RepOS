import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BlockOverflowMenu } from './BlockOverflowMenu';

describe('<BlockOverflowMenu>', () => {
  it('renders the trigger button', () => {
    render(<BlockOverflowMenu blockName="Back Squat" blockIdx={0} onGotATweak={() => {}} />);
    expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
  });

  it('opens menu on trigger click', () => {
    render(<BlockOverflowMenu blockName="Back Squat" blockIdx={0} onGotATweak={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /more options/i }));
    expect(screen.getByRole('menuitem', { name: /got a tweak/i })).toBeInTheDocument();
  });

  it('calls onGotATweak when "Got a tweak?" clicked', () => {
    const cb = vi.fn();
    render(<BlockOverflowMenu blockName="Back Squat" blockIdx={0} onGotATweak={cb} />);
    fireEvent.click(screen.getByRole('button', { name: /more options/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /got a tweak/i }));
    expect(cb).toHaveBeenCalled();
  });

  it('closes on ESC', () => {
    render(<BlockOverflowMenu blockName="Back Squat" blockIdx={0} onGotATweak={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /more options/i }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menuitem', { name: /got a tweak/i })).not.toBeInTheDocument();
  });
});
