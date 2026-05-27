// frontend/src/components/onboarding/OnboardingOverlay.tsx
//
// W2.2 — 5-step responsive onboarding wizard.
//
// A11y baseline matches frontend/src/components/programs/MidSessionSwapPicker.tsx
// (panel C-A11Y): focus trap, initial focus into dialog, re-focus on step
// change, return focus on unmount. Onboarding has no Cancel — ESC is a no-op
// (the user completes or skips steps).
//
// Mounted INSIDE <AppShell> as a sibling of <Outlet> (panel C-MOUNT). The
// single derived state machine in AppShell renders this ONLY when
// !onboarding_completed_at.
import { useEffect, useRef, useState } from 'react';
import { useIsMobile } from '../../lib/useIsMobile';
import { Term } from '../Term';
import WelcomeStep from './steps/WelcomeStep';
import EquipmentStep from './steps/EquipmentStep';
import GoalStep from './steps/GoalStep';
import ProgramStep from './steps/ProgramStep';
import ReadyStep from './steps/ReadyStep';
import { completeOnboarding, type OnboardingGoal } from '../../lib/api/onboarding';
import { TOKENS, FONTS } from '../../tokens';

type Step = 1 | 2 | 3 | 4 | 5;

export function OnboardingOverlay({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<Step>(1);
  const [goal, setGoal] = useState<OnboardingGoal>('maintain');
  const isMobile = useIsMobile();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Capture pre-mount focus + return-focus on unmount.
  useEffect(() => {
    previouslyFocusedRef.current = (document.activeElement as HTMLElement) ?? null;
    return () => {
      previouslyFocusedRef.current?.focus?.();
    };
  }, []);

  // Initial focus into the dialog; re-fires on step change so keyboard users
  // land on the new step's first control.
  useEffect(() => {
    const first = dialogRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
  }, [step]);

  // Focus trap.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  async function finish() {
    await completeOnboarding(goal);
    onComplete();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      ref={dialogRef}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(10,13,18,0.92)',
        display: 'flex', alignItems: isMobile ? 'flex-start' : 'center',
        justifyContent: 'center', zIndex: TOKENS.zModal.zOverlay,
        padding: isMobile ? 0 : 24, overflowY: 'auto',
      }}
    >
      <div style={{
        background: TOKENS.surface, border: `1px solid ${TOKENS.line}`,
        borderRadius: isMobile ? 0 : 16,
        padding: isMobile ? '24px 16px 80px' : '32px 36px',
        maxWidth: 720, width: '100%', minHeight: isMobile ? '100vh' : 'auto',
        fontFamily: FONTS.ui,
      }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: 1.4, color: TOKENS.accent, marginBottom: 8 }}>
          ONBOARDING · STEP {step} / 5
        </div>
        <h2 id="onboarding-title" style={{ fontSize: 24, fontWeight: 700, color: TOKENS.text, margin: '0 0 14px', letterSpacing: -0.4 }}>
          {step === 1 && 'Welcome to RepOS'}
          {step === 2 && 'What equipment do you have?'}
          {step === 3 && "What's your goal?"}
          {step === 4 && 'Pick a program'}
          {step === 5 && <>Ready to start your first <Term k="mesocycle" />?</>}
        </h2>
        {step === 1 && <WelcomeStep onNext={() => setStep(2)} />}
        {step === 2 && <EquipmentStep onNext={() => setStep(3)} onSkip={() => setStep(3)} />}
        {step === 3 && <GoalStep goal={goal} onChange={setGoal} onNext={() => setStep(4)} onSkip={() => setStep(4)} />}
        {step === 4 && <ProgramStep goal={goal} onNext={() => setStep(5)} onSkip={() => setStep(5)} />}
        {step === 5 && <ReadyStep onStart={finish} />}
      </div>
    </div>
  );
}
