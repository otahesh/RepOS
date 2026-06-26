// frontend/src/components/settings/DeleteAccountSection.tsx
//
// Beta W6 Task 16 — irreversible account-delete control on /settings/account.
//
// Flow (spec lines 3615–3619):
//   1. A danger-styled "Delete account" button opens a HEAVY-tier ConfirmDialog
//      whose typed-confirm phrase is CONFIRM_DELETE_ACCOUNT_PHRASE (the single
//      source of truth shared with the API schema + migration comment, per
//      I-CONFIRM-PHRASE-CONST). Confirm stays disabled until the exact phrase
//      is typed — the body confirm-string is the second factor.
//   2. Confirm calls deleteAccount(CONFIRM_DELETE_ACCOUNT_PHRASE) — the route is
//      CF-Access-JWT-only (per C-SIGNOUT-CFACCESS-ONLY) so a stolen bearer can't
//      wipe the account. On 204 success the whole user record is cascade-deleted
//      server-side; we redirect to the CF Access logout to tear down the cookie.
//   3. On failure we surface an error toast and LEAVE the user signed in (no
//      redirect) so they can read the error and retry.

import { useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { deleteAccount } from '../../lib/api/account';
import { CONFIRM_DELETE_ACCOUNT_PHRASE } from '../../lib/constants/accountConfirmPhrases';
import { pushToast } from '../common/ToastHost';

interface Props {
  email: string;
}

export function DeleteAccountSection({ email }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handle = async (): Promise<void> => {
    setBusy(true);
    try {
      await deleteAccount(CONFIRM_DELETE_ACCOUNT_PHRASE);
      // Account is gone server-side; tear down the CF Access cookie. No state
      // to restore — this context is about to be navigated away.
      window.location.assign('/cdn-cgi/access/logout');
    } catch (err) {
      // Stay signed in so the user can read the error and retry.
      pushToast({
        severity: 'error',
        body: 'Account deletion failed. ' + (err instanceof Error ? err.message : 'Try again.'),
      });
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <section
      aria-labelledby="delete-account-title"
      style={{
        background: TOKENS.surface,
        border: `1px solid rgba(255,106,106,0.3)`,
        borderRadius: 12,
        padding: '20px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <h3
        id="delete-account-title"
        style={{ fontSize: 14, fontWeight: 600, color: TOKENS.danger, margin: 0 }}
      >
        Delete account
      </h3>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          lineHeight: 1.5,
          color: TOKENS.textDim,
        }}
      >
        Permanently deletes your account ({email}) and all associated data — programs, logs, weight
        history, and tokens. This cannot be undone.
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            height: 36,
            padding: '0 16px',
            borderRadius: 8,
            border: `1px solid rgba(255,106,106,0.4)`,
            background: 'rgba(255,106,106,0.08)',
            color: TOKENS.danger,
            fontFamily: FONTS.ui,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.2,
            cursor: 'pointer',
          }}
        >
          Delete account
        </button>
      </div>
      <ConfirmDialog
        open={open}
        tier="heavy"
        title="Delete your account?"
        body="This permanently deletes your account and every byte of data tied to it. This cannot be undone."
        requireTyped={CONFIRM_DELETE_ACCOUNT_PHRASE}
        confirmLabel={busy ? 'Deleting…' : 'Delete account'}
        severity="danger"
        onConfirm={() => void handle()}
        onCancel={() => setOpen(false)}
      />
    </section>
  );
}
