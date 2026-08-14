/**
 * Builder postings → GSTR-1 JSON.
 *
 * The GSTR-1 page renders whatever sits in `gstr1_data.raw_json`, in the shape
 * the GSTN offline utility produces. So the builder module does not need its
 * own return viewer: it produces that same shape, and every downstream feature
 * — the section tiles, the summary, the portal push, the export — keeps working
 * untouched. For a builder client this replaces the JSON import; the figures are
 * computed from bookings, receipts and BU events rather than typed or uploaded.
 *
 * Only five sections can arise, and the reasons are structural rather than
 * incidental:
 *
 *   Table 7   → `b2cs`   invoices, net of credit notes
 *   Table 11A → `at`     advances received, net of bounce offsets
 *   Table 11B → `txpd`   advances adjusted against invoices
 *   Table 10  → `b2csa`  amendments from a retrospective re-rating
 *   Table 8   → `nil`    the 1/3rd deemed land deduction, as Non-GST supply
 *                        (firm election — see BUILDER_GST_POSITIONS.md §1)
 *
 * Buyers are unregistered individuals, so Table 4A (B2B) cannot arise. Under
 * s.12(3)(a) IGST Act the place of supply for a service in relation to
 * immovable property is the property's location, so a Gujarat GSTIN supplying
 * Gujarat property is always intra-state: Table 5 (B2CL), CDNUR and 3B Table
 * 3.2 are unreachable, and tax is always CGST + SGST in equal halves with IGST
 * pinned at zero.
 *
 * TDR/FSI reverse charge is deliberately absent. The credit is blocked under
 * the 1%/5% scheme, so it is paid in cash through 3B Table 3.1(d) and never
 * reaches GSTR-1 at all.
 */

import type { BuilderRateCode } from './builderRates';

/** One row of `builder_period_postings`, narrowed to what the return needs. */
export interface Gstr1PostingRow {
  source_type:
    | 'ADVANCE_11A' | 'ADVANCE_11B' | 'OPENING_11B' | 'INVOICE_B2CS'
    | 'CREDIT_NOTE' | 'RECLASS_10_OLD' | 'RECLASS_10_NEW' | 'BOUNCE_REVERSAL' | 'CANCELLATION_OFFSET';
  gstr1_table: string;
  rate_pct: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  /** Only set on Table 10 legs: the month being amended. */
  original_period?: string | null;
  /** Only set on legs that issue their own document — drives Table 13. */
  doc_no?: string | null;
  rate_code?: BuilderRateCode;
  /** 1/3rd deemed land value (Notif 11/2017 para 2), reported as Non-GST
   *  supply — Table 8 `nil.inv[].ngsup_amt`. Zero on Table 10 re-rating legs. */
  land_deduction?: number;
}

/**
 * SAC for construction services. Carried on every document series and on the
 * HSN summary so the classification is stated on the return rather than
 * remembered — it is the same code for the whole module.
 */
export const BUILDER_SAC = '9954';

/**
 * GSTR-1 Table 13 document classes, by the portal's own numbering.
 * Only these three can arise here: a promoter issues receipt vouchers against
 * advances (s.31(3)(d)), tax invoices at milestones, and credit notes.
 */
const DOC_CLASS: Record<string, { num: number; label: string }> = {
  INVOICE_B2CS: { num: 1, label: 'Invoices for outward supply' },
  ADVANCE_11A: { num: 6, label: 'Receipt voucher' },
  CREDIT_NOTE: { num: 5, label: 'Credit note' },
};

export interface DocSeriesLine {
  docNum: number;
  label: string;
  from: string;
  to: string;
  totalIssued: number;
  /** SAC the series relates to. One code for the whole module. */
  sac: string;
}

export interface Gstr1Warning {
  severity: 'BLOCK' | 'WARN';
  message: string;
}

