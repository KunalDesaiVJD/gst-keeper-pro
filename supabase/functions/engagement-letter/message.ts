// The e-mails of an engagement letter (migration 20261028110000, docs/ENGAGEMENT_LETTERS.md):
// the letter itself (its one page summary, each line linking to that clause of the
// full letter on the firm's page), the code that signs it, and the signed copy.
// Fixed in code on purpose: email_templates can be edited by anyone holding the
// anon key, and these messages carry the link and the code that sign for a client.
import { buildEmailHtml } from '../_shared/email.ts';
import { DOC_LINK_ORIGIN } from '../_shared/docLink.ts';

export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** The page of a letter's link: always the firm's own address, never one read from a setting. */
export const letterLink = (token: string) => `${DOC_LINK_ORIGIN}/engagement/${encodeURIComponent(token)}`;
export const clauseLink = (token: string, n: number) => `${letterLink(token)}?clause=${n}`;

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
  staff_name: esc(f.partner_name ? `${f.partner_name}, for ${f.name || 'V. J. Desai & Co. LLP'}` : ''),
});

/** The one page summary: each term in a line, each opening its clause in the full letter. */
export function summaryHtml(token: string, lines: SummaryLine[]): string {
  const rows = lines.map((l) => `<tr>
<td style="padding:9px 0 9px 14px;border-top:1px solid #e2e8f0;vertical-align:top;width:22px;color:#64748b;font-weight:600;">${l.n}</td>
<td style="padding:9px 14px 9px 6px;border-top:1px solid #e2e8f0;">
<a href="${clauseLink(token, l.n)}" style="font-weight:600;color:#0f2b46;text-decoration:none;">${esc(l.heading)}</a>
<div style="color:#475569;margin-top:2px;">${esc(l.summary)}</div>
<a href="${clauseLink(token, l.n)}" style="display:inline-block;margin-top:3px;font-size:12px;color:#1d4ed8;">Read clause ${l.n} in full</a>
</td></tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;margin:4px 0 18px;font-size:13px;line-height:1.5;">
<tr><td colspan="2" style="padding:10px 14px;background:#f8fafc;font-weight:700;color:#0f2b46;">The letter on one page</td></tr>
${rows}
<tr><td colspan="2" style="padding:10px 14px;border-top:1px solid #e2e8f0;background:#f8fafc;"><a href="${letterLink(token)}?part=full" style="font-weight:600;color:#1d4ed8;">Read the full engagement letter</a></td></tr>
</table>`;
}

export function letterEmail(l: IssuedLetter, token: string): { subject: string; html: string } {
  const f = l.firm ?? {};
  const message = [
    `We are pleased to set out the terms on which ${esc(f.name || 'we')} will act for ${esc(l.client_name)} on its affairs under the GST laws. The summary below gives each term in a line; each line opens that clause of the full letter on our page.`,
    l.message ? esc(l.message) : '',
    'To accept it, open the letter with the button, read it in full, type your name and capacity, say whether we may use AI tools on your notices, and confirm with the 6 digit code we then e-mail to this address. A signed copy comes to you by e-mail.',
    'The letter also tells you how we protect personal data under the Digital Personal Data Protection Act, 2023 (clauses 9 to 14), what your rights are, and how to reach our grievance officer.',
    `If this e-mail is not meant for you, please ignore it and tell us at ${esc(f.email || 'gst@vjdesai.com')}.`,
  ].filter(Boolean).join('\n\n');
  const html = buildEmailHtml({
    key: 'engagement_letter',
    kind: 'engagement_letter',
    message,
    vars: {
      ...firmVars(f),
      client_name: esc(l.client_name),
      gstin: esc(l.gstin ?? ''),
      letter: esc(`${l.title} (version ${l.version})`),
      valid_until: esc(istDate(l.expires_at)),
      cta_url: letterLink(token),
      cta_label: 'Review and e-sign the letter',
      summary_html: summaryHtml(token, l.summary ?? []),
    },
  });
  return { subject: `${l.resend ? 'Reminder: ' : ''}Engagement letter for ${l.client_name}: please review and e-sign`, html };
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
  const f = s.firm ?? {};
  const ai = s.consents?.ai_processing === true;
  const message = [
    `Thank you. Your e-signature on our engagement letter for ${esc(s.client_name)} is recorded.`,
    `You agreed to the terms of the letter and to the processing of personal data it describes (clause 9). AI tools (clause 11): you ${ai ? '<strong>allowed</strong>' : '<strong>did not allow</strong>'} us to use them on your notices.`,
    `The fingerprint of the text you signed (SHA-256) is <span style="font-family:Consolas,monospace;font-size:12px;word-break:break-all;">${esc(s.doc_sha256)}</span>. It identifies that exact text.`,
    `The button opens the signed letter, which you can print or save as a PDF.${ai ? ' From that page you can also withdraw your consent to AI tools at any time.' : ''} For any question about your personal data, write to ${esc(f.grievance_email || f.email || 'gst@vjdesai.com')}.`,
  ].join('\n\n');
  const html = buildEmailHtml({
    key: 'engagement_letter_signed',
    kind: 'engagement_letter_signed',
    message,
    vars: {
      ...firmVars(f),
      contact_person: esc(s.signer_name),
      client_name: esc(s.client_name),
      gstin: esc(s.gstin ?? ''),
      letter: esc(`${s.title} (version ${s.version})`),
      signed_by: esc(`${s.signer_name}, ${s.signer_capacity}`),
      signed_on: esc(istDateTime(s.signed_at)),
      letter_ref: esc(s.ref),
      cta_url: letterLink(token),
      cta_label: 'Open the signed letter',
    },
  });
  return { subject: `Signed: engagement letter for ${s.client_name} (ref ${s.ref})`, html };
}

/** The firm's own note of a signature: the facts and where the record is kept, without the client's link. */
export function firmCopyEmail(s: SignedLetter): { subject: string; html: string } {
  const ai = s.consents?.ai_processing === true;
  const message = [
    `${esc(s.client_name)} e-signed the engagement letter (version ${s.version}).`,
    `Signed by ${esc(s.signer_name)} (${esc(s.signer_capacity)}) at ${esc(s.to)} on ${esc(istDateTime(s.signed_at))}. AI tools: ${ai ? 'allowed' : 'not allowed'}; the client's consent is recorded on Client consent.`,
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
