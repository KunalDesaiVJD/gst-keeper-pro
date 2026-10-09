// Allotment and the three-stage sign-off of an Annual Return working:
// allotted → Prepared → Verified → Reviewed & locked, by three different
// people. Pure; no I/O. The rules mirror the database
// (migration 20261011100000_annual_return_allotment_signoff.sql), which
// enforces them — here they decide what the screens offer and why not.
//
//   Prepare  — the allotted preparer (anyone on staff when none is allotted,
//              who then becomes the preparer); a GST manager / superadmin may
//              mark it for them. Never the allotted verifier or reviewer.
//   Verify   — the allotted verifier, or a GST manager / superadmin; never
//              whoever prepared it (or is allotted to) or the allotted reviewer.
//   Review & lock — a GST manager or the superadmin who neither prepared nor
//              verified it. Only the superadmin may override that (no
//              verification, or one they signed), and only with a reason.
//   Unlock   — back to Verified; the superadmin, a GST manager or the
//              unlock-sheets permission, with a reason.

import type { AnnualReturnPeriod, PeriodStatus } from './store';

export type Stage = 'not_started' | 'preparing' | 'sent_back' | 'prepared' | 'verified' | 'locked';
export type Slot = 'preparer' | 'verifier' | 'reviewer';
export type Step = 'prepare' | 'verify' | 'review';
export type SignoffAction = 'prepare' | 'withdraw_prepared' | 'verify' | 'withdraw_verified' | 'send_back';

export interface Person { id: string; name: string }
export interface Stamp { id: string | null; name: string; at: string; note: string | null; role: string | null }
export interface Override { kind: 'legacy' | 'skip_verify' | 'same_person'; by?: string; at?: string; reason: string }
export interface Returned { to: 'preparer' | 'verifier'; by: string; at: string; note: string | null }
export interface SignoffChanges { sincePrepared: number; sinceVerified: number; lastAt: string | null; lastBy: string | null }

/** Everything the screens need about one working's allotment and sign-off. */
export interface SignoffState {
  /** signoff_rev — sent back with every sign-off; a stale one is refused. */
  rev: number;
  status: PeriodStatus;
  stage: Stage;
  /** Sheets saved (annual_return_docs rows). */
  sheets: number;
  lastSavedAt: string | null;
  preparer: Person | null;
  verifier: Person | null;
  reviewer: Person | null;
  preparerAllottedAt: string | null;
  allottedAt: string | null;
  allottedBy: string | null;
  prepared: Stamp | null;
  verified: Stamp | null;
  /** The review & lock. */
  locked: Stamp | null;
  returned: Returned | null;
  overrides: Override[];
  changesAtVerify: number | null;
  changesAtLock: number | null;
  /** Figure changes since the latest sign-off (open, prepared workings only). */
  changes: SignoffChanges | null;
}

/** The user acting, as the sign-off rules see them. */
export interface SignoffActor {
  id: string;
  name: string;
  role: string;
  isStaff: boolean;
  /** Superadmin or GST manager: allots, verifies, reviews & locks, acts for others. */
  isManager: boolean;
  isSuperadmin: boolean;
  canUnlock: boolean;
}

/** The period columns the sign-off reads (a period row, or annual_return_signoff_row). */
export type SignoffPeriod = Pick<AnnualReturnPeriod,
  | 'status' | 'signoff_rev' | 'locked_at' | 'locked_by'
  | 'prepared_by' | 'prepared_by_name' | 'prepared_at' | 'prepared_note'
  | 'verified_by' | 'verified_by_name' | 'verified_role' | 'verified_at' | 'verified_note'
  | 'reviewed_by' | 'reviewed_by_name' | 'reviewed_role' | 'reviewed_at' | 'review_note'
  | 'preparer_id' | 'preparer_name' | 'preparer_allotted_at' | 'verifier_id' | 'verifier_name' | 'reviewer_id' | 'reviewer_name'
  | 'allotted_at' | 'allotted_by_name'
  | 'returned_to' | 'returned_by_name' | 'returned_at' | 'returned_note'
  | 'signoff_overrides' | 'changes_at_verify' | 'changes_at_lock'>;

