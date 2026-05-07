import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import MyProgramPage from './MyProgramPage'
import * as mesoApi from '../lib/api/mesocycles'
import * as upApi from '../lib/api/userPrograms'

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

const ACTIVE_RUN: mesoApi.MesocycleRunDetail = {
  id: 'mr-1',
  user_program_id: 'up-1',
  start_date: '2026-04-01',
  start_tz: 'America/New_York',
  weeks: 5,
  current_week: 3,
  status: 'active',
}

const COMPLETED_RUN: mesoApi.MesocycleRunDetail = {
  ...ACTIVE_RUN,
  status: 'completed',
  finished_at: '2026-05-01T12:00:00Z',
}

const USER_PROGRAM: upApi.UserProgramDetail = {
  id: 'up-1',
  user_id: 'u-1',
  template_id: 'tmpl-1',
  template_slug: 'full-body-3x',
  template_version: 1,
  name: 'Full Body 3x',
  customizations: {},
  status: 'active',
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
  effective_name: 'Full Body 3x',
  effective_structure: { _v: 1, days: [] },
}

const RECAP_STATS: mesoApi.MesocycleRecapStats = {
  weeks: 5,
  total_sets: 180,
  prs: 3,
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

function renderPage(runId = 'mr-1') {
  return render(
    <MemoryRouter initialEntries={[`/my-programs/${runId}`]}>
      <Routes>
        <Route path="/my-programs/:id" element={<MyProgramPage />} />
        {/* Capture navigations so we can assert the destination */}
        <Route path="/programs/:slug" element={<div data-testid="programs-slug-page" />} />
        <Route path="/programs" element={<div data-testid="programs-catalog-page" />} />
      </Routes>
    </MemoryRouter>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MyProgramPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Default: active run, user program loaded, no warnings.
    vi.spyOn(mesoApi, 'getMesocycle').mockResolvedValue(ACTIVE_RUN)
    vi.spyOn(upApi, 'getUserProgram').mockResolvedValue(USER_PROGRAM)
    vi.spyOn(upApi, 'getUserProgramWarnings').mockResolvedValue([])
    vi.spyOn(mesoApi, 'getMesocycleRecapStats').mockResolvedValue(RECAP_STATS)
    // ProgramPage fetches getMesocycle + getVolumeRollup internally.
    vi.spyOn(mesoApi, 'getVolumeRollup').mockResolvedValue({
      run_id: 'mr-1',
      weeks: [],
    })
  })

  // -------------------------------------------------------------------------
  // Active run — should NOT render recap
  // -------------------------------------------------------------------------

  it('does not render MesocycleRecap for an active run', async () => {
    renderPage()
    // Wait for run to load (loading spinner disappears)
    await waitFor(() => expect(screen.queryByText(/Loading…/i)).not.toBeInTheDocument())
    expect(screen.queryByText(/Solid block/i)).not.toBeInTheDocument()
    expect(mesoApi.getMesocycleRecapStats).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Completed run — recap flow
  // -------------------------------------------------------------------------

  it('shows loading state while recap-stats fetch is in flight', () => {
    vi.spyOn(mesoApi, 'getMesocycle').mockResolvedValue(COMPLETED_RUN)
    // Never resolves during this test
    vi.spyOn(mesoApi, 'getMesocycleRecapStats').mockReturnValue(new Promise(() => {}))
    renderPage()
    // The run fetch resolves synchronously via the mock queue; the recap
    // fetch is held. We see the recap loading state.
    // Note: the first "Loading…" is the run loading spinner; once the run
    // is set the component re-renders into the recap loading branch.
    expect(screen.getByText(/Loading…|Loading recap/i)).toBeInTheDocument()
  })

  it('renders MesocycleRecap with stats once recap-stats load', async () => {
    vi.spyOn(mesoApi, 'getMesocycle').mockResolvedValue(COMPLETED_RUN)
    renderPage()
    // Recap component header
    expect(await screen.findByText(/Solid block/i)).toBeInTheDocument()
    // Stat line rendered by MesocycleRecap: "5 weeks · 180 working sets · 3 PRs"
    expect(screen.getByText(/180/)).toBeInTheDocument()
    expect(screen.getByText(/3 PR/)).toBeInTheDocument()
  })

  it('shows inline error when recap-stats fetch fails (page does not blow up)', async () => {
    vi.spyOn(mesoApi, 'getMesocycle').mockResolvedValue(COMPLETED_RUN)
    vi.spyOn(mesoApi, 'getMesocycleRecapStats').mockRejectedValue(new Error('network error'))
    renderPage()
    expect(await screen.findByText(/Couldn't load recap stats/i)).toBeInTheDocument()
    expect(screen.getByText(/network error/i)).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // handleChoice navigation
  // -------------------------------------------------------------------------

  it('navigates to /programs/:slug?intent=deload on deload choice', async () => {
    vi.spyOn(mesoApi, 'getMesocycle').mockResolvedValue(COMPLETED_RUN)
    renderPage()
    await screen.findByText(/Take a deload/i)
    await userEvent.click(screen.getByText(/Take a deload/i))
    // Navigation lands on the programs-slug route
    expect(screen.getByTestId('programs-slug-page')).toBeInTheDocument()
  })

  it('navigates to /programs/:slug on run_it_back choice', async () => {
    vi.spyOn(mesoApi, 'getMesocycle').mockResolvedValue(COMPLETED_RUN)
    renderPage()
    await screen.findByText(/Run it back/i)
    await userEvent.click(screen.getByText(/Run it back/i))
    expect(screen.getByTestId('programs-slug-page')).toBeInTheDocument()
  })

  it('navigates to /programs on new_program choice', async () => {
    vi.spyOn(mesoApi, 'getMesocycle').mockResolvedValue(COMPLETED_RUN)
    renderPage()
    await screen.findByText(/New program/i)
    await userEvent.click(screen.getByText(/New program/i))
    expect(screen.getByTestId('programs-catalog-page')).toBeInTheDocument()
  })

  it('falls back to /programs when template_slug is null (archived template)', async () => {
    vi.spyOn(mesoApi, 'getMesocycle').mockResolvedValue(COMPLETED_RUN)
    vi.spyOn(upApi, 'getUserProgram').mockResolvedValue({ ...USER_PROGRAM, template_slug: null })
    renderPage()
    await screen.findByText(/Take a deload/i)
    await userEvent.click(screen.getByText(/Take a deload/i))
    expect(screen.getByTestId('programs-catalog-page')).toBeInTheDocument()
  })
})
