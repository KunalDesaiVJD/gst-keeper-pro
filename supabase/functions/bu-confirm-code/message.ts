// The e-mail that carries a BU confirmation code. Fixed in code on purpose:
// email_templates can be edited by anyone holding the anon key, and this
// message carries the code that lets its reader answer as this address.
import { buildEmailHtml } from '../_shared/email.ts';

/** One row of builder_bu_confirm_code_claim. */
export interface ClaimedCode {
  code_id: string;
  code: string;
  to_email: string;
  project_name: string;
  client_name: string;
  gstin: string | null;
  expires_at: string;
}

export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** The code as the database minted it: six digits, nothing else. */
export function checkedCode(code: unknown): string {
  const c = String(code ?? '');
  if (!/^[0-9]{6}$/.test(c)) throw new Error('refused: not a 6-digit code');
  return c;
}

/** One address, as the database checked it (no list, no display name). */
export function checkedAddress(to: unknown): string {
  const a = String(to ?? '').trim();
  if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+$/.test(a)) throw new Error('refused: not one e-mail address');
  return a;
}

export function codeEmail(row: ClaimedCode): { subject: string; html: string } {
  const code = checkedCode(row.code);
  const message = [
    `You asked to answer our request to confirm the agreement values for ${esc(row.project_name)}. Your code is:`,
    `<span style="display:inline-block;font-size:24px;font-weight:700;letter-spacing:6px;color:#0f2b46;">${code}</span>`,
    'Type it on the confirmation page. It works for 30 minutes, and only for this e-mail address.',
    'If you did not ask for it, you can ignore this e-mail. Nobody can answer for you without this code.',
  ].join('\n\n');
  const html = buildEmailHtml({
    key: 'builder_bu_confirm_code',
    kind: 'builder_bu_confirm_code',
    message,
    vars: {
      client_name: esc(row.client_name),
      gstin: esc(row.gstin ?? ''),
    },
  });
  return { subject: `Your confirmation code · ${row.project_name}`, html };
}