export const stageOf = (
  p: Pick<SignoffPeriod, 'status' | 'returned_at' | 'verified_at' | 'prepared_at'> | null | undefined,
  sheets: number,
): Stage => {
  if (p?.status === 'locked') return 'locked';
  if (p?.returned_at) return 'sent_back';
  if (p?.verified_at) return 'verified';
  if (p?.prepared_at) return 'prepared';
  if (p?.status === 'in_progress' || sheets > 0) return 'preparing';
  return 'not_started';
};

const person = (id: string | null | undefined, name: string | null | undefined): Person | null =>
  id ? { id, name: name || '—' } : null;

const stamp = (id: string | null | undefined, name: string | null | undefined, at: string | null | undefined, note?: string | null, role?: string | null): Stamp | null =>
  at && (name || id) ? { id: id ?? null, name: name || '—', at, note: note ?? null, role: role ?? null } : null;

const overridesOf = (v: unknown): Override[] =>
  Array.isArray(v) ? v.filter((o): o is Override => !!o && typeof o === 'object' && typeof (o as Override).reason === 'string') : [];

export function toSignoffState(
  p: Partial<SignoffPeriod> | null | undefined,
  extra: { sheets?: number; lastSavedAt?: string | null; changes?: SignoffChanges | null } = {},
): SignoffState {
  const sheets = extra.sheets ?? 0;
  const status: PeriodStatus = p?.status === 'locked' ? 'locked' : p?.status === 'in_progress' ? 'in_progress' : 'not_started';
  const returnedTo = p?.returned_to === 'verifier' ? 'verifier' : p?.returned_to === 'preparer' ? 'preparer' : null;
  return {
    rev: p?.signoff_rev ?? 0,
    status,
    stage: stageOf(p as SignoffPeriod | null, sheets),
    sheets,
    lastSavedAt: extra.lastSavedAt ?? null,
    preparer: person(p?.preparer_id, p?.preparer_name),
    verifier: person(p?.verifier_id, p?.verifier_name),
    reviewer: person(p?.reviewer_id, p?.reviewer_name),
    preparerAllottedAt: p?.preparer_allotted_at ?? null,
    allottedAt: p?.allotted_at ?? null,
    allottedBy: p?.allotted_by_name ?? null,
    prepared: stamp(p?.prepared_by, p?.prepared_by_name, p?.prepared_at, p?.prepared_note),
    verified: stamp(p?.verified_by, p?.verified_by_name, p?.verified_at, p?.verified_note, p?.verified_role),
    locked: status === 'locked'
      ? stamp(p?.reviewed_by, p?.reviewed_by_name ?? p?.locked_by, p?.reviewed_at ?? p?.locked_at, p?.review_note, p?.reviewed_role)
      : null,
    returned: returnedTo && p?.returned_at ? { to: returnedTo, by: p.returned_by_name || '—', at: p.returned_at, note: p.returned_note ?? null } : null,
    overrides: overridesOf(p?.signoff_overrides),
    changesAtVerify: p?.changes_at_verify ?? null,
    changesAtLock: p?.changes_at_lock ?? null,
    changes: status === 'locked' ? null : extra.changes ?? null,
  };
}

/** The step the working waits on (null once locked). */
export const currentStep = (s: SignoffState): Step | null => {
  switch (s.stage) {
    case 'locked': return null;
    case 'verified': return 'review';
    case 'prepared': return 'verify';
    case 'sent_back': return s.returned?.to === 'verifier' ? 'verify' : 'prepare';
    default: return 'prepare';
  }
};

export const SLOT_OF: Record<Step, Slot> = { prepare: 'preparer', verify: 'verifier', review: 'reviewer' };
export const STEP_OF: Record<Slot, Step> = { preparer: 'prepare', verifier: 'verify', reviewer: 'review' };

export type Owner =
  | { kind: 'person'; slot: Slot; person: Person }
  | { kind: 'managers'; slot: Slot }
  | { kind: 'unallotted' }
  | { kind: 'done' };

