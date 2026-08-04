import { supabase } from '@/integrations/supabase/client';
import {
  DEFAULT_CHARGE_INCLUSIONS, classifyUnit, testRrep,
  type ChargeInclusionSettings, type UnitType,
} from '@/utils/builderRates';
import { computeUnitLedger } from '@/utils/builderLedger';
import { fetchBuilderSettings } from '@/lib/builderSettings';
import type { BulkReceiptUnit } from '@/components/builder/BulkReceiptsDialog';
import type { BulkOpeningUnit } from '@/components/builder/BulkOpeningBalancesDialog';

// Build the feed for a client-wide bulk run — every project the client has,
// in one grid, grouped project → block. This is the same classification and
// ledger math the per-project Bookings and Project Detail pages already use;
// it just spans projects instead of one, so a single collection run across a
// client's whole portfolio can be keyed in one place.

interface ProjectRow {
  id: string; name: string; is_metro: boolean;
  carpet_area_source: 'DERIVED' | 'MANUAL';
  manual_residential_carpet_sqm: number; manual_commercial_carpet_sqm: number;
  doc_series_prefix: string | null;
}
interface UnitRow {
  id: string; project_id: string; unit_no: string; unit_type: UnitType;
  carpet_area_sqm: number; base_consideration: number; status: string;
  group_id: string | null; bu_event_id: string | null;
}
interface GroupRow { id: string; project_id: string; name: string; sort_order: number }
interface ChargeRow { unit_id: string; charge_head: string; amount: number; include_override: boolean | null }
interface BookingRow { id: string; unit_id: string; status: string; total_consideration: number }
interface MemberRow { booking_id: string; name: string; ownership_ratio: number; sort_order: number }
interface ReceiptRow {
  id: string; unit_id: string; consideration: number; cgst: number; sgst: number;
  tds_194ia: number; bank_credit: number | null; receipt_nature: string;
  cheque_status: string; gst_already_discharged: boolean; subsumed_by_bu_event_id: string | null;
}
interface InvoiceRow { id: string; unit_id: string; consideration: number; cgst: number; sgst: number }
interface AdjRow { invoice_id: string; consideration_adjusted: number; cgst: number; sgst: number }
interface OpeningRow {
  unit_id: string; as_at_date: string; agreement_value: number; cumulative_value_taxed: number;
  cumulative_cgst: number; cumulative_sgst: number; cumulative_receipts: number;
  cumulative_tds_194ia: number;
}

interface ClientBulkContext {
  projects: ProjectRow[];
  units: UnitRow[];
  groups: GroupRow[];
  chargesByUnit: Record<string, ChargeRow[]>;
  bookingsByUnit: Record<string, BookingRow[]>;
  membersByBooking: Record<string, MemberRow[]>;
  receiptsByUnit: Record<string, ReceiptRow[]>;
  invoicesByUnit: Record<string, InvoiceRow[]>;
  adjustments: AdjRow[];
  openingsByUnit: Record<string, OpeningRow>;
  settings: ChargeInclusionSettings;
  rrepByProject: Record<string, boolean>;
  metroByProject: Record<string, boolean>;
  docSeriesByProject: Record<string, string | null>;
}

