import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MobileWeightChip from './MobileWeightChip';
import { apiFetch } from '../auth';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);

function response(body: unknown, ok = true): Response {
  return { ok, json: vi.fn().mockResolvedValue(body) } as unknown as Response;
}

function mockLoadedWeight() {
  mockedFetch
    .mockResolvedValueOnce(
      response({ source: 'Apple Health', last_success_at: '2026-08-10T12:00:00Z', state: 'fresh' }),
    )
    .mockResolvedValueOnce(
      response({
        current: { weight_lbs: 181.2, date: '2026-08-10', time: '08:00:00' },
        stats: { trend_7d_lbs: -0.8 },
      }),
    );
}

describe('<MobileWeightChip>', () => {
  beforeEach(() => mockedFetch.mockReset());

  it('shows returned weight and sync state', async () => {
    mockLoadedWeight();
    render(<MobileWeightChip />);
    expect(await screen.findByText('181.2')).toBeInTheDocument();
    expect(screen.getByText('fresh')).toBeInTheDocument();
  });

  it('validates the manual measurement range before posting', async () => {
    mockLoadedWeight();
    const user = userEvent.setup();
    render(<MobileWeightChip />);
    await user.click(await screen.findByRole('button', { name: /add manual measurement/i }));
    await user.type(screen.getByRole('spinbutton'), '49');
    await user.click(screen.getByRole('button', { name: /save weight/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/50.0 to 600.0/i);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('posts a manual measurement and refreshes the displayed data', async () => {
    mockLoadedWeight();
    mockedFetch.mockResolvedValueOnce(response({ id: 'weight-1', deduped: false }));
    mockLoadedWeight();
    const user = userEvent.setup();
    render(<MobileWeightChip />);
    await user.click(await screen.findByRole('button', { name: /add manual measurement/i }));
    await user.type(screen.getByRole('spinbutton'), '180.4');
    await user.click(screen.getByRole('button', { name: /save weight/i }));

    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith(
        '/api/health/weight',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const post = mockedFetch.mock.calls.find((call) => call[1]?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      weight_lbs: 180.4,
      source: 'Manual',
    });
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('offers Retry when health data cannot be loaded', async () => {
    mockedFetch
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'));
    render(<MobileWeightChip />);
    expect(await screen.findByText(/bodyweight data is unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
