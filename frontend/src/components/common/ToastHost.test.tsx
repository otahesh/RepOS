import { describe, it, expect } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ToastHost, pushToast } from './ToastHost';

describe('<ToastHost>', () => {
  it('renders a toast when pushToast() is called', () => {
    render(<ToastHost />);
    act(() => {
      pushToast({ severity: 'info', body: 'host-shows-this' });
    });
    expect(screen.getByText('host-shows-this')).toBeInTheDocument();
  });

  it('removes the toast when the dismiss button is clicked', () => {
    render(<ToastHost />);
    act(() => {
      pushToast({ severity: 'info', body: 'dismiss-me-please', durationMs: 60_000 });
    });
    expect(screen.getByText('dismiss-me-please')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /dismiss/i });
    act(() => {
      fireEvent.click(btn);
    });
    expect(screen.queryByText('dismiss-me-please')).toBeNull();
  });

  it('renders multiple toasts in order when pushToast is called repeatedly', () => {
    render(<ToastHost />);
    act(() => {
      pushToast({ severity: 'info', body: 'first-toast', durationMs: 60_000 });
      pushToast({ severity: 'warn', body: 'second-toast', durationMs: 60_000 });
    });
    expect(screen.getByText('first-toast')).toBeInTheDocument();
    expect(screen.getByText('second-toast')).toBeInTheDocument();
  });
});
