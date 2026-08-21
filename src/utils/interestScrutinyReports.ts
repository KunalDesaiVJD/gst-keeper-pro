// Phase 4: interest, late fee (s.47/Rule 88B) and Rule 42 ITC-reversal
// scrutiny reports. All 5 now read gst_filed_returns — the as-filed GSTR-3B
// pulled directly from the portal — instead of this app's own computed
// draft. The one figure that stays an estimate: the portal's summary API
// gives total liability and net ITC per head, but not which ITC head
// actually funded which liability head at filing time, so the cash-portion
// split for interest still uses the same Rule 88A cross-utilization
// estimate as GSTR-3B Offset Summary — only the LIABILITY and ITC feeding it
// are now real, as-filed figures rather than a computed draft. See
// docs/INTEREST_LATE_FEE_POSITIONS.md for what each calculation elects,
// simplifies, or is missing data for.

import { supabase } from '@/integrations/supabase/client';
import type { ReportTable } from './allClientsReports';
import { formatMonthLabel, fyMonthsForKey } from './allClientsReports';
import { fetchFiledReturn, type Gstr3bSummary, type TypedAmt } from './filedReturnReports';
import { computeItcOffset } from './gstr3bReports';
import {
  dueDayForReturn,
  computeDueDate,
  computeDaysLate,
  computeInterest,
  computeLateFee,
  computeRule42Reversal,
} from './interestLateFee';
import { format } from 'date-fns';

interface ClientLite {
  id: string;
  name: string;
  gstin: string;
  target_date_group1: number | null;
  target_date_group2: number | null;
}

const fileSafe = (s: string) => s.replace(/\s+/g, '_');
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const findItc = (arr: TypedAmt[] | undefined, ty: string) => (Array.isArray(arr) ? arr.find((x) => x.ty === ty) : undefined) || {};
const itcAvailGrossOf = (s: Gstr3bSummary) => {
  const heads = ['IMPG', 'IMPS', 'ISRC', 'ISD', 'OTH'].map((ty) => findItc(s.itc_elg?.itc_avl, ty));
  return {
    igst: heads.reduce((a, h) => a + num(h.iamt), 0),
    cgst: heads.reduce((a, h) => a + num(h.camt), 0),
    sgst: heads.reduce((a, h) => a + num(h.samt), 0),
  };
};
const totalLiabilityOf = (s: Gstr3bSummary) => {
  const o = s.sup_details?.osup_det, r = s.sup_details?.isup_rev;
  return { igst: num(o?.iamt) + num(r?.iamt), cgst: num(o?.camt) + num(r?.camt), sgst: num(o?.samt) + num(r?.samt) };
};
const itcNetOf = (s: Gstr3bSummary) => ({ igst: num(s.itc_elg?.itc_net?.iamt), cgst: num(s.itc_elg?.itc_net?.camt), sgst: num(s.itc_elg?.itc_net?.samt) });
const itcReversedOf = (s: Gstr3bSummary) => {
  const heads = s.itc_elg?.itc_rev || [];
  return { igst: heads.reduce((a, h) => a + num(h.iamt), 0), cgst: heads.reduce((a, h) => a + num(h.camt), 0), sgst: heads.reduce((a, h) => a + num(h.samt), 0) };
};

const fetchClientWithDueDays = async (clientId: string): Promise<ClientLite> => {
  const { data } = await supabase
    .from('clients')
    .select('id, name, gstin, target_date_group1, target_date_group2')
    .eq('id', clientId)
    .maybeSingle();
  return (data || { id: clientId, name: 'Unknown', gstin: '', target_date_group1: null, target_date_group2: null }) as ClientLite;
};

const fetchAllClientsWithDueDays = async (): Promise<ClientLite[]> => {
  const { data } = await supabase
    .from('clients')
    .select('id, name, gstin, target_date_group1, target_date_group2')
    .order('name');
  return (data || []) as ClientLite[];
};

