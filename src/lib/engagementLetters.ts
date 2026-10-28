// Engagement letters e-signed by the client (the firm's request of 28 October
// 2026; migration 20261028110000, Edge Function engagement-letter,
// docs/ENGAGEMENT_LETTERS.md). The template in versions (a GST Manager or the
// superadmin edits and publishes it), letters sent from Reply Factory → Client
// consent, the client's page /engagement/<token> (the one page summary, the
// full letter, the e-signature with an e-mailed code), the record of every
// step, and the signed letter as a PDF with its certificate. Every write is a
// database function; the link's token and the codes are minted and e-mailed by
// the Edge Function and never reach the app or a readable table.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { letterDocText, letterState } from './engagementLetterRules';

export interface LetterClause { key: string; heading: string; summary: string; text: string }
export type LetterFirm = Partial<Record<FirmField, string>>;
export type FirmField = 'name' | 'frn' | 'address' | 'email' | 'phone' | 'partner_name' | 'partner_membership_no' | 'grievance_name' | 'grievance_email' | 'city';

/** The firm's details the letter quotes; all but the phone are needed to publish (engagement_letter_template_publish). */
export const FIRM_FIELDS: { key: FirmField; label: string; required: boolean; hint?: string }[] = [
  { key: 'name', label: 'Firm name', required: true },
  { key: 'frn', label: 'Firm registration number (ICAI FRN)', required: true },
  { key: 'address', label: 'Office address', required: true },
  { key: 'email', label: 'Firm e-mail', required: true },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'partner_name', label: 'Engagement partner', required: true },
  { key: 'partner_membership_no', label: 'Partner\'s membership number', required: true },
  { key: 'grievance_name', label: 'Grievance officer (DPDP Act)', required: true, hint: 'The person who answers requests about personal data (s.8(9), s.13).' },
  { key: 'grievance_email', label: 'Grievance officer\'s e-mail', required: true },
  { key: 'city', label: 'City for arbitration and courts', required: true },
];

/** The placeholders a clause may use; each letter fills them when it is made. */
export const PLACEHOLDERS: { key: string; meaning: string }[] = [
  { key: 'client_name', meaning: 'the client\'s name' }, { key: 'gstin', meaning: 'the client\'s GSTIN' }, { key: 'pan', meaning: 'the PAN in the GSTIN' },
  { key: 'services', meaning: 'the services chosen when sending, one line each' }, { key: 'fees', meaning: 'the fees typed when sending' },
  { key: 'start_date', meaning: 'the date the engagement starts' }, { key: 'letter_date', meaning: 'the date the letter is made' },
  { key: 'firm_name', meaning: 'Firm name' }, { key: 'firm_frn', meaning: 'FRN' }, { key: 'firm_address', meaning: 'Office address' },
  { key: 'firm_email', meaning: 'Firm e-mail' }, { key: 'partner_name', meaning: 'Engagement partner' },
  { key: 'grievance_name', meaning: 'Grievance officer' }, { key: 'grievance_email', meaning: 'Grievance officer\'s e-mail' }, { key: 'city', meaning: 'City' },
];

/** The services a letter may list (any other can be typed). */
export const SERVICE_OPTIONS: string[] = [
  'Preparation and filing of GST returns (GSTR-1 or IFF, GSTR-3B, and the other periodic returns that apply to you)',
  'Reconciliation of input tax credit with GSTR-2A and GSTR-2B, and of the returns with your books',
  'Annual return and reconciliation statement (GSTR-9 and GSTR-9C) where they apply',
  'Refund applications (RFD-01) and their follow up until the order',
  'Tracking notices, orders and case documents on the GST portal, and drafting replies on your instructions',
  'Appeals before the appellate authority (statement of facts, grounds of appeal, written submission) and appearing at hearings',
  'Registration, amendments, cancellation and revocation of registration',
  'E-invoicing and e-way bill compliance support',
  'Advice on GST questions and transactions you refer to us',
];

export const CAPACITIES = ['Proprietor', 'Partner', 'Designated partner', 'Director', 'Authorised signatory', 'Karta', 'Trustee'];

export interface LetterTemplate {
  version: number; title: string; intro: string; clauses: LetterClause[]; firm: LetterFirm;
  status: 'draft' | 'published' | 'retired'; note: string | null; created_at: string; updated_at: string; updated_by: string | null;
  published_at: string | null; published_by: string | null;
}

