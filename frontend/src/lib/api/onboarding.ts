// frontend/src/lib/api/onboarding.ts
// W2.2 — onboarding-complete client wrapper. Goes through apiFetch (same-origin
// cookie creds + CF Access 401 redirect handling).
import { apiFetch } from '../../auth';

export type OnboardingGoal = 'cut' | 'maintain' | 'bulk';

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
