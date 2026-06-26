import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('SettingsProgramPrefsPage feature flag [I-FEATURE-FLAG-INLINE]', () => {
  // The flag is read inline via import.meta.env at module load in
  // SettingsProgramPrefsPage.tsx, so we resetModules + stubEnv + re-import.
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders "temporarily unavailable" when VITE_BETA_LANDMARKS_EDITOR=off', async () => {
    vi.stubEnv('VITE_BETA_LANDMARKS_EDITOR', 'off');
    const { default: Page } = await import('./SettingsProgramPrefsPage');
    render(<Page />);
    expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument();
  });

  it('renders the editor (not the unavailable notice) when VITE_BETA_LANDMARKS_EDITOR is unset (default ON)', async () => {
    vi.stubEnv('VITE_BETA_LANDMARKS_EDITOR', '');
    const { default: Page } = await import('./SettingsProgramPrefsPage');
    render(<Page />);
    expect(screen.queryByText(/temporarily unavailable/i)).not.toBeInTheDocument();
  });
});
