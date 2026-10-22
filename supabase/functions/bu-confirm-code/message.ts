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

/**
 * A code's reference: 4 letters from its id (no digits, and no I or O, so it
 * is never read or typed as the code). The same as the database's
 * builder_bu_confirm_code_ref and the page's codeRef
 * (src/lib/builderConfirmRules.ts): the page shows it next to the Code box
 * and the messages name "the e-mail marked <ref>", so a reader who gets codes
 * asked for by two pages (a shared mailbox, or another holder of the link)
 * types the one their page asked for (migration 20261021160000).
 */
export function codeRef(codeId: string): string {
  const map = '0123456789abcdef';
  const to = 'ABCDEFGHJKLMNPQR';
  return String(codeId ?? '').toLowerCase().replace(/-/g, '').slice(0, 4)
    .split('').map((c) => to[map.indexOf(c)] ?? '').join('');
}

/** "10:42 am" in India time, when the e-mail goes. */
export const istTime = (at: Date): string =>
  at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

export function codeEmail(row: ClaimedCode, now: Date = new Date()): { subject: string; html: string } {
  const code = checkedCode(row.code);
  const ref = codeRef(row.code_id);
  const message = [
    `You asked to answer our request to confirm the agreement values for ${esc(row.project_name)}. Your code is:`,
    `<span style="display:inline-block;font-size:24px;font-weight:700;letter-spacing:6px;color:#0f2b46;">${code}</span>`,
    `This e-mail is marked <strong>${esc(ref)}</strong> (sent at ${esc(istTime(now))} IST). The confirmation page shows the same mark next to the Code box: if more than one code came, type the one from the e-mail with that mark.`,
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
  // The digits stay out of the subject (round 4 asked about putting them
  // there): the firm's Microsoft 365 message trace lists every subject the
  // sender sent, so its admins could read a client's code there. The page
  // keeps the code step across a closed tab instead (AgreementConfirmPage).
  // The reference is no secret, and in the subject it tells the e-mails
  // apart in the inbox list.
  return { subject: `Your confirmation code (${ref}) · ${row.project_name}`, html };
}
