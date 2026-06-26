import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { Toast } from './Toast';

describe('<Toast>', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the body text', () => {
    render(<Toast id="t1" severity="info" body="Hello world" onDismiss={() => undefined} />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('uses role="status" for non-error severities', () => {
    render(<Toast id="t1" severity="info" body="info body" onDismiss={() => undefined} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('uses role="alert" for error severity', () => {
    render(<Toast id="t1" severity="error" body="error body" onDismiss={() => undefined} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('auto-dismisses after durationMs (default 5000) via fake timers', () => {
    const onDismiss = vi.fn();
    render(<Toast id="t1" severity="info" body="dismiss me" onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDismiss).toHaveBeenCalledWith('t1');
  });

  it('respects custom durationMs', () => {
    const onDismiss = vi.fn();
    render(
      <Toast id="t2" severity="success" body="custom" durationMs={2000} onDismiss={onDismiss} />,
    );
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onDismiss).toHaveBeenCalledWith('t2');
  });

  it('dismisses immediately when dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(<Toast id="t3" severity="warn" body="warn body" onDismiss={onDismiss} />);
    const btn = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(btn);
    expect(onDismiss).toHaveBeenCalledWith('t3');
  });

  it('renders an action button when actionLabel + onAction are provided', () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(
      <Toast
        id="t4"
        severity="info"
        body="undo me"
        actionLabel="Undo"
        onAction={onAction}
        onDismiss={onDismiss}
      />,
    );
    const btn = screen.getByRole('button', { name: /undo/i });
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith('t4');
  });

  it('does not render an action button when actionLabel is absent', () => {
    render(<Toast id="t5" severity="info" body="no action" onDismiss={() => undefined} />);
    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull();
  });
});
