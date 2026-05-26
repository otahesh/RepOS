// Centralized typed-confirm phrase for DELETE /api/me. Mirrored on the API
// side in api/src/schemas/account.ts (Task 9). Any drift here is caught by
// the cascade test (it imports the API constant and exercises the dialog
// with this exact string).
//
// Per I-CONFIRM-PHRASE-CONST.

export const CONFIRM_DELETE_ACCOUNT_PHRASE = 'DELETE my account';
