// Pure rules of the BU agreement value confirmation (no Supabase here, so
// scripts/verify-bu-confirm.mjs can run them): which typed addresses are
// valid, which are the firm's own, which units the pop-up still offers, what
// it sends back as seen, how a send's "answered meanwhile" list splits, and
// what the public page's "Confirm all" covers. The database holds the same
// address rules (supabase/migrations/20261021140000_bu_confirm_cc.sql:
// builder_bu_confirm_email_ok, builder_bu_confirm_is_staff).

/** The firm's domain: its addresses may get a copy but never answer. */
export const FIRM_DOMAIN = 'vjdesai.com';

/** One e-mail address: a dot-atom local part (no leading, trailing or doubled
 *  dot) and a domain of labels made of letters, digits and inner hyphens.
 *  The database checks the same pattern (builder_bu_confirm_email_ok). */
export const EMAIL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z][A-Za-z0-9-]{0,61}[A-Za-z0-9]$/;

export const emailOk = (a: string): boolean =>
  a.length <= 254 && a.split('@')[0].length <= 64 && EMAIL_RE.test(a);

/** The firm's own address (its domain or a subdomain). The database also
 *  counts every staff member's profile e-mail. */
export const isFirmAddress = (a: string): boolean => {
  const domain = a.trim().toLowerCase().split('@')[1] || '';
  return domain === FIRM_DOMAIN || domain.endsWith(`.${FIRM_DOMAIN}`);
};

/** Split on commas, semicolons and new lines that are not inside quotes; each
 *  piece keeps the separator that ended it. */
const splitParts = (text: string): { text: string; sep: string }[] => {
  const parts: { text: string; sep: string }[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && (ch === ',' || ch === ';' || ch === '\n' || ch === '\r')) {
      parts.push({ text: cur, sep: ch });
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push({ text: cur, sep: '' });
  return parts;
};

const HAS_BRACKET_ADDRESS = /<[^<>]*@[^<>]*>/;

/**
 * Outlook copies "Last, First <address>" with the name unquoted, so a comma
 * inside a name looks like a separator. Pieces with no "@", each ended by a
 * comma, join the piece after them when that one holds an <address>: they are
 * part of that address's name.
 */
const joinNames = (parts: { text: string; sep: string }[]): string[] => {
  const nameBit = (p: { text: string; sep: string }) => !p.text.includes('@') && !!p.text.trim() && p.sep === ',';
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    let j = i;
    while (j < parts.length - 1 && nameBit(parts[j])) j++;
    if (j > i && HAS_BRACKET_ADDRESS.test(parts[j].text)) {
      out.push(parts.slice(i, j + 1).map((p) => p.text).join(','));
      i = j;
    } else {
      out.push(parts[i].text);
    }
  }
  return out;
};

/**
 * Addresses typed or pasted into a To or CC box: separated by commas,
 * semicolons, new lines or spaces. "Name <address>" (as Outlook copies it,
 * the name quoted or not, "Last, First" included) gives the address inside
 * the angle brackets. Trimmed, lower case, each once, in the order typed.
 */
export function parseEmailList(text: string): { valid: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of joinNames(splitParts(text || ''))) {
    const bracket = /<([^<>]*)>/.exec(part);
    const tokens = bracket ? [bracket[1]] : part.split(/\s+/);
    for (const raw of tokens) {
      const a = raw.trim().replace(/^<|>$/g, '').toLowerCase();
      if (!a || seen.has(a)) continue;
      seen.add(a);
      (emailOk(a) ? valid : invalid).push(a);
    }
  }
  return { valid, invalid };
}

/** What the client master's e-mail gave the To box: nothing at all, only
 *  addresses that are not valid, or at least one good address. */
export function masterState(list: { valid: string[]; invalid: string[] } | null): 'empty' | 'invalid' | 'ok' | null {
  if (!list) return null;
  if (list.valid.length) return 'ok';
  return list.invalid.length ? 'invalid' : 'empty';
}

/** A unit's confirmation status as the pop-up and the BU Events page read it. */
export type ConfirmStatus = 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'OVERRIDDEN' | 'NOT_SENT';