/** "2026-27" — matches client_annual_turnover.financial_year, not the "FY 2026-27" display label. */
const fyKeyForMonth = (month: string): string => fyMonthsForKey(month).fyLabel.replace('FY ', '');

interface TurnoverRow { aggregate_turnover: number | null; exempt_turnover: number | null; itc_directly_attributable_exempt: number | null; }

const fetchTurnover = async (clientId: string, month: string): Promise<TurnoverRow | null> => {
  const { data } = await supabase
    .from('client_annual_turnover')
    .select('aggregate_turnover, exempt_turnover, itc_directly_attributable_exempt')
    .eq('client_id', clientId)
    .eq('financial_year', fyKeyForMonth(month))
    .maybeSingle();
  return data as TurnoverRow | null;
};

/** 'YYYY-MM-DD' → 'DD/MM/YYYY', without going through Date (avoids a
 * timezone-driven off-by-one day when the string has no time component). */
const formatIsoDate = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

// ─────────────────── Shared per-client interest + late fee calc ───────────

interface InterestCalcResult {
  client: ClientLite;
  returnType: string;
  status: string;
  dueDate: Date;
  filedDate: string | null;
  daysLate: number;
  stillAccruing: boolean;
  interest: ReturnType<typeof computeInterest>;
  isNil: boolean;
  lateFee: ReturnType<typeof computeLateFee>;
}

/** Returns null when the client has no GSTR-3B/GSTR-3B(Q) filing record for
 * this period (e.g. a quarterly client on a non-quarter-end month) — there is
 * nothing to calculate, not a zero result. */
const computeInterestForClient = async (client: ClientLite, month: string): Promise<InterestCalcResult | null> => {
  const [gstr3bRow, filingRes, turnover] = await Promise.all([
    fetchFiledReturn(client.id, month, 'GSTR3B'),
    supabase
      .from('filing_status')
      .select('return_type, status, target_date, filed_date')
      .eq('client_id', client.id)
      .eq('period_month', month)
      .in('return_type', ['GSTR-3B', 'GSTR-3B (Q)']),
    fetchTurnover(client.id, month),
  ]);
  if (!gstr3bRow || !gstr3bRow.summary || Object.keys(gstr3bRow.summary).length === 0) return null;
  const filingRow = ((filingRes.data || [])[0] || null) as
    | { return_type: string; status: string; target_date: number | null; filed_date: string | null }
    | null;
  if (!filingRow) return null;

  const s = gstr3bRow.summary as Gstr3bSummary;
  const dueDay = filingRow.target_date ?? dueDayForReturn(filingRow.return_type, client.target_date_group1, client.target_date_group2);
  const dueDate = computeDueDate(month, dueDay);
  const filedDate = filingRow.status === 'Filed' ? filingRow.filed_date : null;
  const { daysLate, stillAccruing } = computeDaysLate(dueDate, filedDate);
  const totalLiability = totalLiabilityOf(s);
  const itcNet = itcNetOf(s);
  const { cashPayable } = computeItcOffset(totalLiability, itcNet);
  const interest = computeInterest(cashPayable, daysLate);
  const isNil = totalLiability.igst + totalLiability.cgst + totalLiability.sgst === 0;
  const lateFee = computeLateFee(isNil, daysLate, turnover?.aggregate_turnover ?? null);

  return { client, returnType: filingRow.return_type, status: filingRow.status || 'Data Pending', dueDate, filedDate, daysLate, stillAccruing, interest, isNil, lateFee };
};

// ─────────────────── REPORT 1: Interest and Late Fee Calculator ───────────
// Single client + period, full working.

export const buildInterestLateFeeCalculatorReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClientWithDueDays(clientId);
  const result = await computeInterestForClient(client, month);
  const fileNameBase = `Interest_Late_Fee_Calculator_${fileSafe(client.name)}_${month.replace('/', '-')}`;

  if (!result) {
    return {
      title: 'Interest and Late Fee Calculator',
      subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   No GSTR-3B/GSTR-3B (Q) filing record for this period — nothing to calculate.`,
      headers: ['Item', 'Value'],
      rows: [],
      fileNameBase,
      columnWidths: [34, 20],
    };
  }

  const rows: (string | number)[][] = [
    ['Return Type', result.returnType, '', ''],
    ['Status', result.status, '', ''],
    ['Due Date', format(result.dueDate, 'dd/MM/yyyy'), '', ''],
    ['Filed Date', result.filedDate ? formatIsoDate(result.filedDate) : (result.stillAccruing ? 'Not yet filed — as of today' : '—'), '', ''],
    ['Days Late', result.daysLate, '', ''],
    ['', '', '', ''],
    ['Interest (Rule 88B, net of ITC set-off)', 'IGST', 'CGST', 'SGST'],
    ['', result.interest.igst, result.interest.cgst, result.interest.sgst],
    ['Total Interest', result.interest.total, '', ''],
    ['', '', '', ''],
    ['Late Fee (s.47)', result.isNil ? 'NIL return' : `Turnover tier: ${result.lateFee.tier}${result.lateFee.turnoverAssumed ? ' (assumed — turnover not on record for this FY)' : ''}`, '', ''],
    ['CGST', result.lateFee.cgst, '', ''],
    ['SGST', result.lateFee.sgst, '', ''],
    ['Total Late Fee', result.lateFee.total, '', ''],
    ['', '', '', ''],
    ['TOTAL (Interest + Late Fee)', result.interest.total + result.lateFee.total, '', ''],
  ];

  return {
    title: 'Interest and Late Fee Calculator',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   ${result.stillAccruing ? 'Return not yet filed — computed as of today and still accruing.   |   ' : ''}Approximate — net-of-ITC basis (Rule 88B(1)), flat 18% p.a./365-day interest, s.47 late fee. See docs/INTEREST_LATE_FEE_POSITIONS.md.`,
    headers: ['Item', 'IGST', 'CGST', 'SGST'],
    rows,
    fileNameBase,
    columnWidths: [40, 20, 14, 14],
  };
};

// ─────────────────── REPORT 2: Interest and Late Fee — All Clients ────────

export const buildInterestLateFeeAllClientsReport = async (month: string): Promise<ReportTable> => {
  const clients = await fetchAllClientsWithDueDays();
  const results = await Promise.all(clients.map((c) => computeInterestForClient(c, month)));

  let totInterest = 0, totLateFee = 0;
  const rows: (string | number)[][] = [];
  clients.forEach((client, idx) => {
    const r = results[idx];
    if (!r) return; // no GSTR-3B filing record this period — not applicable
    totInterest += r.interest.total;
    totLateFee += r.lateFee.total;
    rows.push([client.name, client.gstin || '—', r.returnType, r.status, r.daysLate, r.interest.total, r.lateFee.total, r.interest.total + r.lateFee.total]);
  });
  if (rows.length) rows.push(['', '', '', '', 'TOTAL', totInterest, totLateFee, totInterest + totLateFee]);

  return {
    title: 'Interest and Late Fee Report — All Clients',
    subtitle: `Month: ${formatMonthLabel(month)}   |   Computed indicative interest (Rule 88B(1), net of ITC, 18% p.a.) and late fee (s.47), based on the as-filed GSTR-3B liability/ITC pulled from the portal, for every client with a GSTR-3B/GSTR-3B (Q) filing record this period. See docs/INTEREST_LATE_FEE_POSITIONS.md.`,
    headers: ['Client Name', 'GSTIN', 'Return Type', 'Status', 'Days Late', 'Interest', 'Late Fee', 'Total'],
    rows,
    fileNameBase: `Interest_Late_Fee_All_Clients_${month.replace('/', '-')}`,
    columnWidths: [30, 18, 14, 16, 12, 14, 14, 14],
  };
};

// ─────────────────── REPORT 3: Scrutiny of Interest (late payment) ────────
// All clients, one month, exceptions-only (computed interest > 0).

