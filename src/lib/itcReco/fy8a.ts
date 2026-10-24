// A financial year's three ITC statements, as the 8A reports compare them:
// the year's GSTR-2A, the year's GSTR-2B and GSTR-9 Table 8A. Pure: no
// Supabase, no React, no clock (today is handed in).
//
//  - The year's 2A / 2B: every document dated in the FY, from the 2A / 2B of
//    April of the year to October of the next (the s.16(4) window: the last
//    GSTR-3B that can claim the year's ITC is October's, filed by 30 November),
//    each document once: an amendment replaces the document it amends, a
//    document in two statements counts once (its latest). The 2B of November
//    and December after the window are read too, only to say a document
//    reached a 2B too late.
//  - 8A: the uploaded portal document details (eightA.ts) when there is one;
//    otherwise rebuilt the way the portal builds it, from the year's 2B (FY
//    2023-24 on) or 2A (before): B2B invoices and notes with ITC available, no
//    reverse charge, in a statement of the window. A rebuilt 8A is labelled as
//    such everywhere and is never "the portal's 8A".
// Positions: docs/GSTR8A_RECO_POSITIONS.md.
import { fyStartYear, monthRange, periodIndex, fyOfDate, fyMarch } from '@/lib/reply/periods';
import { dayOfNextMonth, due2BDate } from './dates';
import { indexDocs, normKey, exactKey, looseKey, lookupAmendmentOf, type DocIndex } from './engine';
import { EIGHT_A_SECTIONS, findRow, isStored8A, statementFromRow, type Stored8A } from './sources';
import type { RecoDoc, SourceKey, StatementMeta, StatementRow } from './types';

/** The FY's statements whose documents count: April of the year to October of the next. */
export const fyWindow = (fy: string): string[] => monthRange(`04/${fyStartYear(fy)}`, `10/${fyStartYear(fy) + 1}`);
/** What the reports read: the window and two 2Bs after it (a document that reached a 2B too late). */
export const fyLoadMonths = (fy: string): string[] => monthRange(`04/${fyStartYear(fy)}`, `12/${fyStartYear(fy) + 1}`);
/** The last month of the window, 'MM/YYYY'. */
export const fyWindowEnd = (fy: string): string => `10/${fyStartYear(fy) + 1}`;
/** 8A is built from GSTR-2B from FY 2023-24, from GSTR-2A before. */
export const eightABasis = (fy: string): '2A' | '2B' => (fyStartYear(fy) >= 2023 ? '2B' : '2A');
/** The period an FY's 8A is stored under (gst_filed_returns.period_month): March that ends the year. */
export const eightAPeriod = (fy: string): string => fyMarch(fy);

const before = (a: string, b: string) => periodIndex(a) < periodIndex(b);
const inFy = (d: RecoDoc, fy: string): boolean => (d.date ? fyOfDate(d.date) === fy : false);

/** A 2B of `p` is out on the 14th of the next month; a 2A is worth reading once the 11th has passed. */
export const isDue = (source: '2A' | '2B', p: string, today: string): boolean =>
  today >= (source === '2B' ? due2BDate(p) : dayOfNextMonth(p, 12));

/**
 * Each document once. The latest statement's copy of a document wins (a
 * document listed twice, e.g. rejected and then accepted); an amendment
 * replaces the document it amends (B2BA / CDNRA in a later month), so the
 * year holds the figures as last reported. ITC reversal entries are kept as
 * they are (they are not the invoice).
 */
export function collapseDocs(docs: RecoDoc[]): { docs: RecoDoc[]; superseded: number } {
  const ordered = [...docs].sort((a, b) => periodIndex(a.statementPeriod) - periodIndex(b.statementPeriod));
  const kept = new Map<string, RecoDoc>();
  const solo: RecoDoc[] = [];
  let superseded = 0;
  const keyOf = (d: RecoDoc) => `${exactKey(d)}|${d.isAmendment ? 'A' : ''}`;
  for (const d of ordered) {
    if (d.bucket === 'reversal') { solo.push(d); continue; }
    const k = keyOf(d);
    if (kept.has(k)) superseded += 1;
    kept.set(k, d);
  }
  // An amendment replaces its original (and an earlier amendment of it).
  for (const a of ordered) {
    if (!a.isAmendment || a.bucket === 'reversal' || kept.get(keyOf(a)) !== a) continue;
    const ix = indexDocs([a]);
    for (const [k, d] of [...kept.entries()]) {
      if (d === a || periodIndex(d.statementPeriod) > periodIndex(a.statementPeriod)) continue;
      if (lookupAmendmentOf(ix, d) === a) { kept.delete(k); superseded += 1; }
    }
  }
  return { docs: [...kept.values(), ...solo], superseded };
}

export interface FySide {
  source: '2A' | '2B';
  /** Window and load months: each month's statement (ready or not). */
  metas: Map<string, StatementMeta>;
  /** The year's documents, each once (collapseDocs), dated in the FY. */
  docs: RecoDoc[];
  /** Every document read, of any year, uncollapsed: for "is it in a 2B at all". */
  index: DocIndex;
  /** Sections any of the months read (a 2A pulled before 0.14.0 reads B2B invoices only). */
  sectionsRead: string[];
  /** Documents of an earlier FY found in the year's statements (they belong to that year's report). */
  earlierFy: number;
  /** Documents replaced by a later copy or an amendment. */
  superseded: number;
  /** Window months due and not usable (not pulled or failed); a 2B the portal did not generate is not missing. */
  missing: string[];
  /** Window months not due yet (the year is still running). */
  notDue: string[];
}

