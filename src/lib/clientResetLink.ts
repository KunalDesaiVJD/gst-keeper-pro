// Can staff e-mail a client a reset link from this screen, and if not, why.
// The link goes to the e-mail address saved on the client
// (staff_send_client_reset_link reads clients.email), so a screen that edits
// the address names the saved one and waits for a save before sending.

export interface ResetLinkEmail {
  /** clients.email as last loaded or saved. */
  saved: string | null | undefined;
  /** What the form shows now, on a screen that edits the address. */
  typed?: string | null;
}

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();

/** True when the form's address differs from the saved one. */
export function emailUnsaved({ saved, typed }: ResetLinkEmail): boolean {
  return typed !== undefined && norm(typed) !== norm(saved);
}

/** Why "E-mail reset link" is off, or null when a link can go. */
export function resetLinkBlock(email: ResetLinkEmail): string | null {
  if (emailUnsaved(email)) return 'Save the new e-mail first.';
  if (!email.saved || !/@/.test(email.saved)) return 'No e-mail address on record: add one in Edit Client, or set a password below.';
  return null;
}
