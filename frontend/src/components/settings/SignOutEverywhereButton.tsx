// frontend/src/components/settings/SignOutEverywhereButton.tsx
//
// Beta W6 Task 15 — "Sign out everywhere" control on /settings/account.
//
// Flow:
//   1. Click opens a MEDIUM-tier ConfirmDialog (no typed-confirm phrase — this
//      is reversible by re-minting, so it doesn't warrant the heavy tier the
//      account-delete path uses).
//   2. Confirm calls signOutEverywhere() (revokes every bearer token + clears
//      the CF Access cookie server-side, per C-SIGNOUT-CFACCESS-ONLY).
//   3. On success it posts a `{ type: 'signout_everywhere' }` message on
//      BroadcastChannel('repos-auth') BEFORE redirecting (per I-BROADCASTCHANNEL),
//      so any other RepOS tab in this browser hears the signal via the
//      AuthProvider listener and redirects itself to the CF Access logout.
//   4. This tab then redirects to /cdn-cgi/access/logout to tear down its own
//      CF Access cookie.
//
// BroadcastChannel is wrapped in try/catch — older browsers without it still
// complete the sign-out + redirect; they just don't get the cross-tab nudge.
//
// On failure we surface a toast and re-open the affordance (close the dialog,
// drop busy) so the user can retry.

import { useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { signOutEverywhere } from '../../lib/api/account';
import { pushToast } from '../common/ToastHost';

export function SignOutEverywhereButton(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handle = async (): Promise<void> => {
    setBusy(true);
    try {
      await signOutEverywhere();
      // Cross-tab signal BEFORE we navigate this tab away — once we redirect,
      // this execution context is gone and can't post anything.
      try {
        const ch = new BroadcastChannel('repos-auth');
        ch.postMessage({ type: 'signout_everywhere' });
        ch.close();
      } catch {
        /* BroadcastChannel unavailable — non-fatal; this tab still logs out. */
      }
      window.location.assign('/cdn-cgi/access/logout');
    } catch (err) {
      pushToast({
        severity: 'error',
        body:
          'Sign out everywhere failed. ' +
          (err instanceof Error ? err.message : 'Try again.'),
      });
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          height: 36,
          padding: '0 16px',
          borderRadius: 8,
          border: `1px solid ${TOKENS.accentDim}`,
          background: TOKENS.accentGlow,
          color: TOKENS.accent,
          fontFamily: FONTS.ui,
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: 0.2,
          cursor: 'pointer',
        }}
      >
        Sign out everywhere
      </button>
      <ConfirmDialog
        open={open}
        tier="medium"
        title="End this session on every device?"
        body="This signs out every device, including your iOS Shortcut. Re-mint required."
        confirmLabel={busy ? 'Signing out…' : 'Confirm'}
        severity="accent"
        onConfirm={() => void handle()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
