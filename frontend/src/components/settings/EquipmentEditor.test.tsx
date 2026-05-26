import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EquipmentEditor } from './EquipmentEditor';
import * as equipApi from '../../lib/api/equipment.ts';
import * as upApi from '../../lib/api/userPrograms.ts';
import type { UserProgramRecord } from '../../lib/api/programs';

function makeProgram(status: UserProgramRecord['status']): UserProgramRecord {
  return {
    id: 'up-1',
    user_id: 'u-1',
    template_id: 'tmpl-1',
    template_slug: 'full-body-3x',
    template_version: 1,
    name: 'Full Body 3x',
    customizations: {},
    status,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  };
}

describe('<EquipmentEditor>', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(equipApi, 'getEquipmentProfile').mockResolvedValue({ _v: 1, barbell: true });
  });

  it('gates Reset behind a medium-tier confirm when a program is active', async () => {
    vi.spyOn(upApi, 'listMyPrograms').mockResolvedValue([makeProgram('active')]);
    const putSpy = vi.spyOn(equipApi, 'putEquipmentProfile').mockResolvedValue({ _v: 1 });
    const user = userEvent.setup();
    render(<EquipmentEditor />);

    const resetBtn = await screen.findByRole('button', { name: /reset all equipment/i });
    // Wait for the active-program fetch to settle before clicking.
    await waitFor(() => expect(upApi.listMyPrograms).toHaveBeenCalled());
    await user.click(resetBtn);

    // A confirm dialog opens — nothing is persisted yet.
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(putSpy).not.toHaveBeenCalled();

    // Confirming the medium-tier dialog clears the profile. Scope to the dialog
    // so the matcher doesn't collide with the "Reset all equipment" trigger.
    await user.click(within(dialog).getByRole('button', { name: /^reset|resetting/i }));
    expect(putSpy).toHaveBeenCalledWith({ _v: 1 });
  });

  it('resets immediately without a confirm when no program is active', async () => {
    vi.spyOn(upApi, 'listMyPrograms').mockResolvedValue([makeProgram('completed')]);
    const putSpy = vi.spyOn(equipApi, 'putEquipmentProfile').mockResolvedValue({ _v: 1 });
    const user = userEvent.setup();
    render(<EquipmentEditor />);

    const resetBtn = await screen.findByRole('button', { name: /reset all equipment/i });
    await waitFor(() => expect(upApi.listMyPrograms).toHaveBeenCalled());
    await user.click(resetBtn);

    // No dialog — the action applies directly.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(putSpy).toHaveBeenCalledWith({ _v: 1 }));
  });
});
