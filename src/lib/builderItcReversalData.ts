// Data access for the builder Rule 42/43 reversal working
// (src/utils/builderItcReversal.ts is the engine; migration
// 20261015110000_builder_itc_reversal.sql the schema).

import { supabase } from '@/integrations/supabase/client';
import { parseFiledGstr9, type FiledGstr9Itc } from '@/utils/gstr9Filed';
import {
  ZERO, add, fyOfDate, fyRange, t7, tax, defaultStartFy,
  type Gstr9Match, type T7Other, type Tax, type WorkingResult, type YearInput, type YearReference,
} from '@/utils/builderItcReversal';

export interface BuEventOption {
  id: string;
  buDate: string;
  postingPeriod: string;
  status: string;
}

export interface CarpetBasis {
  totalCarpet: number;
  exemptCarpet: number;
  unbookedCarpet: number;
  bookedResidentialCarpet: number;
  units: number;
  unbookedUnits: number;
  itcType: string | null;
  note: string;
}

export interface WorkingRow {
  id: string;
  client_id: string;
  project_id: string;
  bu_event_id: string | null;
  completion_date: string;
  start_fy: string;
  bu_fy: string;
  total_carpet_sqm: number;
  exempt_carpet_sqm: number;
  basis_note: string | null;
  posting_period: string;
  include_interest: boolean;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED';
  result: WorkingResult | null;
  submitted_by: string | null; submitted_at: string | null;
  approved_by: string | null; approved_at: string | null;
  adjustment_ids: string[];
  notes: string | null;
}

export interface YearRow {
  id: string;
  working_id: string;
  financial_year: string;
  is_bu_year: boolean;
  inputs_services: Tax;
  capital_goods: Tax;
  reversed_r42: Tax;
  reversed_r43: Tax;
  /** GSTR-9 Table 7 heads other than 7C / 7D. */
  t7_other: Partial<T7Other>;
  /** What was fetched from the portal and is locked: {source, fields: {column: value}}. */
  portal: PortalLock | null;
  gstr9_arn: string | null;
  gstr9_filed_on: string | null;
  gstr9_match: Gstr9Match;
  remarks: string | null;
}

/** The columns a portal fetch can lock. */
export type LockField = 'inputs_services' | 'capital_goods' | 'reversed_r42' | 'reversed_r43' | 't7_other';
export interface PortalLock {
  source: PortalSource;
  fields: Partial<Record<LockField, unknown>>;
}
export const isLocked = (y: YearRow, f: LockField) => !!y.portal?.fields && f in y.portal.fields;

export const toYearInput = (y: YearRow): YearInput => ({
  financialYear: y.financial_year,
  isBuYear: y.is_bu_year,
  inputsServices: tax(y.inputs_services),
  capitalGoods: tax(y.capital_goods),
  reversedR42: tax(y.reversed_r42),
  reversedR43: tax(y.reversed_r43),
  otherReversed: t7(y.t7_other),
  gstr9Arn: y.gstr9_arn,
  gstr9Match: y.gstr9_match,
});

export async function fetchBuEvents(projectId: string): Promise<BuEventOption[]> {
  const { data, error } = await supabase.from('builder_bu_events')
    .select('id, bu_date, posting_period, status').eq('project_id', projectId).order('bu_date');
  if (error) throw error;
  return ((data || []) as { id: string; bu_date: string; posting_period: string; status: string }[])
    .map((e) => ({ id: e.id, buDate: e.bu_date, postingPeriod: e.posting_period, status: e.status }));
}

/**
 * Te and Tt from the BU event's frozen unit snapshot: every unit unbooked at
 * the cut-off is exempt; for a Partial-ITC client the booked residential
 * carpet is exempt too (residential construction in a REP other than an RREP).
 */