export const buildInterestScrutinyReport = async (month: string): Promise<ReportTable> => {
  const clients = await fetchAllClientsWithDueDays();
  const results = await Promise.all(clients.map((c) => computeInterestForClient(c, month)));

  let total = 0;
  const rows: (string | number)[][] = [];
  clients.forEach((client, idx) => {
    const r = results[idx];
    if (!r || r.interest.total <= 0) return;
    total += r.interest.total;
    rows.push([client.name, client.gstin || '—', r.daysLate, r.interest.igst, r.interest.cgst, r.interest.sgst, r.interest.total]);
  });
  if (rows.length) rows.push(['', '', '', '', '', 'TOTAL', total]);

  return {
    title: 'Scrutiny of Interest due to Late Payment of 3B',
    subtitle: `Month: ${formatMonthLabel(month)}   |   Exceptions only — clients with computed interest > 0.${rows.length ? '' : ' No client shows computed interest for this period.'}   |   Approximate, net-of-ITC basis. See docs/INTEREST_LATE_FEE_POSITIONS.md.`,
    headers: ['Client Name', 'GSTIN', 'Days Late', 'IGST', 'CGST', 'SGST', 'Total Interest'],
    rows,
    fileNameBase: `Interest_Scrutiny_${month.replace('/', '-')}`,
    columnWidths: [30, 18, 12, 14, 14, 14, 16],
  };
};

// ─────────────────── Shared per-client Rule 42 calc ────────────────────────

interface Rule42CalcResult {
  client: ClientLite;
  itcAvailableTotal: number;
  itcReversedDeclared: number;
  t1: number;
  exemptTurnover: number | null;
  aggregateTurnover: number | null;
  commonCredit: number;
  ratio: number | null;
  computedReversal: number;
  shortfall: number;
  turnoverMissing: boolean;
}

const computeRule42ForClient = async (client: ClientLite, month: string): Promise<Rule42CalcResult | null> => {
  const [gstr3bRow, turnover] = await Promise.all([
    fetchFiledReturn(client.id, month, 'GSTR3B'),
    fetchTurnover(client.id, month),
  ]);
  if (!gstr3bRow || !gstr3bRow.summary || Object.keys(gstr3bRow.summary).length === 0) return null;

  const s = gstr3bRow.summary as Gstr3bSummary;
  const itcAvail = itcAvailGrossOf(s);
  const itcRev = itcReversedOf(s);
  const itcAvailableTotal = itcAvail.igst + itcAvail.cgst + itcAvail.sgst;
  const itcReversedDeclared = itcRev.igst + itcRev.cgst + itcRev.sgst;
  const t1 = turnover?.itc_directly_attributable_exempt || 0;
  const rule42 = computeRule42Reversal({
    itcAvailable: itcAvailableTotal,
    itcDirectlyAttributableExempt: t1,
    exemptTurnover: turnover?.exempt_turnover ?? null,
    aggregateTurnover: turnover?.aggregate_turnover ?? null,
  });
  const shortfall = Math.max(0, rule42.reversal - itcReversedDeclared);

  return {
    client,
    itcAvailableTotal,
    itcReversedDeclared,
    t1,
    exemptTurnover: turnover?.exempt_turnover ?? null,
    aggregateTurnover: turnover?.aggregate_turnover ?? null,
    commonCredit: rule42.commonCredit,
    ratio: rule42.ratio,
    computedReversal: rule42.reversal,
    shortfall,
    turnoverMissing: rule42.turnoverMissing,
  };
};

// ─────────────────── REPORT 4: Short Reversal of ITC — Rule 42 working ────
// Single client + period, full working. Rule 43 (capital goods) explicitly
// out of scope — see docs/INTEREST_LATE_FEE_POSITIONS.md §5.