export interface LetterConsents { engagement?: boolean; data_processing?: boolean; ai_processing?: boolean }

export interface EngagementLetter {
  id: string; client_id: string | null; client_name: string; client_gstin: string | null; template_version: number;
  to_email: string; cc_email: string | null; vars: Record<string, unknown>; title: string; intro: string; clauses: LetterClause[];
  firm: LetterFirm; doc_sha256: string; status: 'ready' | 'sent' | 'signed' | 'revoked'; send_pending: boolean;
  created_at: string; created_by_name: string | null; sent_at: string | null; sends: number; send_error: string | null; expires_at: string;
  first_opened_at: string | null; full_opened_at: string | null; signed_at: string | null; signer_name: string | null;
  signer_capacity: string | null; signer_email: string | null; consents: LetterConsents | null; decline_reason: string | null;
  declined_at: string | null; ai_withdrawn_at: string | null; revoked_at: string | null; revoked_by: string | null;
  revoke_reason: string | null; copy_sent_at: string | null; copy_error: string | null;
}

export { letterState, LETTER_STATE, letterDocText, type LetterState } from './engagementLetterRules';

const call = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  const d = data as unknown as T & { error?: string };
  if (d && typeof d === 'object' && 'error' in d && typeof d.error === 'string') throw new Error(d.error);
  return d;
};

// ── Staff ──────────────────────────────────────────────────────────────────
export function useLetterTemplates() {
  return useQuery({
    queryKey: ['engagement-letter-templates'],
    queryFn: async (): Promise<LetterTemplate[]> => {
      const { data, error } = await supabase.from('engagement_letter_templates' as never).select('*').order('version', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as LetterTemplate[];
    },
  });
}

/** Every letter, newest first (a few per client at most). */
export function useEngagementLetters() {
  return useQuery({
    queryKey: ['engagement-letters'],
    queryFn: async (): Promise<EngagementLetter[]> => {
      const { data, error } = await supabase.from('engagement_letters' as never).select('*').order('created_at', { ascending: false }).limit(2000);
      if (error) throw error;
      return (data ?? []) as unknown as EngagementLetter[];
    },
    // While a letter is being e-mailed, look again shortly.
    refetchInterval: (q) => ((q.state.data ?? []).some((l) => letterState(l) === 'ready') ? 4_000 : false),
  });
}

/** Each client's latest letter. */
export function latestByClient(letters: EngagementLetter[] | undefined): Map<string, EngagementLetter> {
  const m = new Map<string, EngagementLetter>();
  for (const l of letters ?? []) if (l.client_id && !m.has(l.client_id)) m.set(l.client_id, l);
  return m;
}

export interface Actor { id: string; name: string }

export const saveTemplate = (t: Pick<LetterTemplate, 'version' | 'title' | 'intro' | 'clauses' | 'firm' | 'note'>, a: Actor) =>
  call<{ version: number; new: boolean }>('engagement_letter_template_save', {
    p_version: t.version, p_title: t.title, p_intro: t.intro, p_clauses: t.clauses, p_firm: t.firm, p_note: t.note, p_actor_id: a.id, p_actor_name: a.name,
  });
export const publishTemplate = (version: number, a: Actor) =>
  call<{ version: number }>('engagement_letter_template_publish', { p_version: version, p_actor_id: a.id, p_actor_name: a.name });

/** E-mails a letter made (or asked to be resent); the Edge Function mints its link. */
async function emailLetter(id: string): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke('engagement-letter', { body: { action: 'send', letter_id: id } });
  return !error && (data as { ok?: boolean } | null)?.ok === true;
}

export interface SendInput {
  clientIds: string[]; to: string | null; cc: string | null; services: string[]; fees: string; startDate: string | null;
  validDays: number; message: string | null; replace: boolean;
}
export interface SendResult { sent: { name: string; to: string }[]; failed: { name: string; to: string }[]; skipped: { name: string; why: string }[] }

