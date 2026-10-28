// The e-mails of an engagement letter (migrations 20261028110000 and 130000,
// docs/ENGAGEMENT_LETTERS.md): the link to the letter (the page opens on its one
// page summary, each line opening that clause of the full letter), the code that
// signs it, and the signed letter to download. Short on purpose (the firm, 28
// October 2026).
// Fixed in code on purpose: email_templates can be edited by anyone holding the
// anon key, and these messages carry the link and the code that sign for a client.
import { buildEmailHtml } from '../_shared/email.ts';
import { DOC_LINK_ORIGIN } from '../_shared/docLink.ts';

export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** The page of a letter's link: always the firm's own address, never one read from a setting. */
export const letterLink = (token: string) => `${DOC_LINK_ORIGIN}/engagement/${encodeURIComponent(token)}`;

/** One address, as the database checked it (no list, no display name). */
export function checkedAddress(to: unknown): string {
  const a = String(to ?? '').trim();
  if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+$/.test(a)) throw new Error('refused: not one e-mail address');
  return a;
}

/** The code as the database minted it: six digits, nothing else. */
export function checkedCode(code: unknown): string {
  const c = String(code ?? '');
  if (!/^[0-9]{6}$/.test(c)) throw new Error('refused: not a 6-digit code');
  return c;
}

const IST: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Kolkata' };
export const istDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { ...IST, day: 'numeric', month: 'long', year: 'numeric' });
export const istDateTime = (iso: string) =>
  `${new Date(iso).toLocaleString('en-IN', { ...IST, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })} IST`;

export interface Firm { name?: string; email?: string; partner_name?: string; grievance_email?: string }
export interface SummaryLine { n: number; key: string; heading: string; summary: string }

/** What engagement_letter_issue hands over for the e-mail. */
export interface IssuedLetter {
  id: string; to: string; cc: string | null; client_name: string; gstin: string | null; title: string; version: number;
  firm: Firm; expires_at: string; message: string | null; resend: boolean; summary: SummaryLine[];
}

const firmVars = (f: Firm) => ({
  firm_name: esc(f.name || 'V. J. Desai & Co. LLP'),
  firm_email: esc(f.email || 'gst@vjdesai.com'),
  // The firm's name is the line under it.
  staff_name: esc(f.partner_name ?? ''),
});

export function letterEmail(l: IssuedLetter, token: string): { subject: string; html: string } {
  // Only the link (the firm, 28 October 2026: "Email is too long"): the page opens on the letter's one page summary.
  const message = [
    `Please find our engagement letter for ${esc(l.client_name)}, for your review and e-signature.`,
    l.message ? esc(l.message) : '',
    `The button opens the letter. Read it and sign it there with a code we e-mail to you. The link works until ${esc(istDate(l.expires_at))}.`,
  ].filter(Boolean).join('\n\n');
  const html = buildEmailHtml({
    key: 'engagement_letter',
    kind: 'engagement_letter',
    message,
    vars: { ...firmVars(l.firm ?? {}), client_name: esc(l.client_name), cta_url: letterLink(token), cta_label: 'Review and sign the engagement letter' },
  });
  return { subject: `${l.resend ? 'Reminder: ' : ''}Engagement letter for ${l.client_name}: please review and sign`, html };
}

/** What engagement_letter_code_claim hands over. */
export interface ClaimedCode {
  code_id: string; code: string; to: string; purpose: 'sign' | 'withdraw'; client_name: string; gstin: string | null; title: string; firm: Firm; ref: string;
}

export function codeEmail(c: ClaimedCode, now: Date = new Date()): { subject: string; html: string } {
  const code = checkedCode(c.code);
  const what = c.purpose === 'withdraw' ? `withdraw your consent to AI tools under the engagement letter of ${esc(c.client_name)}` : `sign the engagement letter of ${esc(c.client_name)}`;
  const message = [
    `You asked for a code to ${what}. Your code is:`,
    `<span style="display:inline-block;font-size:24px;font-weight:700;letter-spacing:6px;color:#0f2b46;">${code}</span>`,
    `This e-mail is marked <strong>${esc(c.ref)}</strong> (sent at ${esc(now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }))} IST). The page shows the same mark next to the Code box: if more than one code came, type the one with that mark.`,
    'Type it on the page. It works for 30 minutes.',
    'If you did not ask for it, you can ignore this e-mail: nobody can sign for you without this code.',
  ].join('\n\n');
  const html = buildEmailHtml({
    key: 'engagement_letter_code',
    kind: 'engagement_letter_code',
    message,
    vars: { ...firmVars(c.firm ?? {}), client_name: esc(c.client_name), gstin: esc(c.gstin ?? '') },
  });
  // The digits stay out of the subject: the firm's mail trace lists every subject it sent.
  return { subject: `Your signing code (${c.ref}) · ${c.client_name}`, html };
}

/** What engagement_letter_copy_claim hands over. */
export interface SignedLetter {
  id: string; ref: string; to: string; cc: string | null; client_name: string; gstin: string | null; title: string; version: number; firm: Firm;
  signer_name: string; signer_capacity: string; signed_at: string; consents: { engagement?: boolean; data_processing?: boolean; ai_processing?: boolean };
  doc_sha256: string;
}

export function copyEmail(s: SignedLetter, token: string): { subject: string; html: string } {
  // Short (the firm, 28 October 2026): the signed letter to download, nothing else.
  const message = `Thank you. The engagement letter for ${esc(s.client_name)} is signed. Download the signed letter with the button.`;
  const html = buildEmailHtml({
    key: 'engagement_letter_signed',
    kind: 'engagement_letter_signed',
    message,
    vars: {
      ...firmVars(s.firm ?? {}),
      contact_person: esc(s.signer_name),
      client_name: esc(s.client_name),
      cta_url: `${letterLink(token)}?download=1`,
      cta_label: 'Download the signed letter',
    },
  });
  return { subject: `Signed: engagement letter for ${s.client_name}`, html };
}

/** The firm's own note of a signature: the facts and where the record is kept, without the client's link. */
export function firmCopyEmail(s: SignedLetter): { subject: string; html: string } {
  const message = [
    `${esc(s.client_name)} e-signed the engagement letter (version ${s.version}).`,
    `Signed by ${esc(s.signer_name)} (${esc(s.signer_capacity)}) at ${esc(s.to)} on ${esc(istDateTime(s.signed_at))}; the client's consent is recorded on Client consent.`,
    `Document fingerprint (SHA-256): <span style="font-family:Consolas,monospace;font-size:12px;word-break:break-all;">${esc(s.doc_sha256)}</span>.`,
    'The full record (every step, with its time, network address and browser) and the signed PDF are under Reply Factory, Client consent, on the client\'s letter.',
  ].join('\n\n');
  const html = buildEmailHtml({
    key: 'engagement_letter_signed',
    kind: 'engagement_letter_signed',
    message,
    vars: {
      ...firmVars(s.firm ?? {}),
      contact_person: 'Team',
      client_name: esc(s.client_name),
      gstin: esc(s.gstin ?? ''),
      letter: esc(`${s.title} (version ${s.version})`),
      signed_by: esc(`${s.signer_name}, ${s.signer_capacity}`),
      signed_on: esc(istDateTime(s.signed_at)),
      letter_ref: esc(s.ref),
      cta_url: `${DOC_LINK_ORIGIN}/notices-reply-factory?tab=consent&letter=${encodeURIComponent(s.id)}`,
      cta_label: 'Open the record',
    },
  });
  return { subject: `Engagement letter signed: ${s.client_name} (ref ${s.ref})`, html };
}