/** Who has the working now — every open working has exactly one answer. */
export const ownerOf = (s: SignoffState): Owner => {
  const step = currentStep(s);
  if (!step) return { kind: 'done' };
  const slot = SLOT_OF[step];
  const p = s[slot];
  if (p) return { kind: 'person', slot, person: p };
  return slot === 'preparer' ? { kind: 'unallotted' } : { kind: 'managers', slot };
};

export interface Can { ok: boolean; reason?: string; /** Lock only: the superadmin may go ahead with a reason. */ override?: string }

const yes: Can = { ok: true };
const no = (reason: string): Can => ({ ok: false, reason });

/** What `me` may do on this working, and in words why not. Mirrors the database's checks. */
export function can(s: SignoffState, me: SignoffActor, action: SignoffAction | 'allot' | 'lock' | 'unlock'): Can {
  if (!me.isStaff) return no('Only staff can do this.');
  const locked = s.stage === 'locked';
  if (action === 'unlock') {
    if (!locked) return no('It is not locked.');
    return me.canUnlock ? yes : no('Only the superadmin, a GST manager or a user with the unlock-sheets permission can unlock.');
  }
  if (locked) return no('It is reviewed and locked — unlock it first.');
  const isMe = (x: { id: string | null } | null | undefined) => !!x?.id && x.id === me.id;

  switch (action) {
    case 'allot':
      return me.isManager ? yes : no('Only a GST manager or the superadmin can allot.');
    case 'prepare':
      if (s.verified) return no('It is verified — withdraw the verification first.');
      if (!s.sheets) return no('Nothing has been saved in the working yet.');
      if (isMe(s.verifier)) return no('You are allotted to verify this — someone else must prepare it.');
      if (isMe(s.reviewer)) return no('You are allotted to review this — someone else must prepare it.');
      if (s.preparer && !isMe(s.preparer) && !me.isManager) return no(`Allotted to ${displayName(s.preparer.name)} to prepare.`);
      return yes;
    case 'withdraw_prepared':
      if (!s.prepared) return no('It is not marked prepared.');
      if (s.verified) return no('It is verified — withdraw the verification first.');
      return isMe(s.prepared) || me.isManager ? yes : no(`Only ${displayName(s.prepared.name)} (who marked it prepared) or a GST manager can withdraw it.`);
    case 'verify':
      if (!s.prepared) return no('It has to be prepared first.');
      if (s.verified) return no('It is already verified.');
      if (isMe(s.prepared)) return no('You prepared it — someone else must verify it.');
      if (isMe(s.preparer)) return no('You are allotted to prepare it — someone else must verify it.');
      if (isMe(s.reviewer)) return no('You are allotted to review it — someone else must verify it.');
      if (isMe(s.verifier) || me.isManager) return yes;
      return no(s.verifier
        ? `Allotted to ${displayName(s.verifier.name)} to verify.`
        : 'No verifier is allotted — a GST manager or the superadmin verifies it, or allots a verifier.');
    case 'withdraw_verified':
      if (!s.verified) return no('It is not verified.');
      return isMe(s.verified) || me.isManager ? yes : no(`Only ${displayName(s.verified.name)} (who verified it) or a GST manager can withdraw the verification.`);
    case 'send_back':
      if (!s.prepared) return no('It is not prepared yet, so there is nothing to send back.');
      if (!s.verified) return isMe(s.verifier) || me.isManager ? yes : no('Only the verifier or a GST manager can send it back.');
      return me.isManager ? yes : no('Only a GST manager or the superadmin can send back a verified working.');
    case 'lock': {
      if (!me.isManager) return no('Only a GST manager or the superadmin can review and lock the year.');
      if (!s.prepared) return no('It has to be prepared and verified first.');
      const problem = !s.verified ? 'It has not been verified.'
        : isMe(s.verified) || isMe(s.verifier) ? 'You verified it — a third person must review it.'
          : isMe(s.prepared) || isMe(s.preparer) ? 'You prepared it — a third person must review it.'
            : null;
      if (!problem) return yes;
      return me.isSuperadmin ? { ok: true, override: problem } : no(problem);
    }
    default:
      return no('Not available.');
  }
}