export async function fetchCarpetBasis(buEventId: string, clientId: string): Promise<CarpetBasis> {
  const [{ data: rows, error }, { data: client }] = await Promise.all([
    supabase.from('builder_bu_event_units')
      .select('carpet_area_sqm, booked_at_cutoff, unit_type').eq('bu_event_id', buEventId),
    supabase.from('clients').select('builder_itc_type').eq('id', clientId).maybeSingle(),
  ]);
  if (error) throw error;
  const units = (rows || []) as { carpet_area_sqm: number; booked_at_cutoff: boolean; unit_type: string }[];
  const itcType = (client as { builder_itc_type: string | null } | null)?.builder_itc_type ?? null;
  const area = (u: { carpet_area_sqm: number }) => Number(u.carpet_area_sqm) || 0;
  const totalCarpet = units.reduce((s, u) => s + area(u), 0);
  const unbooked = units.filter((u) => !u.booked_at_cutoff);
  const unbookedCarpet = unbooked.reduce((s, u) => s + area(u), 0);
  const bookedResidentialCarpet = itcType === 'PARTIAL_ITC'
    ? units.filter((u) => u.booked_at_cutoff && u.unit_type === 'Residential').reduce((s, u) => s + area(u), 0)
    : 0;
  const exemptCarpet = unbookedCarpet + bookedResidentialCarpet;
  const note = itcType === 'PARTIAL_ITC'
    ? `Exempt = carpet unbooked at completion (${unbookedCarpet.toFixed(2)} sq m) + booked residential carpet (${bookedResidentialCarpet.toFixed(2)} sq m).`
    : `Exempt = carpet unbooked at completion (${unbooked.length} of ${units.length} units).`;
  return {
    totalCarpet: Math.round(totalCarpet * 100) / 100,
    exemptCarpet: Math.round(exemptCarpet * 100) / 100,
    unbookedCarpet: Math.round(unbookedCarpet * 100) / 100,
    bookedResidentialCarpet: Math.round(bookedResidentialCarpet * 100) / 100,
    units: units.length, unbookedUnits: unbooked.length, itcType, note,
  };
}

export async function fetchWorking(projectId: string, buEventId: string): Promise<{ working: WorkingRow | null; years: YearRow[] }> {
  const { data: w, error } = await supabase.from('builder_itc_reversal_workings')
    .select('*').eq('project_id', projectId).eq('bu_event_id', buEventId).maybeSingle();
  if (error) throw error;
  if (!w) return { working: null, years: [] };
  const { data: ys, error: yErr } = await supabase.from('builder_itc_reversal_years')
    .select('*').eq('working_id', (w as { id: string }).id).order('financial_year');
  if (yErr) throw yErr;
  return { working: w as unknown as WorkingRow, years: (ys || []) as unknown as YearRow[] };
}

export async function createWorking(params: {
  clientId: string; projectId: string; event: BuEventOption; basis: CarpetBasis;
  registrationDate: string | null; actorId: string | null;
}): Promise<string> {
  const buFy = fyOfDate(params.event.buDate);
  const startFy = defaultStartFy(params.registrationDate);
  const { data, error } = await supabase.from('builder_itc_reversal_workings').insert({
    client_id: params.clientId,
    project_id: params.projectId,
    bu_event_id: params.event.id,
    completion_date: params.event.buDate,
    start_fy: startFy,
    bu_fy: buFy,
    total_carpet_sqm: params.basis.totalCarpet,
    exempt_carpet_sqm: params.basis.exemptCarpet,
    basis_note: params.basis.note,
    posting_period: params.event.postingPeriod,
    created_by: params.actorId,
  }).select('id').single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  const rows = fyRange(startFy, buFy).map((fy) => ({
    working_id: id, financial_year: fy, is_bu_year: fy === buFy, updated_by: params.actorId,
  }));
  const { error: yErr } = await supabase.from('builder_itc_reversal_years').insert(rows);
  if (yErr) throw yErr;
  return id;
}

/** Add or drop years at the start (the first FY of the project can be moved). */
export async function setStartFy(working: WorkingRow, years: YearRow[], startFy: string, actorId: string | null): Promise<void> {
  const want = new Set(fyRange(startFy, working.bu_fy));
  const drop = years.filter((y) => !want.has(y.financial_year)).map((y) => y.id);
  if (drop.length) {
    const { error } = await supabase.from('builder_itc_reversal_years').delete().in('id', drop);
    if (error) throw error;
  }
  const have = new Set(years.map((y) => y.financial_year));
  const add = [...want].filter((fy) => !have.has(fy)).map((fy) => ({
    working_id: working.id, financial_year: fy, is_bu_year: fy === working.bu_fy, updated_by: actorId,
  }));
  if (add.length) {
    const { error } = await supabase.from('builder_itc_reversal_years').insert(add);
    if (error) throw error;
  }
  const { error } = await supabase.from('builder_itc_reversal_workings')
    .update({ start_fy: startFy, updated_at: new Date().toISOString() }).eq('id', working.id);
  if (error) throw error;
}