export interface FyEightA {
  /** 'portal': the uploaded document details; 'rebuilt': rebuilt here from the year's 2B (or 2A). */
  origin: 'portal' | 'rebuilt';
  basis: '2A' | '2B';
  meta: StatementMeta;
  docs: RecoDoc[];
  stored: Stored8A | null;
}

export interface FyStatements {
  fy: string;
  window: string[];
  windowEnd: string;
  twoA: FySide;
  twoB: FySide;
  eightA: FyEightA;
}

const sideOf = (source: '2A' | '2B', fy: string, rows: StatementRow[], today: string): FySide => {
  const window = fyWindow(fy);
  const months = source === '2B' ? fyLoadMonths(fy) : window;
  const metas = new Map<string, StatementMeta>();
  const all: RecoDoc[] = [];
  const sections = new Set<string>();
  for (const p of months) {
    const st = statementFromRow(findRow(rows, source, p), source, p);
    metas.set(p, st.meta);
    if (st.meta.state !== 'ready') continue;
    st.meta.sectionsRead.forEach((s) => sections.add(s));
    all.push(...st.docs);
  }
  const ofYear = all.filter((d) => inFy(d, fy) || (!d.date && window.includes(d.statementPeriod) && d.bucket === 'reversal'));
  const earlierFy = new Set(all.filter((d) => d.date && fyOfDate(d.date) < fy && d.bucket !== 'reversal').map(exactKey)).size;
  const { docs, superseded } = collapseDocs(ofYear);
  const usable = (m: StatementMeta) => m.state === 'ready' && !m.suspectEmpty;
  const missing = window.filter((p) => isDue(source, p, today) && !usable(metas.get(p) as StatementMeta) && metas.get(p)?.state !== 'not_generated');
  const notDue = window.filter((p) => !isDue(source, p, today));
  return { source, metas, docs, index: indexDocs(all), sectionsRead: [...sections], earlierFy, superseded, missing, notDue };
};

/** The 8A rebuilt from the year's 2B (or 2A): what the portal puts in it, as engineering reads the rules (§3). */
export function rebuild8A(side: FySide, fy: string): RecoDoc[] {
  const window = new Set(fyWindow(fy));
  return side.docs
    .filter((d) => window.has(d.statementPeriod) && EIGHT_A_SECTIONS.includes(d.section) && !d.reverseCharge
      && (side.source === '2A' || (d.bucket === 'available' && d.itcAvailable !== false)))
    .map((d, i) => ({
      ...d,
      ref: `8A|${eightAPeriod(fy)}|${d.section}|${d.ctin}|${d.number}|${i + 1}`,
      source: '8A' as SourceKey,
      statementPeriod: eightAPeriod(fy),
      bucket: null,
      imsStatus: null,
    }));
}

export interface FyInput {
  fy: string;
  /** 2A and 2B rows of fyLoadMonths, and the 8A row (source '8A', period eightAPeriod) when uploaded. */
  rows: StatementRow[];
  /** ISO date in India. */
  today: string;
}

/** The year's three statements from stored rows. */
export function assembleFy({ fy, rows, today }: FyInput): FyStatements {
  const twoA = sideOf('2A', fy, rows, today);
  const twoB = sideOf('2B', fy, rows, today);
  const basis = eightABasis(fy);
  const row8A = findRow(rows, '8A', eightAPeriod(fy));
  const st8A = statementFromRow(row8A, '8A', eightAPeriod(fy));
  let eightA: FyEightA;
  if (st8A.meta.state === 'ready') {
    const { docs } = collapseDocs(st8A.docs.filter((d) => !d.date || inFy(d, fy)));
    eightA = { origin: 'portal', basis, meta: st8A.meta, docs, stored: isStored8A(row8A?.summary) ? row8A?.summary as Stored8A : null };
  } else {
    const docs = rebuild8A(basis === '2B' ? twoB : twoA, fy);
    eightA = {
      origin: 'rebuilt',
      basis,
      meta: { ...st8A.meta, state: 'ready', sectionsRead: EIGHT_A_SECTIONS, pulledAt: null, generatedOn: null },
      docs,
      stored: null,
    };
  }
  return { fy, window: fyWindow(fy), windowEnd: fyWindowEnd(fy), twoA, twoB, eightA };
}

/** Words for months: "Apr 2025, May 2025 and Jun 2025" (at most six named). */
export const monthsWords = (ps: string[], label: (p: string) => string): string => {
  const names = ps.slice(0, 6).map(label);
  const more = ps.length > 6 ? ` and ${ps.length - 6} more` : '';
  if (names.length <= 1 || more) return names.join(', ') + more;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

/** The window months from `from` (a document's own month) to the end, among `ps`. */
export const fromMonth = (ps: string[], from: string | null): string[] => (from ? ps.filter((p) => !before(p, from)) : ps);

/** Every copy of a document in a side's statements (exact, normalised and its amendments), latest first. */
export function copiesIn(side: FySide, d: RecoDoc): RecoDoc[] {
  const hits = new Set<RecoDoc>([...(side.index.exact.get(exactKey(d)) ?? []), ...(side.index.norm.get(normKey(d)) ?? [])]);
  for (const a of side.index.byOriginal.get(normKey(d)) ?? side.index.byOriginal.get(looseKey(d)) ?? []) hits.add(a);
  return [...hits].sort((a, b) => periodIndex(b.statementPeriod) - periodIndex(a.statementPeriod));
}
