// The 6 GSTR-1 family reports on the Reports Hub. Each now PREFERS the real
// filed GSTR-1 JSON — gst_filed_returns.full_json, pulled directly from the
// portal's own "Offline Download for GSTR-1" feature (content.js
// handleGstr1JsonPull) — over this app's own pre-filing books draft
// (gstr1_data.raw_json, still the fallback when the filed JSON hasn't been
// pulled yet, since a return not yet filed genuinely has no portal JSON to
// pull). Confirmed live (2026-08-21): the portal's own download is the SAME
// invoice-level JSON schema gstr1_data.raw_json already uses, so every
// parser below works unchanged against either source — only WHICH one wins
// changed, and each report says which one it's showing.
//
// Reuses the app's existing GSTR-1 JSON parsers rather than re-deriving
// section logic:
//   - hydrateManualEntriesFromJson (gstr1ManualBuild.ts) flattens every
//     section into per-line rows with rt/txval/iamt/camt/samt/csamt, the
//     same parser the manual entry grid uses to re-open a return for
//     editing — kept in lock-step with the portal JSON shape by that file.
//   - buildGstr1Summary (buildGstr1Summary.ts) produces the portal-style
//     table-wise consolidated summary already shown in the "Generate
//     Summary" dialog.

import { supabase } from '@/integrations/supabase/client';
import type { ReportTable, RowTone } from './allClientsReports';
import { mmYyyyToShort, formatMonthLabel } from './allClientsReports';
import { hydrateManualEntriesFromJson } from './gstr1ManualBuild';
import { buildGstr1Summary } from './buildGstr1Summary';

interface ClientLite { id: string; name: string; gstin: string; }

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

const fileSafe = (s: string) => s.replace(/\s+/g, '_');

// A debit note adds to the outward figure, a credit note subtracts — same
// convention buildGstr1Summary.ts and computeGstr1OutputTax.ts both use.
const noteSign = (ntTyp: unknown): 1 | -1 =>
  String(ntTyp ?? 'C').toUpperCase().startsWith('D') ? 1 : -1;

type Gstr1Source = 'filed' | 'draft';

// One line, appended to every report's subtitle, so it's never ambiguous
// which JSON a figure came from.
const sourceNote = (source: Gstr1Source) => source === 'filed'
  ? 'As filed on the portal (real invoices, pulled via GSTR-1 (Filed on Portal)\'s Pull button)'
  : 'This app\'s pre-filing books draft — pull the filed GSTR-1 JSON (GSTR-1 (Filed on Portal) → Pull) to see the real return instead';

const fetchGstr1Row = async (clientId: string, month: string) => {
  const shortMonth = mmYyyyToShort(month);
  const [clientRes, filedRes, draftRes] = await Promise.all([
    supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle(),
    supabase.from('gst_filed_returns').select('full_json').eq('client_id', clientId).eq('period_month', month).eq('return_type', 'GSTR1').maybeSingle(),
    supabase.from('gstr1_data').select('raw_json').eq('client_id', clientId).eq('period_month', shortMonth).maybeSingle(),
  ]);
  const client: ClientLite = (clientRes.data || { id: clientId, name: 'Unknown', gstin: '' }) as any;
  const filedJson = filedRes.data?.full_json;
  if (filedJson && typeof filedJson === 'object' && Object.keys(filedJson).length > 0) {
    return { client, gstr1: { raw_json: filedJson }, source: 'filed' as Gstr1Source, shortMonth };
  }
  if (draftRes.data) {
    return { client, gstr1: { raw_json: draftRes.data.raw_json }, source: 'draft' as Gstr1Source, shortMonth };
  }
  throw new Error(`No filed GSTR-1 JSON pulled and no books draft imported for ${client.name} in ${formatMonthLabel(month)}. Use Pull to fetch the filed return from the portal, or import a draft from GSTR-1 Data.`);
};

// ─────────────────── REPORT 1: Rate Wise ─────────────────────────────────