/** The person (or "any manager") the working is waiting on is me. Unallotted rows wait on an allotment, not on work. */
export const isMyTurn = (s: SignoffState, me: SignoffActor | null): boolean => {
  if (!me?.isStaff) return false;
  const o = ownerOf(s);
  if (o.kind === 'person') return o.person.id === me.id;
  if (o.kind === 'managers') return me.isManager && can(s, me, o.slot === 'verifier' ? 'verify' : 'lock').ok;
  return false;
};

/** Allotted to me in any slot, and not locked. */
export const isMine = (s: SignoffState, me: SignoffActor | null): boolean =>
  !!me && s.stage !== 'locked' && [s.preparer, s.verifier, s.reviewer].some((p) => p?.id === me.id);

/** When the current stage began (for "days in stage"). */
export const stageStartedAt = (s: SignoffState): string | null => {
  switch (s.stage) {
    case 'sent_back': return s.returned?.at ?? null;
    case 'prepared': return s.prepared?.at ?? null;
    case 'verified': return s.verified?.at ?? null;
    case 'locked': return s.locked?.at ?? null;
    default: return s.preparer ? s.preparerAllottedAt : null;
  }
};

export const daysInStage = (s: SignoffState, now: Date = new Date()): number | null => {
  const at = stageStartedAt(s);
  if (!at || s.stage === 'locked') return null;
  const t = Date.parse(at);
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
};

/** Figure changes since the latest sign-off of an open working (0 when none). */
export const changesSinceSignoff = (s: SignoffState): number => {
  if (!s.changes) return 0;
  if (s.verified) return s.changes.sinceVerified;
  if (s.prepared) return s.changes.sincePrepared;
  return 0;
};

/** "superadmin" (the account's first name) reads as "Superadmin". */
export const displayName = (name: string | null | undefined): string => {
  const n = (name ?? '').trim();
  if (!n) return '—';
  return n === n.toLowerCase() ? n.charAt(0).toUpperCase() + n.slice(1) : n;
};

/** Two letters for an avatar: "RI" for Riya, "RS" for Riya Shah. */
export const monogram = (name: string | null | undefined): string => {
  const w = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
};

export type StageTone = 'outline' | 'warning' | 'destructive' | 'info' | 'default' | 'success';

export const STAGE_META: Record<Stage, { label: string; tone: StageTone }> = {
  not_started: { label: 'Not started', tone: 'outline' },
  preparing: { label: 'Preparing', tone: 'warning' },
  sent_back: { label: 'Sent back', tone: 'destructive' },
  prepared: { label: 'Prepared', tone: 'info' },
  verified: { label: 'Verified', tone: 'default' },
  locked: { label: 'Locked', tone: 'success' },
};

/** What a client login is shown: a send-back reads as the stage it went back to. */
export const clientStage = (s: SignoffState): Stage =>
  s.stage === 'sent_back' ? (s.returned?.to === 'verifier' ? 'prepared' : 'preparing') : s.stage;

/** The verb in the cell when it is my turn. */
export const turnVerb = (s: SignoffState): string => {
  const step = currentStep(s);
  if (s.stage === 'sent_back' && step === 'prepare') return 'Fix';
  return step === 'prepare' ? 'Prepare' : step === 'verify' ? 'Verify' : step === 'review' ? 'Review' : '';
};

const fmtDay = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const ROLE_WORD: Record<string, string> = { superadmin: 'superadmin', gst_manager: 'GST manager', employee: 'staff' };