/** Makes one letter per client (the database renders and fingerprints it), then e-mails each. */
export async function sendLetters(v: SendInput, a: Actor): Promise<SendResult> {
  const made = await call<{ letters: { id: string; name: string; to: string }[]; skipped: { name: string; why: string }[] }>('engagement_letter_create', {
    p_client_ids: v.clientIds, p_to: v.to?.trim() || null, p_cc: v.cc?.trim() || null, p_services: v.services, p_fees: v.fees,
    p_start_date: v.startDate || null, p_valid_days: v.validDays, p_message: v.message?.trim() || null, p_replace: v.replace,
    p_actor_id: a.id, p_actor_name: a.name,
  });
  const out: SendResult = { sent: [], failed: [], skipped: made.skipped ?? [] };
  for (const l of made.letters ?? []) (await emailLetter(l.id) ? out.sent : out.failed).push({ name: l.name, to: l.to });
  return out;
}

export async function resendLetter(id: string, validDays: number, a: Actor): Promise<boolean> {
  await call('engagement_letter_resend', { p_letter_id: id, p_valid_days: validDays, p_actor_id: a.id, p_actor_name: a.name });
  return emailLetter(id);
}
export const revokeLetter = (id: string, reason: string, a: Actor) =>
  call('engagement_letter_revoke', { p_letter_id: id, p_reason: reason, p_actor_id: a.id, p_actor_name: a.name });

export interface LetterEvent { at: string; kind: string; actor: string | null; ip: string | null; user_agent: string | null; detail: Record<string, unknown> | null }
export interface LetterAudit {
  events: LetterEvent[];
  signature: { typed_name: string; drawn_png: string | null; ip: string | null; user_agent: string | null; code_id: string | null; signed_at: string } | null;
  codes: { purpose: string; created_at: string; sent_at: string | null; send_error: string | null; attempts: number; used_at: string | null }[];
}
export function useLetterAudit(id: string | null, actorId: string | null | undefined) {
  return useQuery({
    queryKey: ['engagement-letter-audit', id],
    enabled: !!id && !!actorId,
    queryFn: () => call<LetterAudit>('engagement_letter_audit', { p_letter_id: id, p_actor_id: actorId }),
  });
}

export const EVENT_LABEL: Record<string, string> = {
  created: 'Letter made', resend_asked: 'Resend asked', sent: 'E-mailed', send_failed: 'E-mail failed',
  opened_summary: 'Summary opened', opened_full: 'Full letter opened', code_asked: 'Code asked', code_sent: 'Code e-mailed',
  code_failed: 'Code e-mail failed', sign_refused: 'Signature refused', signed: 'Signed', declined: 'Changes asked',
  ai_withdrawn: 'AI consent withdrawn', copy_sent: 'Signed copy e-mailed', copy_failed: 'Signed copy failed', revoked: 'Withdrawn by the firm',
};

// ── The client's page ──────────────────────────────────────────────────────
export interface LetterView {
  id: string; ref: string; state: 'ready' | 'sent' | 'signed' | 'revoked' | 'expired'; client_name: string; gstin: string | null;
  title: string; intro: string; clauses: LetterClause[]; firm: LetterFirm; version: number; doc_sha256: string;
  sent_at: string | null; expires_at: string; to_masked: string; full_opened: boolean; signed_at: string | null;
  signer_name: string | null; signer_capacity: string | null; consents: LetterConsents | null; declined_at: string | null;
  ai_withdrawn_at: string | null; revoke_reason: string | null;
}

export async function viewLetter(token: string, part: 'summary' | 'full'): Promise<LetterView | { error: string }> {
  const { data, error } = await supabase.rpc('engagement_letter_view' as never, { p_token: token, p_part: part } as never);
  if (error) throw error;
  return data as unknown as LetterView | { error: string };
}

/** Asks for a code; the Edge Function e-mails it. Returns its id and the mark the e-mail carries. */
export async function askLetterCode(token: string, purpose: 'sign' | 'withdraw'): Promise<{ codeId: string; ref: string; toMasked: string; sent: boolean }> {
  const r = await call<{ code_id: string; ref: string; to_masked: string }>('engagement_letter_code_request', { p_token: token, p_purpose: purpose });
  const { data, error } = await supabase.functions.invoke('engagement-letter', { body: { action: 'code', code_id: r.code_id } });
  return { codeId: r.code_id, ref: r.ref, toMasked: r.to_masked, sent: !error && (data as { ok?: boolean } | null)?.ok === true };
}