export const isClearedStatus = (s: ConfirmStatus | undefined): boolean => s === 'CONFIRMED' || s === 'OVERRIDDEN';

interface FreshRow {
  unitId: string;
  status: ConfirmStatus;
  disputeNotes?: string | null;
  respondedByName?: string | null;
  respondedByEmail?: string | null;
  respondedAt?: string | null;
  /** The latest request that asked about the unit (null: none, or a per-unit e-mail). */
  requestId?: string | null;
  /** A per-unit e-mail of before 21 Oct 2026 asked about it and went out (its link may still answer). */
  legacyLink?: boolean;
  /** That per-unit e-mail, when there was one: whether it went out (null: no such e-mail). */
  legacy?: LegacyMail | null;
}

/** What became of a per-unit e-mail of before 21 Oct 2026 (its email_outbox row, legacy_outbox_id). */
export interface LegacyMail {
  /** As mailOutcome reads the outbox status: a missing row is out, as the database counts it. */
  mail: 'out' | 'waiting' | 'failed';
  error: string | null;
  /** When it went (outbox sent_at), else when the row was written (sent_at on the unit's row). */
  at: string | null;
}

/**
 * The units the pop-up offers, from the page's list and the statuses read
 * again when the pop-up opened (or after a send found a unit answered): a unit
 * confirmed or accepted since the page loaded is left out, and every other
 * unit shows its status as it is now. fresh null: not read yet, the page's list
 * as it is.
 */
export function freshCandidates<T extends FreshRow>(candidates: T[], fresh: FreshRow[] | null): T[] {
  if (!fresh) return candidates;
  const now = new Map(fresh.map((f) => [f.unitId, f]));
  return candidates
    .filter((c) => !isClearedStatus(now.get(c.unitId)?.status))
    .map((c) => {
      const f = now.get(c.unitId);
      return {
        ...c,
        status: f?.status ?? 'NOT_SENT',
        disputeNotes: f?.disputeNotes ?? null,
        respondedByName: f?.respondedByName ?? null,
        respondedByEmail: f?.respondedByEmail ?? null,
        respondedAt: f?.respondedAt ?? null,
        requestId: f?.requestId ?? null,
        legacyLink: f?.legacyLink ?? false,
        legacy: f?.legacy ?? null,
      };
    });
}

/**
 * What the pop-up showed for each ticked unit, sent with the send: the
 * database leaves out (and reports) any unit answered since, a dispute
 * included, so a dispute staff never saw is never cleared; and, with the
 * unit's request, any unit a colleague asked about meanwhile, so their
 * request is not replaced unseen. A unit whose request the pop-up does not
 * know is sent without one (the database then does not compare it).
 */
export function seenFor(units: { unitId: string; status: ConfirmStatus; respondedAt?: string | null; requestId?: string | null }[]):
  Record<string, { status: ConfirmStatus; responded_at: string | null; request_id?: string | null }> {
  return Object.fromEntries(units.map((u) => [u.unitId, {
    status: u.status,
    responded_at: u.respondedAt ?? null,
    ...(u.requestId !== undefined ? { request_id: u.requestId } : {}),
  }]));
}

/**
 * A send's "answered meanwhile" list, split: units confirmed or accepted
 * (final: the send drops them and goes again on its own) and units answered
 * otherwise, a dispute above all (the send stops: staff must see it before a
 * new request clears it).
 */
export function splitAnswered<T extends { status: string }>(answered: T[]): { cleared: T[]; changed: T[] } {
  return {
    cleared: answered.filter((a) => isClearedStatus(a.status as ConfirmStatus)),
    changed: answered.filter((a) => !isClearedStatus(a.status as ConfirmStatus)),
  };
}

/** A unit the send found changed since the pop-up read it. */
export interface MeanwhileUnit {
  unitNo: string;
  status: string;
  respondedByName?: string | null;
  respondedByEmail?: string | null;
  /** The unit's request now, when a colleague's request asked about it. */
  requestTo?: string[] | null;
  requestCc?: string[] | null;
}

/** Nobody answered it: a colleague's request asked about it meanwhile. */
export const askedMeanwhile = (a: { status: string }): boolean => a.status === 'PENDING' || a.status === 'NOT_SENT';

