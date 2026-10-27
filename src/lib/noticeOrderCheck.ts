// Order checker (the law audit of 26 October 2026, section C): an order of
// demand (DRC-07) read against its show cause notice, the time limit of its
// year and the papers of the case. Each failure is a ground of appeal, worded
// to go into the grounds the Appeal view drafts. Pure and self-contained; the
// data is gathered by OrderCheckPanel. §36 of docs/NOTICES_LITIGATION_POSITIONS.md.

export type CheckStatus = 'ok' | 'issue' | 'check';

export interface OrderCheck {
  key: string;
  status: CheckStatus;
  title: string;
  detail: string;
  law: string;
  /** The ground of appeal it gives, when it fails. */
  ground: string | null;
}

type Head = 'igst' | 'cgst' | 'sgst' | 'cess';
const HEADS: Head[] = ['igst', 'cgst', 'sgst', 'cess'];
const HEAD_LABEL: Record<Head, string> = { igst: 'IGST', cgst: 'CGST', sgst: 'SGST', cess: 'Cess' };

export interface CheckPaper {
  form_code: string | null;
  section_of_law: string | null;
  financial_year: string | null;
  period_from: string | null;
  period_to: string | null;
  issue_date: string | null;
  reference_number: string | null;
  demand: unknown;
  hearing_date?: string | null;
}

export interface OrderCheckInput {
  order: CheckPaper & {
    /** The portal's record of the order (gst_case_folder_items.raw_json), when synced. */
    raw?: unknown;
    /** Entered by hand, not from the portal. */
    manual?: boolean;
  };
  /** The show cause notice the order answers, when on record. */
  scn: CheckPaper | null;
  /** The DIN the order's PDF carries, as read by the AI. */
  din?: string | null;
  /** Every hearing or adjournment date on record in the case. */
  hearings: string[];
  limitation?: { fy: string; s73_order_by: string | null; s74_order_by: string | null; s73_basis?: string | null } | null;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^0-9.-]/g, '')) : 0;
  return Number.isFinite(n) ? n : 0;
};
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const fmt = (iso: string | null | undefined) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};
const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
};
// No hyphens in what is filed (the firm's rule): "2018-19" reads "2018 to 2019".
const fyWords = (fy: string | null | undefined) => {
  const m = /^(\d{4})\D+(\d{2,4})$/.exec(fy ?? '');
  if (!m) return fy ? `FY ${fy}` : 'the year';
  return `FY ${m[1]} to ${m[2].length === 2 ? m[1].slice(0, 2) + m[2] : m[2]}`;
};

export function sectionOf(s: string | null | undefined): '73' | '74' | '74A' | null {
  const m = /(74\s*A|73|74)(?![0-9])/i.exec(s ?? '');
  return m ? (m[1].replace(/\s+/g, '').toUpperCase() as '73' | '74' | '74A') : null;
}

function heads(demand: unknown): Partial<Record<Head, { tax: number; penalty: number; total: number }>> {
  const out: Partial<Record<Head, { tax: number; penalty: number; total: number }>> = {};
  if (!demand || typeof demand !== 'object' || Array.isArray(demand)) return out;
  for (const h of HEADS) {
    const v = (demand as Record<string, unknown>)[h] as Record<string, unknown> | undefined;
    if (!v || typeof v !== 'object') continue;
    const tax = num(v.tax), penalty = num(v.penalty);
    const total = tax + num(v.interest) + penalty + num(v.fee) + num(v.others);
    if (total) out[h] = { tax, penalty, total };
  }
  return out;
}

const get = (o: unknown, path: string[]): unknown => path.reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o);

