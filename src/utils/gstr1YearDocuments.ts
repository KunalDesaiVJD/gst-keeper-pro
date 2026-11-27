// GSTR-1 Documents — Full Year (Reports Hub, 27 Nov 2026). For one client and
// FY, every document of every section of each month's filed GSTR-1 (B2B,
// B2CL, B2CS, exports, credit / debit notes, every amendment table, advances,
// e-commerce tables 14 / 15, nil, HSN, documents issued) compiled into one
// working paper with a Month column.
//
// Source: only the filed return as the portal gives it, the extension's
// "Offline Download for GSTR-1" pull (gstr1_json_pull, extension 0.18.7 and
// earlier; it walks a list of months in one run) stored in
// gst_filed_returns.full_json. This app's own books draft is never mixed in:
// a month not pulled is listed as such, so the year shows what was filed.
// The Pull plan (reportsCatalog) asks for each month of the FY still missing.
import { supabase } from '@/integrations/supabase/client';
import type { ReportTable, ReportSheet, ReportKpi, RowTone, RowKind } from './allClientsReports';
import { fyMonthsForKey, formatMonthLabel } from './allClientsReports';
import {
  flattenGstr1, toDocLine, sectionInfo, OWN_SHEET, docKey, signOf, num, DOC_NATURE, NIL_SUPPLY,
  type DocLine, type SectionRow,
} from '@/lib/gstr1Year/flatten';

interface ClientLite { id: string; name: string; gstin: string }
interface MonthRead { period: string; json: unknown | null; status: string; pulledAt: string | null }

const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_');
const round2 = (n: number) => Math.round(n * 100) / 100;

const loadYear = async (clientId: string, months: string[]): Promise<{ client: ClientLite; reads: MonthRead[] }> => {
  const clientRes = await supabase.from('clients').select('id, name, gstin').eq('id', clientId).maybeSingle();
  const client: ClientLite = (clientRes.data as ClientLite | null) ?? { id: clientId, name: 'Unknown', gstin: '' };
  // One month a query: a year of filed JSON can run to tens of MB in one answer.
  const reads = await Promise.all(months.map(async (period): Promise<MonthRead> => {
    const { data, error } = await supabase.from('gst_filed_returns')
      .select('full_json, full_json_pulled_at, status')
      .eq('client_id', clientId).eq('period_month', period).eq('return_type', 'GSTR1').maybeSingle();
    if (error) throw new Error(`Could not read the GSTR-1 of ${formatMonthLabel(period)}: ${error.message}`);
    const row = data as { full_json: unknown; full_json_pulled_at: string | null; status: string | null } | null;
    const json = row?.full_json && typeof row.full_json === 'object' && Object.keys(row.full_json as object).length ? row.full_json : null;
    return { period, json, status: String(row?.status ?? ''), pulledAt: row?.full_json_pulled_at ?? null };
  }));
  return { client, reads };
};

const monthStatus = (m: MonthRead): { label: string; tone: RowTone } => {
  if (m.json) return { label: 'Pulled', tone: 'good' };
  if (/^PENDING/i.test(m.status)) return { label: 'Generating on the portal: Pull again in about 20 minutes', tone: 'warn' };
  if (/^PULL FAILED/i.test(m.status)) return { label: m.status.replace(/^PULL FAILED:\s*/i, 'Pull failed: '), tone: 'bad' };
  if (/NOT FILED|NOT FOUND/i.test(m.status)) return { label: 'Not filed / not found on the portal', tone: 'muted' };
  return { label: 'Not pulled', tone: 'muted' };
};


const DOC_HEADERS = [
  'Month', 'Table', 'Section', 'Sub-section', 'Counterparty GSTIN', 'Document', 'Document No.', 'Document Date', 'Note Type',
  'Original Doc No.', 'Original Doc Date', 'Original Month', 'Place of Supply', 'Supply Type', 'Reverse Charge', 'Invoice Type', 'Type',
  'Rate (%)', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total Tax', 'Document Value', 'Other Details',
];
const DOC_WIDTHS = [10, 12, 30, 18, 18, 14, 18, 12, 8, 18, 12, 10, 10, 10, 8, 10, 10, 8, 15, 13, 13, 13, 11, 14, 15, 30];
const AMT_START = 18; // Taxable Value