/**
 * One unit in the pop-up's "since this pop-up opened" list and toast:
 * "A-101 (confirmed by Rajesh Shah, rajesh@client.com)", or, when nobody
 * answered but a colleague's request asked about it meanwhile,
 * "A-101 (asked meanwhile in another request to priya@client.com, CC accounts@client.com)".
 */
export function meanwhileWords(a: MeanwhileUnit): string {
  if (askedMeanwhile(a)) {
    const to = (a.requestTo || []).join(', ');
    const cc = (a.requestCc || []).join(', ');
    return `${a.unitNo} (asked meanwhile in another request${to ? ` to ${to}` : ''}${cc ? `, CC ${cc}` : ''})`;
  }
  const what = a.status === 'OVERRIDDEN' ? 'accepted by the firm'
    : a.status === 'DISPUTED' ? 'disputed' : a.status === 'CONFIRMED' ? 'confirmed' : 'answered';
  const by = a.respondedByName ? ` by ${a.respondedByName}${a.respondedByEmail ? `, ${a.respondedByEmail}` : ''}` : '';
  return `${a.unitNo} (${what}${by})`;
}

/** The heading over that list: answered, asked again elsewhere, or both. */
export function meanwhileHeading(list: { status: string }[]): string {
  const asked = list.filter(askedMeanwhile).length;
  if (asked === list.length) return 'Asked meanwhile in another request, so nothing was sent:';
  if (asked === 0) return 'Answered since this pop-up opened, so nothing was sent:';
  return 'Answered or asked again since this pop-up opened, so nothing was sent:';
}

/**
 * The words after a failed send: is there a link to these units the client
 * already holds? Said of the request's own units (round 4: "No e-mail has
 * reached the client yet" was wrong when an earlier e-mail about other units
 * had been answered), and, once the send records which units had one
 * (earlierNos, from builder_bu_confirm_requests.earlier_units since
 * 20261021160000), of each unit: "The earlier link still takes answers for
 * A-101 until an e-mail goes out. No link to A-102, A-103 has reached the
 * client." (finding of 21 Oct 2026: it was said of every unit when only some
 * had one). earlierNos null or undefined: a request sent before that, known
 * only as "some unit had one".
 */
export const failedMailWords = (
  earlierLink: boolean | null | undefined, unitNos: string[] = [], earlierNos?: string[] | null,
): string => {
  const which = unitNos.filter(Boolean);
  const list = (nos: string[]) => (nos.length ? nos.join(', ') : 'these units');
  if (Array.isArray(earlierNos)) {
    const had = earlierNos.filter(Boolean);
    if (!had.length) return `No earlier link to ${list(which)} has reached the client.`;
    const rest = which.filter((n) => !had.includes(n));
    return `The earlier link still takes answers for ${had.join(', ')} until an e-mail goes out.`
      + (rest.length ? ` No link to ${rest.join(', ')} has reached the client.` : '');
  }
  if (earlierLink) return 'The earlier link still takes answers until an e-mail goes out.';
  return `No earlier link to ${list(which)} has reached the client.`;
};

/** A request as BU Events reads it, with its e-mail's outbox status. */
export interface AskRequest {
  id: string;
  unitIds: string[];
  to: string[];
  sentAt: string | null;
  createdAt: string;
  /** email_outbox status: sent, pending, sending, failed, skipped, cancelled; null when the row is gone. */
  mailStatus: string | null;
  mailError: string | null;
  /** When the e-mail went (email_outbox.sent_at). */
  mailSentAt?: string | null;
  earlierLink: boolean;
  /** Which of its units had an earlier link that reached the client (null: sent before 20261021160000). */
  earlierUnits?: string[] | null;
}

/** What became of a request's e-mail: out (sent, or its outbox row gone, as
 *  the database counts it), waiting (queued or being sent), or failed
 *  (failed, skipped or cancelled). */
export function mailOutcome(status: string | null | undefined): 'out' | 'waiting' | 'failed' {
  if (status === 'pending' || status === 'sending') return 'waiting';
  if (status === 'failed' || status === 'skipped' || status === 'cancelled') return 'failed';
  return 'out';
}