/** The order's own record: the SCN it names, its signature and its portal reference. */
export function orderRecord(raw: unknown): { scnRef: string | null; scnDate: string | null; signed: string | null; portalRef: string | null } {
  const d = get(raw, ['sdtls', 'dtorder']) ?? get(raw, ['sdtls']);
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const pd = s(get(d, ['ntcdt']));
  const m = pd ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(pd) : null;
  return {
    scnRef: s(get(d, ['ntcno'])),
    scnDate: m ? `${m[3]}-${m[2]}-${m[1]}` : null,
    signed: s(get(raw, ['todtls', 'signty'])),
    portalRef: s(get(raw, ['refid'])),
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthWords = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const monthsOf = (p: CheckPaper) => ({ from: p.period_from?.slice(0, 7) ?? null, to: p.period_to?.slice(0, 7) ?? null });

export function checkOrder(x: OrderCheckInput): OrderCheck[] {
  const o = x.order;
  const out: OrderCheck[] = [];
  const rec = orderRecord(o.raw);
  const oSec = sectionOf(o.section_of_law);
  const oDate = o.issue_date;
  const label = `the impugned order${o.reference_number ? ` ${o.reference_number}` : ''}${oDate ? ` dated ${fmt(oDate)}` : ''}`;

  // 1. A show cause notice to answer (s.73(1), s.74(1), s.74A(1)).
  const scn = x.scn;
  if (!scn) {
    out.push({ key: 'scn', status: 'check', title: 'No show cause notice on record for this order',
      detail: 'An order of demand can only follow a show cause notice. Find the DRC-01 in the case papers; if none was issued, the order is without jurisdiction.',
      law: 's.73(1), s.74(1)', ground: null });
  } else {
    out.push({ key: 'scn', status: 'ok', title: `Show cause notice ${scn.reference_number ?? ''} of ${fmt(scn.issue_date)} on record`.replace(/\s+/g, ' '),
      detail: rec.scnRef && scn.reference_number && rec.scnRef !== scn.reference_number
        ? `The order names notice ${rec.scnRef}; check it is the same proceeding.` : 'The order is read against it below.',
      law: 's.75(7)', ground: null });
  }

  // 2. The section: an order cannot rest on grounds the notice did not raise (s.75(7)); s.74 down to s.73 is allowed (s.75(2)).
  if (scn) {
    const sSec = sectionOf(scn.section_of_law);
    if (sSec && oSec && sSec === '73' && oSec !== '73') {
      out.push({ key: 'section', status: 'issue', title: `Notice under s.${sSec}, order under s.${oSec}`,
        detail: 'Fraud, wilful misstatement or suppression was not alleged in the notice, so the order cannot invoke it.',
        law: 's.75(7)',
        ground: `The show cause notice was issued under section ${sSec} of the CGST Act, 2017 and alleged no fraud, wilful misstatement or suppression of facts. ${cap(label)} invokes section ${oSec} and so travels beyond the notice, which section 75(7) does not permit; the order is liable to be set aside on this ground alone.` });
    } else if (sSec && oSec) {
      out.push({ key: 'section', status: 'ok', title: `Order under s.${oSec}, notice under s.${sSec}`,
        detail: sSec === '74' && oSec === '73' ? 'Fraud was not held; the s.73 time limit and penalty then apply (s.75(2)).' : 'The section is the one the notice proposed.',
        law: sSec === '74' && oSec === '73' ? 's.75(2)' : 's.75(7)', ground: null });
    }
  }

  // 3. The period: not beyond the notice's.
  if (scn) {
    const op = monthsOf(o), sp = monthsOf(scn);
    if (op.from && sp.from && op.to && sp.to && (op.from < sp.from || op.to > sp.to)) {
      out.push({ key: 'period', status: 'issue', title: 'The order covers months the notice did not',
        detail: `Order ${monthWords(op.from)} to ${monthWords(op.to)}, notice ${monthWords(sp.from)} to ${monthWords(sp.to)}.`, law: 's.75(7)',
        ground: `${cap(label)} confirms a demand for the period ${monthWords(op.from)} to ${monthWords(op.to)}, whereas the show cause notice was confined to ${monthWords(sp.from)} to ${monthWords(sp.to)}. A demand for a period not covered by the notice is beyond it and contrary to section 75(7) of the CGST Act, 2017.` });
    } else if (o.financial_year && scn.financial_year && o.financial_year !== scn.financial_year) {
      out.push({ key: 'period', status: 'check', title: `Order for ${fyWords(o.financial_year)}, notice for ${fyWords(scn.financial_year)}`,
        detail: 'Check the order is for the year of the notice.', law: 's.75(7)', ground: null });
    } else if (op.from || o.financial_year) {
      out.push({ key: 'period', status: 'ok', title: 'The period is within the notice', detail: '', law: 's.75(7)', ground: null });
    }
  }

  // 4. The amount, head by head: not above the notice (s.75(7)).
  const oh = heads(o.demand);
  if (scn) {
    const sh = heads(scn.demand);
    const over = HEADS.filter((h) => oh[h] && sh[h] && (oh[h]!.tax > sh[h]!.tax + 1));
    const newHeads = HEADS.filter((h) => oh[h] && oh[h]!.tax > 0 && !sh[h] && Object.keys(sh).length > 0);
    if (over.length || newHeads.length) {
      const parts = [
        ...over.map((h) => `${HEAD_LABEL[h]} tax ${inr(oh[h]!.tax)} against ${inr(sh[h]!.tax)} proposed`),
        ...newHeads.map((h) => `${HEAD_LABEL[h]} tax ${inr(oh[h]!.tax)} where the notice proposed none`),
      ];
      out.push({ key: 'amount', status: 'issue', title: 'The order demands more tax than the notice', detail: parts.join('; ') + '.', law: 's.75(7)',
        ground: `${cap(label)} confirms ${parts.join(', and ')}. The amount of tax demanded in an order cannot exceed the amount specified in the show cause notice (section 75(7) of the CGST Act, 2017); the excess at least must be set aside.` });
    } else if (Object.keys(sh).length && Object.keys(oh).length) {
      out.push({ key: 'amount', status: 'ok', title: 'The tax is within the notice, head by head', detail: '', law: 's.75(7)', ground: null });
    }
  }

  // 5. The penalty the section allows.
  if (oSec === '73' || oSec === '74') {
    const wrong = HEADS.filter((h) => {
      const v = oh[h];
      if (!v || v.tax <= 0) return false;
      const cap73 = h === 'cess' ? v.tax * 0.1 : Math.max(v.tax * 0.1, 10_000);
      return oSec === '73' ? v.penalty > cap73 + 1 : v.penalty > v.tax + 1;
    });
    if (wrong.length) {
      const parts = wrong.map((h) => `${HEAD_LABEL[h]} penalty ${inr(oh[h]!.penalty)} on tax of ${inr(oh[h]!.tax)}`);
      out.push({ key: 'penalty', status: 'issue', title: `Penalty above what s.${oSec} allows`, detail: parts.join('; ') + '.',
        law: oSec === '73' ? 's.73(9)' : 's.74(9)',
        ground: oSec === '73'
          ? `${cap(label)} imposes ${parts.join(', and ')}. Section 73(9) of the CGST Act, 2017 limits the penalty to ten per cent of the tax or ten thousand rupees, whichever is higher; the penalty in excess is without authority of law.`
          : `${cap(label)} imposes ${parts.join(', and ')}. Section 74(9) of the CGST Act, 2017 limits the penalty to an amount equal to the tax; the penalty in excess is without authority of law.` });
    }
  }

  // 6. The time limit of the year (s.73(10), s.74(10)); for s.74A, 12 months from the notice (s.74A(7)).
  if (oDate && (oSec === '73' || oSec === '74') && x.limitation) {
    const by = oSec === '73' ? x.limitation.s73_order_by : x.limitation.s74_order_by;
    if (by && oDate > by) {
      out.push({ key: 'limitation', status: 'issue', title: 'Order passed after its time limit',
        detail: `For ${fyWords(x.limitation.fy)} an order under s.${oSec} had to issue by ${fmt(by)}${oSec === '73' && x.limitation.s73_basis ? ` (${x.limitation.s73_basis})` : ''}. First check it is not a fresh order on remand (s.75(3)).`,
        law: oSec === '73' ? 's.73(10), s.75(10)' : 's.74(10), s.75(10)',
        ground: `For ${fyWords(x.limitation.fy)} an order under section ${oSec} of the CGST Act, 2017 had to be issued by ${fmt(by)} under section ${oSec}(10)${oSec === '73' ? ' read with the notifications extending that time' : ''}. ${cap(label)} was issued after that date and is barred by limitation; the adjudication proceedings are deemed to have concluded under section 75(10).` });
    } else if (by) {
      out.push({ key: 'limitation', status: 'ok', title: `Within the time limit (${fmt(by)})`, detail: '', law: oSec === '73' ? 's.73(10)' : 's.74(10)', ground: null });
    }
  } else if (oDate && oSec === '74A' && scn?.issue_date) {
    const by = addMonths(scn.issue_date, 12), ext = addMonths(scn.issue_date, 18);
    if (oDate > ext) {
      out.push({ key: 'limitation', status: 'issue', title: 'Order more than 18 months after the notice', detail: `The notice was of ${fmt(scn.issue_date)}.`, law: 's.74A(7)',
        ground: `${cap(label)} was issued more than eighteen months after the show cause notice of ${fmt(scn.issue_date)}, beyond the twelve months of section 74A(7) of the CGST Act, 2017 and the most it can be extended; the proceedings stand concluded.` });
    } else if (oDate > by) {
      out.push({ key: 'limitation', status: 'check', title: 'Order more than 12 months after the notice',
        detail: `Valid only if an officer extended the time in writing, by up to six months, before ${fmt(by)}. Ask for the extension order.`, law: 's.74A(7)', ground: null });
    }
  }

  // 7. A hearing before an adverse order (s.75(4)).
  if (oDate) {
    const before = [...x.hearings, scn?.hearing_date ?? null].filter((d): d is string => !!d && d.slice(0, 10) <= oDate);
    if (!before.length) {
      out.push({ key: 'hearing', status: 'issue', title: 'No personal hearing on record before the order',
        detail: 'Check the case papers. A hearing must be given where an adverse decision is contemplated, whether or not asked for.', law: 's.75(4)',
        ground: `No opportunity of personal hearing was granted before ${label} was passed, although it decides against the appellant. Section 75(4) of the CGST Act, 2017 requires such an opportunity where an adverse decision is contemplated; the order is in breach of it and of the principles of natural justice, and deserves to be set aside on this ground.` });
    } else {
      out.push({ key: 'hearing', status: 'ok', title: `Hearing on record (${fmt(before.sort().at(-1))})`, detail: '', law: 's.75(4)', ground: null });
    }
  }

  // 8. DIN and signature: a communication without a DIN, not generated on the portal, is deemed never issued.
  if (rec.portalRef || !o.manual) {
    out.push({ key: 'din', status: 'ok', title: `Issued on the common portal${rec.portalRef ? ` (${rec.portalRef})` : ''}`,
      detail: x.din ? `DIN ${x.din} also on the order.` : 'A portal reference number stands in for a DIN.', law: 'Circular 249/06/2025 GST', ground: null });
  } else if (x.din) {
    out.push({ key: 'din', status: 'ok', title: `DIN ${x.din} on the order`, detail: '', law: 'Circular 122/41/2019 GST', ground: null });
  } else {
    out.push({ key: 'din', status: 'check', title: 'Not on the portal, and no DIN read from the order',
      detail: 'Look for the DIN on the order. A central tax communication with neither is invalid and deemed never to have been issued (state officers follow their own circular).',
      law: 'Circular 122/41/2019 GST',
      ground: null });
  }
  if (o.raw && !rec.signed) {
    out.push({ key: 'signed', status: 'check', title: 'No signature recorded on the portal for the order',
      detail: 'An order must be signed by the proper officer (rule 26(3)). Check the PDF: an unsigned order is open to challenge.', law: 'rule 26(3)', ground: null });
  }
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The grounds the failed checks give, numbered, to add to the grounds of appeal. */
export function groundsText(checks: OrderCheck[]): string {
  return checks.filter((c) => c.status === 'issue' && c.ground).map((c, i) => `${i + 1}. ${c.ground}`).join('\n\n');
}
