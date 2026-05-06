import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MesocycleRecap } from './MesocycleRecap';

describe('<MesocycleRecap>', () => {
  it('renders 3 choices, deload visually defaulted', async () => {
    render(<MesocycleRecap onChoice={vi.fn()} stats={{ weeks: 5, total_sets: 380, prs: 4 }} />);
    expect(screen.getByText(/Take a deload/i)).toBeInTheDocument();
    expect(screen.getByText(/Run it back/i)).toBeInTheDocument();
    expect(screen.getByText(/New program/i)).toBeInTheDocument();
  });
  it('emits choice', async () => {
    const onChoice = vi.fn();
    const user = userEvent.setup();
    render(<MesocycleRecap onChoice={onChoice} stats={{ weeks: 5, total_sets: 380, prs: 4 }} />);
    await user.click(screen.getByText(/Run it back/i));
    expect(onChoice).toHaveBeenCalledWith('run_it_back');
  });
});