/**
 * Whether a unit waiting on the client was really asked (round 4: BU Events
 * said "Asked <date>" when the unit's only e-mail had failed or was still
 * queued). requests: the event's requests, newest first.
 *   asked     its e-mail is out (at: when it went)
 *   waiting   its e-mail is queued or being sent
 *   failed    its e-mail failed (error: why)
 * Its e-mail is its request's, or, for a unit no request asked about, the
 * per-unit e-mail of before 21 Oct 2026 (legacy: finding of 21 Oct 2026, such
 * a unit was shown "Asked <date>" when that e-mail had failed).
 * earlier, for waiting or failed: the newest link to the unit that did reach
 * the client and still takes answers: an earlier request whose e-mail is out
 * (at: when), or the per-unit e-mail of before 21 Oct 2026 when it went out
 * (legacyLink). null for a unit not waiting, or with no request and no
 * per-unit e-mail on record.
 */
export function unitAsk(
  unitId: string,
  cf: { status: string; requestId?: string | null; legacyLink?: boolean; legacy?: LegacyMail | null } | undefined,
  requests: AskRequest[],
): {
  state: 'asked' | 'waiting' | 'failed';
  at: string | null;
  error: string | null;
  earlier: { kind: 'request'; at: string | null } | { kind: 'legacy' } | null;
} | null {
  if (!cf || cf.status !== 'PENDING') return null;
  // The per-unit e-mail out, as the database's earlier_link counts it.
  const legacyOut = !!cf.legacyLink && (cf.legacy?.mail ?? 'out') === 'out';
  if (!cf.requestId) {
    if (!cf.legacy) return null;
    const { mail, error, at } = cf.legacy;
    return { state: mail === 'out' ? 'asked' : mail, at, error: mail === 'failed' ? error || 'failed' : null, earlier: null };
  }
  const idx = requests.findIndex((r) => r.id === cf.requestId);
  if (idx < 0) return null;
  const req = requests[idx];
  const outcome = mailOutcome(req.mailStatus);
  if (outcome === 'out') {
    return { state: 'asked', at: req.mailSentAt || req.sentAt || req.createdAt, error: null, earlier: null };
  }
  const prior = requests.slice(idx + 1).find((r) => r.unitIds.includes(unitId) && mailOutcome(r.mailStatus) === 'out');
  return {
    state: outcome,
    at: req.sentAt || req.createdAt,
    error: outcome === 'failed' ? (req.mailError || req.mailStatus) : null,
    earlier: prior ? { kind: 'request', at: prior.mailSentAt || prior.sentAt || prior.createdAt }
      : legacyOut ? { kind: 'legacy' } : null,
  };
}

/**
 * A unit's request that the page had not loaded (finding of 21 Oct 2026: the
 * pop-up used the requests as BU Events loaded them, so a colleague's request
 * sent since showed as a plain "Pending" and was replaced unseen). fresh: the
 * requests read when the pop-up opened; known: the ids the page had. The
 * request, or null when the page knew it (or the unit has none).
 */
export function unseenRequest<T extends { id: string }>(
  requestId: string | null | undefined, fresh: T[] | null, known: Iterable<string>,
): T | null {
  if (!requestId || !fresh) return null;
  const had = new Set(known);
  if (had.has(requestId)) return null;
  return fresh.find((r) => r.id === requestId) ?? null;
}

/** "Asked since this page loaded, in another request to priya@client.test, CC accounts@client.test." */
export function unseenRequestWords(r: { to: string[]; cc?: string[] }): string {
  const to = (r.to || []).join(', ');
  const cc = (r.cc || []).join(', ');
  return `Asked since this page loaded, in another request${to ? ` to ${to}` : ''}${cc ? `, CC ${cc}` : ''}.`;
}

/**
 * The requests whose e-mail has not gone out (failed, skipped, queued or
 * being sent) and that still hold units waiting on the client, with those
 * units: BU Events flags each one, not only the last request (round 4).
 */
