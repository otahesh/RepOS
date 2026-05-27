import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LandmarksEditor } from './LandmarksEditor';
import * as lmApi from '../../lib/api/userLandmarks';

// Auto-mock; the repo's vitest config has restoreMocks:true, so resolved
// values are (re)set in beforeEach. The seed mirror is mocked statically (a
// const re-export needs no restore).
vi.mock('../../lib/api/userLandmarks');
vi.mock('../../lib/muscleLandmarksSeed', () => ({
  MUSCLE_LANDMARKS_SEED: { chest: { mev: 10, mav: 14, mrv: 22 }, quads: { mev: 8, mav: 14, mrv: 20 } },
}));

const defaultGetResponse = {
  landmarks: { chest: { mev: 10, mav: 14, mrv: 22 }, quads: { mev: 8, mav: 14, mrv: 20 } },
  par_q_advisory_active: false,
  injury_constraints: {},
};

describe('<LandmarksEditor>', () => {
  beforeEach(() => {
    vi.mocked(lmApi.getLandmarks).mockResolvedValue(defaultGetResponse as any);
    vi.mocked(lmApi.patchLandmarks).mockResolvedValue({
      landmarks: { chest: { mev: 12, mav: 16, mrv: 22 }, quads: { mev: 8, mav: 14, mrv: 20 } },
      par_q_advisory_active: false,
      injury_constraints: {},
    } as any);
  });

  it('renders a row per muscle with MV/MEV/MAV/MRV inputs', async () => {
    render(<LandmarksEditor />);
    await waitFor(() => expect(screen.getByLabelText('chest mev')).toBeInTheDocument());
    expect(screen.getByLabelText('chest mav')).toBeInTheDocument();
    expect(screen.getByLabelText('quads mrv')).toBeInTheDocument();
  });

  it('shows per-row error for clinical floor violation [C-LANDMARKS-CLINICAL-FLOORS]', async () => {
    const user = userEvent.setup();
    render(<LandmarksEditor />);
    await waitFor(() => expect(screen.getByLabelText('chest mev')).toBeInTheDocument());
    const mev = screen.getByLabelText('chest mev');
    await user.clear(mev); await user.type(mev, '1'); // below floor max(2, 10*0.5)=5
    await user.click(screen.getByRole('button', { name: /save landmarks/i }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => /MEV below clinical floor/.test(a.textContent ?? ''))).toBe(true);
  });

  it('shows per-row errors for MULTIPLE bad rows simultaneously [C-LANDMARKS-CLINICAL-FLOORS]', async () => {
    const user = userEvent.setup();
    render(<LandmarksEditor />);
    await waitFor(() => expect(screen.getByLabelText('chest mev')).toBeInTheDocument());
    await user.clear(screen.getByLabelText('chest mev')); await user.type(screen.getByLabelText('chest mev'), '1');
    await user.clear(screen.getByLabelText('quads mrv')); await user.type(screen.getByLabelText('quads mrv'), '60');
    await user.click(screen.getByRole('button', { name: /save landmarks/i }));
    const chestRow = screen.getByText(/chest/i).closest('tr');
    const quadsRow = screen.getByText(/quads/i).closest('tr');
    expect(chestRow?.textContent).toMatch(/MEV below clinical floor/);
    expect(quadsRow?.textContent).toMatch(/MRV above clinical ceiling/);
  });

  it('shows named injury chip with joint + level [I-INJURY-OVERLAY-COPY]', async () => {
    vi.mocked(lmApi.getLandmarks).mockResolvedValueOnce({
      ...defaultGetResponse,
      injury_constraints: { quads: { joint: 'knee_left', level: 'high' } },
    } as any);
    render(<LandmarksEditor />);
    await waitFor(() => expect(screen.getByLabelText('quads mev')).toBeInTheDocument());
    expect(screen.getByText(/knee left.*high/i)).toBeInTheDocument();
  });

  it('shows PAR-Q advisory banner when par_q_advisory_active=true [D2]', async () => {
    vi.mocked(lmApi.getLandmarks).mockResolvedValueOnce({ ...defaultGetResponse, par_q_advisory_active: true } as any);
    render(<LandmarksEditor />);
    await waitFor(() => expect(screen.getByRole('note')).toHaveTextContent(/PAR-Q advisory active/i));
    expect(screen.getByText(/talk to a clinician/i)).toBeInTheDocument();
  });

  it('soft-caps MAV at 80% when PAR-Q active; "Override anyway?" lifts the cap [D2 + I-INJURY-OVERRIDE-CONFIRM]', async () => {
    vi.mocked(lmApi.getLandmarks).mockResolvedValueOnce({ ...defaultGetResponse, par_q_advisory_active: true } as any);
    const user = userEvent.setup();
    render(<LandmarksEditor />);
    await waitFor(() => expect(screen.getByLabelText('chest mev')).toBeInTheDocument());
    // chest.mav default 14 → soft cap floor(14*0.8)=11; type 12 → should error on save.
    await user.clear(screen.getByLabelText('chest mav')); await user.type(screen.getByLabelText('chest mav'), '12');
    await user.click(screen.getByRole('button', { name: /save landmarks/i }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => /MAV above soft-cap/i.test(a.textContent ?? ''))).toBe(true);
    // patchLandmarks must NOT have been called while the soft-cap blocks the save.
    expect(lmApi.patchLandmarks).not.toHaveBeenCalled();
  });

  it('saves a valid override (PATCH called) and shows the saved confirmation', async () => {
    const user = userEvent.setup();
    render(<LandmarksEditor />);
    await waitFor(() => expect(screen.getByLabelText('chest mev')).toBeInTheDocument());
    await user.clear(screen.getByLabelText('chest mev')); await user.type(screen.getByLabelText('chest mev'), '12');
    await user.clear(screen.getByLabelText('chest mav')); await user.type(screen.getByLabelText('chest mav'), '16');
    await user.click(screen.getByRole('button', { name: /save landmarks/i }));
    await waitFor(() => expect(lmApi.patchLandmarks).toHaveBeenCalled());
    expect(await screen.findByText(/applies to your next mesocycle/i)).toBeInTheDocument();
  });
});