export interface BuilderGstr1Result {
  json: Record<string, unknown>;
  warnings: Gstr1Warning[];
  /** Per-section row counts, for the confirmation screen. */
  counts: { b2cs: number; at: number; txpd: number; b2csa: number; nil: number };
  /** Total tax the return carries, for tying back to the workpaper. */
  totalTax: number;
  /** Table 8 non-GST total (the period's land deduction), for the workpaper. */
  nonGstTotal: number;
  /** Table 13 series, surfaced so the workpaper can show them with the SAC. */
  docSeries: DocSeriesLine[];
}

/**
 * Build GSTR-1 Table 13 from the documents actually issued in the period.
 *
 * A serial range wants a natural sort, not a lexical one: "BSD/SH/9" must come
 * before "BSD/SH/10", which a plain string compare gets backwards and would
 * report as a range running from 10 down to 9.
 */
function buildDocSeries(postings: Gstr1PostingRow[]): DocSeriesLine[] {
  const natural = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

  const byClass = new Map<string, string[]>();
  for (const r of postings) {
    const cls = DOC_CLASS[r.source_type];
    const no = (r.doc_no || '').trim();
    if (!cls || !no) continue;
    byClass.set(r.source_type, [...(byClass.get(r.source_type) || []), no]);
  }

  return [...byClass.entries()]
    .map(([src, nums]) => {
      // A document number can appear on more than one posting — an invoice
      // covering two units is one document, not two — so count distinct.
      const distinct = [...new Set(nums)].sort(natural);
      return {
        docNum: DOC_CLASS[src].num,
        label: DOC_CLASS[src].label,
        from: distinct[0],
        to: distinct[distinct.length - 1],
        totalIssued: distinct.length,
        sac: BUILDER_SAC,
      };
    })
    .sort((a, b) => a.docNum - b.docNum);
}

/** 2-dp money. Everything the portal accepts is rounded here, once. */
const money = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

/** 'MM/YYYY' → 'MMYYYY', the `fp` / `omon` format. */
export const periodToFp = (period: string): string => (period || '').replace('/', '');

/**
 * State code for `pos`, taken from the GSTIN rather than a project's city:
 * the place of supply follows the property, and a client filing under a Gujarat
 * GSTIN is registered where the property is.
 */
export const posFromGstin = (gstin: string | null | undefined): string | null => {
  const code = (gstin || '').trim().slice(0, 2);
  return /^\d{2}$/.test(code) ? code : null;
};

/** Sum a set of rows into one rate-keyed bucket map. */
const bucketByRate = (rows: Gstr1PostingRow[]) => {
  const map = new Map<number, { rt: number; txval: number; camt: number; samt: number }>();
  for (const r of rows) {
    const rt = Number(r.rate_pct) || 0;
    const cur = map.get(rt) || { rt, txval: 0, camt: 0, samt: 0 };
    cur.txval += Number(r.taxable_value) || 0;
    cur.camt += Number(r.cgst) || 0;
    cur.samt += Number(r.sgst) || 0;
    map.set(rt, cur);
  }
  return [...map.values()]
    .map((b) => ({ rt: b.rt, txval: money(b.txval), camt: money(b.camt), samt: money(b.samt) }))
    .sort((a, b) => a.rt - b.rt);
};

/**
 * Build the return.
 *
 * Signs follow the view: Table 11B, credit notes, bounce offsets and the
 * old-rate reclass leg are stored negative. GSTR-1 wants the 11B figure as a
 * positive magnitude in its own table, so it is flipped on the way out; the
 * others net inside their table and keep their sign.
 */