async function loadClientBulkContext(clientId: string): Promise<ClientBulkContext | null> {
  const { data: proj } = await supabase
    .from('builder_projects').select('*').eq('client_id', clientId).order('name');
  const projects = (proj || []) as unknown as ProjectRow[];
  if (!projects.length) return null;
  const projectIds = projects.map((p) => p.id);

  const [{ data: unt }, { data: grp }, settings] = await Promise.all([
    supabase.from('builder_units').select('*').in('project_id', projectIds)
      .order('sort_order').order('unit_no'),
    supabase.from('builder_project_groups').select('*').in('project_id', projectIds)
      .order('sort_order').order('name'),
    fetchBuilderSettings(clientId),
  ]);
  const units = (unt || []) as unknown as UnitRow[];
  const groups = (grp || []) as unknown as GroupRow[];
  const unitIds = units.map((u) => u.id);

  const chargesByUnit: Record<string, ChargeRow[]> = {};
  const bookingsByUnit: Record<string, BookingRow[]> = {};
  const membersByBooking: Record<string, MemberRow[]> = {};
  const receiptsByUnit: Record<string, ReceiptRow[]> = {};
  const invoicesByUnit: Record<string, InvoiceRow[]> = {};
  const openingsByUnit: Record<string, OpeningRow> = {};
  let adjustments: AdjRow[] = [];

  if (unitIds.length) {
    const [{ data: chg }, { data: bkg }, { data: rcp }, { data: inv }, { data: opn }] =
      await Promise.all([
        supabase.from('builder_unit_charges').select('*').in('unit_id', unitIds),
        supabase.from('builder_bookings').select('*').in('unit_id', unitIds),
        supabase.from('builder_receipts').select('*').in('unit_id', unitIds),
        supabase.from('builder_invoices').select('*').in('unit_id', unitIds),
        supabase.from('builder_opening_balances').select('*').in('unit_id', unitIds),
      ]);
    ((chg || []) as unknown as ChargeRow[]).forEach((c) => { (chargesByUnit[c.unit_id] ||= []).push(c); });
    const bookingRows = (bkg || []) as unknown as BookingRow[];
    bookingRows.forEach((b) => { (bookingsByUnit[b.unit_id] ||= []).push(b); });
    ((rcp || []) as unknown as ReceiptRow[]).forEach((r) => { (receiptsByUnit[r.unit_id] ||= []).push(r); });
    const invoiceRows = (inv || []) as unknown as InvoiceRow[];
    invoiceRows.forEach((i) => { (invoicesByUnit[i.unit_id] ||= []).push(i); });
    ((opn || []) as unknown as OpeningRow[]).forEach((o) => { openingsByUnit[o.unit_id] = o; });

    const bookingIds = bookingRows.map((b) => b.id);
    if (bookingIds.length) {
      const { data: mem } = await supabase
        .from('builder_booking_members').select('*').in('booking_id', bookingIds).order('sort_order');
      ((mem || []) as unknown as MemberRow[]).forEach((m) => { (membersByBooking[m.booking_id] ||= []).push(m); });
    }
    const invoiceIds = invoiceRows.map((i) => i.id);
    if (invoiceIds.length) {
      const { data: adj } = await supabase
        .from('builder_advance_adjustments').select('*').in('invoice_id', invoiceIds);
      adjustments = (adj || []) as unknown as AdjRow[];
    }
  }

  // RREP + metro are per project; the classification engine needs both.
  const rrepByProject: Record<string, boolean> = {};
  const metroByProject: Record<string, boolean> = {};
  const docSeriesByProject: Record<string, string | null> = {};
  projects.forEach((p) => {
    metroByProject[p.id] = p.is_metro;
    docSeriesByProject[p.id] = p.doc_series_prefix;
    if (p.carpet_area_source === 'MANUAL') {
      rrepByProject[p.id] = testRrep(p.manual_residential_carpet_sqm, p.manual_commercial_carpet_sqm).isRrep;
    } else {
      const projUnits = units.filter((u) => u.project_id === p.id && u.status !== 'Cancelled');
      const resi = projUnits.filter((u) => u.unit_type === 'Residential').reduce((s, u) => s + (Number(u.carpet_area_sqm) || 0), 0);
      const comm = projUnits.filter((u) => u.unit_type === 'Commercial').reduce((s, u) => s + (Number(u.carpet_area_sqm) || 0), 0);
      rrepByProject[p.id] = testRrep(resi, comm).isRrep;
    }
  });

  return {
    projects, units, groups, chargesByUnit, bookingsByUnit, membersByBooking,
    receiptsByUnit, invoicesByUnit, adjustments, openingsByUnit,
    settings: settings as ChargeInclusionSettings,
    rrepByProject, metroByProject, docSeriesByProject,
  };
}

function classifyOne(ctx: ClientBulkContext, u: UnitRow) {
  return classifyUnit({
    unitType: u.unit_type,
    carpetAreaSqM: Number(u.carpet_area_sqm) || 0,
    baseConsideration: Number(u.base_consideration) || 0,
    charges: (ctx.chargesByUnit[u.id] || []).map((c) => ({
      charge_head: c.charge_head as never, amount: Number(c.amount) || 0, include_override: c.include_override,
    })),
    isMetro: ctx.metroByProject[u.project_id] ?? false,
    isRrep: ctx.rrepByProject[u.project_id] ?? false,
    settings: ctx.settings || DEFAULT_CHARGE_INCLUSIONS,
  });
}

