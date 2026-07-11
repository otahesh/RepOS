// frontend/src/lib/api/onboarding.ts
// W2.2 — onboarding-complete client wrapper. Goes through apiFetch (same-origin
// cookie creds + CF Access 401 redirect handling).
import { apiFetch } from '../../auth';

export type OnboardingGoal = 'cut' | 'maintain' | 'bulk';

// G14 — first-run Beta disclaimer ack. Idempotent server-side.
export async function ackBetaDisclaimer(): Promise<{ beta_disclaimer_ack_at: string }> {
  const res = await apiFetch('/api/me/beta-disclaimer-ack', { method: 'POST' });
  if (!res.ok) throw new Error(`beta_disclaimer_ack_failed_${res.status}`);
  return res.json();
}

export async function completeOnboarding(
  goal: OnboardingGoal,
): Promise<{ onboarding_completed_at: string }> {
  const res = await apiFetch('/api/me/onboarding/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal }),
  });
  if (!res.ok) throw new Error(`onboarding_failed_${res.status}`);
  return res.json();
}