export function buildBuilderGstr1(params: {
  gstin: string | null | undefined;
  period: string;
  postings: Gstr1PostingRow[];
  /** Cumulative turnover, if the firm tracks it. Left at 0 when unknown. */
  grossTurnover?: number;
}): BuilderGstr1Result {
  const { gstin, period, postings } = params;
  const warnings: Gstr1Warning[] = [];

  const pos = posFromGstin(gstin);
  if (!pos) {
    warnings.push({
      severity: 'BLOCK',
      message: 'Client has no valid GSTIN, so the place-of-supply state code cannot be set. '
        + 'Add the GSTIN on the client master before generating.',
    });
  }
  const posCode = pos || '';

  const of = (t: string) => postings.filter((r) => r.gstr1_table === t);

  // ── Table 7 → b2cs. Invoices net of credit notes. ────────────────────────
  const b2cs = bucketByRate(of('Table 7')).map((b) => ({
    sply_ty: 'INTRA',
    pos: posCode,
    typ: 'OE',
    rt: b.rt,
    txval: b.txval,
    iamt: 0,
    camt: b.camt,
    samt: b.samt,
    csamt: 0,
  }));

  // ── Table 11A → at. Advances received net of bounce offsets. ─────────────
  const atBuckets = bucketByRate(of('Table 11A'));
  const at = atBuckets.map((b) => ({
    pos: posCode,
    sply_ty: 'INTRA',
    itms: [{ rt: b.rt, ad_amt: b.txval, iamt: 0, camt: b.camt, samt: b.samt, csamt: 0 }],
  }));

  // ── Table 11B → txpd. Stored negative; reported as a positive magnitude. ─
  const txpd = bucketByRate(of('Table 11B')).map((b) => ({
    pos: posCode,
    sply_ty: 'INTRA',
    itms: [{
      rt: b.rt,
      ad_amt: money(-b.txval),
      iamt: 0,
      camt: money(-b.camt),
      samt: money(-b.samt),
      csamt: 0,
    }],
  }));

  // ── Table 10 → b2csa. Amendments, grouped by the month they amend. ───────
  const t10 = of('Table 10');
  const missingOmon = t10.filter((r) => !r.original_period).length;
  if (missingOmon > 0) {
    warnings.push({
      severity: 'BLOCK',
      message: `${missingOmon} re-rating row(s) carry no original period, so the amendment `
        + 'cannot say which month it corrects. Re-post the reclassification.',
    });
  }
  const byMonth = new Map<string, Gstr1PostingRow[]>();
  for (const r of t10) {
    const m = r.original_period || '';
    if (!m) continue;
    byMonth.set(m, [...(byMonth.get(m) || []), r]);
  }
  const b2csa = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([omon, rows]) => bucketByRate(rows).map((b) => ({
      pos: posCode,
      typ: 'OE',
      omon: periodToFp(omon),
      sply_ty: 'INTRA',
      rt: b.rt,
      txval: b.txval,
      iamt: 0,
      camt: b.camt,
      samt: b.samt,
      csamt: 0,
    })));

  // ── HSN summary. One SAC for the whole module. ───────────────────────────
  // Built off Table 7 only: the HSN summary covers supplies invoiced in the
  // period, and an advance has no invoice behind it yet.
  const hsnData = bucketByRate(of('Table 7')).map((b, i) => ({
    num: i + 1,
    hsn_sc: BUILDER_SAC,
    desc: 'Construction services of buildings',
    uqc: 'OTH',
    qty: 0,
    txval: b.txval,
    rt: b.rt,
    iamt: 0,
    camt: b.camt,
    samt: b.samt,
    csamt: 0,
  }));

  // ── Portal-rejection guards ──────────────────────────────────────────────
  // The portal will not take a negative figure in these tables. The bounce
  // rules carry an unabsorbed offset forward precisely so this does not happen,
  // so a negative here means something upstream needs looking at, not that the
  // return should be filed as-is.
  for (const b of atBuckets) {
    if (b.txval < 0 || b.camt < 0) {
      warnings.push({
        severity: 'BLOCK',
        message: `Table 11A is negative at ${b.rt}% (${b.txval.toFixed(2)}). Bounce offsets `
          + 'exceed the advances received this month; the excess should carry forward instead.',
      });
    }
  }
  for (const b of b2cs) {
    if (b.txval < 0) {
      warnings.push({
        severity: 'WARN',
        message: `Table 7 is net negative at ${b.rt}% (${b.txval.toFixed(2)}) because credit `
          + 'notes exceed invoices this month. The portal may reject it.',
      });
    }
  }
  if (!b2cs.length && !at.length && !txpd.length && !b2csa.length) {
    warnings.push({
      severity: 'WARN',
      message: 'Nothing posted for this period — the return would be nil.',
    });
  }

  // ── Table 8 → nil. The 1/3rd land deduction, as Non-GST supply. ──────────
  // Summed across every posting in the period (not filtered by table): Table
  // 10 legs always contribute zero by construction (see the view comment on
  // builder_period_postings), so summing unconditionally nets 11A/11B/Table 7
  // together exactly the way `outward` already does for taxable value.
  const landTotal = money(
    postings.reduce((s, r) => s + (Number(r.land_deduction) || 0), 0),
  );
  if (landTotal < 0) {
    warnings.push({
      severity: 'WARN',
      message: `Table 8 (non-GST land) is net negative this period (${landTotal.toFixed(2)}) `
        + 'because credit notes/reversals exceed the land component posted. The portal may reject it.',
    });
  }

  const totalTax = money(
    postings.reduce((s, r) => s + (Number(r.cgst) || 0) + (Number(r.sgst) || 0), 0),
  );

  const json: Record<string, unknown> = {
    gstin: (gstin || '').trim(),
    fp: periodToFp(period),
    version: 'GST3.2.2',
    hash: 'hash',
    gt: money(params.grossTurnover || 0),
    cur_gt: money(params.grossTurnover || 0),
  };
  if (b2cs.length) json.b2cs = b2cs;
  if (at.length) json.at = at;
  if (txpd.length) json.txpd = txpd;
  if (b2csa.length) json.b2csa = b2csa;
  if (hsnData.length) json.hsn = { data: hsnData };
  const nilInv = landTotal !== 0
    ? [{ sply_ty: 'INTRAB2C', nil_amt: 0, expt_amt: 0, ngsup_amt: landTotal }]
    : [];
  if (nilInv.length) json.nil = { inv: nilInv };

  // ── Table 13 — documents issued ──────────────────────────────────────────
  const docSeries = buildDocSeries(postings);
  if (docSeries.length) {
    json.doc_issue = {
      doc_det: docSeries.map((s) => ({
        doc_num: s.docNum,
        doc_typ: s.label,
        docs: [{
          num: 1,
          from: s.from,
          to: s.to,
          totnum: s.totalIssued,
          cancel: 0,
          net_issue: s.totalIssued,
        }],
      })),
    };
  } else {
    warnings.push({
      severity: 'WARN',
      message: 'No document numbers on this period\'s receipts or invoices, so Table 13 '
        + '(documents issued) will be empty. Receipt vouchers are required under s.31(3)(d) '
        + 'for advances against a construction service.',
    });
  }

  return {
    json,
    warnings,
    counts: { b2cs: b2cs.length, at: at.length, txpd: txpd.length, b2csa: b2csa.length, nil: nilInv.length },
    totalTax,
    nonGstTotal: landTotal,
    docSeries,
  };
}

/**
 * True when a stored GSTR-1 record was produced by Builder Returns rather
 * than uploaded. Provenance is the `file_name` `saveBuilderGstr1()` writes
 * ("Builder Returns — <period>"), never a field inside the JSON itself —
 * that JSON is the exact file the portal receives, and stuffing app-only
 * metadata into it is what caused the portal to reject the whole upload
 * over an unrecognised key (see `stripInternalFields`).
 */
export const isBuilderGenerated = (fileName: string | null | undefined): boolean =>
  !!fileName && fileName.startsWith('Builder Returns');

/**
 * Older Builder-generated rows (before this fix) still carry `_source`/
 * `_generated_at` inside their stored `raw_json` — added so the UI could
 * show a provenance badge, before that moved to `file_name`. The portal's
 * upload schema doesn't recognise them, and a strict validator rejects the
 * whole file over one unexpected key with the same generic "doesn't match
 * the template" message it gives for any schema mismatch. Strip them at
 * every point a stored JSON leaves the app: the manual download and the
 * automated portal push. A no-op on rows saved after this fix.
 */
export function stripInternalFields(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const { _source, _generated_at, ...rest } = raw as Record<string, unknown>;
  return rest;
}