export async function signLetter(v: {
  token: string; codeId: string; code: string; name: string; capacity: string; consents: Required<LetterConsents>; signature: string | null;
}): Promise<{ ref: string; letterId: string }> {
  const r = await call<{ ref: string; letter_id: string }>('engagement_letter_sign', {
    p_token: v.token, p_code_id: v.codeId, p_code: v.code.replace(/\D/g, ''), p_name: v.name, p_capacity: v.capacity,
    p_consents: v.consents, p_signature: v.signature,
  });
  // The signed copy, e-mailed once (a failure is in the record for the firm to follow).
  await supabase.functions.invoke('engagement-letter', { body: { action: 'copy', letter_id: r.letter_id } }).catch(() => null);
  return { ref: r.ref, letterId: r.letter_id };
}
export const declineLetter = (token: string, reason: string) => call('engagement_letter_decline', { p_token: token, p_reason: reason });
export const withdrawLetterAi = (token: string, codeId: string, code: string) =>
  call('engagement_letter_withdraw_ai', { p_token: token, p_code_id: codeId, p_code: code.replace(/\D/g, '') });

/** What a refusal from the database means, in the page's words. */
export const LETTER_ERRORS: Record<string, string> = {
  not_found: 'This link is not valid, or a newer e-mail replaced it. Please use the link in our latest e-mail, or write to us.',
  expired: 'This link has expired. Please write to us for a new one.',
  revoked: 'The firm has withdrawn this letter. A newer one may be on its way.',
  signed: 'This letter is already signed.',
  ready: 'This letter is being sent again: please use the link in the newest e-mail.',
  read_full: 'Please open and read the full letter first.',
  name: 'Please type your full name.',
  capacity: 'Please say in what capacity you sign.',
  consents: 'Please tick both boxes to accept the letter.',
  ai_choice: 'Please say whether we may use AI tools.',
  signature: 'The drawn signature could not be kept: clear it and draw again, or leave it out.',
  wrong_code: 'That code is not right. Check the e-mail with the mark shown, or ask for a new code.',
  code_expired: 'That code has expired. Ask for a new one.',
  code_spent: 'That code was tried too often. Ask for a new one.',
  code_used: 'That code has been used. Ask for a new one.',
  no_code: 'Ask for a code first.',
  too_many: 'Too many codes were asked for. Please try again in an hour.',
  reason: 'Please say what you would like changed.',
  nothing_to_withdraw: 'There is no consent to AI tools to withdraw.',
};
export const letterError = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  return LETTER_ERRORS[m] ?? m;
};

/** Whether the text shown is the text fingerprinted when the letter was made. */
export async function fingerprintMatches(v: { title: string; intro: string; clauses: LetterClause[]; doc_sha256: string }): Promise<boolean> {
  try {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(letterDocText(v.title, v.intro, v.clauses)));
    return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('') === v.doc_sha256;
  } catch {
    return false;
  }
}

export const istDateTime = (iso: string | null | undefined) => (iso
  ? `${new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })} IST`
  : '');

// ── The signed letter as a PDF, with its certificate of signing ─────────────
export interface LetterPdfInput {
  ref: string; title: string; intro: string; clauses: LetterClause[]; firm: LetterFirm; version: number; doc_sha256: string;
  client_name: string; gstin: string | null; to: string | null; sent_at: string | null;
  signed_at: string | null; signer_name: string | null; signer_capacity: string | null; consents: LetterConsents | null; ai_withdrawn_at: string | null;
  /** The firm's copy: the record of every step with its network address and browser, and the drawn signature. */
  audit?: LetterAudit | null;
}

