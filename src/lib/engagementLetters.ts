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
  { key: 'services', meaning: 'the services chosen when sending, one line each' }, { key: 'fees', meaning: 'the fees typed when sending (asked only when a clause quotes it)' },
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

/**
 * The letter as a PDF (the firm, 28 October 2026: "properly structured, justified"):
 * the letterhead, the reference and date, the addressee, the subject, the
 * clauses numbered with their text justified, and the signatures (the firm's
 * and the client's e-signature with its record), every page footed with the
 * reference and its number. The firm's copy adds a page with every step of the
 * signing, its network address and browser.
 */
export async function downloadLetterPdf(v: LetterPdfInput): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }, { drawFirmLogo }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('@/utils/reportTheme'),
  ]);
  const doc = new jsPDF('p', 'mm', 'a4');
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 18;
  const TW = W - 2 * M;
  const BODY = 9.5;
  const LH = 4.25;
  const INK: [number, number, number] = [17, 24, 39];
  const MUTED: [number, number, number] = [100, 116, 139];
  const NAVY: [number, number, number] = [15, 43, 70];
  const f = v.firm ?? {};
  let y = 0;
  const room = (h: number) => { if (y + h > H - 18) { doc.addPage(); y = 18; } };
  const font = (size: number, style: 'normal' | 'bold' | 'italic' = 'normal', color = INK, face = 'helvetica') => {
    doc.setFont(face, style); doc.setFontSize(size); doc.setTextColor(...color);
  };
  // One line spread to the full width by jsPDF's own word spacing, so the text
  // copies with its spaces (a line justifies when it is not its block's last:
  // hence the empty line after it). A short line, with too few words to spread, stays left.
  const justified = (line: string, x: number, at: number, width: number) => {
    const words = line.trim().split(/\s+/);
    const gap = words.length > 1 ? (width - doc.getTextWidth(line.trim())) / (words.length - 1) : Infinity;
    if (gap > doc.getTextWidth(' ') * 4) { doc.text(line, x, at); return; }
    doc.text([line.trim(), ''], x, at, { maxWidth: width, align: 'justify' });
  };
  const para = (text: string, o: { indent?: number; bullet?: boolean; gap?: number } = {}) => {
    font(BODY);
    const x = M + (o.indent ?? 0);
    const width = TW - (o.indent ?? 0);
    const lines = doc.splitTextToSize(plain(text), width) as string[];
    lines.forEach((line, i) => {
      room(LH);
      if (o.bullet && i === 0) doc.text('\u2022', x - 3.5, y);
      if (i < lines.length - 1) justified(line, x, y, width); else doc.text(line, x, y);
      y += LH;
    });
    y += o.gap ?? 1.4;
  };
  const block = (text: string) => {
    for (const p of text.split(/\n{2,}/)) {
      const lines = p.split('\n').filter((l) => l.trim());
      lines.forEach((line, i) => {
        const bullet = /^\s*[•*-]\s+/.test(line);
        para(bullet ? line.replace(/^\s*[•*-]\s+/, '') : line, { indent: bullet ? 5 : 0, bullet, gap: i < lines.length - 1 ? 0.5 : 1.4 });
      });
    }
  };

  // The letterhead.
  y = drawFirmLogo(doc, { width: 54, y: 10, align: 'center' }) + 4;
  font(7.8, 'normal', MUTED);
  const head = [f.address, [f.email, f.phone].filter(Boolean).join('  |  ')].filter(Boolean) as string[];
  head.forEach((l) => { doc.text(plain(l), W / 2, y, { align: 'center', maxWidth: TW }); y += 3.4; });
  doc.setDrawColor(...NAVY); doc.setLineWidth(0.5); doc.line(M, y, W - M, y);
  doc.setLineWidth(0.15); doc.line(M, y + 0.9, W - M, y + 0.9);
  y += 7;

  // Reference and date, the addressee, the subject.
  const dated = v.sent_at ?? v.signed_at;
  font(9, 'normal', MUTED);
  doc.text(plain(`Ref: ${v.ref}`), M, y);
  if (dated) doc.text(plain(`${f.city ? `${f.city}, ` : ''}${new Date(dated).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' })}`), W - M, y, { align: 'right' });
  y += 7;
  font(BODY); doc.text('To,', M, y); y += LH;
  font(BODY, 'bold'); doc.text(plain(v.client_name), M, y); y += LH;
  if (v.gstin) { font(BODY); doc.text(plain(`GSTIN: ${v.gstin}`), M, y); y += LH; }
  y += 3;
  font(BODY, 'bold', NAVY);
  doc.text(plain(`Subject: ${v.title}`), M, y); y += 2;
  doc.setDrawColor(...NAVY); doc.setLineWidth(0.2); doc.line(M, y, M + Math.min(TW, doc.getTextWidth(plain(`Subject: ${v.title}`))), y);
  y += 5.5;
  block(v.intro);
  y += 1;

  // The clauses.
  v.clauses.forEach((c, i) => {
    room(LH * 3);
    font(10, 'bold', NAVY);
    doc.text(plain(`${i + 1}.  ${c.heading}`), M, y);
    y += LH + 0.4;
    block(c.text);
    y += 0.6;
  });

  // The signatures: the firm's, and the client's acceptance by e-signature.
  room(56);
  y += 3;
  const col = (W - 2 * M - 10) / 2;
  const R = M + col + 10;
  const top = y;
  font(BODY, 'bold'); doc.text(plain(`For ${f.name ?? ''}`), M, y);
  doc.text(plain(`Accepted for ${v.client_name}`), R, y, { maxWidth: col });
  y += LH;
  font(8.5, 'normal', MUTED);
  doc.text(plain(`Chartered Accountants${f.frn ? `, FRN ${f.frn}` : ''}`), M, y);
  y = top + 22;
  font(BODY, 'bold'); doc.text(plain(f.partner_name ?? ''), M, y); y += LH;
  font(8.5, 'normal', MUTED);
  doc.text(plain(`Partner${f.partner_membership_no ? `, Membership No. ${f.partner_membership_no}` : ''}`), M, y); y += 3.8;
  if (f.city) doc.text(plain(f.city), M, y);
  // The client's side.
  let ry = top + LH + 1;
  if (v.signer_name) {
    const png = v.audit?.signature?.drawn_png;
    if (png) { try { doc.addImage(png, 'PNG', R, ry - 1, 42, 15); } catch { /* the typed name stands */ } }
    font(17, 'italic', NAVY, 'times');
    doc.text(plain(v.signer_name), png ? R + 44 : R, ry + 9, { maxWidth: png ? col - 44 : col });
    ry = top + 22;
    font(BODY, 'bold'); doc.text(plain(v.signer_name), R, ry, { maxWidth: col }); ry += LH;
    font(8.5, 'normal', MUTED);
    if (v.signer_capacity) { doc.text(plain(v.signer_capacity), R, ry); ry += 3.8; }
    if (v.signed_at) { doc.text(plain(`E-signed on ${istDateTime(v.signed_at)}`), R, ry, { maxWidth: col }); ry += 3.8; }
  } else {
    font(8.5, 'normal', MUTED);
    ry = top + 22;
    ['Name', 'Capacity', 'Date'].forEach((l) => { doc.text(`${l}:`, R, ry); doc.setDrawColor(...MUTED); doc.line(R + 16, ry + 0.6, R + col, ry + 0.6); ry += 5; });
  }
  y = Math.max(y, ry) + 6;
  if (v.signed_at) {
    room(14);
    doc.setDrawColor(...MUTED); doc.setLineWidth(0.1); doc.line(M, y - 3, W - M, y - 3);
    font(7.4, 'normal', MUTED);
    const note = `Signed electronically on the firm's portal after the full letter was opened, confirmed by a one time code e-mailed to ${v.to ?? 'the client'} `
      + `(section 10A, Information Technology Act, 2000). Fingerprint of the text signed (SHA-256): ${v.doc_sha256}.`;
    const lines = doc.splitTextToSize(plain(note), TW) as string[];
    lines.forEach((l) => { doc.text(l, M, y); y += 3.2; });
  }

  // The firm's copy: the record of the signing.
  if (v.audit) {
    doc.addPage(); y = 18;
    font(12, 'bold', NAVY); doc.text('Record of the electronic signature', M, y); y += 3;
    const c = v.consents ?? {};
    const rows: [string, string | null | undefined][] = [
      ['Letter', `${v.title}, version ${v.version}`], ['Reference', v.ref], ['Client', `${v.client_name}${v.gstin ? ` (GSTIN ${v.gstin})` : ''}`],
      ['Sent to', v.to], ['Sent on', istDateTime(v.sent_at)],
      ['Signed by', v.signer_name ? `${v.signer_name}${v.signer_capacity ? `, ${v.signer_capacity}` : ''}` : 'Not signed'],
      ['Signed on', istDateTime(v.signed_at)],
      ['Consents', v.signed_at ? `The terms of the letter, with the processing of personal data and the use of AI tools it describes${c.ai_processing === false || v.ai_withdrawn_at ? ` (AI tools withdrawn${v.ai_withdrawn_at ? ` on ${istDateTime(v.ai_withdrawn_at)}` : ''})` : ''}.` : null],
      ['Document fingerprint (SHA-256)', v.doc_sha256],
      ['Signed from', v.audit.signature ? `${v.audit.signature.ip ?? 'address not recorded'} · ${v.audit.signature.user_agent ?? ''}` : null],
    ];
    autoTable(doc, {
      startY: y + 2, theme: 'grid', body: rows.filter(([, x]) => x).map(([k, x]) => [k, plain(x as string)]),
      bodyStyles: { fontSize: 8.5, valign: 'top' }, columnStyles: { 0: { cellWidth: 50, fontStyle: 'bold' } }, margin: { left: M, right: M },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    if (v.audit.events.length) {
      autoTable(doc, {
        startY: y, head: [['When (IST)', 'Step', 'By', 'Network address and browser']],
        body: v.audit.events.map((e) => [istDateTime(e.at).replace(' IST', ''), EVENT_LABEL[e.kind] ?? e.kind, plain(e.actor ?? ''), plain(`${e.ip ?? ''} ${e.user_agent ?? ''}`.trim())]),
        headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 8 }, bodyStyles: { fontSize: 7, valign: 'top' },
        columnStyles: { 0: { cellWidth: 36 }, 1: { cellWidth: 34 }, 2: { cellWidth: 28 } }, margin: { left: M, right: M },
      });
    }
  }

  // Every page footed: the firm, the client, the reference and the page.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.2); doc.line(M, H - 12, W - M, H - 12);
    font(7.4, 'normal', MUTED);
    doc.text(plain(`${f.name ?? ''}  |  Engagement letter for ${v.client_name}  |  Ref ${v.ref}`), M, H - 8, { maxWidth: TW - 30 });
    doc.text(`Page ${i} of ${pages}`, W - M, H - 8, { align: 'right' });
  }
  doc.save(`${plain(v.client_name).replace(/[\\/:*?"<>|]+/g, ' ').trim()} engagement letter ${v.ref}.pdf`);
}
