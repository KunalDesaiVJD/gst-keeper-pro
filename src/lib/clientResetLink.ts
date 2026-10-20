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

// The database's rule (client_email_list in migration 20261020140000): the
// field may hold several addresses, separated by commas, semicolons or
// spaces; only well-formed ones count (something@domain.tld, a top-level part
// of two or more characters, no trailing dot), each once, in the order
// written. Keep the two in step.
const ADDRESS = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>".]{2,}$/;

/** The addresses a reset link goes to: the well-formed ones in clients.email. */
export function clientEmailList(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (raw ?? '').split(/[,;\s]+/)) {
    const e = part.trim();
    if (!e || !ADDRESS.test(e) || seen.has(e.toLowerCase())) continue;
    seen.add(e.toLowerCase());
    out.push(e);
  }
  return out;
}

/** Where a link would go now, as the database will write it ("a@x.com, b@y.com"). */
export function resetLinkAddresses(saved: string | null | undefined): string {
  return clientEmailList(saved).join(', ');
}

/** True when the form's address differs from the saved one. */
export function emailUnsaved({ saved, typed }: ResetLinkEmail): boolean {
  return typed !== undefined && norm(typed) !== norm(saved);
}

export interface ResetLinkViewer {
  /**
   * The staff member looking can open Edit Client (canAddEditClients()).
   * Every staff level opens the reset dialog, but not every employee can
   * open Edit Client, so only then does the dialog send them there.
   */
  canEditClients?: boolean;
}

/** Why "E-mail reset link" is off, or null when a link can go. */
export function resetLinkBlock(email: ResetLinkEmail, viewer: ResetLinkViewer = {}): string | null {
  if (emailUnsaved(email)) return 'Save the new e-mail first.';
  const edits = viewer.canEditClients === true;
  if (!norm(email.saved)) {
    return edits
      ? 'No e-mail address on record: add one in Edit Client, or set a password below.'
      : 'No e-mail address on record: set a password below, or ask a colleague who edits clients to add one.';
  }
  if (clientEmailList(email.saved).length === 0) {
    return edits
      ? 'No usable e-mail address on record: correct it in Edit Client, or set a password below.'
      : 'No usable e-mail address on record: set a password below, or ask a colleague who edits clients to correct it.';
  }
  return null;
}

/** True when the form's GSTIN (the client's User ID) differs from the saved one. */
export function gstinUnsaved(saved: string | null | undefined, typed: string | null | undefined): boolean {
  return typed !== undefined && typed !== null && typed.trim().toUpperCase() !== (saved ?? '').trim().toUpperCase();
}