export async function saveYear(id: string, patch: Partial<Omit<YearRow, 'id' | 'working_id'>>, actorId: string | null): Promise<void> {
  const { error } = await supabase.from('builder_itc_reversal_years')
    .update({ ...patch, updated_by: actorId, updated_at: new Date().toISOString() } as never).eq('id', id);
  if (error) throw error;
}

export async function saveWorking(id: string, patch: Partial<Pick<WorkingRow,
  'posting_period' | 'include_interest' | 'notes' | 'total_carpet_sqm' | 'exempt_carpet_sqm' | 'basis_note'>>): Promise<void> {
  const { error } = await supabase.from('builder_itc_reversal_workings')
    .update({ ...patch, updated_at: new Date().toISOString() } as never).eq('id', id);
  if (error) throw error;
}

/**
 * What the app already holds for each FY: GSTR-9 Table 6A when the annual
 * return's portal figures are in, else the as-filed GSTR-3B Table 4A totals
 * month by month.
 */
export async function fetchReferences(clientId: string, fys: string[]): Promise<Record<string, YearReference>> {
  const out: Record<string, YearReference> = {};
  if (!fys.length) return out;
  const { data } = await supabase.from('annual_return_docs')
    .select('financial_year, data').eq('client_id', clientId).eq('doc_key', 'portal').in('financial_year', fys);
  type Doc = { financial_year: string; data: { gstr9?: { t6A?: Tax }; months?: Record<string, { itc4aTotal?: Tax }> } };
  for (const d of (data || []) as unknown as Doc[]) {
    const t6A = tax(d.data?.gstr9?.t6A);
    const months = Object.values(d.data?.months || {}).filter((m) => m?.itc4aTotal);
    if (t6A.i + t6A.c + t6A.s + t6A.x > 0) {
      out[d.financial_year] = { financialYear: d.financial_year, availed: t6A, source: 'GSTR-9 Table 6A', months: 12 };
    } else if (months.length) {
      out[d.financial_year] = {
        financialYear: d.financial_year,
        availed: months.reduce((a, m) => add(a, tax(m.itc4aTotal)), ZERO),
        source: 'GSTR-3B Table 4A (as filed)',
        months: months.length,
      };
    }
  }
  return out;
}