export const buildGstr1RateWiseReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { client, gstr1, source } = await fetchGstr1Row(clientId, month);
  const { rowsBySection } = hydrateManualEntriesFromJson(gstr1.raw_json);

  interface Bucket { txval: number; igst: number; cgst: number; sgst: number; cess: number; }
  const byRate = new Map<number, Bucket>();
  const bump = (rt: unknown, txval: number, igst: number, cgst: number, sgst: number, cess: number) => {
    const key = num(rt);
    const cur = byRate.get(key) || { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    cur.txval += txval; cur.igst += igst; cur.cgst += cgst; cur.sgst += sgst; cur.cess += cess;
    byRate.set(key, cur);
  };

  // Every outward-supply line, at whatever rate it carries — reverse-charge
  // and SEZ/deemed-export B2B invoices included, since this is a breakdown
  // of what's in the return, not a re-derivation of net output liability.
  (['b2b', 'b2cl', 'b2cs', 'exp'] as const).forEach((section) => {
    (rowsBySection[section] || []).forEach((r) => bump(r.rt, num(r.txval), num(r.iamt), num(r.camt), num(r.samt), num(r.csamt)));
  });
  (['cdnr', 'cdnur'] as const).forEach((section) => {
    (rowsBySection[section] || []).forEach((r) => {
      const sign = noteSign(r.ntTyp);
      bump(r.rt, sign * num(r.txval), sign * num(r.iamt), sign * num(r.camt), sign * num(r.samt), sign * num(r.csamt));
    });
  });

  const j = gstr1.raw_json || {};
  const nilValue = (j.nil?.inv || []).reduce((s: number, r: any) => s + num(r.nil_amt) + num(r.expt_amt) + num(r.ngsup_amt), 0);

  const rateRows = Array.from(byRate.entries()).map(([rt, v]) => ({ rt, ...v })).sort((a, b) => a.rt - b.rt);

  let totTx = 0, totI = 0, totC = 0, totS = 0, totCess = 0;
  const rows: (string | number)[][] = rateRows.map((r) => {
    totTx += r.txval; totI += r.igst; totC += r.cgst; totS += r.sgst; totCess += r.cess;
    return [`${r.rt}%`, r.txval, r.igst, r.cgst, r.sgst, r.cess, r.igst + r.cgst + r.sgst + r.cess];
  });
  if (nilValue) {
    rows.push(['Nil Rated / Exempt / Non-GST', nilValue, 0, 0, 0, 0, 0]);
    totTx += nilValue;
  }
  rows.push(['TOTAL', totTx, totI, totC, totS, totCess, totI + totC + totS + totCess]);

  return {
    title: 'GSTR-1 Rate Wise Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   ${sourceNote(source)}`,
    headers: ['Rate', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total Tax'],
    rows,
    fileNameBase: `GSTR1_Rate_Wise_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [22, 18, 14, 14, 14, 12, 14],
  };
};

// ─────────────────── REPORT 2: Summary ────────────────────────────────────

export const buildGstr1SummaryReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { client, gstr1, source } = await fetchGstr1Row(clientId, month);
  // A filed GSTR-1 (pulled as filed, or Filed on Filing Status) keeps the
  // total it always showed; see buildGstr1Summary's `filed`.
  const { data: fs } = await supabase.from('filing_status').select('status')
    .eq('client_id', clientId).eq('period_month', month).in('return_type', ['GSTR-1', 'GSTR-1 (IFF)']).eq('status', 'Filed').limit(1);
  const summary = buildGstr1Summary(gstr1.raw_json, { filed: source === 'filed' || (fs?.length ?? 0) > 0 });

  const rows: (string | number)[][] = summary.sections.map((s) => [
    s.code, s.title, s.docType, s.count, s.value, s.igst, s.cgst, s.sgst, s.cess, s.igst + s.cgst + s.sgst + s.cess,
  ]);
  rows.push([
    '', summary.totalBasis === 'legacy'
      ? 'TOTAL (liability-bearing tables only — HSN and Documents Issued are memo rows above, excluded here)'
      : 'TOTAL LIABILITY (as GSTR-3B 3.1(a) + 3.1(b): 4B at value only, 11B deducted, amendments and Table 8 out; HSN and Documents are memo rows)', '', '',
    summary.totals.value, summary.totals.igst, summary.totals.cgst, summary.totals.sgst, summary.totals.cess,
    summary.totals.igst + summary.totals.cgst + summary.totals.sgst + summary.totals.cess,
  ]);

  return {
    title: 'GSTR-1 Summary Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   ${sourceNote(source)}`,
    headers: ['Table', 'Description', 'Doc Type', 'Count', 'Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total Tax'],
    rows,
    fileNameBase: `GSTR1_Summary_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [8, 60, 12, 10, 16, 14, 14, 14, 12, 14],
  };
};

// ─────────────────── REPORT 3: HSN Summary ────────────────────────────────
//
// What a preparer keys into GSTR-9 Table 17 (and checks Table 18 against):
// the year's Table 12 lines added up by HSN, UQC and rate. Each month is read
// from the best source it has, in this order:
//   1. the filed GSTR-1 JSON pulled from the portal (gst_filed_returns.full_json);
//   2. this app's books draft (gstr1_data.raw_json);
//   3. the last GSTR-1 JSON this app uploaded to the portal (gstr1_upload_versions,
//      an accepted upload first), for a month whose draft has since gone;
//   4. the portal's GSTR-1 summary (gst_filed_returns.summary, pulled with the
//      filing status): Table 12's totals only, no HSN-wise lines, so the month
//      is shown as "totals only" and kept out of the HSN-wise table.
// A month with none of these is listed once on the coverage strip, never as an
// error: one month missing no longer hides the months that have data.

type HsnSource = 'filed' | 'draft' | 'uploaded' | 'summary' | 'none';

const HSN_SOURCE_LABEL: Record<HsnSource, string> = {
  filed: 'Filed GSTR-1 (pulled)',
  draft: 'Books draft',
  uploaded: 'As uploaded by this app',
  summary: 'Portal summary (totals only)',
  none: 'Not available',
};

interface HsnLine {
  hsn: string; desc: string; uqc: string; rt: number; supply: 'B2B' | 'B2C' | '';
  qty: number; txval: number; iamt: number; camt: number; samt: number; csamt: number;
}

interface HsnMonth {
  period: string;
  source: HsnSource;
  lines: HsnLine[];
  /** Table 12's totals when only the portal summary is held. */
  totals?: { txval: number; iamt: number; camt: number; samt: number; csamt: number };
}

interface HsnReportTable extends ReportTable { hsnMonths?: HsnMonth[]; hsnClient?: ClientLite }

const hsnLinesOf = (j: any): HsnLine[] => {
  const h = j?.hsn;
  if (!h) return [];
  const tagged: { r: any; supply: HsnLine['supply'] }[] = Array.isArray(h.data)
    ? h.data.map((r: any) => ({ r, supply: '' as const }))
    : [
      ...(h.hsn_b2b || []).map((r: any) => ({ r, supply: 'B2B' as const })),
      ...(h.hsn_b2c || []).map((r: any) => ({ r, supply: 'B2C' as const })),
    ];
  return tagged.map(({ r, supply }) => ({
    hsn: String(r.hsn_sc ?? '').trim(),
    desc: String(r.desc ?? r.user_desc ?? '').trim(),
    uqc: String(r.uqc ?? '').trim().toUpperCase(),
    rt: num(r.rt),
    supply,
    qty: num(r.qty), txval: num(r.txval), iamt: num(r.iamt), camt: num(r.camt), samt: num(r.samt), csamt: num(r.csamt),
  }));
};

const hasHsn = (j: any): boolean => hsnLinesOf(j).length > 0;

/** Table 12's totals from the portal's GSTR-1 summary (sec_sum "HSN"; ttl_tax is the taxable value). */
const hsnTotalsFromSummary = (summary: any): HsnMonth['totals'] | undefined => {
  const secs: any[] = Array.isArray(summary?.sec_sum) ? summary.sec_sum : [];
  const all = secs.find((x) => x?.sec_nm === 'HSN');
  const parts = all ? [all] : secs.filter((x) => x?.sec_nm === 'HSN_B2B' || x?.sec_nm === 'HSN_B2C');
  if (!parts.length) return undefined;
  const t = { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
  for (const x of parts) {
    t.txval += num(x.ttl_tax); t.iamt += num(x.ttl_igst); t.camt += num(x.ttl_cgst); t.samt += num(x.ttl_sgst); t.csamt += num(x.ttl_cess);
  }
  return t.txval || t.iamt || t.camt || t.samt || t.csamt ? t : undefined;
};

const loadHsnMonth = async (clientId: string, month: string): Promise<{ client: ClientLite; month: HsnMonth }> => {
  const shortMonth = mmYyyyToShort(month);
  const [clientRes, filedRes, draftRes, versionsRes] = await Promise.all([
    supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle(),
    supabase.from('gst_filed_returns').select('full_json, summary').eq('client_id', clientId).eq('period_month', month).eq('return_type', 'GSTR1').maybeSingle(),
    supabase.from('gstr1_data').select('raw_json').eq('client_id', clientId).eq('period_month', shortMonth).maybeSingle(),
    supabase.from('gstr1_upload_versions').select('payload, action_type, status, version_number')
      .eq('client_id', clientId).eq('period_month', shortMonth).order('version_number', { ascending: false }).limit(50),
  ]);
  const client: ClientLite = (clientRes.data || { id: clientId, name: 'Unknown', gstin: '' }) as any;
  const filed = filedRes.data as { full_json?: any; summary?: any } | null;
  const draft = (draftRes.data as { raw_json?: any } | null)?.raw_json;
  const versions = (versionsRes.data || []) as { payload: any; action_type: string; status: string }[];

  if (hasHsn(filed?.full_json)) return { client, month: { period: month, source: 'filed', lines: hsnLinesOf(filed!.full_json) } };
  if (hasHsn(draft)) return { client, month: { period: month, source: 'draft', lines: hsnLinesOf(draft) } };
  const uploaded = versions.find((v) => v.action_type === 'UPLOAD' && v.status === 'accepted' && hasHsn(v.payload))
    ?? versions.find((v) => hasHsn(v.payload));
  if (uploaded) return { client, month: { period: month, source: 'uploaded', lines: hsnLinesOf(uploaded.payload) } };
  const totals = hsnTotalsFromSummary(filed?.summary);
  if (totals) return { client, month: { period: month, source: 'summary', lines: [], totals } };
  return { client, month: { period: month, source: 'none', lines: [] } };
};

const monthSort = (a: string, b: string) => {
  const k = (p: string) => { const [m, y] = p.split('/').map(Number); return (y || 0) * 100 + (m || 0); };
  return k(a) - k(b);
};

/** "Apr 2025 to Mar 2026" for a run of consecutive months, else the months listed. */
const describeMonths = (periods: string[]): string => {
  const sorted = [...periods].sort(monthSort);
  const idx = (p: string) => { const [m, y] = p.split('/').map(Number); return y * 12 + m; };
  const runs: string[][] = [];
  for (const p of sorted) {
    const last = runs[runs.length - 1];
    if (last && idx(p) === idx(last[last.length - 1]) + 1) last.push(p); else runs.push([p]);
  }
  return runs.map((r) => (r.length > 2 ? `${formatMonthLabel(r[0])} to ${formatMonthLabel(r[r.length - 1])}` : r.map(formatMonthLabel).join(', '))).join(', ');
};

const HSN_HEADERS = ['HSN/SAC', 'Description', 'UQC', 'Qty', 'Rate', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total Tax'];

/** The HSN table (one or several months) from the months read. */
const hsnTableOf = (client: ClientLite, months: HsnMonth[]): HsnReportTable => {
  const sortedMonths = [...months].sort((a, b) => monthSort(a.period, b.period));
  const periods = sortedMonths.map((m) => m.period);
  const several = periods.length > 1;

  // HSN-wise: one line per HSN, UQC and rate, across the months (and B2B / B2C).
  interface Agg { hsn: string; desc: string; uqc: string; rt: number; qty: number; txval: number; iamt: number; camt: number; samt: number; csamt: number }
  const byKey = new Map<string, Agg>();
  for (const m of sortedMonths) {
    for (const l of m.lines) {
      const key = `${l.hsn}|${l.uqc}|${l.rt}`;
      const cur = byKey.get(key) || { hsn: l.hsn, desc: '', uqc: l.uqc, rt: l.rt, qty: 0, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
      if (!cur.desc && l.desc) cur.desc = l.desc;
      cur.qty += l.qty; cur.txval += l.txval; cur.iamt += l.iamt; cur.camt += l.camt; cur.samt += l.samt; cur.csamt += l.csamt;
      byKey.set(key, cur);
    }
  }
  const aggs = [...byKey.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rt - b.rt || a.uqc.localeCompare(b.uqc));
  const tot = { qty: 0, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
  const rows: (string | number)[][] = aggs.map((a) => {
    tot.qty += a.qty; tot.txval += a.txval; tot.iamt += a.iamt; tot.camt += a.camt; tot.samt += a.samt; tot.csamt += a.csamt;
    return [a.hsn || '—', a.desc, a.uqc || '—', a.qty, `${a.rt}%`, a.txval, a.iamt, a.camt, a.samt, a.csamt, a.iamt + a.camt + a.samt + a.csamt];
  });
  if (rows.length) rows.push(['', 'TOTAL', '', tot.qty, '', tot.txval, tot.iamt, tot.camt, tot.samt, tot.csamt, tot.iamt + tot.camt + tot.samt + tot.csamt]);

  // Coverage: each month's source and Table 12 totals.
  const withLines = sortedMonths.filter((m) => m.lines.length > 0);
  const totalsOnly = sortedMonths.filter((m) => m.source === 'summary');
  const missing = sortedMonths.filter((m) => m.source === 'none');
  const monthTotals = (m: HsnMonth) => m.totals ?? m.lines.reduce((t, l) => ({
    txval: t.txval + l.txval, iamt: t.iamt + l.iamt, camt: t.camt + l.camt, samt: t.samt + l.samt, csamt: t.csamt + l.csamt,
  }), { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
  const coverageRows: (string | number)[][] = sortedMonths.map((m) => {
    const t = monthTotals(m);
    const status = m.lines.length ? 'HSN-wise' : m.source === 'summary' ? 'Totals only' : 'Missing';
    return [formatMonthLabel(m.period), HSN_SOURCE_LABEL[m.source], status, m.lines.length, t.txval, t.iamt, t.camt, t.samt, t.csamt, t.iamt + t.camt + t.samt + t.csamt];
  });
  const covTot = sortedMonths.reduce((acc, m) => { const t = monthTotals(m); return { txval: acc.txval + t.txval, tax: acc.tax + t.iamt + t.camt + t.samt + t.csamt, i: acc.i + t.iamt, c: acc.c + t.camt, s: acc.s + t.samt, cess: acc.cess + t.csamt }; }, { txval: 0, tax: 0, i: 0, c: 0, s: 0, cess: 0 });
  coverageRows.push(['TOTAL', '', `${withLines.length} of ${sortedMonths.length} HSN-wise`, withLines.reduce((n, m) => n + m.lines.length, 0), covTot.txval, covTot.i, covTot.c, covTot.s, covTot.cess, covTot.tax]);

  const notes: string[] = [];
  if (missing.length) notes.push(`No GSTR-1 data held for ${describeMonths(missing.map((m) => m.period))} (${missing.length} month${missing.length === 1 ? '' : 's'}): pull the filed GSTR-1 with the Pull button, or import a draft on GSTR-1 Data.`);
  if (totalsOnly.length) notes.push(`${describeMonths(totalsOnly.map((m) => m.period))}: only the portal's GSTR-1 summary is held, so Table 12's totals are shown here but not its HSN-wise lines. Pull the filed GSTR-1 to add them to the HSN-wise table.`);
  if (sortedMonths.some((m) => m.source === 'draft' || m.source === 'uploaded')) notes.push('Months marked Books draft or As uploaded by this app are this app\'s own GSTR-1, not the copy filed on the portal. Pull the filed GSTR-1 before keying GSTR-9 Table 17.');

  // Month-wise detail: every Table 12 line as read, for tracing a Table 17 figure back.
  const detailRows: (string | number)[][] = sortedMonths.flatMap((m) => m.lines
    .slice().sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rt - b.rt)
    .map((l) => [formatMonthLabel(m.period), HSN_SOURCE_LABEL[m.source], l.supply || '—', l.hsn || '—', l.desc, l.uqc || '—', l.qty, `${l.rt}%`, l.txval, l.iamt, l.camt, l.samt, l.csamt, l.iamt + l.camt + l.samt + l.csamt]));

  const sources = [...new Set(withLines.map((m) => m.source))];
  const periodText = several ? `${formatMonthLabel(periods[0])} to ${formatMonthLabel(periods[periods.length - 1])}` : formatMonthLabel(periods[0] ?? '');
  const sourceText = sources.length === 1 && sources[0] === 'filed' && withLines.length === sortedMonths.length
    ? sourceNote('filed')
    : withLines.length === 0 ? 'No HSN-wise data held for the period' : `Source: ${sources.map((s) => HSN_SOURCE_LABEL[s]).join(', ')}`;
  const fileMonth = several ? `${periods[0].replace('/', '-')}_to_${periods[periods.length - 1].replace('/', '-')}` : (periods[0] ?? '').replace('/', '-');

  return {
    title: several ? 'GSTR-1 HSN Summary (for GSTR-9 Table 17)' : 'GSTR-1 HSN Summary Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${periodText}   |   ${sourceText}`,
    headers: HSN_HEADERS,
    rows,
    sheetName: several ? 'HSN-wise (Table 17)' : 'HSN Summary',
    fileNameBase: `GSTR1_HSN_Summary_${fileSafe(client.name)}_${fileMonth}`,
    columnWidths: [12, 30, 8, 10, 8, 16, 14, 14, 14, 12, 14],
    kpis: [
      { label: 'Months with HSN data', value: `${withLines.length} of ${sortedMonths.length}`, tone: withLines.length === sortedMonths.length ? 'good' : withLines.length ? 'warn' : 'bad' },
      { label: 'HSN lines', value: aggs.length },
      { label: 'Taxable value', value: tot.txval },
      { label: 'Total tax', value: tot.iamt + tot.camt + tot.samt + tot.csamt },
    ],
    summary: {
      title: 'Coverage by month',
      headers: ['Month', 'Source', 'Status', 'HSN Lines', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total Tax'],
      rows: coverageRows,
      columnWidths: [12, 26, 14, 10, 16, 14, 14, 14, 12, 14],
      notes,
      rowTones: [...sortedMonths.map((m) => (m.lines.length ? (m.source === 'filed' ? 'good' : 'info') : m.source === 'summary' ? 'warn' : 'bad') as RowTone), null],
      toneColumn: 2,
    },
    extraSheets: detailRows.length ? [{
      name: 'Month-wise lines',
      title: 'Table 12 lines by month, as read',
      headers: ['Month', 'Source', 'Supply', 'HSN/SAC', 'Description', 'UQC', 'Qty', 'Rate', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total Tax'],
      rows: detailRows,
      columnWidths: [10, 22, 8, 12, 28, 8, 10, 8, 16, 14, 14, 14, 12, 14],
      pdf: false,
    }] : undefined,
    coverage: {
      periods: sortedMonths.map((m) => ({
        period: m.period,
        label: formatMonthLabel(m.period),
        status: m.lines.length ? 'ok' : m.source === 'summary' ? 'partial' : 'missing',
        source: HSN_SOURCE_LABEL[m.source],
      })),
      action: notes.join(' '),
    },
    hsnMonths: sortedMonths,
    hsnClient: client,
    // Several months add up by HSN (Table 17 is the year's), rather than one band per month.
    merge: (tables: ReportTable[]) => {
      const all = tables.flatMap((t) => (t as HsnReportTable).hsnMonths ?? []);
      const c = tables.map((t) => (t as HsnReportTable).hsnClient).find(Boolean) ?? client;
      return hsnTableOf(c, all);
    },
  };
};

export const buildGstr1HsnSummaryReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { client, month: m } = await loadHsnMonth(clientId, month);
  return hsnTableOf(client, [m]);
};

// ─────────────────── REPORT 4: Customer Wise ──────────────────────────────

export const buildGstr1CustomerWiseReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { client, gstr1, source } = await fetchGstr1Row(clientId, month);
  const { rowsBySection } = hydrateManualEntriesFromJson(gstr1.raw_json);

  interface Agg { count: number; txval: number; igst: number; cgst: number; sgst: number; cess: number; docKeys: Set<string>; }
  const byGstin = new Map<string, Agg>();
  const bump = (ctin: unknown, docKey: string, txval: number, igst: number, cgst: number, sgst: number, cess: number) => {
    const gstin = String(ctin || '').trim();
    if (!gstin) return;
    const cur = byGstin.get(gstin) || { count: 0, txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, docKeys: new Set() };
    if (!cur.docKeys.has(docKey)) { cur.docKeys.add(docKey); cur.count += 1; }
    cur.txval += txval; cur.igst += igst; cur.cgst += cgst; cur.sgst += sgst; cur.cess += cess;
    byGstin.set(gstin, cur);
  };

  // Registered (B2B) counterparties only — B2CL/B2CS/CDNUR/EXP address the
  // recipient by place-of-supply, not GSTIN, so there's no customer to
  // group them under.
  (rowsBySection.b2b || []).forEach((r) => bump(r.ctin, `inv:${r.inum}`, num(r.txval), num(r.iamt), num(r.camt), num(r.samt), num(r.csamt)));
  (rowsBySection.cdnr || []).forEach((r) => {
    const sign = noteSign(r.ntTyp);
    bump(r.ctin, `nt:${r.ntNum}`, sign * num(r.txval), sign * num(r.iamt), sign * num(r.camt), sign * num(r.samt), sign * num(r.csamt));
  });

  const sortedGstins = Array.from(byGstin.keys()).sort();
  let totCount = 0, totTx = 0, totI = 0, totC = 0, totS = 0, totCess = 0;
  const rows: (string | number)[][] = sortedGstins.map((gstin, idx) => {
    const a = byGstin.get(gstin)!;
    totCount += a.count; totTx += a.txval; totI += a.igst; totC += a.cgst; totS += a.sgst; totCess += a.cess;
    return [idx + 1, gstin, a.count, a.txval, a.igst, a.cgst, a.sgst, a.cess, a.igst + a.cgst + a.sgst + a.cess];
  });
  rows.push(['', 'TOTAL', totCount, totTx, totI, totC, totS, totCess, totI + totC + totS + totCess]);

  return {
    title: 'GSTR-1 Customer Wise Report',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}   |   Registered (B2B) customers only — the GSTR-1 JSON doesn't carry counterparty trade names   |   ${sourceNote(source)}`,
    headers: ['Sr No.', 'Customer GSTIN', 'Document Count', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total Tax'],
    rows,
    fileNameBase: `GSTR1_Customer_Wise_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [6, 20, 12, 16, 14, 14, 14, 12, 14],
  };
};

// ─────────────────── REPORT 5: Error Log ──────────────────────────────────

interface UploadErrorRow { invoiceNo?: string; gstin?: string; reason: string; }

// GSTN's upload/error-report responses can include a row for every
// submitted record, not just the rejected ones — accepted records show up
// with placeholder fields like reason "NA NA NA". Same filter GSTR1DataPage
// applies before rendering the on-screen error list.
const isPlaceholderReason = (reason?: string | null) => {
  const trimmed = (reason || '').trim();
  if (!trimmed) return true;
  return trimmed.split(/\s+/).every((token) => /^n\/?a$/i.test(token));
};

export const buildGstr1ErrorLogReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const shortMonth = mmYyyyToShort(month);
  const [clientRes, versionsRes] = await Promise.all([
    supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle(),
    supabase.from('gstr1_upload_versions').select('*').eq('client_id', clientId).eq('period_month', shortMonth).order('version_number', { ascending: true }),
  ]);
  const client: ClientLite = (clientRes.data || { id: clientId, name: 'Unknown', gstin: '' }) as any;
  const versions = versionsRes.data || [];
  if (versions.length === 0) {
    throw new Error(`No GSTR-1 upload history for ${client.name} in ${formatMonthLabel(month)}.`);
  }

  const rows: (string | number)[][] = [];
  versions.forEach((v: any) => {
    const errors = ((v.errors as UploadErrorRow[] | null) || []).filter((e) => !isPlaceholderReason(e.reason));
    const when = v.action_at ? new Date(v.action_at).toLocaleString('en-IN') : '—';
    if (errors.length === 0) {
      rows.push([v.version_number, v.action_type || '—', when, v.status || '—', '—', '—', 'No errors']);
    } else {
      errors.forEach((e) => rows.push([v.version_number, v.action_type || '—', when, v.status || '—', e.invoiceNo || '—', e.gstin || '—', e.reason]));
    }
  });

  return {
    title: 'GSTR-1 Error Log',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${formatMonthLabel(month)}`,
    headers: ['Version', 'Action', 'Date/Time', 'Status', 'Invoice No.', 'GSTIN', 'Reason'],
    rows,
    fileNameBase: `GSTR1_Error_Log_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [8, 14, 22, 14, 16, 20, 44],
  };
};

// ────────────── REPORT 6: P.Y. Invoice Showing in C.Y. ───────────────────

// Indian FY (Apr-Mar) start year for an ISO (YYYY-MM-DD) date, as produced
// by gstr1ManualBuild's fromPortalDate conversion.
const fyStartYearOfIso = (isoDate: string): number | null => {
  const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]), monthNum = Number(m[2]);
  return monthNum >= 4 ? year : year - 1;
};

export const buildGstr1PyInCyReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { client, gstr1, source } = await fetchGstr1Row(clientId, month);
  const { rowsBySection } = hydrateManualEntriesFromJson(gstr1.raw_json);

  const [mm, yyyy] = month.split('/').map(Number);
  const periodFy = mm >= 4 ? yyyy : yyyy - 1;

  interface FlagRow { section: string; partyRef: string; docNo: string; docDate: string; txval: number; totalTax: number; }
  const flagged: FlagRow[] = [];
  const check = (section: string, partyRef: unknown, docNo: unknown, isoDate: unknown, txval: number, igst: number, cgst: number, sgst: number, cess: number) => {
    const invFy = fyStartYearOfIso(String(isoDate || ''));
    if (invFy == null || invFy >= periodFy) return;
    flagged.push({ section, partyRef: String(partyRef || '—'), docNo: String(docNo || '—'), docDate: String(isoDate), txval, totalTax: igst + cgst + sgst + cess });
  };

  (rowsBySection.b2b || []).forEach((r) => check('B2B', r.ctin, r.inum, r.idt, num(r.txval), num(r.iamt), num(r.camt), num(r.samt), num(r.csamt)));
  (rowsBySection.b2cl || []).forEach((r) => check('B2CL', r.pos, r.inum, r.idt, num(r.txval), num(r.iamt), 0, 0, num(r.csamt)));
  (rowsBySection.cdnr || []).forEach((r) => check('CDNR', r.ctin, r.ntNum, r.ntDt, num(r.txval), num(r.iamt), num(r.camt), num(r.samt), num(r.csamt)));
  (rowsBySection.cdnur || []).forEach((r) => check('CDNUR', r.pos, r.ntNum, r.ntDt, num(r.txval), num(r.iamt), 0, 0, num(r.csamt)));
  (rowsBySection.exp || []).forEach((r) => check('EXP', '—', r.inum, r.idt, num(r.txval), num(r.iamt), 0, 0, num(r.csamt)));

  flagged.sort((a, b) => a.docDate.localeCompare(b.docDate));

  const rows: (string | number)[][] = flagged.map((f, idx) => [idx + 1, f.section, f.partyRef, f.docNo, f.docDate, f.txval, f.totalTax]);
  if (rows.length === 0) {
    rows.push(['—', 'No previous-year-dated invoices/notes found in this period\'s GSTR-1.', '', '', '', '', '']);
  }

  return {
    title: 'GSTR-1 — P.Y. Invoice Showing in C.Y.',
    subtitle: `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Return Period: ${formatMonthLabel(month)} (FY ${periodFy}-${String(periodFy + 1).slice(-2)})   |   ${sourceNote(source)}`,
    headers: ['Sr No.', 'Section', 'GSTIN / POS', 'Doc No.', 'Doc Date', 'Taxable Value', 'Total Tax'],
    rows,
    fileNameBase: `GSTR1_PY_in_CY_${fileSafe(client.name)}_${month.replace('/', '-')}`,
    columnWidths: [6, 10, 18, 16, 12, 16, 14],
  };
};
