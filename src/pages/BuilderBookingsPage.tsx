import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import {
  ArrowLeft, Loader2, ChevronDown, ChevronRight, Plus, Receipt, FileText,
  AlertTriangle, UserPlus, Trash2, Users,
} from 'lucide-react';
import {
  DEFAULT_CHARGE_INCLUSIONS, RATE_CODE_LABEL, classifyUnit, computeTds194IA,
  formatINR, isTds194IAApplicable, testRrep,
  type BuilderRateCode, type ChargeInclusionSettings, type UnitType,
} from '@/utils/builderRates';
import {
  CHEQUE_STATUS_LABEL, INVOICE_TYPE_LABEL, checkTieOut, computeUnitLedger,
  dateToPeriod, deriveReceipt, planAdvanceAbsorption, prettyPeriodLabel,
  type ChequeStatus, type InvoiceType, type ReceiptNature,
} from '@/utils/builderLedger';
import { fetchBuilderSettings } from '@/lib/builderSettings';

interface ProjectRow {
  id: string; client_id: string; name: string; is_metro: boolean;
  carpet_area_source: 'DERIVED' | 'MANUAL';
  manual_residential_carpet_sqm: number; manual_commercial_carpet_sqm: number;
  doc_series_prefix: string | null;
}
interface UnitRow {
  id: string; unit_no: string; unit_type: UnitType; carpet_area_sqm: number;
  base_consideration: number; status: string;
}
interface ChargeRow { unit_id: string; charge_head: string; amount: number; include_override: boolean | null }
interface BookingRow {
  id: string; unit_id: string; booking_date: string; total_consideration: number;
  status: string; notes: string | null;
}
interface MemberRow {
  id: string; booking_id: string; name: string; pan: string | null;
  ownership_ratio: number; is_primary: boolean;
}
interface ReceiptRow {
  id: string; booking_id: string; unit_id: string; receipt_date: string;
  receipt_nature: ReceiptNature; amount_entered: number; amount_is_gst_inclusive: boolean;
  consideration: number; rate_code: BuilderRateCode; rate_pct: number; taxable_value: number;
  cgst: number; sgst: number; tds_194ia: number; bank_credit: number | null;
  instrument_type: string; instrument_ref: string | null; cheque_status: ChequeStatus;
  gst_already_discharged: boolean; period_month: string; doc_no: string | null;
}
interface InvoiceRow {
  id: string; booking_id: string; unit_id: string; invoice_date: string;
  invoice_type: InvoiceType; milestone_label: string | null; consideration: number;
  rate_code: BuilderRateCode; rate_pct: number; taxable_value: number;
  cgst: number; sgst: number; period_month: string; doc_no: string | null;
}
interface AdjRow {
  id: string; invoice_id: string; receipt_id: string; consideration_adjusted: number;
  cgst: number; sgst: number; period_month: string;
}
interface OpeningRow {
  unit_id: string; agreement_value: number; cumulative_value_taxed: number;
  cumulative_cgst: number; cumulative_sgst: number; cumulative_receipts: number;
  cumulative_tds_194ia: number;
}

const today = () => new Date().toISOString().slice(0, 10);

const emptyBooking = { booking_date: today(), total_consideration: '', notes: '' };
const emptyMember = { name: '', pan: '', ownership_ratio: '100' };
const emptyReceipt = {
  receipt_date: today(), receipt_nature: 'ADVANCE' as ReceiptNature,
  amount_entered: '', amount_is_gst_inclusive: false, tds_194ia: '', bank_credit: '',
  instrument_type: 'NEFT/RTGS', instrument_ref: '', cheque_status: 'Cleared' as ChequeStatus,
  gst_already_discharged: false, doc_no: '',
};
const emptyInvoice = {
  invoice_date: today(), invoice_type: 'MILESTONE' as InvoiceType,
  milestone_label: '', consideration: '', doc_no: '',
};

const BuilderBookingsPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { canEnterBuilderReceipts, user } = useAuth();

  const [project, setProject] = useState<ProjectRow | null>(null);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [charges, setCharges] = useState<Record<string, ChargeRow[]>>({});
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [members, setMembers] = useState<Record<string, MemberRow[]>>({});
  const [receipts, setReceipts] = useState<Record<string, ReceiptRow[]>>({});
  const [invoices, setInvoices] = useState<Record<string, InvoiceRow[]>>({});
  const [adjustments, setAdjustments] = useState<AdjRow[]>([]);
  const [openings, setOpenings] = useState<Record<string, OpeningRow>>({});
  const [settings, setSettings] = useState<ChargeInclusionSettings>(DEFAULT_CHARGE_INCLUSIONS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [bookingDialog, setBookingDialog] = useState(false);
  const [bookingUnit, setBookingUnit] = useState<UnitRow | null>(null);
  const [bookingForm, setBookingForm] = useState(emptyBooking);
  const [bookingMembers, setBookingMembers] = useState([{ ...emptyMember }]);

  const [receiptDialog, setReceiptDialog] = useState(false);
  const [receiptTarget, setReceiptTarget] = useState<{ unit: UnitRow; booking: BookingRow } | null>(null);
  const [receiptForm, setReceiptForm] = useState(emptyReceipt);

  const [invoiceDialog, setInvoiceDialog] = useState(false);
  const [invoiceTarget, setInvoiceTarget] = useState<{ unit: UnitRow; booking: BookingRow } | null>(null);
  const [invoiceForm, setInvoiceForm] = useState(emptyInvoice);

  const canEdit = canEnterBuilderReceipts();

  const load = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const { data: proj, error } = await supabase
        .from('builder_projects').select('*').eq('id', projectId).maybeSingle();
      if (error) throw error;
      if (!proj) { toast.error('Project not found'); navigate('/builder-projects'); return; }
      const p = proj as unknown as ProjectRow;
      setProject(p);
      setSettings(await fetchBuilderSettings(p.client_id) as ChargeInclusionSettings);

      const { data: unt } = await supabase
        .from('builder_units').select('*').eq('project_id', projectId)
        .order('sort_order').order('unit_no');
      const unitRows = (unt || []) as unknown as UnitRow[];
      setUnits(unitRows);
      const unitIds = unitRows.map((u) => u.id);
      if (!unitIds.length) {
        setCharges({}); setBookings([]); setMembers({}); setReceipts({});
        setInvoices({}); setAdjustments([]); setOpenings({});
        return;
      }

      const [{ data: chg }, { data: bkg }, { data: rcp }, { data: inv }, { data: opn }] =
        await Promise.all([
          supabase.from('builder_unit_charges').select('*').in('unit_id', unitIds),
          supabase.from('builder_bookings').select('*').in('unit_id', unitIds).order('booking_date'),
          supabase.from('builder_receipts').select('*').in('unit_id', unitIds).order('receipt_date'),
          supabase.from('builder_invoices').select('*').in('unit_id', unitIds).order('invoice_date'),
          supabase.from('builder_opening_balances').select('*').in('unit_id', unitIds),
        ]);

      const cmap: Record<string, ChargeRow[]> = {};
      ((chg || []) as unknown as ChargeRow[]).forEach((c) => { (cmap[c.unit_id] ||= []).push(c); });
      setCharges(cmap);

      const bookingRows = (bkg || []) as unknown as BookingRow[];
      setBookings(bookingRows);

      const rmap: Record<string, ReceiptRow[]> = {};
      ((rcp || []) as unknown as ReceiptRow[]).forEach((r) => { (rmap[r.unit_id] ||= []).push(r); });
      setReceipts(rmap);

      const invoiceRows = (inv || []) as unknown as InvoiceRow[];
      const imap: Record<string, InvoiceRow[]> = {};
      invoiceRows.forEach((i) => { (imap[i.unit_id] ||= []).push(i); });
      setInvoices(imap);

      const omap: Record<string, OpeningRow> = {};
      ((opn || []) as unknown as OpeningRow[]).forEach((o) => { omap[o.unit_id] = o; });
      setOpenings(omap);

      const bookingIds = bookingRows.map((b) => b.id);
      if (bookingIds.length) {
        const { data: mem } = await supabase
          .from('builder_booking_members').select('*').in('booking_id', bookingIds).order('sort_order');
        const mmap: Record<string, MemberRow[]> = {};
        ((mem || []) as unknown as MemberRow[]).forEach((m) => { (mmap[m.booking_id] ||= []).push(m); });
        setMembers(mmap);
      } else setMembers({});

      const invoiceIds = invoiceRows.map((i) => i.id);
      if (invoiceIds.length) {
        const { data: adj } = await supabase
          .from('builder_advance_adjustments').select('*').in('invoice_id', invoiceIds);
        setAdjustments((adj || []) as unknown as AdjRow[]);
      } else setAdjustments([]);
    } catch (e) {
      toast.error(`Could not load: ${(e as Error).message}`);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, navigate]);

  useEffect(() => { void load(); }, [load]);

  // The project-level 15% test decides every commercial unit's rate.
  const rrep = useMemo(() => {
    if (!project) return testRrep(0, 0);
    if (project.carpet_area_source === 'MANUAL') {
      return testRrep(project.manual_residential_carpet_sqm, project.manual_commercial_carpet_sqm);
    }
    let resi = 0, comm = 0;
    units.forEach((u) => {
      if (u.status === 'Cancelled') return;
      if (u.unit_type === 'Residential') resi += Number(u.carpet_area_sqm) || 0;
      else comm += Number(u.carpet_area_sqm) || 0;
    });
    return testRrep(resi, comm);
  }, [project, units]);

  const classifyFor = useCallback((u: UnitRow) => classifyUnit({
    unitType: u.unit_type,
    carpetAreaSqM: Number(u.carpet_area_sqm) || 0,
    baseConsideration: Number(u.base_consideration) || 0,
    charges: (charges[u.id] || []).map((c) => ({
      charge_head: c.charge_head as never, amount: Number(c.amount) || 0,
      include_override: c.include_override,
    })),
    isMetro: project?.is_metro ?? false,
    isRrep: rrep.isRrep,
    settings,
  }), [charges, project, rrep.isRrep, settings]);

  const activeBookingFor = useCallback(
    (unitId: string) => bookings.find((b) => b.unit_id === unitId && b.status === 'Active') || null,
    [bookings],
  );

  const adjustmentsForUnit = useCallback((unitId: string) => {
    const invIds = new Set((invoices[unitId] || []).map((i) => i.id));
    return adjustments.filter((a) => invIds.has(a.invoice_id));
  }, [adjustments, invoices]);

  const ledgerFor = useCallback((u: UnitRow) => {
    const cls = classifyFor(u);
    const opening = openings[u.id];
    return computeUnitLedger({
      agreementValue: opening?.agreement_value || cls.gross.gross,
      opening,
      receipts: (receipts[u.id] || []).map((r) => ({
        consideration: r.consideration, cgst: r.cgst, sgst: r.sgst,
        tds_194ia: r.tds_194ia, bank_credit: r.bank_credit,
        receipt_nature: r.receipt_nature, cheque_status: r.cheque_status,
        gst_already_discharged: r.gst_already_discharged,
      })),
      invoices: (invoices[u.id] || []).map((i) => ({
        consideration: i.consideration, cgst: i.cgst, sgst: i.sgst,
      })),
      adjustments: adjustmentsForUnit(u.id).map((a) => ({
        consideration_adjusted: a.consideration_adjusted, cgst: a.cgst, sgst: a.sgst,
      })),
    });
  }, [classifyFor, openings, receipts, invoices, adjustmentsForUnit]);

  /** Open advances on a unit, net of what invoices have already absorbed. */
  const openAdvancesFor = useCallback((unitId: string) => {
    const unitAdj = adjustmentsForUnit(unitId);
    return (receipts[unitId] || [])
      .filter((r) => r.receipt_nature === 'ADVANCE' && r.cheque_status !== 'Bounced' && !r.gst_already_discharged)
      .map((r) => {
        const used = unitAdj
          .filter((a) => a.receipt_id === r.id)
          .reduce((s, a) => s + (Number(a.consideration_adjusted) || 0), 0);
        return {
          receiptId: r.id, receiptDate: r.receipt_date, rateCode: r.rate_code,
          available: Math.round(((Number(r.consideration) || 0) - used + Number.EPSILON) * 100) / 100,
        };
      })
      .filter((a) => a.available > 0.005);
  }, [receipts, adjustmentsForUnit]);

  const toggle = (unitId: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(unitId)) next.delete(unitId); else next.add(unitId);
    return next;
  });

  // ── Booking ──────────────────────────────────────────────────────────────
  const openBooking = (u: UnitRow) => {
    const cls = classifyFor(u);
    setBookingUnit(u);
    setBookingForm({ ...emptyBooking, total_consideration: String(cls.gross.gross || '') });
    setBookingMembers([{ ...emptyMember }]);
    setBookingDialog(true);
  };

  const handleSaveBooking = async () => {
    if (!bookingUnit) return;
    const named = bookingMembers.filter((m) => m.name.trim());
    if (!named.length) { toast.error('At least one member is required'); return; }
    const ratioTotal = named.reduce((s, m) => s + (parseFloat(m.ownership_ratio) || 0), 0);
    if (Math.abs(ratioTotal - 100) > 0.01) {
      toast.error(`Ownership ratios must total 100% (currently ${ratioTotal}%)`);
      return;
    }
    setIsSaving(true);
    try {
      const { data, error } = await supabase.from('builder_bookings').insert({
        unit_id: bookingUnit.id,
        booking_date: bookingForm.booking_date,
        total_consideration: parseFloat(bookingForm.total_consideration) || 0,
        notes: bookingForm.notes.trim() || null,
        created_by: user?.userId ?? null,
      }).select('id').single();
      if (error) throw error;

      const { error: mErr } = await supabase.from('builder_booking_members').insert(
        named.map((m, idx) => ({
          booking_id: data.id,
          name: m.name.trim(),
          pan: m.pan.trim() || null,
          ownership_ratio: parseFloat(m.ownership_ratio) || 0,
          is_primary: idx === 0,
          sort_order: idx,
        })),
      );
      if (mErr) throw mErr;

      await supabase.from('builder_units').update({ status: 'Booked' }).eq('id', bookingUnit.id);
      toast.success('Unit booked');
      setBookingDialog(false);
      await load();
    } catch (e) {
      toast.error(`Could not book: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Receipt ──────────────────────────────────────────────────────────────
  const openReceipt = (u: UnitRow, b: BookingRow) => {
    setReceiptTarget({ unit: u, booking: b });
    setReceiptForm({ ...emptyReceipt });
    setReceiptDialog(true);
  };

  const receiptPreview = useMemo(() => {
    if (!receiptTarget) return null;
    const cls = classifyFor(receiptTarget.unit);
    return deriveReceipt({
      amountEntered: parseFloat(receiptForm.amount_entered) || 0,
      amountIsGstInclusive: receiptForm.amount_is_gst_inclusive,
      rateCode: cls.rateCode,
      tds194ia: parseFloat(receiptForm.tds_194ia) || 0,
      bankCredit: receiptForm.bank_credit === '' ? null : parseFloat(receiptForm.bank_credit),
    });
  }, [receiptTarget, receiptForm, classifyFor]);

  const tdsApplies = useMemo(() => {
    if (!receiptTarget) return false;
    return isTds194IAApplicable(receiptTarget.booking.total_consideration);
  }, [receiptTarget]);

  const handleSaveReceipt = async () => {
    if (!receiptTarget || !receiptPreview) return;
    if (!(parseFloat(receiptForm.amount_entered) > 0)) { toast.error('Amount is required'); return; }
    setIsSaving(true);
    try {
      const cls = classifyFor(receiptTarget.unit);
      const t = receiptPreview.tax;
      const { error } = await supabase.from('builder_receipts').insert({
        booking_id: receiptTarget.booking.id,
        unit_id: receiptTarget.unit.id,
        receipt_date: receiptForm.receipt_date,
        receipt_nature: receiptForm.receipt_nature,
        amount_entered: parseFloat(receiptForm.amount_entered) || 0,
        amount_is_gst_inclusive: receiptForm.amount_is_gst_inclusive,
        consideration: t.consideration,
        rate_code: cls.rateCode,
        rate_pct: t.ratePct,
        taxable_value: t.taxableValue,
        cgst: t.cgst,
        sgst: t.sgst,
        tds_194ia: receiptPreview.tds194ia,
        bank_credit: receiptForm.bank_credit === '' ? null : parseFloat(receiptForm.bank_credit),
        instrument_type: receiptForm.instrument_type,
        instrument_ref: receiptForm.instrument_ref.trim() || null,
        cheque_status: receiptForm.cheque_status,
        gst_already_discharged: receiptForm.gst_already_discharged,
        period_month: dateToPeriod(receiptForm.receipt_date),
        doc_series: project?.doc_series_prefix ?? null,
        doc_no: receiptForm.doc_no.trim() || null,
        created_by: user?.userId ?? null,
      });
      if (error) throw error;
      toast.success('Receipt recorded');
      setReceiptDialog(false);
      await load();
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Invoice ──────────────────────────────────────────────────────────────
  const openInvoice = (u: UnitRow, b: BookingRow) => {
    setInvoiceTarget({ unit: u, booking: b });
    setInvoiceForm({ ...emptyInvoice });
    setInvoiceDialog(true);
  };

  const invoicePlan = useMemo(() => {
    if (!invoiceTarget) return null;
    return planAdvanceAbsorption(
      parseFloat(invoiceForm.consideration) || 0,
      openAdvancesFor(invoiceTarget.unit.id),
    );
  }, [invoiceTarget, invoiceForm.consideration, openAdvancesFor]);

  const handleSaveInvoice = async () => {
    if (!invoiceTarget || !invoicePlan) return;
    const consideration = parseFloat(invoiceForm.consideration) || 0;
    if (!(consideration > 0)) { toast.error('Invoice value is required'); return; }
    setIsSaving(true);
    try {
      const cls = classifyFor(invoiceTarget.unit);
      const { computeTax } = await import('@/utils/builderRates');
      const t = computeTax(consideration, cls.rateCode);
      const period = dateToPeriod(invoiceForm.invoice_date);

      const { data, error } = await supabase.from('builder_invoices').insert({
        booking_id: invoiceTarget.booking.id,
        unit_id: invoiceTarget.unit.id,
        invoice_date: invoiceForm.invoice_date,
        invoice_type: invoiceForm.invoice_type,
        milestone_label: invoiceForm.milestone_label.trim() || null,
        consideration: t.consideration,
        rate_code: cls.rateCode,
        rate_pct: t.ratePct,
        taxable_value: t.taxableValue,
        cgst: t.cgst,
        sgst: t.sgst,
        period_month: period,
        doc_series: project?.doc_series_prefix ?? null,
        doc_no: invoiceForm.doc_no.trim() || null,
        created_by: user?.userId ?? null,
      }).select('id').single();
      if (error) throw error;

      // The 11B leg: absorb the advances this invoice covers, so the rupees
      // taxed on receipt are not taxed again inside the invoice.
      if (invoicePlan.adjustments.length) {
        const { error: aErr } = await supabase.from('builder_advance_adjustments').insert(
          invoicePlan.adjustments.map((a) => ({
            invoice_id: data.id,
            receipt_id: a.receiptId,
            consideration_adjusted: a.consideration,
            taxable_value_adjusted: a.taxableValue,
            cgst: a.cgst,
            sgst: a.sgst,
            rate_code: a.rateCode,
            rate_pct: a.ratePct,
            period_month: period,
            created_by: user?.userId ?? null,
          })),
        );
        if (aErr) throw aErr;
      }
      toast.success(
        invoicePlan.absorbed > 0
          ? `Invoice raised; ${formatINR(invoicePlan.absorbed)} of advances adjusted in Table 11B`
          : 'Invoice raised',
      );
      setInvoiceDialog(false);
      await load();
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteReceipt = async (r: ReceiptRow) => {
    if (!window.confirm('Delete this receipt? Any advance adjustment against it goes too.')) return;
    const { error } = await supabase.from('builder_receipts').delete().eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Receipt deleted');
    await load();
  };

  const setChequeStatus = async (r: ReceiptRow, status: ChequeStatus) => {
    const { error } = await supabase.from('builder_receipts')
      .update({ cheque_status: status, bounced_on: status === 'Bounced' ? today() : null })
      .eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    if (status === 'Bounced') {
      toast.warning(
        `Receipt excluded from ${prettyPeriodLabel(r.period_month)}. If that return is already filed, `
        + 'the reversal has to be offset against the following month instead.',
      );
    }
    await load();
  };

  /** Receipts and invoices for a unit, grouped by period — the expanded view. */
  const monthWiseFor = useCallback((unitId: string) => {
    const byPeriod = new Map<string, { receipts: ReceiptRow[]; invoices: InvoiceRow[] }>();
    (receipts[unitId] || []).forEach((r) => {
      const e = byPeriod.get(r.period_month) || { receipts: [], invoices: [] };
      e.receipts.push(r); byPeriod.set(r.period_month, e);
    });
    (invoices[unitId] || []).forEach((i) => {
      const e = byPeriod.get(i.period_month) || { receipts: [], invoices: [] };
      e.invoices.push(i); byPeriod.set(i.period_month, e);
    });
    const key = (p: string) => { const m = /^(\d{2})\/(\d{4})$/.exec(p); return m ? `${m[2]}${m[1]}` : p; };
    return [...byPeriod.entries()].sort((a, b) => key(a[0]).localeCompare(key(b[0])));
  }, [receipts, invoices]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading bookings…
      </div>
    );
  }
  if (!project) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${project.name} — Bookings & Receipts`}
        subtitle="Advances bear tax on receipt (Table 11A); milestone invoices absorb them (Table 11B)"
        icon={<Receipt className="h-5 w-5" />}
        actions={
          <Button variant="outline" onClick={() => navigate(`/builder-projects/${projectId}`)}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Project
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Units</CardTitle>
          <CardDescription>
            "Value taxed" is what a BU event will deduct from — the value offered to tax, not the money
            received. Expand a unit to see its month-wise ledger.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {units.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No units in this project yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Unit</TableHead>
                    <TableHead>Member(s)</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead className="text-right">Agreement</TableHead>
                    <TableHead className="text-right">Value taxed</TableHead>
                    <TableHead className="text-right">Open advance</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Balance to tax</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {units.map((u) => {
                    const cls = classifyFor(u);
                    const booking = activeBookingFor(u.id);
                    const led = ledgerFor(u);
                    const agreement = openings[u.id]?.agreement_value || cls.gross.gross;
                    const tie = checkTieOut(agreement, led.valueTaxed);
                    const mem = booking ? members[booking.id] || [] : [];
                    const isOpen = expanded.has(u.id);
                    const months = monthWiseFor(u.id);
                    return (
                      <React.Fragment key={u.id}>
                        <TableRow>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggle(u.id)}>
                              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium">
                            {u.unit_no}
                            <span className="block text-xs text-muted-foreground">{u.unit_type}</span>
                          </TableCell>
                          <TableCell className="text-sm">
                            {mem.length === 0 ? (
                              <span className="text-muted-foreground">Unbooked</span>
                            ) : (
                              <>
                                {mem[0].name}
                                {mem.length > 1 && (
                                  <span className="block text-xs text-muted-foreground">
                                    +{mem.length - 1} joint
                                  </span>
                                )}
                              </>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {cls.ratePct}%
                            <span className="block text-xs text-muted-foreground">eff. {cls.effectiveRatePct}%</span>
                          </TableCell>
                          <TableCell className="text-right text-sm">{formatINR(agreement)}</TableCell>
                          <TableCell className="text-right text-sm font-medium">
                            {formatINR(led.valueTaxed)}
                            {!tie.reconciles && (
                              <span className="block text-xs text-destructive">
                                over by {formatINR(tie.overTaxedBy)}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {led.openAdvance > 0 ? formatINR(led.openAdvance) : '—'}
                          </TableCell>
                          <TableCell className="text-right text-sm">{formatINR(led.totalReceived)}</TableCell>
                          <TableCell className="text-right text-sm">{formatINR(led.balanceToTax)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-0.5">
                              {canEdit && !booking && u.status !== 'Cancelled' && (
                                <Button variant="ghost" size="icon" title="Book unit" onClick={() => openBooking(u)}>
                                  <UserPlus className="h-4 w-4" />
                                </Button>
                              )}
                              {canEdit && booking && (
                                <>
                                  <Button variant="ghost" size="icon" title="Add receipt" onClick={() => openReceipt(u, booking)}>
                                    <Plus className="h-4 w-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon" title="Raise invoice" onClick={() => openInvoice(u, booking)}>
                                    <FileText className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>

                        {isOpen && (
                          <TableRow>
                            <TableCell colSpan={10} className="bg-muted/30 p-4">
                              {months.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  No receipts or invoices for this unit yet.
                                </p>
                              ) : (
                                <div className="space-y-4">
                                  {months.map(([period, entries]) => (
                                    <div key={period}>
                                      <p className="text-xs font-semibold text-muted-foreground mb-1">
                                        {prettyPeriodLabel(period)}
                                      </p>
                                      <div className="rounded border bg-background">
                                        <Table>
                                          <TableHeader>
                                            <TableRow>
                                              <TableHead className="h-8">Date</TableHead>
                                              <TableHead className="h-8">Document</TableHead>
                                              <TableHead className="h-8">Table</TableHead>
                                              <TableHead className="h-8 text-right">Consideration</TableHead>
                                              <TableHead className="h-8 text-right">Taxable</TableHead>
                                              <TableHead className="h-8 text-right">CGST</TableHead>
                                              <TableHead className="h-8 text-right">SGST</TableHead>
                                              <TableHead className="h-8 text-right">TDS</TableHead>
                                              <TableHead className="h-8">Status</TableHead>
                                              <TableHead className="h-8 w-24" />
                                            </TableRow>
                                          </TableHeader>
                                          <TableBody>
                                            {entries.receipts.map((r) => {
                                              const posts = r.receipt_nature === 'ADVANCE'
                                                && r.cheque_status !== 'Bounced' && !r.gst_already_discharged;
                                              return (
                                                <TableRow key={r.id}>
                                                  <TableCell className="text-xs py-1">{r.receipt_date}</TableCell>
                                                  <TableCell className="text-xs py-1">
                                                    Receipt {r.doc_no || ''}
                                                    <span className="block text-muted-foreground">
                                                      {r.instrument_type}
                                                      {r.amount_is_gst_inclusive ? ' · incl. GST' : ''}
                                                    </span>
                                                  </TableCell>
                                                  <TableCell className="text-xs py-1">
                                                    {posts ? (
                                                      <Badge variant="outline" className="text-xs">11A</Badge>
                                                    ) : (
                                                      <span className="text-muted-foreground">—</span>
                                                    )}
                                                  </TableCell>
                                                  <TableCell className="text-xs py-1 text-right">{formatINR(r.consideration)}</TableCell>
                                                  <TableCell className="text-xs py-1 text-right">{posts ? formatINR(r.taxable_value) : '—'}</TableCell>
                                                  <TableCell className="text-xs py-1 text-right">{posts ? formatINR(r.cgst) : '—'}</TableCell>
                                                  <TableCell className="text-xs py-1 text-right">{posts ? formatINR(r.sgst) : '—'}</TableCell>
                                                  <TableCell className="text-xs py-1 text-right">{r.tds_194ia > 0 ? formatINR(r.tds_194ia) : '—'}</TableCell>
                                                  <TableCell className="text-xs py-1">
                                                    <Badge
                                                      variant="outline"
                                                      className={
                                                        r.cheque_status === 'Bounced'
                                                          ? 'bg-red-100 text-red-800 border-red-200 text-xs'
                                                          : r.cheque_status === 'Pending'
                                                            ? 'bg-amber-100 text-amber-800 border-amber-200 text-xs'
                                                            : 'text-xs'
                                                      }
                                                    >
                                                      {CHEQUE_STATUS_LABEL[r.cheque_status]}
                                                    </Badge>
                                                    {r.receipt_nature === 'AGAINST_INVOICE' && (
                                                      <span className="block text-muted-foreground">vs invoice</span>
                                                    )}
                                                    {r.gst_already_discharged && (
                                                      <span className="block text-muted-foreground">GST already paid</span>
                                                    )}
                                                  </TableCell>
                                                  <TableCell className="py-1">
                                                    {canEdit && (
                                                      <div className="flex gap-0.5">
                                                        {r.cheque_status !== 'Bounced' && (
                                                          <Button
                                                            variant="ghost" size="icon" className="h-6 w-6"
                                                            title="Mark bounced"
                                                            onClick={() => setChequeStatus(r, 'Bounced')}
                                                          >
                                                            <AlertTriangle className="h-3 w-3 text-amber-600" />
                                                          </Button>
                                                        )}
                                                        <Button
                                                          variant="ghost" size="icon" className="h-6 w-6"
                                                          title="Delete receipt"
                                                          onClick={() => handleDeleteReceipt(r)}
                                                        >
                                                          <Trash2 className="h-3 w-3 text-destructive" />
                                                        </Button>
                                                      </div>
                                                    )}
                                                  </TableCell>
                                                </TableRow>
                                              );
                                            })}
                                            {entries.invoices.map((i) => {
                                              const adj = adjustments.filter((a) => a.invoice_id === i.id);
                                              const absorbed = adj.reduce((s, a) => s + (Number(a.consideration_adjusted) || 0), 0);
                                              return (
                                                <React.Fragment key={i.id}>
                                                  <TableRow>
                                                    <TableCell className="text-xs py-1">{i.invoice_date}</TableCell>
                                                    <TableCell className="text-xs py-1">
                                                      {INVOICE_TYPE_LABEL[i.invoice_type]} {i.doc_no || ''}
                                                      {i.milestone_label && (
                                                        <span className="block text-muted-foreground">{i.milestone_label}</span>
                                                      )}
                                                    </TableCell>
                                                    <TableCell className="text-xs py-1">
                                                      <Badge variant="outline" className="text-xs">Table 7</Badge>
                                                    </TableCell>
                                                    <TableCell className="text-xs py-1 text-right">{formatINR(i.consideration)}</TableCell>
                                                    <TableCell className="text-xs py-1 text-right">{formatINR(i.taxable_value)}</TableCell>
                                                    <TableCell className="text-xs py-1 text-right">{formatINR(i.cgst)}</TableCell>
                                                    <TableCell className="text-xs py-1 text-right">{formatINR(i.sgst)}</TableCell>
                                                    <TableCell className="text-xs py-1 text-right">—</TableCell>
                                                    <TableCell className="text-xs py-1" />
                                                    <TableCell className="py-1" />
                                                  </TableRow>
                                                  {absorbed > 0 && (
                                                    <TableRow>
                                                      <TableCell className="text-xs py-1" />
                                                      <TableCell className="text-xs py-1 text-muted-foreground">
                                                        Advance adjusted ({adj.length} receipt{adj.length > 1 ? 's' : ''})
                                                      </TableCell>
                                                      <TableCell className="text-xs py-1">
                                                        <Badge variant="outline" className="text-xs">11B</Badge>
                                                      </TableCell>
                                                      <TableCell className="text-xs py-1 text-right">-{formatINR(absorbed)}</TableCell>
                                                      <TableCell className="text-xs py-1 text-right">—</TableCell>
                                                      <TableCell className="text-xs py-1 text-right">
                                                        -{formatINR(adj.reduce((s, a) => s + (Number(a.cgst) || 0), 0))}
                                                      </TableCell>
                                                      <TableCell className="text-xs py-1 text-right">
                                                        -{formatINR(adj.reduce((s, a) => s + (Number(a.sgst) || 0), 0))}
                                                      </TableCell>
                                                      <TableCell className="text-xs py-1 text-right">—</TableCell>
                                                      <TableCell className="text-xs py-1" />
                                                      <TableCell className="py-1" />
                                                    </TableRow>
                                                  )}
                                                </React.Fragment>
                                              );
                                            })}
                                          </TableBody>
                                        </Table>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Booking dialog ───────────────────────────────────────────────── */}
      <Dialog open={bookingDialog} onOpenChange={setBookingDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Book unit {bookingUnit?.unit_no}</DialogTitle>
            <DialogDescription>
              Consideration is snapshotted at booking. Joint buyers share in an agreed ratio, which is
              also how the 194-IA deduction splits between them.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="b-date">Booking date</Label>
              <Input
                id="b-date" type="date" value={bookingForm.booking_date}
                onChange={(e) => setBookingForm({ ...bookingForm, booking_date: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="b-cons">Total consideration (excl. GST)</Label>
              <Input
                id="b-cons" type="number" step="0.01" value={bookingForm.total_consideration}
                onChange={(e) => setBookingForm({ ...bookingForm, total_consideration: e.target.value })}
              />
            </div>
          </div>

          {isTds194IAApplicable(parseFloat(bookingForm.total_consideration) || 0) && (
            <div className="flex gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sky-900">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p className="text-xs">
                Consideration is ₹50 lakh or more, so the buyer deducts 1% TDS u/s 194-IA on the whole
                amount. GST is still computed on the full consideration, never on the 99% banked.
              </p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Members</Label>
              <Button
                variant="outline" size="sm"
                onClick={() => setBookingMembers([...bookingMembers, { ...emptyMember, ownership_ratio: '0' }])}
              >
                <Plus className="h-3 w-3 mr-1" /> Add joint holder
              </Button>
            </div>
            <div className="space-y-2">
              {bookingMembers.map((m, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <Input
                    className="col-span-5" placeholder="Name" value={m.name}
                    onChange={(e) => {
                      const next = [...bookingMembers]; next[idx] = { ...m, name: e.target.value };
                      setBookingMembers(next);
                    }}
                  />
                  <Input
                    className="col-span-4" placeholder="PAN" value={m.pan}
                    onChange={(e) => {
                      const next = [...bookingMembers]; next[idx] = { ...m, pan: e.target.value.toUpperCase() };
                      setBookingMembers(next);
                    }}
                  />
                  <Input
                    className="col-span-2" type="number" step="0.01" placeholder="%"
                    value={m.ownership_ratio}
                    onChange={(e) => {
                      const next = [...bookingMembers]; next[idx] = { ...m, ownership_ratio: e.target.value };
                      setBookingMembers(next);
                    }}
                  />
                  <Button
                    variant="ghost" size="icon" className="col-span-1"
                    disabled={bookingMembers.length === 1}
                    onClick={() => setBookingMembers(bookingMembers.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Ratios must total 100%. Currently{' '}
              {bookingMembers.reduce((s, m) => s + (parseFloat(m.ownership_ratio) || 0), 0)}%.
            </p>
          </div>

          <div>
            <Label htmlFor="b-notes">Notes</Label>
            <Input
              id="b-notes" value={bookingForm.notes}
              onChange={(e) => setBookingForm({ ...bookingForm, notes: e.target.value })}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBookingDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveBooking} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Book unit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Receipt dialog ───────────────────────────────────────────────── */}
      <Dialog open={receiptDialog} onOpenChange={setReceiptDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Receipt — unit {receiptTarget?.unit.unit_no}</DialogTitle>
            <DialogDescription>
              An advance bears tax in the month of receipt and goes to Table 11A. A collection against an
              invoice already raised posts nothing — that tax went out with the invoice.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="r-date">Receipt date</Label>
              <Input
                id="r-date" type="date" value={receiptForm.receipt_date}
                onChange={(e) => setReceiptForm({ ...receiptForm, receipt_date: e.target.value })}
              />
            </div>
            <div>
              <Label>Nature</Label>
              <Select
                value={receiptForm.receipt_nature}
                onValueChange={(v) => setReceiptForm({ ...receiptForm, receipt_nature: v as ReceiptNature })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADVANCE">Advance — tax now (Table 11A)</SelectItem>
                  <SelectItem value="AGAINST_INVOICE">Against an invoice already raised</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="r-amt">Amount received</Label>
              <Input
                id="r-amt" type="number" step="0.01" value={receiptForm.amount_entered}
                onChange={(e) => {
                  const amt = e.target.value;
                  // Seed the TDS from the booking, so the common case is one field less to key.
                  const auto = receiptTarget && tdsApplies && !receiptForm.amount_is_gst_inclusive
                    ? String(computeTds194IA(receiptTarget.booking.total_consideration, parseFloat(amt) || 0))
                    : receiptForm.tds_194ia;
                  setReceiptForm({ ...receiptForm, amount_entered: amt, tds_194ia: auto });
                }}
              />
            </div>
            <div className="flex items-end">
              <div className="flex items-center justify-between rounded-lg border p-3 w-full">
                <div>
                  <p className="text-sm font-medium">Amount includes GST</p>
                  <p className="text-xs text-muted-foreground">Backed out under Rule 35</p>
                </div>
                <Switch
                  checked={receiptForm.amount_is_gst_inclusive}
                  onCheckedChange={(v) => setReceiptForm({ ...receiptForm, amount_is_gst_inclusive: v })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="r-tds">TDS u/s 194-IA deducted</Label>
              <Input
                id="r-tds" type="number" step="0.01" value={receiptForm.tds_194ia}
                onChange={(e) => setReceiptForm({ ...receiptForm, tds_194ia: e.target.value })}
              />
              {tdsApplies && (
                <p className="text-xs text-muted-foreground mt-1">
                  Consideration is ≥ ₹50 lakh — confirm the 1% deduction with the client.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="r-bank">Bank credit (actual)</Label>
              <Input
                id="r-bank" type="number" step="0.01" value={receiptForm.bank_credit}
                placeholder={receiptPreview ? String(receiptPreview.expectedBankCredit) : ''}
                onChange={(e) => setReceiptForm({ ...receiptForm, bank_credit: e.target.value })}
              />
            </div>
            <div>
              <Label>Instrument</Label>
              <Select
                value={receiptForm.instrument_type}
                onValueChange={(v) => setReceiptForm({
                  ...receiptForm, instrument_type: v,
                  cheque_status: v === 'Cheque' ? 'Pending' : 'Cleared',
                })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['Cheque', 'NEFT/RTGS', 'UPI', 'Cash', 'Bank Transfer', 'Adjustment', 'Other'].map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select
                value={receiptForm.cheque_status}
                onValueChange={(v) => setReceiptForm({ ...receiptForm, cheque_status: v as ChequeStatus })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['Cleared', 'Pending', 'Bounced', 'Replaced'] as ChequeStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{CHEQUE_STATUS_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="r-ref">Instrument reference</Label>
              <Input
                id="r-ref" value={receiptForm.instrument_ref}
                onChange={(e) => setReceiptForm({ ...receiptForm, instrument_ref: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="r-doc">Receipt voucher no.</Label>
              <Input
                id="r-doc" value={receiptForm.doc_no}
                onChange={(e) => setReceiptForm({ ...receiptForm, doc_no: e.target.value })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">GST already discharged on the receipt this replaces</p>
              <p className="text-xs text-muted-foreground">
                For a funding swap — own money returned, bank disbursement received for the same unit.
                The consideration never changed, so it is not taxed again.
              </p>
            </div>
            <Switch
              checked={receiptForm.gst_already_discharged}
              onCheckedChange={(v) => setReceiptForm({ ...receiptForm, gst_already_discharged: v })}
            />
          </div>

          {receiptPreview && (
            <div className="rounded-lg border p-3 bg-muted/30 space-y-2">
              <div className="grid gap-2 sm:grid-cols-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Consideration (excl. GST)</p>
                  <p className="font-semibold">{formatINR(receiptPreview.tax.consideration)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Taxable value (2/3rd)</p>
                  <p className="font-semibold">{formatINR(receiptPreview.tax.taxableValue)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">CGST + SGST @ {receiptPreview.tax.ratePct}%</p>
                  <p className="font-semibold">
                    {formatINR(receiptPreview.tax.cgst)} + {formatINR(receiptPreview.tax.sgst)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Expected bank credit</p>
                  <p className="font-semibold">{formatINR(receiptPreview.expectedBankCredit)}</p>
                </div>
              </div>
              {receiptForm.receipt_nature === 'AGAINST_INVOICE' && (
                <p className="text-xs text-muted-foreground">
                  Recorded as a collection only — no entry in Table 11A.
                </p>
              )}
              {Math.abs(receiptPreview.bankVariance) > 0.5 && (
                <div className="flex gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <p className="text-xs">
                    Bank credit differs from expected by {formatINR(Math.abs(receiptPreview.bankVariance))}.
                    Check whether a TDS deduction is unrecorded — GST must still be on the full
                    consideration, not the net banked.
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiptDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveReceipt} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Record receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Invoice dialog ───────────────────────────────────────────────── */}
      <Dialog open={invoiceDialog} onOpenChange={setInvoiceDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invoice — unit {invoiceTarget?.unit.unit_no}</DialogTitle>
            <DialogDescription>
              The invoice goes to Table 7 in full; open advances it covers are reversed in Table 11B, so
              only the incremental liability reaches 3B Table 3.1(a).
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="i-date">Invoice date</Label>
              <Input
                id="i-date" type="date" value={invoiceForm.invoice_date}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, invoice_date: e.target.value })}
              />
            </div>
            <div>
              <Label>Type</Label>
              <Select
                value={invoiceForm.invoice_type}
                onValueChange={(v) => setInvoiceForm({ ...invoiceForm, invoice_type: v as InvoiceType })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MILESTONE">{INVOICE_TYPE_LABEL.MILESTONE}</SelectItem>
                  <SelectItem value="SUPPLEMENTARY">{INVOICE_TYPE_LABEL.SUPPLEMENTARY}</SelectItem>
                  <SelectItem value="DELAY_INTEREST">{INVOICE_TYPE_LABEL.DELAY_INTEREST}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="i-label">Milestone</Label>
              <Input
                id="i-label" placeholder="e.g. On completion of plinth"
                value={invoiceForm.milestone_label}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, milestone_label: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="i-cons">Invoice value (excl. GST)</Label>
              <Input
                id="i-cons" type="number" step="0.01" value={invoiceForm.consideration}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, consideration: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="i-doc">Invoice no.</Label>
              <Input
                id="i-doc" value={invoiceForm.doc_no}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, doc_no: e.target.value })}
              />
            </div>
          </div>

          {invoicePlan && invoiceTarget && (
            <div className="rounded-lg border p-3 bg-muted/30 space-y-2">
              <div className="grid gap-2 sm:grid-cols-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Open advance available</p>
                  <p className="font-semibold">
                    {formatINR(openAdvancesFor(invoiceTarget.unit.id).reduce((s, a) => s + a.available, 0))}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">To be adjusted (Table 11B)</p>
                  <p className="font-semibold">{formatINR(invoicePlan.absorbed)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Fresh liability</p>
                  <p className="font-semibold">{formatINR(invoicePlan.unabsorbed)}</p>
                </div>
              </div>
              {invoicePlan.adjustments.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Absorbing {invoicePlan.adjustments.length} advance
                  {invoicePlan.adjustments.length > 1 ? 's' : ''}, oldest first.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {RATE_CODE_LABEL[classifyFor(invoiceTarget.unit).rateCode]}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoiceDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveInvoice} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Raise invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BuilderBookingsPage;