const plain = (s: string | null | undefined) => (s ?? '').replace(/₹/g, 'Rs. ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, ', ');

export async function downloadLetterPdf(v: LetterPdfInput): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }, { drawFirmLogo }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('@/utils/reportTheme'),
  ]);
  const doc = new jsPDF('p', 'mm', 'a4');
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 18;
  let y = 10;
  drawFirmLogo(doc, { width: 62, y, align: 'center' });
  y = 32;
  const room = (h: number) => { if (y + h > H - 16) { doc.addPage(); y = 16; } };
  const para = (text: string, o: { size?: number; bold?: boolean; indent?: number; gap?: number } = {}) => {
    doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
    doc.setFontSize(o.size ?? 10);
    const lines = doc.splitTextToSize(plain(text), W - 2 * M - (o.indent ?? 0)) as string[];
    for (const line of lines) { room(5); doc.text(line, M + (o.indent ?? 0), y); y += (o.size ?? 10) * 0.45; }
    y += o.gap ?? 2;
  };
  const block = (text: string) => {
    for (const p of text.split(/\n{2,}/)) {
      for (const line of p.split('\n')) {
        if (line.startsWith('• ')) para(`•  ${line.slice(2)}`, { indent: 4, gap: 0.6 });
        else para(line, { gap: 0.6 });
      }
      y += 1.6;
    }
  };
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(plain(v.title), W / 2, y, { align: 'center' }); y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(plain(`${v.client_name}${v.gstin ? `, GSTIN ${v.gstin}` : ''} · version ${v.version} · ref ${v.ref}`), W / 2, y, { align: 'center' }); y += 8;
  block(v.intro);
  v.clauses.forEach((c, i) => {
    room(14);
    para(`${i + 1}. ${c.heading}`, { bold: true, size: 11, gap: 1.5 });
    block(c.text);
  });
  const f = v.firm ?? {};
  room(20);
  para(`For ${f.name ?? ''}, Chartered Accountants (FRN ${f.frn ?? ''})`, { bold: true });
  para(`${f.partner_name ?? ''}, Partner${f.partner_membership_no ? `, membership no. ${f.partner_membership_no}` : ''}`);
  if (f.address) para(f.address);

  // The certificate of signing.
  doc.addPage(); y = 16;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text('Certificate of electronic signature', M, y); y += 4;
  const c = v.consents ?? {};
  const rows: [string, string | null | undefined][] = [
    ['Letter', `${v.title}, version ${v.version}`], ['Reference', v.ref], ['Client', `${v.client_name}${v.gstin ? ` (GSTIN ${v.gstin})` : ''}`],
    ['Sent to', v.to], ['Sent on', istDateTime(v.sent_at)],
    ['Signed by', v.signer_name ? `${v.signer_name}${v.signer_capacity ? `, ${v.signer_capacity}` : ''}` : 'Not signed'],
    ['Signed on', istDateTime(v.signed_at)],
    ['How it was signed', v.signed_at ? 'On the firm\'s portal, after the full letter was opened, with a one time code e-mailed to the address above (section 10A, Information Technology Act, 2000)' : null],
    ['Consents', v.signed_at ? `Terms of the letter: yes. Personal data processing (clause 9): yes. AI tools (clause 11): ${c.ai_processing ? 'yes' : 'no'}${v.ai_withdrawn_at ? `, withdrawn on ${istDateTime(v.ai_withdrawn_at)}` : ''}.` : null],
    ['Document fingerprint (SHA-256)', v.doc_sha256],
    ['Signed from', v.audit?.signature ? `${v.audit.signature.ip ?? 'address not recorded'} · ${v.audit.signature.user_agent ?? ''}` : null],
  ];
  autoTable(doc, {
    startY: y + 2, theme: 'grid', body: rows.filter(([, x]) => x).map(([k, x]) => [k, plain(x as string)]),
    bodyStyles: { fontSize: 9, valign: 'top' }, columnStyles: { 0: { cellWidth: 52, fontStyle: 'bold' } }, margin: { left: M, right: M },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  if (v.signer_name) {
    room(26);
    doc.setFont('times', 'italic'); doc.setFontSize(20); doc.text(plain(v.signer_name), M, y + 8);
    const png = v.audit?.signature?.drawn_png;
    if (png) { try { doc.addImage(png, 'PNG', W - M - 60, y - 2, 60, 22); } catch { /* the typed name stands */ } }
    y += 14;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text('Typed name (and the drawn signature, where one was given), as signed on the portal.', M, y); y += 6;
  }
  if (v.audit?.events.length) {
    autoTable(doc, {
      startY: y, head: [['When (IST)', 'Step', 'By', 'Network address and browser']],
      body: v.audit.events.map((e) => [istDateTime(e.at).replace(' IST', ''), EVENT_LABEL[e.kind] ?? e.kind, plain(e.actor ?? ''), plain(`${e.ip ?? ''} ${e.user_agent ?? ''}`.trim())]),
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 8 }, bodyStyles: { fontSize: 7, valign: 'top' },
      columnStyles: { 0: { cellWidth: 36 }, 1: { cellWidth: 34 }, 2: { cellWidth: 28 } }, margin: { left: M, right: M },
    });
  }
  doc.save(`${plain(v.client_name).replace(/[\\/:*?"<>|]+/g, ' ').trim()} engagement letter ${v.ref}.pdf`);
}