interface Agg { docs: Set<string>; lines: number; taxable: number; igst: number; cgst: number; sgst: number; cess: number }
const newAgg = (): Agg => ({ docs: new Set(), lines: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
const bump = (a: Agg, l: DocLine, key: string, sign: number) => {
  a.docs.add(key); a.lines += 1;
  a.taxable += sign * l.taxable; a.igst += sign * l.igst; a.cgst += sign * l.cgst; a.sgst += sign * l.sgst; a.cess += sign * l.cess;
};
const aggCells = (a: Agg) => {
  const tax = a.igst + a.cgst + a.sgst + a.cess;
  return [a.docs.size, a.lines, round2(a.taxable), round2(a.igst), round2(a.cgst), round2(a.sgst), round2(a.cess), round2(tax)];
};
const addInto = (t: Agg, a: Agg) => { a.docs.forEach((d) => t.docs.add(d)); t.lines += a.lines; t.taxable += a.taxable; t.igst += a.igst; t.cgst += a.cgst; t.sgst += a.sgst; t.cess += a.cess; };

/** The year's report, for the FY holding `anyMonthInFy`. */
export const buildGstr1YearDocumentsReport = async (clientId: string, anyMonthInFy: string): Promise<ReportTable> => {
  const { fyLabel, months } = fyMonthsForKey(anyMonthInFy);
  const { client, reads } = await loadYear(clientId, months);

  const docRows: (string | number)[][] = [];
  const docKinds: (RowKind | null)[] = [];
  const hsnRows: (string | number)[][] = [];
  const docIssueRows: (string | number)[][] = [];
  const nilRows: (string | number)[][] = [];
  const bySection = new Map<string, Agg>();
  const sectionOrder: string[] = [];
  const byMonth = new Map<string, Agg>();
  const hsnTot = { qty: 0, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
  const docTot = { total: 0, cancel: 0, net: 0 };
  const nilTot = { nil: 0, expt: 0, ngsup: 0 };
  const docTotAgg = newAgg();

  for (const m of reads) {
    const monthLabel = formatMonthLabel(m.period);
    const mAgg = newAgg();
    byMonth.set(m.period, mAgg);
    if (!m.json) continue;
    const flat: SectionRow[] = flattenGstr1(m.json);
    for (const s of flat) {
      const r = s.row;
      if (s.section === 'hsn') {
        const igst = num(r.iamt), cgst = num(r.camt), sgst = num(r.samt), cess = num(r.csamt), qty = num(r.qty), txval = num(r.txval);
        hsnTot.qty += qty; hsnTot.txval += txval; hsnTot.iamt += igst; hsnTot.camt += cgst; hsnTot.samt += sgst; hsnTot.csamt += cess;
        hsnRows.push([monthLabel, s.sub || 'All', String(r.hsn_sc ?? ''), String(r.desc ?? r.user_desc ?? ''), String(r.uqc ?? ''), qty,
          r.rt === undefined ? '' : num(r.rt), txval, igst, cgst, sgst, cess, round2(igst + cgst + sgst + cess)]);
        continue;
      }
      if (s.section === 'doc_issue') {
        const total = num(r.totnum), cancel = num(r.cancel), net = r.net_issue === undefined ? total - cancel : num(r.net_issue);
        docTot.total += total; docTot.cancel += cancel; docTot.net += net;
        docIssueRows.push([monthLabel, DOC_NATURE[String(r.doc_num ?? '')] ?? String(r.doc_typ ?? r.doc_num ?? ''), String(r.from ?? ''), String(r.to ?? ''), total, cancel, net]);
        continue;
      }
      if (s.section === 'nil') {
        const nil = num(r.nil_amt), expt = num(r.expt_amt), ngsup = num(r.ngsup_amt);
        nilTot.nil += nil; nilTot.expt += expt; nilTot.ngsup += ngsup;
        nilRows.push([monthLabel, NIL_SUPPLY[String(r.sply_ty ?? '')] ?? String(r.sply_ty ?? ''), nil, expt, ngsup, round2(nil + expt + ngsup)]);
        continue;
      }
      if (OWN_SHEET.has(s.section)) continue;
      const l = toDocLine(s);
      const key = `${m.period}|${docKey(l)}`;
      const sign = signOf(s.section, r);
      const tax = l.igst + l.cgst + l.sgst + l.cess;
      const info = sectionInfo(s.section);
      docRows.push([
        monthLabel, info.table, `${s.section.toUpperCase()}: ${info.name}`, l.sub, l.counterparty, l.kind, l.docNo, l.docDate, l.noteType,
        l.origNo, l.origDate, l.origMonth, l.pos, l.supplyType, l.reverseCharge, l.invType, l.type,
        l.rate, l.taxable, l.igst, l.cgst, l.sgst, l.cess, round2(tax), l.docValue, l.other,
      ]);
      docKinds.push(null);
      const secKey = s.sub ? `${s.section}§${s.sub}` : s.section;
      if (!bySection.has(secKey)) { bySection.set(secKey, newAgg()); sectionOrder.push(secKey); }
      bump(bySection.get(secKey)!, l, key, sign);
      bump(mAgg, l, key, sign);
      bump(docTotAgg, l, key, sign);
    }
  }

  const pulled = reads.filter((m) => m.json);
  const notPulled = reads.filter((m) => !m.json);
  const head = `Client: ${client.name}   |   GSTIN: ${client.gstin || '—'}   |   Period: ${fyLabel}`;

  // The documents list's TOTAL: amounts as on the return, credit notes taken off.
  if (docRows.length) {
    const t = docTotAgg;
    const row: (string | number)[] = Array(DOC_HEADERS.length).fill('');
    row[0] = 'TOTAL'; row[2] = `${t.docs.size} documents, ${t.lines} lines (credit notes taken off)`;
    row[AMT_START] = round2(t.taxable); row[AMT_START + 1] = round2(t.igst); row[AMT_START + 2] = round2(t.cgst);
    row[AMT_START + 3] = round2(t.sgst); row[AMT_START + 4] = round2(t.cess); row[AMT_START + 5] = round2(t.igst + t.cgst + t.sgst + t.cess);
    docRows.push(row); docKinds.push('total');
  }

  // Section-wise summary for the year (the Summary sheet, printed first).
  sectionOrder.sort((a, b) => {
    const [sa] = a.split('§'); const [sb] = b.split('§');
    return sectionInfo(sa).order - sectionInfo(sb).order || a.localeCompare(b);
  });
  const sumHeaders = ['Table', 'Section', 'Sub-section', 'Documents', 'Lines', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total Tax'];
  const sumRows: (string | number)[][] = sectionOrder.map((k) => {
    const [sec, sub = ''] = k.split('§');
    const info = sectionInfo(sec);
    return [info.table, `${sec.toUpperCase()}: ${info.name}`, sub, ...aggCells(bySection.get(k)!)];
  });
  const sumKinds: (RowKind | null)[] = sumRows.map(() => null);
  if (sumRows.length) { sumRows.push(['', 'TOTAL', '', ...aggCells(docTotAgg)]); sumKinds.push('total'); }

  // Month-wise: what each month holds and whether it was pulled.
  const monthHeaders = ['Month', 'Status', 'Pulled On', 'Documents', 'Lines', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total Tax'];
  const monthTones: (RowTone | null)[] = [];
  const monthKinds: (RowKind | null)[] = [];
  const yearAgg = newAgg();
  const monthRows: (string | number)[][] = reads.map((m) => {
    const st = monthStatus(m);
    monthTones.push(st.tone); monthKinds.push(null);
    const a = byMonth.get(m.period)!;
    addInto(yearAgg, a);
    const on = m.pulledAt ? new Date(m.pulledAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }).replace(/\//g, '-') : '';
    return [formatMonthLabel(m.period), st.label, on, ...aggCells(a)];
  });
  monthRows.push(['TOTAL', `${pulled.length} of 12 months pulled`, '', ...aggCells(yearAgg)]);
  monthTones.push(null); monthKinds.push('total');

  const sheets: ReportSheet[] = [
    {
      name: 'Month-wise', title: `Month-wise totals, ${fyLabel}`, headers: monthHeaders, rows: monthRows,
      columnWidths: [12, 40, 12, 11, 9, 16, 14, 14, 14, 12, 15], rowTones: monthTones, rowKinds: monthKinds, toneColumn: 1,
      notes: ['Credit notes are taken off and debit notes added; amendment tables count at their revised figures, as the portal shows them.'],
    },
  ];
  if (hsnRows.length) {
    hsnRows.push(['TOTAL', '', '', '', '', round2(hsnTot.qty), '', round2(hsnTot.txval), round2(hsnTot.iamt), round2(hsnTot.camt), round2(hsnTot.samt), round2(hsnTot.csamt),
      round2(hsnTot.iamt + hsnTot.camt + hsnTot.samt + hsnTot.csamt)]);
    sheets.push({
      name: 'HSN (Table 12)', title: `Table 12 HSN-wise summary, ${fyLabel}`,
      headers: ['Month', 'B2B / B2C', 'HSN/SAC', 'Description', 'UQC', 'Qty', 'Rate (%)', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Total Tax'],
      rows: hsnRows, columnWidths: [10, 10, 12, 30, 8, 12, 8, 16, 14, 14, 14, 12, 15],
      rowKinds: hsnRows.map((_, i) => (i === hsnRows.length - 1 ? 'total' : null)),
    });
  }
  if (docIssueRows.length) {
    docIssueRows.push(['TOTAL', '', '', '', docTot.total, docTot.cancel, docTot.net]);
    sheets.push({
      name: 'Documents issued (13)', title: `Table 13 documents issued, ${fyLabel}`,
      headers: ['Month', 'Nature of Document', 'Sr. No. From', 'Sr. No. To', 'Total Number', 'Cancelled', 'Net Issued'],
      rows: docIssueRows, columnWidths: [10, 44, 18, 18, 12, 12, 12],
      rowKinds: docIssueRows.map((_, i) => (i === docIssueRows.length - 1 ? 'total' : null)),
    });
  }
  if (nilRows.length) {
    nilRows.push(['TOTAL', '', round2(nilTot.nil), round2(nilTot.expt), round2(nilTot.ngsup), round2(nilTot.nil + nilTot.expt + nilTot.ngsup)]);
    sheets.push({
      name: 'Nil, exempt, non-GST (8)', title: `Table 8 nil rated, exempted and non-GST supplies, ${fyLabel}`,
      headers: ['Month', 'Supply Type', 'Nil Rated', 'Exempted', 'Non-GST', 'Total'],
      rows: nilRows, columnWidths: [10, 44, 16, 16, 16, 16],
      rowKinds: nilRows.map((_, i) => (i === nilRows.length - 1 ? 'total' : null)),
    });
  }

  const totalTax = docTotAgg.igst + docTotAgg.cgst + docTotAgg.sgst + docTotAgg.cess;
  const kpis: ReportKpi[] = [
    { label: 'Months pulled', value: `${pulled.length} / 12`, tone: notPulled.length ? 'warn' : 'good', note: notPulled.length ? `${notPulled.length} missing` : 'complete' },
    { label: 'Documents', value: docTotAgg.docs.size },
    { label: 'Sections', value: new Set(sectionOrder.map((k) => k.split('§')[0])).size },
    { label: 'Taxable value (net)', value: round2(docTotAgg.taxable) },
    { label: 'Total tax (net)', value: round2(totalTax) },
  ];

  const missingNote = notPulled.length
    ? `Not pulled: ${notPulled.map((m) => formatMonthLabel(m.period)).join(', ')}. Use Pull: the extension opens each missing month's filed GSTR-1 on the portal and reads all of it.`
    : 'Every month of the year is pulled from the portal.';

  return {
    title: `GSTR-1 Documents — Full Year (${fyLabel})`,
    subtitle: `${head}   |   Source: filed GSTR-1 as downloaded from the portal, every section and amendment   |   ${missingNote}`,
    meta: [
      { label: 'Client', value: client.name },
      { label: 'GSTIN', value: client.gstin || '—' },
      { label: 'Period', value: fyLabel },
      { label: 'Months pulled', value: `${pulled.length} of 12` },
      { label: 'Source', value: 'Filed GSTR-1 (portal offline download)' },
    ],
    kpis,
    headers: DOC_HEADERS,
    rows: docRows,
    rowKinds: docKinds,
    columnWidths: DOC_WIDTHS,
    freezeColumns: 3,
    sheetName: 'Documents',
    pdfColumns: [0, 1, 2, 4, 5, 6, 7, 9, 12, 17, 18, 19, 20, 21, 22, 23],
    summary: {
      title: `Section-wise summary, ${fyLabel}`,
      headers: sumHeaders,
      rows: sumRows.length ? sumRows : [['', 'No GSTR-1 of this year is pulled yet', '', '', '', '', '', '', '', '', '']],
      rowKinds: sumKinds,
      columnWidths: [12, 44, 26, 11, 9, 16, 14, 14, 14, 12, 15],
      notes: [
        missingNote,
        'Amounts in the Documents sheet are as on the return; totals take credit notes off and add debit notes.',
        'Amendment tables (9A, 9C, 10, 11, 14A, 15A) are counted at their revised figures, as the portal holds them: compare with the original month before adding them to a year figure.',
      ],
    },
    extraSheets: sheets,
    fileNameBase: `GSTR1_Documents_Full_Year_${fileSafe(client.name)}_${fyLabel.replace(/\s+/g, '_')}`,
  };
};