export async function submitWorking(id: string, result: WorkingResult, actorId: string | null): Promise<void> {
  const { error } = await supabase.from('builder_itc_reversal_workings').update({
    status: 'SUBMITTED', result: result as never, submitted_by: actorId, submitted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as never).eq('id', id).eq('status', 'DRAFT');
  if (error) throw error;
}

export async function approveWorking(id: string, actorId: string, result: WorkingResult): Promise<void> {
  const lines = result.lines.map((l) => ({
    table_ref: l.tableRef, label: l.label, reason: l.reason,
    igst: l.amount.i, cgst: l.amount.c, sgst: l.amount.s, cess: l.amount.x,
  }));
  const { error } = await supabase.rpc('builder_itc_reversal_approve', {
    p_working_id: id, p_actor_id: actorId, p_lines: lines as never,
  });
  if (error) throw error;
}

export async function withdrawWorking(id: string, actorId: string): Promise<void> {
  const { error } = await supabase.rpc('builder_itc_reversal_withdraw', { p_working_id: id, p_actor_id: actorId });
  if (error) throw error;
}

// ─── Filed GSTR-9 from the portal (extension 0.10.3, 'GSTR9_FILED') ─────────

/** 'YYYY-YY' → the GSTR-9 period the extension uses, '03/YYYY' (the closing March). */
export const gstr9PeriodOf = (fy: string) => `03/${Number(fy.slice(0, 4)) + 1}`;

/** Where a past year's figures came from, best first. */
export type PortalSource = 'GSTR9_FILED' | 'GSTR9_COMPUTED' | 'GSTR3B_AS_FILED';
export const PORTAL_SOURCE_LABEL: Record<PortalSource, string> = {
  GSTR9_FILED: 'From the filed GSTR-9 (portal)',
  GSTR9_COMPUTED: 'From GSTR-9 Table 6A (portal)',
  GSTR3B_AS_FILED: 'From the GSTR-3Bs filed (GSTR-9 not filed yet)',
};

export interface FiledGstr9 {
  financialYear: string;
  source: PortalSource;
  itc: FiledGstr9Itc;
  arn: string | null;
  filedDate: string | null;
  status: string | null;
  pulledAt: string | null;
  /** What the source could not give, said on the year. */
  note: string | null;
}

/**
 * Each past year's credit, from what the portal gave, best first:
 *  1. the filed GSTR-9 (extension 0.10.3+, 'GSTR9_FILED'): Table 6 by type and
 *     Table 7C/7D;
 *  2. the GSTR-9 the portal computes ('GSTR9_CALC') of a year whose GSTR-9 is
 *     filed: Table 6A (ITC availed through GSTR-3B) and the ARN. It carries no
 *     split by type and no Table 7, so the whole of 6A is taken as Rule 42/43
 *     common credit (the same exempt share applies to both, so the split does
 *     not change the reversal) and nothing as reversed earlier;
 *  3. a year whose GSTR-9 is not filed yet: the GSTR-3Bs filed for it, as the
 *     app holds them month by month (4A total availed, 4B(1) reversed).
 */
export async function fetchFiledGstr9(clientId: string, fys: string[]): Promise<Record<string, FiledGstr9>> {
  const out: Record<string, FiledGstr9> = {};
  if (!fys.length) return out;
  const byPeriod = new Map(fys.map((fy) => [gstr9PeriodOf(fy), fy]));
  const [{ data, error }, { data: docs }] = await Promise.all([
    supabase.from('gst_filed_returns')
      .select('return_type, period_month, summary, arn, filed_date, status, updated_at')
      .eq('client_id', clientId).in('return_type', ['GSTR9_FILED', 'GSTR9_CALC']).in('period_month', [...byPeriod.keys()]),
    supabase.from('annual_return_docs')
      .select('financial_year, data').eq('client_id', clientId).eq('doc_key', 'portal').in('financial_year', fys),
  ]);
  if (error) throw error;
  type Row = { return_type: string; period_month: string; summary: unknown; arn: string | null; filed_date: string | null; status: string | null; updated_at: string | null };
  const rowsFor = (rt: string) => ((data || []) as unknown as Row[]).filter((r) => r.return_type === rt && !!r.summary);  // a later failed read only rewrites the status

  for (const r of rowsFor('GSTR9_FILED')) {
    const fy = byPeriod.get(r.period_month);
    const itc = parseFiledGstr9(r.summary);
    if (!fy || !itc.found) continue;
    out[fy] = { financialYear: fy, source: 'GSTR9_FILED', itc, arn: r.arn, filedDate: r.filed_date, status: r.status, pulledAt: r.updated_at, note: null };
  }
  for (const r of rowsFor('GSTR9_CALC')) {
    const fy = byPeriod.get(r.period_month);
    if (!fy || out[fy] || r.status !== 'Filed') continue;
    const t6 = (r.summary as { table6?: { itc_3b?: Record<string, unknown> } }).table6;
    if (!t6?.itc_3b) continue;
    const a = t6.itc_3b;
    const availed = tax({ i: Number(a.iamt) || 0, c: Number(a.camt) || 0, s: Number(a.samt) || 0, x: Number(a.csamt) || 0 });
    out[fy] = {
      financialYear: fy, source: 'GSTR9_COMPUTED',
      itc: { inputsServices: availed, capitalGoods: ZERO, reversedR42: ZERO, reversedR43: ZERO, otherReversed: t7(), availed, found: true },
      arn: r.arn, filedDate: r.filed_date, status: r.status, pulledAt: r.updated_at,
      note: 'The portal gave Table 6A (locked) but not Table 7 of the filed return: enter 7A to 7H from the filed GSTR-9, then tick that it has been checked.',
    };
  }
  type Doc = { financial_year: string; data: { months?: Record<string, { itc4aTotal?: Tax; itc4b1?: Tax; itc4b2?: Tax }> } };
  for (const d of (docs || []) as unknown as Doc[]) {
    const fy = d.financial_year;
    if (out[fy]) continue;
    const calc = ((data || []) as unknown as Row[]).find((r) => r.return_type === 'GSTR9_CALC' && byPeriod.get(r.period_month) === fy);
    // Only for a year whose GSTR-9 the portal says is not filed yet.
    if (!calc || calc.status === 'Filed') continue;
    const months = Object.values(d.data?.months || {}).filter((m) => m?.itc4aTotal);
    if (!months.length) continue;
    const availed = months.reduce((a, m) => add(a, tax(m.itc4aTotal)), ZERO);
    const reversed = months.reduce((a, m) => add(a, tax(m.itc4b1)), ZERO);
    const otherRev = months.reduce((a, m) => add(a, tax(m.itc4b2)), ZERO);
    out[fy] = {
      financialYear: fy, source: 'GSTR3B_AS_FILED',
      itc: { inputsServices: availed, capitalGoods: ZERO, reversedR42: reversed, reversedR43: ZERO, otherReversed: t7({ h: otherRev }), availed, found: true },
      arn: null, filedDate: null, status: calc.status, pulledAt: calc.updated_at,
      note: `GSTR-9 not filed yet, so every figure is editable: prefilled from ${months.length} month(s) of GSTR-3B as filed — 4A as credit availed, 4B(1) as 7C, 4B(2) as 7H. Split them as the GSTR-9 will show them.`,
    };
  }
  return out;
}

/**
 * Fill a past year from what the portal gave. A filed GSTR-9 locks what it
 * gave (the DB refuses edits to it): all of Tables 6 and 7 when the filed
 * return was read, Table 6 alone when only the system-computed 6A came back
 * (Table 7 is then typed from the filed return and ticked as checked). A year
 * whose GSTR-9 is not filed is only prefilled, from the GSTR-3Bs, and stays
 * editable.
 */
export async function fillYearFromPortal(yearId: string, f: FiledGstr9, actorId: string | null): Promise<void> {
  const values = {
    inputs_services: f.itc.inputsServices,
    capital_goods: f.itc.capitalGoods,
    reversed_r42: f.itc.reversedR42,
    reversed_r43: f.itc.reversedR43,
    t7_other: f.itc.otherReversed,
  };
  const lockKeys: LockField[] = f.source === 'GSTR9_FILED'
    ? ['inputs_services', 'capital_goods', 'reversed_r42', 'reversed_r43', 't7_other']
    : f.source === 'GSTR9_COMPUTED' ? ['inputs_services', 'capital_goods'] : [];
  const portal: PortalLock | null = lockKeys.length
    ? { source: f.source, fields: Object.fromEntries(lockKeys.map((k) => [k, values[k]])) }
    : null;
  await saveYear(yearId, {
    ...values,
    portal,
    gstr9_arn: f.arn,
    gstr9_filed_on: f.filedDate,
    // Table 7 of a year read only as 6A still has to be typed and checked.
    gstr9_match: f.source === 'GSTR9_COMPUTED' ? 'UNVERIFIED' : 'MATCHED_DATA',
    remarks: `${PORTAL_SOURCE_LABEL[f.source]}.${f.note ? ` ${f.note}` : ''}`,
  }, actorId);
}

/** Whether a year should be (re)filled from the portal on load. */
export const needsPortalFill = (y: YearRow, f: FiledGstr9, blank: boolean): boolean => {
  if (f.source === 'GSTR3B_AS_FILED') return blank;              // prefill only, never over typing
  if (!y.portal) return true;                                      // never locked: take the filed return
  return y.portal.source !== 'GSTR9_FILED' && f.source === 'GSTR9_FILED'; // a better read arrived
};
