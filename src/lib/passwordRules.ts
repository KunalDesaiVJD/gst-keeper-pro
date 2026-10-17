// Client app-login password rules. The database decides
// (client_password_problem / staff_set_client_password in
// supabase/migrations/20261020100000_client_password_reset.sql); this mirror
// only lets the forms say so before a round trip. Keep the wording identical.

export const CLIENT_PASSWORD_MIN = 8;
/** bcrypt reads only the first 72 bytes. */
export const CLIENT_PASSWORD_MAX = 72;

const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

/** A password the client chooses (the e-mailed reset link). Null when fine. */
export function clientPasswordProblem(password: string, gstin?: string | null): string | null {
  if (!password || password.length < CLIENT_PASSWORD_MIN) return 'The new password must be at least 8 characters.';
  if (password.length > CLIENT_PASSWORD_MAX) return 'The new password can be at most 72 characters.';
  if (password !== password.trim()) return 'The new password cannot start or end with a space.';
  if (gstin && password.toUpperCase() === gstin.trim().toUpperCase()) return 'The new password cannot be your GSTIN.';
  if (GSTIN_SHAPE.test(password.toUpperCase())) return 'The new password cannot be a GSTIN.';
  return null;
}

/**
 * A password staff set for a client. Looser on purpose: staff may set the
 * GSTIN, which makes the client choose a new one at first sign-in.
 */
export function staffClientPasswordProblem(password: string): string | null {
  if (!password || password.length < CLIENT_PASSWORD_MIN) return 'The new password must be at least 8 characters.';
  if (password.length > CLIENT_PASSWORD_MAX) return 'The new password can be at most 72 characters.';
  return null;
}