/** "Prepared by Riya · 12 Oct 2026", "Sent back to the preparer by Mehul · 13 Oct 2026: “…”". */
export const stageSentence = (s: SignoffState, opts: { notes?: boolean } = {}): string => {
  const notes = opts.notes ?? true;
  const q = (n: string | null | undefined) => (notes && n ? `: “${n}”` : '');
  switch (s.stage) {
    case 'locked': {
      const l = s.locked;
      const role = l?.role ? ` (${ROLE_WORD[l.role] ?? l.role})` : '';
      return l ? `Reviewed & locked by ${displayName(l.name)}${role} · ${fmtDay(l.at)}` : 'Reviewed & locked';
    }
    case 'verified': return `Verified by ${displayName(s.verified?.name)} · ${fmtDay(s.verified?.at)}`;
    case 'prepared': return `Prepared by ${displayName(s.prepared?.name)} · ${fmtDay(s.prepared?.at)}`;
    case 'sent_back':
      return `Sent back to the ${s.returned?.to === 'verifier' ? 'verifier' : 'preparer'} by ${displayName(s.returned?.by)} · ${fmtDay(s.returned?.at)}${q(s.returned?.note)}`;
    case 'preparing': return s.preparer ? `Being prepared by ${displayName(s.preparer.name)}` : 'Being prepared';
    default: return 'Not started';
  }
};

/** "With Amit to verify", "With any manager to review & lock", "No preparer allotted". */
export const nextSentence = (s: SignoffState): string | null => {
  const o = ownerOf(s);
  const step = currentStep(s);
  const what = step === 'prepare' ? (s.stage === 'sent_back' ? 'fix and prepare again' : 'prepare') : step === 'verify' ? 'verify' : 'review & lock';
  if (o.kind === 'done') return null;
  if (o.kind === 'unallotted') return 'No preparer allotted';
  if (o.kind === 'managers') return `With any GST manager to ${what}`;
  return `With ${displayName(o.person.name)} to ${what}`;
};

/** A locked working that skipped (or bent) the three-person sign-off, in words. */
export const overrideText = (o: Override): string =>
  o.kind === 'legacy' ? o.reason
    : `${o.kind === 'skip_verify' ? 'Locked without a verification' : 'Locked by someone who also signed it'} — superadmin override${o.by ? ` by ${displayName(o.by)}` : ''}: “${o.reason}”`;

// ---------------------------------------------------------------------------
// Allotment
// ---------------------------------------------------------------------------

export interface Load { prepare: number; verify: number; review: number }

/** Open work each person holds, by step: allotted, and that step not yet signed. */
export const loadsOf = (states: Iterable<SignoffState>): Map<string, Load> => {
  const m = new Map<string, Load>();
  const add = (id: string | undefined, k: keyof Load) => {
    if (!id) return;
    const l = m.get(id) ?? { prepare: 0, verify: 0, review: 0 };
    l[k] += 1;
    m.set(id, l);
  };
  for (const s of states) {
    if (s.stage === 'locked') continue;
    if (!s.prepared) add(s.preparer?.id, 'prepare');
    if (!s.verified) add(s.verifier?.id, 'verify');
    add(s.reviewer?.id, 'review');
  }
  return m;
};

export const SLOT_WORD: Record<Slot, string> = { preparer: 'preparer', verifier: 'verifier', reviewer: 'reviewer' };

/**
 * Why a person cannot take this slot (null = they can). Mirrors the database's
 * per-working skip reasons: a signed step keeps its slot, the reviewer is a
 * GST manager / superadmin, and three different people sign.
 */
export const allotBlock = (s: SignoffState, slot: Slot, who: { id: string; role: string }): string | null => {
  if (s.stage === 'locked') return 'locked';
  if (slot === 'preparer' && s.prepared) return 'already prepared';
  if (slot === 'verifier' && s.verified) return 'already verified';
  if (slot === 'reviewer' && who.role !== 'superadmin' && who.role !== 'gst_manager') return 'not a GST manager';
  const is = (p: { id: string | null } | null) => !!p?.id && p.id === who.id;
  if (slot !== 'preparer' && (is(s.preparer) || is(s.prepared))) return 'prepares this';
  if (slot !== 'verifier' && (is(s.verifier) || is(s.verified))) return 'verifies this';
  if (slot !== 'reviewer' && is(s.reviewer)) return 'reviews this';
  return null;
};
