import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog tiers', () => {
  it('medium tier shows Confirm + Cancel + does not require typing', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        tier="medium"
        title="Confirm action?"
        body="This is a medium-severity action."
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const confirmBtn = screen.getByRole('button', { name: /confirm/i });
    expect(confirmBtn).toBeEnabled();
    expect(screen.queryByRole('textbox')).toBeNull();
    await userEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('heavy tier requires typing the exact phrase before Confirm enables', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        tier="heavy"
        title="Delete account?"
        body="This is permanent."
        requireTyped="DELETE"
        severity="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const confirmBtn = screen.getByRole('button', { name: /confirm/i });
    expect(confirmBtn).toBeDisabled();
    const input = screen.getByRole('textbox');
    await userEvent.type(input, 'delete');
    expect(confirmBtn).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, 'DELETE');
    expect(confirmBtn).toBeEnabled();
    await userEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('DELETE');
  });

  it('Escape key triggers onCancel exactly once (per C-CONFIRMDIALOG-ESC)', async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        tier="medium"
        title="X"
        body="Y"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('heavy tier focuses the typed-confirm input on open', async () => {
    render(
      <ConfirmDialog
        open
        tier="heavy"
        title="Delete?"
        body=""
        requireTyped="DELETE"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const input = screen.getByRole('textbox');
    expect(input).toHaveFocus();
  });

  it('restores focus to the previously-focused trigger on unmount', async () => {
    function Harness(): JSX.Element {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button data-testid="trigger" onClick={() => setOpen(true)}>
            Open
          </button>
          {open && (
            <ConfirmDialog
              open
              tier="medium"
              title="X"
              body=""
              onConfirm={() => setOpen(false)}
              onCancel={() => setOpen(false)}
            />
          )}
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });
});
