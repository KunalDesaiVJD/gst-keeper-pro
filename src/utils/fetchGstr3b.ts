// Fetches the three sources GSTR-3B is assembled from — GSTR-1 (outward),
// ITC Summary (Table 4) and RCM Summary (inward RCM) — and runs them through
// buildGstr3bJson(). Shared by the GSTR-3B page and the "Prepare GSTR-3B"
// dialog so both compute the return the exact same way.

import { supabase } from '@/integrations/supabase/client';
import { buildGstr3bJson, type Gstr3bAdjustment, type Gstr3bItcTyped, type Gstr3bResult, type ItcData, type ItcRow, type RcmTotals } from './buildGstr3bJson';
import { fetchItcAutoLinkTotals } from '@/lib/itcAutoLink';
import { with4D1Total } from '@/lib/itc4D';
import { headsTyped } from '@/lib/itcHeads';
import { fetchImport2BHeld, import2BHeldMessage } from '@/lib/postImport2B';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const toShort = (mmYyyy: string) => {
  const [mm, yyyy] = (mmYyyy || '').split('/');
  return mm && yyyy ? `${SHORT[Number(mm) - 1]}-${String(yyyy).slice(-2)}` : '';
};

export async function fetchGstr3b(
  clientId: string,
  gstin: string,
  periodMonth: string, // MM/YYYY
): Promise<Gstr3bResult> {
  const short = toShort(periodMonth);
  const [g, itcRes, rcmRes, adjRes, fsiRes, filingRes, clientRes, autoLink, held] = await Promise.all([
    supabase.from('gstr1_data').select('raw_json').eq('client_id', clientId).eq('period_month', short).maybeSingle(),
    supabase.from('itc_summaries').select('data').eq('client_id', clientId).eq('period_month', periodMonth).maybeSingle(),
    supabase.from('rcm_data').select('taxable_value, cgst_2_5, cgst_9, sgst_2_5, sgst_9, igst_5, igst_18').eq('client_id', clientId).eq('month', short),
    // GSTR-3B Adjustments module — GSTR-1A / prior-period corrections that
    // don't come from GSTR-1/ITC Summary/RCM. See Gstr3bAdjustmentsPage.tsx.
    supabase.from('gstr3b_adjustments')
      .select('table_ref, label, taxable_value, igst, cgst, sgst, cess')
      .eq('client_id', clientId).eq('period_month', periodMonth),
    // Builder TDR/FSI reverse charge. It is a second, independent source of
    // 3.1(d) that never passes through rcm_data — the working is computed from
    // a posted BU event and lives in its own view. Reading only rcm_data left a
    // posted, approved FSI liability out of the return entirely, and because
    // the credit is blocked under the 1%/5% scheme this is cash, not paperwork.
    // Only PAY-treatment postings appear here; anything the client has elected
    // to ignore is excluded by the view itself.
    supabase.from('builder_rcm_postings')
      .select('taxable_value, cgst, sgst')
      .eq('client_id', clientId).eq('period_month', periodMonth),
    // Has this client's GSTR-3B (monthly or quarterly) for this period
    // already been filed? Drives the RCM reverse-charge exclusion below —
    // see RCM_RCHRG_FIX_FROM in buildGstr3bJson.ts.
    supabase.from('filing_status').select('status')
      .eq('client_id', clientId).eq('period_month', periodMonth)
      .in('return_type', ['GSTR-3B', 'GSTR-3B (Q)']),
    // Builder Partial-ITC / No-ITC carpet-area apportionment — see
    // docs/BUILDER_GST_POSITIONS.md §7 and builderPartialItc.ts. Also carries
    // liberal_2b_reconciliation, which gates the row 5.1 / 5.3 auto-links below.
    supabase.from('clients').select('builder_itc_type, commercial_area, residential_area, liberal_2b_reconciliation').eq('id', clientId).maybeSingle(),
    fetchItcAutoLinkTotals(clientId, periodMonth),
    // Amendments HELD in Import 2B count in neither 5.1 nor 5.3 until staff
    // settle them: flagged below. A failed count is flagged, never fatal.
    fetchImport2BHeld(clientId, periodMonth).catch(() => null),
  ]);

  const alreadyFiled = ((filingRes.data as { status: string }[]) || []).some((r) => r.status === 'Filed');

  let itc: ItcData | null = null;
  const rawItc = (itcRes.data as any)?.data;
  const parsed = typeof rawItc === 'string' ? JSON.parse(rawItc) : rawItc;
  // 4(D)(1) = 1.1 + 1.2, whatever the saved summary held there.
  if (parsed) itc = { section4A: parsed.section4A || [], section4B: parsed.section4B || [], section4D: with4D1Total(parsed.section4D || []) };

  // ITC Summary's auto-linked rows (5.1, 5.4, 4B's "current month as per 2B
  // RECO", 4D's reclaim rows) are computed LIVE on that page and only ever
  // written back to itc_summaries.data on a manual Save — so reading the
  // saved snapshot for them drifts the moment Import 2B / 2B Reconciliation
  // changes without someone reopening and resaving ITC Summary. Patch them
  // with the same live figures ITC Summary itself would show right now,
  // mirroring its own auto-link effect exactly (including row 5.1 = eligible
  // + this period's reversal, gross not netted, per the ITC Summary fix this
  // mirrors). Liberal clients leave row 5.1 exactly as saved/typed — same
  // carve-out ITC Summary itself applies, since their invoices don't
  // necessarily go through Import 2B's classification at all. No-ITC clients
  // get the same carve-out per the 2026-08-19 revert to the plain, manual-
  // entry template — staff type the figure directly in ITC Summary now.
  // Option 3 (14 Oct 2026): what in 4A(5) was typed in ITC Summary rather
  // than taken from 2B: row 5.1 of a Liberal or No-ITC client, and row 5.2.
  // Row 5.3 "Debit Note" (14 Oct 2026, §10) is the month's 2B credit notes
  // for a Strict client, patched live like 5.1, but only for a month whose
  // import read the notes (notesFromImport2B); an older month keeps 5.3 as
  // saved. A Liberal or No-ITC client's 5.3 stays typed and, once the notes
  // were read, is listed here beside what 2B gives.
  const itcTyped: Gstr3bItcTyped[] = [];
  if (itc) {
    const isLiberal = !!clientRes.data?.liberal_2b_reconciliation;
    const isNoITC = clientRes.data?.builder_itc_type === 'NO_ITC';
    const {
      eligibleFromImport2B, creditNotesFromImport2B, notesFromImport2B, reversalFromReco, reclaimFromReco, expenseOutFromReco,
    } = autoLink;
    const amt = (r: ItcRow) => ({ igst: Number(r.igst) || 0, cgst: Number(r.cgst) || 0, sgst: Number(r.sgst) || 0 });
    // headsTyped: row 5.2 may hold a negative head, and heads that cancel must not hide a typed row.
    for (const r of itc.section4A as ItcRow[]) {
      if (r.srNo === '5.1' && (isLiberal || isNoITC)) {
        const twob = { igst: eligibleFromImport2B.igst + reversalFromReco.igst, cgst: eligibleFromImport2B.cgst + reversalFromReco.cgst, sgst: eligibleFromImport2B.sgst + reversalFromReco.sgst };
        if (headsTyped(amt(r)) || headsTyped(twob)) itcTyped.push({ row: '5.1', label: 'ITC for the Month', typed: amt(r), twob });
      }
      if (r.srNo === '5.2' && headsTyped(amt(r))) itcTyped.push({ row: '5.2', label: r.particular || 'ITC for Previous Month', typed: amt(r) });
      if (r.srNo === '5.3' && (isLiberal || isNoITC) && notesFromImport2B) {
        const twob = { ...creditNotesFromImport2B };
        if (headsTyped(amt(r)) || headsTyped(twob)) itcTyped.push({ row: '5.3', label: 'Debit Note', typed: amt(r), twob });
      }
    }
    itc.section4A = itc.section4A.map((r: ItcRow) => {
      if (r.srNo === '5.1' && !isLiberal && !isNoITC) {
        return { ...r, igst: eligibleFromImport2B.igst + reversalFromReco.igst, cgst: eligibleFromImport2B.cgst + reversalFromReco.cgst, sgst: eligibleFromImport2B.sgst + reversalFromReco.sgst };
      }
      if (r.srNo === '5.3' && notesFromImport2B && !isLiberal && !isNoITC) {
        return { ...r, igst: creditNotesFromImport2B.igst, cgst: creditNotesFromImport2B.cgst, sgst: creditNotesFromImport2B.sgst };
      }
      if (r.srNo === '5.4') return { ...r, igst: reclaimFromReco.igst, cgst: reclaimFromReco.cgst, sgst: reclaimFromReco.sgst };
      return r;
    });
    itc.section4B = itc.section4B.map((r: ItcRow) =>
      (r.particular || '').includes('current month as per 2B RECO')
        ? { ...r, igst: reversalFromReco.igst, cgst: reversalFromReco.cgst, sgst: reversalFromReco.sgst }
        : r,
    );
    itc.section4D = with4D1Total(itc.section4D.map((r: ItcRow) => {
      if (r.srNo === '1.1') return { ...r, igst: reclaimFromReco.igst, cgst: reclaimFromReco.cgst, sgst: reclaimFromReco.sgst };
      if (r.srNo === '1.2') return { ...r, igst: expenseOutFromReco.igst, cgst: expenseOutFromReco.cgst, sgst: expenseOutFromReco.sgst };
      return r;
    }));
  }

  const rcmRows = ((rcmRes.data as any[]) || []);
  const rcm: RcmTotals = rcmRows.reduce((a, r) => ({
    taxable: a.taxable + (r.taxable_value || 0),
    igst: a.igst + (r.igst_5 || 0) + (r.igst_18 || 0),
    cgst: a.cgst + (r.cgst_2_5 || 0) + (r.cgst_9 || 0),
    sgst: a.sgst + (r.sgst_2_5 || 0) + (r.sgst_9 || 0),
  }), { taxable: 0, igst: 0, cgst: 0, sgst: 0 });

  // Fold the builder FSI legs in. Always intra-state — the place of supply for
  // development rights follows the land under s.12(3)(a) IGST Act — so they add
  // to CGST and SGST and never to IGST.
  type FsiLeg = { taxable_value: number | null; cgst: number | null; sgst: number | null };
  (((fsiRes.data as unknown) as FsiLeg[]) || []).forEach((r) => {
    rcm.taxable += Number(r.taxable_value) || 0;
    rcm.cgst += Number(r.cgst) || 0;
    rcm.sgst += Number(r.sgst) || 0;
  });

  const adjustments: Gstr3bAdjustment[] = ((adjRes.data as any[]) || []).map((a) => ({
    tableRef: a.table_ref,
    label: a.label,
    taxableValue: Number(a.taxable_value) || 0,
    igst: Number(a.igst) || 0,
    cgst: Number(a.cgst) || 0,
    sgst: Number(a.sgst) || 0,
    cess: Number(a.cess) || 0,
  }));

  const clientRow = clientRes.data as { builder_itc_type: string | null; commercial_area: number | null; residential_area: number | null } | null;

  const built = buildGstr3bJson({
    gstin, periodMonth, gstr1Raw: (g.data as any)?.raw_json ?? null, itc, rcm, adjustments, alreadyFiled,
    builderItcType: clientRow?.builder_itc_type ?? null,
    commercialArea: clientRow?.commercial_area ?? null,
    residentialArea: clientRow?.residential_area ?? null,
  });
  const flags = [...built.flags];
  if (held === null) flags.push('Could not check Import 2B for held amendments: open Import 2B to see whether any are held.');
  else if (held > 0) flags.push(`${import2BHeldMessage(held)}.`);
  return { ...built, flags, itcTyped };
}