export function requestsNotOut(
  requests: AskRequest[],
  confirmations: { unitId: string; status: string; requestId?: string | null }[],
): { request: AskRequest; unitIds: string[] }[] {
  return requests
    .filter((r) => mailOutcome(r.mailStatus) !== 'out')
    .map((r) => ({
      request: r,
      unitIds: confirmations.filter((c) => c.requestId === r.id && c.status === 'PENDING').map((c) => c.unitId),
    }))
    .filter((x) => x.unitIds.length > 0);
}

// ── The public page's code step, kept per link in the reader's browser ──────
// Round 4 (medium): the code step lived only in the page's memory, so a phone
// mail app that closes the link's tab to show the inbox (Gmail on Android)
// lost it: the reopened page had no Code box, the e-mailed code could not be
// typed, and a reload dropped the 2-hour proof. The page keeps it per token
// and restores it on load; expired parts are dropped. Since 21 Oct 2026
// (finding, low): the proof is kept only in sessionStorage, for the tab that
// checked the code (it survives a reload of that tab), so anyone else using
// the same browser, in a new tab, cannot answer as the checked address
// without a code; localStorage keeps the name, the address, the code's id and
// time and whether the mailer said it was sent, which is all a closed tab
// needs to type the code already e-mailed.

/**
 * A code's reference: 4 letters from its id (no digits, and no I or O, so it
 * is never typed as the code). The database (builder_bu_confirm_code_ref) and
 * the code e-mail (supabase/functions/bu-confirm-code/message.ts) work it out
 * the same way: the page shows it next to the Code box, the e-mail carries
 * it, and the messages name "the e-mail marked <ref>", never "the latest"
 * (finding of 21 Oct 2026: a reader typed the code another holder of the
 * link had asked for, the newest in the mailbox, and was locked out).
 */
export function codeRef(codeId: string | null | undefined): string {
  const map = '0123456789abcdef';
  const to = 'ABCDEFGHJKLMNPQR';
  return String(codeId ?? '').toLowerCase().replace(/-/g, '').slice(0, 4)
    .split('').map((c) => to[map.indexOf(c)] ?? '').join('');
}

/** How long a code works (builder_bu_confirm_code_claim) and a proof holds
 *  (builder_bu_confirm_respond), less a minute so the page never offers a
 *  dead one. */
export const CODE_LIFE_MS = 29 * 60 * 1000;
export const PROOF_LIFE_MS = 119 * 60 * 1000;

export interface CodeStep {
  name: string;
  email: string;
  /** Where the latest code went, its id (only this browser has it) and when it was asked for. */
  codeSentTo: string | null;
  codeId: string | null;
  codeAt: number | null;
  /** What the mailer said: sent, or did not report back (unknown: it may not have gone). */
  codeStatus: 'sent' | 'unknown' | null;
  /** The proof, the address it proves and until when it holds (sessionStorage only). */
  proof: string | null;
  proofEmail: string | null;
  proofUntil: number | null;
}

export const codeStepKey = (token: string): string => `bu-confirm:${token}`;

/** The step as stored: local (localStorage) without the proof, session
 *  (sessionStorage) with only the proof. null: nothing to keep there. */
