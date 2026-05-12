import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, screen } from '@testing-library/react'
import { AuthProvider, useCurrentUser } from './auth'

function Probe() {
  const { status, user, error } = useCurrentUser()
  return (
    <>
      <span data-testid="status">{status}</span>
      <span data-testid="user-id">{user?.id ?? 'none'}</span>
      <span data-testid="error">{error ?? 'none'}</span>
    </>
  )
}

describe('AuthProvider', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  it('lands on "authenticated" when /api/me returns 200', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u1',
          email: 'a@b.c',
          display_name: 'A',
          timezone: 'UTC',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    expect(screen.getByTestId('user-id').textContent).toBe('u1')
  })

  it('lands on "error" when /api/me returns 503 (post-flag-flip a 503 is broken, not transitional)', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'cf_access_disabled' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'))
    expect(screen.getByTestId('user-id').textContent).toBe('none')
  })

  it('lands on "error" on 500', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(null, { status: 500 }),
    )
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'))
  })
})