function ledgerOne(ctx: ClientBulkContext, u: UnitRow, agreementValue: number) {
  const opening = ctx.openingsByUnit[u.id];
  const invIds = new Set((ctx.invoicesByUnit[u.id] || []).map((i) => i.id));
  return computeUnitLedger({
    agreementValue: opening?.agreement_value || agreementValue,
    opening,
    receipts: (ctx.receiptsByUnit[u.id] || []).map((r) => ({
      consideration: r.consideration, cgst: r.cgst, sgst: r.sgst, tds_194ia: r.tds_194ia,
      bank_credit: r.bank_credit, receipt_nature: r.receipt_nature as never,
      cheque_status: r.cheque_status as never, gst_already_discharged: r.gst_already_discharged,
      subsumed_by_bu_event_id: r.subsumed_by_bu_event_id,
    })),
    invoices: (ctx.invoicesByUnit[u.id] || []).map((i) => ({ consideration: i.consideration, cgst: i.cgst, sgst: i.sgst })),
    adjustments: ctx.adjustments.filter((a) => invIds.has(a.invoice_id))
      .map((a) => ({ consideration_adjusted: a.consideration_adjusted, cgst: a.cgst, sgst: a.sgst })),
  });
}

/** Sort key that keeps a client-wide list ordered project → block → unit. */
function sortUnits(ctx: ClientBulkContext): UnitRow[] {
  const projName = new Map(ctx.projects.map((p) => [p.id, p.name]));
  const groupOrder = (u: UnitRow) => {
    const g = ctx.groups.find((x) => x.id === u.group_id);
    return g ? g.sort_order : Number.MAX_SAFE_INTEGER;
  };
  return [...ctx.units].sort((a, b) =>
    (projName.get(a.project_id) || '').localeCompare(projName.get(b.project_id) || '')
    || groupOrder(a) - groupOrder(b)
    || a.unit_no.localeCompare(b.unit_no));
}

/** Every active-booking, not-yet-BU-closed unit across a client's projects, ready for a bulk receipt run. */
export async function fetchClientBulkReceiptUnits(clientId: string): Promise<{
  units: BulkReceiptUnit[]; docSeriesPrefix: string | null;
}> {
  const ctx = await loadClientBulkContext(clientId);
  if (!ctx) return { units: [], docSeriesPrefix: null };
  const projName = new Map(ctx.projects.map((p) => [p.id, p.name]));
  const groupName = (u: UnitRow) => ctx.groups.find((g) => g.id === u.group_id)?.name || null;

  const out: BulkReceiptUnit[] = [];
  sortUnits(ctx).forEach((u) => {
    if (u.bu_event_id) return;
    const booking = (ctx.bookingsByUnit[u.id] || []).find((b) => b.status === 'Active');
    if (!booking) return;
    const cls = classifyOne(ctx, u);
    const led = ledgerOne(ctx, u, cls.gross.gross);
    out.push({
      unitId: u.id,
      unitNo: u.unit_no,
      bookingId: booking.id,
      rateCode: cls.rateCode,
      ratePct: cls.ratePct,
      totalConsideration: Number(booking.total_consideration) || 0,
      balanceToTax: Math.max(0, (Number(booking.total_consideration) || 0) - (led?.valueTaxed || 0)),
      members: (ctx.membersByBooking[booking.id] || []).map((m) => ({ name: m.name, ratio: Number(m.ownership_ratio) || 0 })),
      groupLabel: groupName(u),
      projectName: projName.get(u.project_id),
    });
  });
  // A client-wide run can't stamp one project's doc series; the caller leaves it null.
  return { units: out, docSeriesPrefix: null };
}

/** Every unit across a client's projects, ready for a bulk opening-balance run. */
export async function fetchClientBulkOpeningUnits(clientId: string): Promise<BulkOpeningUnit[]> {
  const ctx = await loadClientBulkContext(clientId);
  if (!ctx) return [];
  const projName = new Map(ctx.projects.map((p) => [p.id, p.name]));
  const groupName = (u: UnitRow) => ctx.groups.find((g) => g.id === u.group_id)?.name || null;

  return sortUnits(ctx).map((u) => {
    const cls = classifyOne(ctx, u);
    const existing = ctx.openingsByUnit[u.id];
    return {
      unitId: u.id,
      unitNo: u.unit_no,
      rateCode: cls.rateCode,
      ratePct: cls.ratePct,
      isAffordable: cls.affordable.isAffordable,
      defaultAgreementValue: cls.gross.gross,
      groupLabel: groupName(u),
      projectName: projName.get(u.project_id),
      existing: existing ? {
        as_at_date: existing.as_at_date,
        agreement_value: existing.agreement_value,
        cumulative_receipts: existing.cumulative_receipts,
        cumulative_value_taxed: existing.cumulative_value_taxed,
        cumulative_cgst: existing.cumulative_cgst,
        cumulative_sgst: existing.cumulative_sgst,
        cumulative_tds_194ia: existing.cumulative_tds_194ia,
      } : undefined,
    };
  });
}