export const buildRule42ShortReversalReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const client = await fetchClientWithDueDays(clientId);
  const result = await computeRule42ForClient(client, month);
  const fileNameBase = `Rule42_Short_Reversal_${fileSafe(client.name)}_${month.replace('/', '-')}`;

  if (!result) {
    return {
      title: 'Short Reversal of ITC — Section 17(2) & Rule 42',
      subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   No filed GSTR-3B pulled from the portal for this period — use GSTR-3B (Filed on Portal)'s Pull button first.`,
      headers: ['Item', 'Value'],
      rows: [],
      fileNameBase,
      columnWidths: [40, 20],
    };
  }

  const rows: (string | number)[][] = [
    ['ITC Available (Table 4A total, this period)', result.itcAvailableTotal],
    ['Less: ITC directly attributable to exempt supplies (T1, optional)', result.t1],
    ['Common Credit', result.commonCredit],
    ['', ''],
    [`Exempt Turnover (FY ${fyKeyForMonth(month)}, on record)`, result.exemptTurnover ?? 'Not entered'],
    [`Aggregate Turnover (FY ${fyKeyForMonth(month)}, on record)`, result.aggregateTurnover ?? 'Not entered'],
    ['Ratio (Exempt ÷ Aggregate)', result.ratio != null ? `${(result.ratio * 100).toFixed(2)}%` : 'Turnover not entered — cannot compute'],
    ['', ''],
    ['Rule 42 Computed Reversal (D1)', result.computedReversal],
    ["ITC Reversed as per this period's as-filed GSTR-3B (Table 4B, declared)", result.itcReversedDeclared],
    ['Short Reversal (Computed − Declared, floored at 0)', result.shortfall],
  ];

  return {
    title: 'Short Reversal of ITC — Section 17(2) & Rule 42',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   Rule 42 only (inputs/input services) — Rule 43 (capital goods) out of scope, this app has no capital-goods ITC ledger. A working-paper estimate, not a final annual Rule 42 true-up. See docs/INTEREST_LATE_FEE_POSITIONS.md §5.`,
    headers: ['Item', 'Amount'],
    rows,
    fileNameBase,
    columnWidths: [55, 22],
  };
};

// ─────────────────── REPORT 5: Short Reversal of ITC — All Clients ────────
// All clients, one month, exceptions-only (computed shortfall > 0, turnover on record).

export const buildRule42ShortReversalAllClientsReport = async (month: string): Promise<ReportTable> => {
  const clients = await fetchAllClientsWithDueDays();
  const results = await Promise.all(clients.map((c) => computeRule42ForClient(c, month)));

  let total = 0;
  let missingTurnoverCount = 0;
  const rows: (string | number)[][] = [];
  clients.forEach((client, idx) => {
    const r = results[idx];
    if (!r) return;
    if (r.turnoverMissing) { missingTurnoverCount++; return; }
    if (r.shortfall <= 0) return;
    total += r.shortfall;
    rows.push([client.name, client.gstin || '—', r.commonCredit, r.ratio != null ? `${(r.ratio * 100).toFixed(2)}%` : '—', r.computedReversal, r.itcReversedDeclared, r.shortfall]);
  });
  if (rows.length) rows.push(['', '', '', '', '', 'TOTAL', total]);

  return {
    title: 'Short Reversal of ITC in GSTR-3B (Rule 42)',
    subtitle: `Month: ${formatMonthLabel(month)}   |   Exceptions only — clients with a computed Rule 42 shortfall > 0.${missingTurnoverCount ? ` ${missingTurnoverCount} client(s) excluded — no turnover on record for the relevant FY, so their reversal can't be computed; check Annual Turnover on Edit Client.` : ''}   |   Approximate. See docs/INTEREST_LATE_FEE_POSITIONS.md §5.`,
    headers: ['Client Name', 'GSTIN', 'Common Credit', 'Ratio', 'Computed Reversal (D1)', 'Declared Reversal', 'Shortfall'],
    rows,
    fileNameBase: `Rule42_Short_Reversal_All_Clients_${month.replace('/', '-')}`,
    columnWidths: [30, 18, 16, 10, 18, 16, 14],
  };
};