export function codeStepForStorage(step: CodeStep): { local: string | null; session: string | null } {
  const hasProof = !!(step.proof && step.proofEmail && step.proofUntil);
  // Once a code has given this tab its proof, other tabs are not offered that
  // code again: checking it twice would replace this tab's proof. They ask
  // for a code of their own.
  const keepCode = !hasProof;
  const local = {
    name: step.name, email: step.email,
    codeSentTo: keepCode ? step.codeSentTo : null, codeId: keepCode ? step.codeId : null,
    codeAt: keepCode ? step.codeAt : null, codeStatus: keepCode ? step.codeStatus : null,
  };
  const hasLocal = !!(step.name || step.email || local.codeId);
  return {
    local: hasLocal ? JSON.stringify(local) : null,
    session: hasProof ? JSON.stringify({ proof: step.proof, proofEmail: step.proofEmail, proofUntil: step.proofUntil }) : null,
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const parseObject = (raw: string | null | undefined): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

/** The stored step, read back: the name, address and code from local, the
 *  proof only from session (a proof found in local, as the page kept it
 *  before 21 Oct 2026, is ignored). A code older than its life and a proof
 *  past its time are dropped. null when nothing usable is stored. */
export function readCodeStep(localRaw: string | null | undefined, sessionRaw: string | null | undefined, now: number): CodeStep | null {
  const o = parseObject(localRaw) ?? {};
  const p = parseObject(sessionRaw) ?? {};
  const status = str(o.codeStatus);
  const step: CodeStep = {
    name: str(o.name) ?? '',
    email: str(o.email) ?? '',
    codeSentTo: str(o.codeSentTo),
    codeId: str(o.codeId),
    codeAt: num(o.codeAt),
    codeStatus: status === 'sent' || status === 'unknown' ? status : null,
    proof: str(p.proof),
    proofEmail: str(p.proofEmail),
    proofUntil: num(p.proofUntil),
  };
  if (!step.codeSentTo || !step.codeId || step.codeAt === null || now - step.codeAt > CODE_LIFE_MS || step.codeAt > now + 60_000) {
    step.codeSentTo = null; step.codeId = null; step.codeAt = null; step.codeStatus = null;
  }
  if (!step.proof || !step.proofEmail || step.proofUntil === null || step.proofUntil <= now || step.proofUntil > now + PROOF_LIFE_MS + 60_000) {
    step.proof = null; step.proofEmail = null; step.proofUntil = null;
  }
  return step.name || step.email || step.codeId || step.proof ? step : null;
}

/**
 * What the page says about a code restored on load, with no proof yet: that
 * it was e-mailed, or, when the mailer did not report back, that it may not
 * have gone (finding of 21 Oct 2026, low: a reload said "We e-mailed a code"
 * after the page had said it could not confirm that). clock: how to show a
 * time. null when there is nothing to say.
 */
export function restoredCodeMessage(step: CodeStep | null, clock: (ms: number) => string):
  { tone: 'ok' | 'warn'; text: string } | null {
  if (!step?.codeSentTo || !step.codeId || !step.codeAt || step.proof) return null;
  const mark = codeRef(step.codeId);
  if (step.codeStatus === 'unknown') {
    return { tone: 'warn', text: `We could not confirm the code asked for at ${clock(step.codeAt)} was sent to ${step.codeSentTo}. `
      + `If no e-mail marked ${mark} came, ask for a new one.` };
  }
  return { tone: 'ok', text: `We e-mailed a code to ${step.codeSentTo} at ${clock(step.codeAt)}, in the e-mail marked ${mark}. `
    + 'Type it below, or ask for a new one.' };
}

/** A unit as the public page shows it. */
export type PageUnitState = 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'ACCEPTED' | 'REPLACED';

/**
 * What "Confirm all" on the public page covers: the open units, leaving out
 * any whose dispute box is open (the reader is writing a dispute for it, and
 * a confirmation cannot be undone).
 */
export function confirmAllTargets(units: { unit_id: string; state: PageUnitState }[], disputing: Iterable<string>): string[] {
  const open = new Set(disputing);
  return units.filter((u) => u.state === 'PENDING' && !open.has(u.unit_id)).map((u) => u.unit_id);
}

/** The page's summary line and total. */
export function pageSummary(units: { state: PageUnitState; agreement_value: number }[]): {
  open: number;
  replaced: number;
  /** No open unit, nothing replaced: every unit here has an answer. */
  allAnswered: boolean;
  /** No open unit, some replaced: the rest were asked again in a newer e-mail. */
  restReplaced: boolean;
  allReplaced: boolean;
  total: number;
  totalLabel: string;
} {
  const open = units.filter((u) => u.state === 'PENDING').length;
  const replaced = units.filter((u) => u.state === 'REPLACED').length;
  const total = units.filter((u) => u.state !== 'REPLACED').reduce((a, u) => a + (Number(u.agreement_value) || 0), 0);
  return {
    open,
    replaced,
    allAnswered: open === 0 && replaced === 0 && units.length > 0,
    restReplaced: open === 0 && replaced > 0 && replaced < units.length,
    allReplaced: units.length > 0 && replaced === units.length,
    total,
    totalLabel: replaced > 0 ? 'Total of units still on this link' : 'Total',
  };
}
