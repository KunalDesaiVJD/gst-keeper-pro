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
  /** A per-unit e-mail of before 21 Oct 2026 asked about it (its link may still answer). */
  legacyLink?: boolean;
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
 * had been answered).
 */
export const failedMailWords = (earlierLink: boolean | null | undefined, unitNos: string[] = []): string => {
  if (earlierLink) return 'The earlier link still takes answers until an e-mail goes out.';
  const which = unitNos.filter(Boolean);
  return `No earlier link to ${which.length ? which.join(', ') : 'these units'} has reached the client.`;
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
 *   asked     its request's e-mail is out (at: when it went)
 *   waiting   its request's e-mail is queued or being sent
 *   failed    its request's e-mail failed (error: why)
 * earlier, for waiting or failed: the newest link to the unit that did reach
 * the client and still takes answers: an earlier request whose e-mail is out
 * (at: when), or the per-unit e-mail of before 21 Oct 2026 (legacyLink).
 * null for a unit not waiting, or with no request (an old per-unit row).
 */
export function unitAsk(
  unitId: string,
  cf: { status: string; requestId?: string | null; legacyLink?: boolean } | undefined,
  requests: AskRequest[],
): {
  state: 'asked' | 'waiting' | 'failed';
  at: string | null;
  error: string | null;
  earlier: { kind: 'request'; at: string | null } | { kind: 'legacy' } | null;
} | null {
  if (!cf || cf.status !== 'PENDING' || !cf.requestId) return null;
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
      : cf.legacyLink ? { kind: 'legacy' } : null,
  };
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
// typed, and a reload dropped the 2-hour proof. The page keeps it per token in
// localStorage and restores it on load; expired parts are dropped.

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
  /** The proof, the address it proves and until when it holds. */
  proof: string | null;
  proofEmail: string | null;
  proofUntil: number | null;
}

export const codeStepKey = (token: string): string => `bu-confirm:${token}`;

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The stored step, read back: a code older than its life and a proof past
 *  its time are dropped. null when nothing usable is stored. */
export function readCodeStep(raw: string | null | undefined, now: number): CodeStep | null {
  if (!raw) return null;
  let o: Record<string, unknown>;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    o = v as Record<string, unknown>;
  } catch {
    return null;
  }
  const step: CodeStep = {
    name: str(o.name) ?? '',
    email: str(o.email) ?? '',
    codeSentTo: str(o.codeSentTo),
    codeId: str(o.codeId),
    codeAt: num(o.codeAt),
    proof: str(o.proof),
    proofEmail: str(o.proofEmail),
    proofUntil: num(o.proofUntil),
  };
  if (!step.codeSentTo || !step.codeId || step.codeAt === null || now - step.codeAt > CODE_LIFE_MS || step.codeAt > now + 60_000) {
    step.codeSentTo = null; step.codeId = null; step.codeAt = null;
  }
  if (!step.proof || !step.proofEmail || step.proofUntil === null || step.proofUntil <= now || step.proofUntil > now + PROOF_LIFE_MS + 60_000) {
    step.proof = null; step.proofEmail = null; step.proofUntil = null;
  }
  return step.name || step.email || step.codeId || step.proof ? step : null;
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
