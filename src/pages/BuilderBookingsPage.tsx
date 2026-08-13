import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBuilderEmbedded, useBuilderProjectId } from '@/contexts/BuilderWorkspaceContext';
import { useMonth } from '@/contexts/MonthContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import BuilderProjectDetailPage from './BuilderProjectDetailPage';
import BuilderAdjustmentsPage from './BuilderAdjustmentsPage';
import BuilderDastavejPage from './BuilderDastavejPage';
import { AFFORDABLE_VALUE_LIMIT } from '@/utils/builderRates';
import BulkReceiptsDialog, { type BulkReceiptUnit } from '@/components/builder/BulkReceiptsDialog';
import {
  ArrowLeft, Loader2, ChevronDown, ChevronRight, Plus, Receipt, FileText,
  AlertTriangle, UserPlus, Trash2, Users, Pencil, Wallet, CheckSquare, MoreHorizontal, Layers, ArrowUpDown,
  History, ListChecks,
} from 'lucide-react';
import {
  DEFAULT_CHARGE_INCLUSIONS, RATE_CODE_LABEL, classifyUnit, computeTds194IA,
  formatINR, isTds194IAApplicable, testRrep,
  type BuilderRateCode, type ChargeInclusionSettings, type UnitType,
} from '@/utils/builderRates';
import {
  CHEQUE_STATUS_LABEL, INVOICE_TYPE_LABEL, checkTieOut, computeUnitLedger,
  dateToPeriod, deriveReceipt, planAdvanceAbsorption, prettyPeriodLabel, receiptPostsTax,
  type ChequeStatus, type InvoiceType, type ReceiptNature,
} from '@/utils/builderLedger';
import { computeDelayInterest, type DelayInterestBasis } from '@/utils/builderAdjustments';
import { autoReclassifyProject } from '@/lib/builderAdjustmentsData';
import { periodKey } from '@/utils/builderBuEvent';
import { fetchBuilderSettings } from '@/lib/builderSettings';

interface ProjectRow {
  id: string; client_id: string; name: string; is_metro: boolean;
  carpet_area_source: 'DERIVED' | 'MANUAL';
  manual_residential_carpet_sqm: number; manual_commercial_carpet_sqm: number;
  doc_series_prefix: string | null;
}
interface GroupRow { id: string; project_id: string; name: string; sort_order: number }
interface UnitRow {
  id: string; unit_no: string; unit_type: UnitType; carpet_area_sqm: number;
  base_consideration: number; status: string; group_id: string | null;
  /** The registered sale deed. Half of the BU cut-off, so it belongs on the row. */
  dastavej_date: string | null;
  dastavej_value: number | null;
  /** Set once this unit has gone through its BU/dastavej differential — the whole balance is taxed. */
  bu_event_id: string | null;
  onboarding_status: 'LIVE' | 'CLOSED_PRE_ONBOARDING';
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
  subsumed_by_bu_event_id: string | null;
  cancelled_via_id: string | null;
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
const currentMonthShort = () => {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
/** One calendar month before the given 'MM/YYYY' — for the Opening column. */
const previousPeriod = (mmYyyy: string): string => {
  const [mm, yyyy] = (mmYyyy || currentMonthShort()).split('/').map(Number);
  const d = new Date(yyyy, mm - 1 - 1, 1);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
/** Only the return period matters for tax purposes — the 1st of it satisfies
 *  the schema's NOT NULL receipt_date without asking staff for an exact day. */
const monthToIsoDate = (mmYyyy: string): string => {
  const [mm, yyyy] = (mmYyyy || currentMonthShort()).split('/');
  return `${yyyy}-${mm}-01`;
};

const emptyBooking = { booking_date: today(), total_consideration: '', notes: '' };
const emptyMember = { name: '', pan: '', ownership_ratio: '100' };
const emptyReceipt = {
  receipt_month: currentMonthShort(), receipt_nature: 'ADVANCE' as ReceiptNature,
  amount_entered: '', amount_is_gst_inclusive: false, tds_194ia: '', bank_credit: '',
  instrument_type: 'NEFT/RTGS', instrument_ref: '', cheque_status: 'Cleared' as ChequeStatus,
  gst_already_discharged: false, doc_no: '',
};
const emptyInvoice = {
  invoice_date: today(), invoice_type: 'MILESTONE' as InvoiceType,
  milestone_label: '', consideration: '', doc_no: '',
};

const BuilderBookingsPage: React.FC = () => {
  const projectId = useBuilderProjectId();
  const embedded = useBuilderEmbedded();
  const navigate = useNavigate();
  const { canEnterBuilderReceipts, user } = useAuth();
  const { selectedMonth } = useMonth();

  /**
   * Two different questions, easy to conflate: "where does this unit stand"
   * (cumulative, as of a period-end) and "what happened this month" (a flat
   * register to tally against a bank statement or Tally). Up-to-mode reuses
   * the unit table; month-mode replaces it with the register below. Neither
   * touches the entry dialogs — those always act on the true, current
   * position, never on a historical snapshot.
   */
  const [viewMode, setViewMode] = useState<'upto' | 'month'>('upto');

  const [project, setProject] = useState<ProjectRow | null>(null);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [charges, setCharges] = useState<Record<string, ChargeRow[]>>({});
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [members, setMembers] = useState<Record<string, MemberRow[]>>({});
  const [receipts, setReceipts] = useState<Record<string, ReceiptRow[]>>({});
  const [invoices, setInvoices] = useState<Record<string, InvoiceRow[]>>({});
  const [adjustments, setAdjustments] = useState<AdjRow[]>([]);
  const [openings, setOpenings] = useState<Record<string, OpeningRow>>({});
  /** Units already carrying a re-rating (auto-posted or, rarely, manual). */
  const [reclassifiedUnitIds, setReclassifiedUnitIds] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<ChargeInclusionSettings>(DEFAULT_CHARGE_INCLUSIONS);
  const [delayInterestBasis, setDelayInterestBasis] = useState<DelayInterestBasis>('FLAT_18');
  /** False for a client who never raises a milestone invoice — hides that control on the ledger. */
  const [raisesInvoices, setRaisesInvoices] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [bookingDialog, setBookingDialog] = useState(false);
  const [bookingUnit, setBookingUnit] = useState<UnitRow | null>(null);
  const [bookingForm, setBookingForm] = useState(emptyBooking);
  const [bookingMembers, setBookingMembers] = useState([{ ...emptyMember }]);

  // Rename/correct the member(s) on an already-booked unit — the "Book unit"
  // flow above only ever creates a booking, so it disappears once one exists.
  // Needed most often for bookings created via Bulk Receipts import, which
  // leaves a placeholder "To be named" member when no name was supplied.
  const [membersDialog, setMembersDialog] = useState(false);
  const [membersDialogTarget, setMembersDialogTarget] = useState<{ unit: UnitRow; booking: BookingRow } | null>(null);
  const [editMembers, setEditMembers] = useState([{ ...emptyMember }]);

  const [bulkReceipts, setBulkReceipts] = useState(false);
  /**
   * The surfaces the row menu opens. They are dialogs over the table rather
   * than destinations, so dismissing one returns you to the row you were on —
   * which is the whole reason the sub-tab strip was wrong. A menu click also
   * carries which unit and which action it was for, so the surface opens
   * straight into that unit's dialog instead of a generic, unscoped page the
   * unit has to be found in again.
   */
  interface SurfaceState {
    type: '' | 'masters' | 'corrections' | 'dastavej';
    unitId?: string;
    action?: 'editUnit' | 'openingBalance' | 'creditNote' | 'reRate' | 'bounceReversal' | 'convert' | 'cancelBooking' | 'recordDastavej';
  }
  const [surface, setSurface] = useState<SurfaceState>({ type: '' });

  /**
   * Client setup opens the masters surface too, so the one-time job lives with
   * the other one-time jobs. A custom event rather than lifted state because
   * the two are siblings under the workspace and threading a prop through
   * would give the ledger a second owner for a dialog it already owns.
   */
  useEffect(() => {
    const open = () => setSurface({ type: 'masters' });
    window.addEventListener('builder:open-masters', open);
    return () => window.removeEventListener('builder:open-masters', open);
  }, []);
  /**
   * Sorting by ₹45 lakh headroom puts the units closest to losing the
   * affordable concession at the top. That is the review order that matters:
   * a unit ₹10,000 under the limit is one charge head from a retrospective
   * re-rating on everything already collected.
   */
  const [byHeadroom, setByHeadroom] = useState(false);
  // Selected receipt ids, for bulk delete. Kept as ids rather than rows so a
  // reload cannot leave the selection pointing at stale objects.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Column-heading filters on the Units table, same pattern as Filing Status:
  // an empty array means "no filter" (show everything).
  const [unitTypeFilter, setUnitTypeFilter] = useState<UnitType[]>([]);
  const [bookingFilter, setBookingFilter] = useState<('Booked' | 'Unbooked')[]>([]);
  const [rateFilter, setRateFilter] = useState<BuilderRateCode[]>([]);
  const toggleInArray = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, value: T) => {
    setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };
  // Excel-style unit-number picker inside the Unit column filter: null means
  // "everything" (the default, unfiltered state) rather than an empty list,
  // because an explicit empty selection has to mean "show nothing" once the
  // user starts unchecking individual units — the same list used for "no
  // filter applied" and "user cleared every box" would otherwise collide.
  const [unitNoFilter, setUnitNoFilter] = useState<string[] | null>(null);
  const [unitNoSearch, setUnitNoSearch] = useState('');
  const allUnitNos = useMemo(
    () => Array.from(new Set(units.map((u) => u.unit_no))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [units],
  );
  const toggleUnitNo = (no: string) => {
    setUnitNoFilter((prev) => {
      const current = prev ?? allUnitNos;
      return current.includes(no) ? current.filter((v) => v !== no) : [...current, no];
    });
  };

  const [receiptDialog, setReceiptDialog] = useState(false);
  /** Set when the receipt dialog is editing rather than creating. */
  const [editingReceipt, setEditingReceipt] = useState<ReceiptRow | null>(null);
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
      const clientSettings = await fetchBuilderSettings(p.client_id);
      setSettings(clientSettings as ChargeInclusionSettings);
      setDelayInterestBasis(clientSettings.delay_interest_basis);
      setRaisesInvoices(clientSettings.raises_invoices !== false);

      const [{ data: unt }, { data: grp }] = await Promise.all([
        supabase.from('builder_units').select('*').eq('project_id', projectId)
          .order('sort_order').order('unit_no'),
        supabase.from('builder_project_groups').select('*').eq('project_id', projectId)
          .order('sort_order').order('name'),
      ]);
      const unitRows = (unt || []) as unknown as UnitRow[];
      setUnits(unitRows);
      setGroups((grp || []) as unknown as GroupRow[]);
      const unitIds = unitRows.map((u) => u.id);
      if (!unitIds.length) {
        setCharges({}); setBookings([]); setMembers({}); setReceipts({});
        setInvoices({}); setAdjustments([]); setOpenings({}); setReclassifiedUnitIds(new Set());
        return;
      }

      const [{ data: chg }, { data: bkg }, { data: rcp }, { data: inv }, { data: opn }, { data: rcl }] =
        await Promise.all([
          supabase.from('builder_unit_charges').select('*').in('unit_id', unitIds),
          supabase.from('builder_bookings').select('*').in('unit_id', unitIds).order('booking_date'),
          supabase.from('builder_receipts').select('*').in('unit_id', unitIds).order('receipt_date'),
          supabase.from('builder_invoices').select('*').in('unit_id', unitIds).order('invoice_date'),
          supabase.from('builder_opening_balances').select('*').in('unit_id', unitIds),
          supabase.from('builder_reclassifications').select('unit_id').in('unit_id', unitIds),
        ]);
      setReclassifiedUnitIds(new Set(((rcl || []) as unknown as { unit_id: string }[]).map((r) => r.unit_id)));

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

  /**
   * The client-wide "Record receipts" / "Opening balances" dialogs (client
   * setup toolbar, in BuilderWorkspacePage) write straight to the database
   * and only refresh their own unit list so a re-open shows the numbers just
   * entered — this component's own openings/receipts state, loaded once on
   * mount, never heard about the write. Reload on the same event so a save
   * there shows up here without a manual page refresh.
   */
  useEffect(() => {
    const reload = () => { void load(); };
    window.addEventListener('builder:data-changed', reload);
    return () => window.removeEventListener('builder:data-changed', reload);
  }, [load]);

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

  const classification = useMemo(() => {
    const out: Record<string, { rateCode: string; ratePct: number; agreementValue: number }> = {};
    units.forEach((u) => {
      const cls = classifyFor(u);
      out[u.id] = { rateCode: cls.rateCode, ratePct: cls.ratePct, agreementValue: cls.gross.gross };
    });
    return out;
  }, [units, classifyFor]);

  /** Receipt entry only ever needs the return period, not an exact date. */
  const receiptMonthOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = -24; i <= 2; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      out.push({ value: `${mm}/${d.getFullYear()}`, label: prettyPeriodLabel(`${mm}/${d.getFullYear()}`) });
    }
    return out.reverse();
  }, []);

  /**
   * Re-rating (§8) posts itself the moment a unit crosses ₹45L — no staff
   * selection. This is the daily workspace, so the correction fires from
   * here rather than waiting for anyone to open the Adjustments tab; Builder
   * Returns' Generate step re-runs the same check as a safety net for
   * whichever page a unit actually crossed on.
   */
  useEffect(() => {
    if (!projectId || !units.length) return;
    (async () => {
      try {
        const posted = await autoReclassifyProject(projectId, classification, user?.id ?? null);
        if (posted.length) {
          toast.success(
            `${posted.length} unit${posted.length === 1 ? '' : 's'} auto re-rated on crossing ₹45,00,000 `
            + `(${posted.map((c) => c.unitNo).join(', ')}) — Table 10 amendment and interest posted.`,
          );
          setReclassifiedUnitIds((prev) => new Set([...prev, ...posted.map((c) => c.unitId)]));
        }
      } catch (e) {
        toast.error(`Auto re-rating failed for one or more units: ${(e as Error).message}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, units.length, classification]);

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
        subsumed_by_bu_event_id: r.subsumed_by_bu_event_id,
      })),
      invoices: (invoices[u.id] || []).map((i) => ({
        consideration: i.consideration, cgst: i.cgst, sgst: i.sgst,
      })),
      adjustments: adjustmentsForUnit(u.id).map((a) => ({
        consideration_adjusted: a.consideration_adjusted, cgst: a.cgst, sgst: a.sgst,
      })),
    });
  }, [classifyFor, openings, receipts, invoices, adjustmentsForUnit]);

  /**
   * The same ledger, frozen at the end of a given period — what the table
   * shows in "Up to [period]" mode. Never used by the entry dialogs: adding a
   * receipt always acts on the true, current balance, not a historical one.
   */
  const ledgerForAsOf = useCallback((u: UnitRow, asOfPeriod: string) => {
    const cls = classifyFor(u);
    const opening = openings[u.id];
    const cutoff = periodKey(asOfPeriod);
    return computeUnitLedger({
      agreementValue: opening?.agreement_value || cls.gross.gross,
      opening,
      receipts: (receipts[u.id] || [])
        .filter((r) => periodKey(r.period_month) <= cutoff)
        .map((r) => ({
          consideration: r.consideration, cgst: r.cgst, sgst: r.sgst,
          tds_194ia: r.tds_194ia, bank_credit: r.bank_credit,
          receipt_nature: r.receipt_nature, cheque_status: r.cheque_status,
          gst_already_discharged: r.gst_already_discharged,
          subsumed_by_bu_event_id: r.subsumed_by_bu_event_id,
        })),
      invoices: (invoices[u.id] || [])
        .filter((i) => periodKey(i.period_month) <= cutoff)
        .map((i) => ({ consideration: i.consideration, cgst: i.cgst, sgst: i.sgst })),
      adjustments: adjustmentsForUnit(u.id)
        .filter((a) => periodKey(a.period_month) <= cutoff)
        .map((a) => ({
          consideration_adjusted: a.consideration_adjusted, cgst: a.cgst, sgst: a.sgst,
        })),
    });
  }, [classifyFor, openings, receipts, invoices, adjustmentsForUnit]);

  /**
   * Open advances on a unit, net of what invoices have already absorbed.
   * Excludes a cancelled booking's receipts — once cancelled, that money
   * belongs to a sale that no longer exists and must never be absorbed
   * against a fresh booking's invoice on the same unit.
   */
  const openAdvancesFor = useCallback((unitId: string) => {
    const unitAdj = adjustmentsForUnit(unitId);
    return (receipts[unitId] || [])
      .filter((r) => receiptPostsTax(r) && !r.cancelled_via_id)
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
        created_by: user?.id ?? null,
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

  // ── Edit member(s) on an existing booking ───────────────────────────────
  const openEditMembers = (u: UnitRow, b: BookingRow) => {
    const existing = (members[b.id] || []).map((m) => ({
      name: m.name === 'To be named' ? '' : m.name,
      pan: m.pan || '',
      ownership_ratio: String(m.ownership_ratio ?? 0),
    }));
    setMembersDialogTarget({ unit: u, booking: b });
    setEditMembers(existing.length ? existing : [{ ...emptyMember }]);
    setMembersDialog(true);
  };

  const handleSaveMembers = async () => {
    if (!membersDialogTarget) return;
    const named = editMembers.filter((m) => m.name.trim());
    if (!named.length) { toast.error('At least one member is required'); return; }
    const ratioTotal = named.reduce((s, m) => s + (parseFloat(m.ownership_ratio) || 0), 0);
    if (Math.abs(ratioTotal - 100) > 0.01) {
      toast.error(`Ownership ratios must total 100% (currently ${ratioTotal}%)`);
      return;
    }
    setIsSaving(true);
    try {
      const bookingId = membersDialogTarget.booking.id;
      const { error: delErr } = await supabase.from('builder_booking_members').delete().eq('booking_id', bookingId);
      if (delErr) throw delErr;
      const { error: insErr } = await supabase.from('builder_booking_members').insert(
        named.map((m, idx) => ({
          booking_id: bookingId,
          name: m.name.trim(),
          pan: m.pan.trim() || null,
          ownership_ratio: parseFloat(m.ownership_ratio) || 0,
          is_primary: idx === 0,
          sort_order: idx,
        })),
      );
      if (insErr) throw insErr;

      toast.success('Member(s) updated');
      setMembersDialog(false);
      await load();
    } catch (e) {
      toast.error(`Could not update members: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Receipt ──────────────────────────────────────────────────────────────
  const openReceipt = (u: UnitRow, b: BookingRow) => {
    setEditingReceipt(null);
    setReceiptTarget({ unit: u, booking: b });
    // A unit that has already been through its BU/dastavej differential was
    // taxed on its whole balance at that cut-off — a receipt arriving after
    // that is a plain collection, not a fresh advance. Defaulted, not forced:
    // an unpost or a genuine edge case can still override it.
    setReceiptForm({
      ...emptyReceipt,
      // Default to whatever month is already selected on the main screen —
      // staff already made that choice before opening this dialog.
      receipt_month: selectedMonth || emptyReceipt.receipt_month,
      gst_already_discharged: !!u.bu_event_id,
    });
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

  /**
   * When this receipt takes the unit past its recorded agreement value, the
   * customer's price has almost certainly changed. The firm's rule: update the
   * unit's value in the master FIRST (so the ₹45 lakh test and rate are right),
   * and a residential unit crossing ₹45 lakh is re-rated on everything already
   * taxed, in the month it crosses. This surfaces that at the point of entry
   * rather than leaving it to be caught later.
   */
  const agreementWarning = useMemo(() => {
    if (!receiptTarget || !receiptPreview) return null;
    if (!(receiptPreview.tax.consideration > 0)) return null;
    if (receiptForm.receipt_nature === 'AGAINST_INVOICE') return null; // not fresh consideration
    const u = receiptTarget.unit;
    const cls = classifyFor(u);
    const agreement = openings[u.id]?.agreement_value || cls.gross.gross;
    const led = ledgerFor(u);
    const newValueTaxed = (led?.valueTaxed || 0) + receiptPreview.tax.consideration;
    if (newValueTaxed <= agreement + 1) return null;
    const crosses45L = u.unit_type === 'Residential'
      && cls.affordable.isAffordable
      && newValueTaxed > AFFORDABLE_VALUE_LIMIT;
    return { agreement, newValueTaxed, crosses45L };
  }, [receiptTarget, receiptPreview, receiptForm.receipt_nature, classifyFor, openings, ledgerFor]);

  /** Reopen an existing receipt in the same dialog that created it. */
  const openEditReceipt = (u: UnitRow, b: BookingRow, r: ReceiptRow) => {
    setReceiptTarget({ unit: u, booking: b });
    setEditingReceipt(r);
    setReceiptForm({
      receipt_month: dateToPeriod(r.receipt_date) || currentMonthShort(),
      receipt_nature: r.receipt_nature,
      amount_entered: String(r.amount_entered ?? ''),
      amount_is_gst_inclusive: !!r.amount_is_gst_inclusive,
      tds_194ia: String(r.tds_194ia ?? ''),
      bank_credit: r.bank_credit === null || r.bank_credit === undefined ? '' : String(r.bank_credit),
      instrument_type: r.instrument_type || 'NEFT/RTGS',
      instrument_ref: r.instrument_ref || '',
      cheque_status: r.cheque_status,
      gst_already_discharged: !!r.gst_already_discharged,
      doc_no: r.doc_no || '',
    });
    setReceiptDialog(true);
  };

  const handleSaveReceipt = async () => {
    if (!receiptTarget || !receiptPreview) return;
    if (!(parseFloat(receiptForm.amount_entered) > 0)) { toast.error('Amount is required'); return; }
    setIsSaving(true);
    try {
      const cls = classifyFor(receiptTarget.unit);
      const t = receiptPreview.tax;
      const receiptDate = monthToIsoDate(receiptForm.receipt_month);
      const payload = {
        booking_id: receiptTarget.booking.id,
        unit_id: receiptTarget.unit.id,
        receipt_date: receiptDate,
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
        period_month: receiptForm.receipt_month,
        doc_series: project?.doc_series_prefix ?? null,
        doc_no: receiptForm.doc_no.trim() || null,
        created_by: user?.id ?? null,
      };
      // Editing rewrites the derived tax as well as the entered amount — the
      // rate could have moved since, and a receipt carrying its old tax against
      // a new amount is worse than one that was never edited.
      const { error } = editingReceipt
        ? await supabase.from('builder_receipts').update(payload).eq('id', editingReceipt.id)
        : await supabase.from('builder_receipts').insert(payload);
      if (error) throw error;
      toast.success(editingReceipt ? 'Receipt updated' : 'Receipt recorded');
      setEditingReceipt(null);
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
      // Delay interest follows the client's election. Under the flat 18% it is
      // a supply separate from construction, so no 1/3rd land deduction — the
      // whole amount is the taxable value.
      const isDelayInterest = invoiceForm.invoice_type === 'DELAY_INTEREST';
      const di = isDelayInterest
        ? computeDelayInterest({
          interestAmount: consideration,
          basis: delayInterestBasis,
          unitRateCode: cls.rateCode,
        })
        : null;
      const t = di
        ? { consideration: di.consideration, ratePct: di.ratePct, taxableValue: di.taxableValue, cgst: di.cgst, sgst: di.sgst }
        : computeTax(consideration, cls.rateCode);
      const rateCode = di ? di.rateCode : cls.rateCode;
      const period = dateToPeriod(invoiceForm.invoice_date);

      const { data, error } = await supabase.from('builder_invoices').insert({
        booking_id: invoiceTarget.booking.id,
        unit_id: invoiceTarget.unit.id,
        invoice_date: invoiceForm.invoice_date,
        invoice_type: invoiceForm.invoice_type,
        milestone_label: invoiceForm.milestone_label.trim() || null,
        consideration: t.consideration,
        rate_code: rateCode,
        rate_pct: t.ratePct,
        taxable_value: t.taxableValue,
        cgst: t.cgst,
        sgst: t.sgst,
        period_month: period,
        doc_series: project?.doc_series_prefix ?? null,
        doc_no: invoiceForm.doc_no.trim() || null,
        created_by: user?.id ?? null,
      }).select('id').single();
      if (error) throw error;

      // The 11B leg: absorb the advances this invoice covers, so the rupees
      // taxed on receipt are not taxed again inside the invoice. Delay interest
      // is its own supply and never absorbs an advance for the unit.
      if (!isDelayInterest && invoicePlan.adjustments.length) {
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
            created_by: user?.id ?? null,
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

  /**
   * Units a collection run can touch. Every unit is offered — a booked one
   * collects against its booking; an unbooked one is auto-booked on save (money
   * in is the moment of sale), so the grid never leaves a unit out just because
   * nobody has keyed a booking for it yet.
   */
  const bulkReceiptUnits: BulkReceiptUnit[] = useMemo(() => {
    // Group order first (units within a block stay together for the section
    // headers), then the project's own sort within each block.
    const orderOf = (u: UnitRow) => {
      const g = groups.find((x) => x.id === u.group_id);
      return g ? g.sort_order : Number.MAX_SAFE_INTEGER;
    };
    const ordered = [...units].sort((a, b) => orderOf(a) - orderOf(b));
    return ordered.flatMap((u) => {
    // Already through its BU/dastavej differential — the whole balance is
    // taxed. Anything collected from here is a plain collection, not a fresh
    // advance, so it doesn't belong in a "record this month's advances" run.
    // The rare late payment still goes through the single-receipt dialog,
    // which defaults "GST already discharged" on for exactly this unit.
    if (u.bu_event_id) return [];
    if (u.status === 'Cancelled') return [];
    const booking = bookings.find((b) => b.unit_id === u.id && b.status === 'Active');
    const cls = classifyFor(u);
    const led = ledgerFor(u);
    const agreement = openings[u.id]?.agreement_value || cls.gross.gross;
    const total = booking ? Number(booking.total_consideration) || 0 : agreement;
    return [{
      unitId: u.id,
      unitNo: u.unit_no,
      bookingId: booking ? booking.id : null,
      rateCode: cls.rateCode,
      ratePct: cls.ratePct,
      totalConsideration: total,
      balanceToTax: Math.max(0, total - (led?.valueTaxed || 0)),
      members: booking
        ? (members[booking.id] || []).map((m) => ({ name: m.name, ratio: Number(m.ownership_ratio) || 0 }))
        : [],
      groupLabel: groups.find((g) => g.id === u.group_id)?.name || null,
    }];
    });
  }, [units, bookings, classifyFor, ledgerFor, members, groups, openings]);

  /** Headroom for a residential unit; null where affordability cannot apply. */
  const headroomOf = useCallback((u: UnitRow) => (
    u.unit_type === 'Residential'
      ? AFFORDABLE_VALUE_LIMIT - classifyFor(u).gross.gross
      : null
  ), [classifyFor]);

  const sortedUnits = useMemo(() => {
    if (!byHeadroom) return units;
    return [...units].sort((a, b) => {
      const ha = headroomOf(a), hb = headroomOf(b);
      if (ha === null) return 1;          // commercial last — never affordable
      if (hb === null) return -1;
      return ha - hb;
    });
  }, [units, byHeadroom, headroomOf]);

  const filteredUnits = useMemo(() => {
    if (unitTypeFilter.length === 0 && bookingFilter.length === 0 && rateFilter.length === 0 && unitNoFilter === null) {
      return sortedUnits;
    }
    return sortedUnits.filter((u) => {
      if (unitTypeFilter.length > 0 && !unitTypeFilter.includes(u.unit_type)) return false;
      if (unitNoFilter !== null && !unitNoFilter.includes(u.unit_no)) return false;
      if (bookingFilter.length > 0) {
        const booking = activeBookingFor(u.id);
        const isBooked = !!booking && (members[booking.id] || []).length > 0;
        if (!bookingFilter.includes(isBooked ? 'Booked' : 'Unbooked')) return false;
      }
      if (rateFilter.length > 0 && !rateFilter.includes(classifyFor(u).rateCode)) return false;
      return true;
    });
  }, [sortedUnits, unitTypeFilter, unitNoFilter, bookingFilter, rateFilter, activeBookingFor, members, classifyFor]);

  const atRisk = useMemo(
    () => units.filter((u) => {
      const h = headroomOf(u);
      return h !== null && h >= 0 && h < 100000;
    }).length,
    [units, headroomOf],
  );

  /**
   * Units that have already crossed ₹45 lakh while carrying receipts taxed at
   * the affordable 1.5% rate — the concession never applied, so everything
   * already taxed at 1.5% is due at 7.5%. This is the re-rating the firm has
   * to raise in the month it crosses; surfacing it here, on the page staff
   * work every day, rather than only on the Adjustments tab.
   */
  const reRatingDue = useMemo(
    () => units.filter((u) => {
      if (reclassifiedUnitIds.has(u.id)) return false; // already corrected
      if (u.unit_type !== 'Residential') return false;
      if (classifyFor(u).affordable.isAffordable) return false; // now over ₹45L
      return (receipts[u.id] || []).some((r) => r.rate_code === 'AFFORDABLE');
    }),
    [units, classifyFor, receipts, reclassifiedUnitIds],
  );

  /**
   * The register view: every receipt and invoice dated in the selected month,
   * across every unit, in one chronological list — the shape that tallies
   * against a bank statement or Tally, not the per-unit cumulative table.
   *
   * "Bank amount" and "GST tax" are kept as two separate totals rather than
   * one grand total. An invoice absorbing an old advance carries GST this
   * month but moved no new cash; folding it into a single sum would make
   * neither total reconcile against anything real.
   */
  interface RegisterRow {
    key: string; date: string; unitId: string; unitNo: string; memberLabel: string;
    docType: string; tableTag: string; ref: string | null;
    bankAmount: number | null; taxableValue: number; cgst: number; sgst: number;
    /** Only a receipt is directly editable/deletable here — an invoice or an
     * 11B adjustment is a derived posting, changed only by undoing its source. */
    receipt?: ReceiptRow; unit?: UnitRow; booking?: BookingRow;
  }
  interface RegisterGroup {
    unitId: string; unitNo: string; memberLabel: string; unit: UnitRow; booking: BookingRow | null;
    rows: RegisterRow[];
    bank: number; taxable: number; cgst: number; sgst: number;
  }
  const monthRegisterGroups = useMemo<RegisterGroup[]>(() => {
    if (viewMode !== 'month') return [];
    const groups: RegisterGroup[] = [];
    units.forEach((u) => {
      // Prefer the active booking for display; a cancelled one still names
      // who was involved historically, but must never be the add-receipt
      // target, so that gate checks status again below rather than truthiness.
      const booking = bookings.find((b) => b.unit_id === u.id && b.status === 'Active')
        || bookings.find((b) => b.unit_id === u.id) || null;
      const mem = booking ? members[booking.id] || [] : [];
      const memberLabel = mem.length === 0 ? 'Unbooked'
        : mem.length === 1 ? mem[0].name : `${mem[0].name} +${mem.length - 1} joint`;
      const rows: RegisterRow[] = [];

      (receipts[u.id] || []).filter((r) => r.period_month === selectedMonth).forEach((r) => {
        const posts = receiptPostsTax(r);
        const tag = posts ? '11A'
          : r.cheque_status === 'Bounced' ? 'Bounced — excluded'
            : r.subsumed_by_bu_event_id ? 'Subsumed by BU event'
              : r.gst_already_discharged ? 'GST discharged elsewhere'
                : 'Against invoice — no fresh tax';
        const rBooking = bookings.find((b) => b.id === r.booking_id);
        rows.push({
          key: `r-${r.id}`, date: r.receipt_date, unitId: u.id, unitNo: u.unit_no, memberLabel,
          docType: `Receipt ${r.doc_no || ''}`.trim(), tableTag: tag, ref: r.instrument_ref,
          bankAmount: r.cheque_status === 'Bounced' ? null : (r.bank_credit ?? (
            (Number(r.consideration) || 0) + (Number(r.cgst) || 0) + (Number(r.sgst) || 0) - (Number(r.tds_194ia) || 0)
          )),
          taxableValue: posts ? Number(r.taxable_value) || 0 : 0,
          cgst: posts ? Number(r.cgst) || 0 : 0,
          sgst: posts ? Number(r.sgst) || 0 : 0,
          receipt: r, unit: u, booking: rBooking,
        });
      });

      (invoices[u.id] || []).filter((i) => i.period_month === selectedMonth).forEach((i) => {
        rows.push({
          key: `i-${i.id}`, date: i.invoice_date, unitId: u.id, unitNo: u.unit_no, memberLabel,
          docType: `${INVOICE_TYPE_LABEL[i.invoice_type]} ${i.doc_no || ''}`.trim(),
          tableTag: 'Table 7', ref: null,
          // Not fresh cash — an invoice bills value already received as an
          // advance, or value not yet received at all (a BU differential).
          bankAmount: null,
          taxableValue: Number(i.taxable_value) || 0, cgst: Number(i.cgst) || 0, sgst: Number(i.sgst) || 0,
        });
      });

      adjustmentsForUnit(u.id)
        .filter((a) => a.period_month === selectedMonth)
        .forEach((a) => {
          const inv = (invoices[u.id] || []).find((i) => i.id === a.invoice_id);
          rows.push({
            key: `a-${a.id}`, date: inv?.invoice_date || '', unitId: u.id, unitNo: u.unit_no, memberLabel,
            docType: `Advance adjusted${inv?.doc_no ? ` (${inv.doc_no})` : ''}`,
            tableTag: '11B', ref: null, bankAmount: null,
            taxableValue: -(Number(a.consideration_adjusted) || 0) * (2 / 3),
            cgst: -(Number(a.cgst) || 0), sgst: -(Number(a.sgst) || 0),
          });
        });

      if (!rows.length) return;
      rows.sort((x, y) => x.date.localeCompare(y.date));
      groups.push({
        unitId: u.id, unitNo: u.unit_no, memberLabel, unit: u, booking,
        rows,
        bank: rows.reduce((s, r) => s + (r.bankAmount || 0), 0),
        taxable: rows.reduce((s, r) => s + r.taxableValue, 0),
        cgst: rows.reduce((s, r) => s + r.cgst, 0),
        sgst: rows.reduce((s, r) => s + r.sgst, 0),
      });
    });
    return groups.sort((x, y) => x.rows[0].date.localeCompare(y.rows[0].date));
  }, [viewMode, units, bookings, members, receipts, invoices, adjustmentsForUnit, selectedMonth]);

  const registerTotals = useMemo(() => monthRegisterGroups.reduce((t, g) => ({
    bank: t.bank + g.bank, taxable: t.taxable + g.taxable, cgst: t.cgst + g.cgst, sgst: t.sgst + g.sgst,
  }), { bank: 0, taxable: 0, cgst: 0, sgst: 0 }), [monthRegisterGroups]);

  const [registerExpanded, setRegisterExpanded] = useState<Set<string>>(new Set());
  const toggleRegisterExpanded = (unitId: string) => setRegisterExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(unitId)) next.delete(unitId); else next.add(unitId);
    return next;
  });

  const toggleSelect = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleDeleteSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!window.confirm(
      `Delete ${ids.length} receipt${ids.length === 1 ? '' : 's'}? `
      + 'Any advance adjustment against them goes too, and a filed period would need a reversal.',
    )) return;
    const { error } = await supabase.from('builder_receipts').delete().in('id', ids);
    if (error) { toast.error(error.message); return; }
    toast.success(`${ids.length} receipt${ids.length === 1 ? '' : 's'} deleted`);
    setSelected(new Set());
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
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && bulkReceiptUnits.length > 0 && (
              <Button onClick={() => setBulkReceipts(true)}>
                <Wallet className="mr-2 h-4 w-4" /> Record receipts
              </Button>
            )}
            <div className="flex rounded-md border p-0.5">
              <Button
                variant={viewMode === 'upto' ? 'secondary' : 'ghost'} size="sm" className="h-8"
                onClick={() => setViewMode('upto')}
                title="Cumulative position as of the end of the selected period"
              >
                <History className="mr-1.5 h-3.5 w-3.5" /> Up to {prettyPeriodLabel(selectedMonth)}
              </Button>
              <Button
                variant={viewMode === 'month' ? 'secondary' : 'ghost'} size="sm" className="h-8"
                onClick={() => setViewMode('month')}
                title="Every receipt and invoice dated in this period, across all units — tally against your bank statement or Tally"
              >
                <ListChecks className="mr-1.5 h-3.5 w-3.5" /> {prettyPeriodLabel(selectedMonth)} register
              </Button>
            </div>
            {viewMode === 'upto' && (
              <Button
                variant={byHeadroom ? 'default' : 'outline'}
                onClick={() => setByHeadroom((v) => !v)}
                title="Put the units closest to the ₹45 lakh limit first"
              >
                <ArrowUpDown className="mr-2 h-4 w-4" />
                ₹45L headroom
              </Button>
            )}
            {viewMode === 'upto' && atRisk > 0 && (
              <Badge variant="outline" className="gap-1 self-center border-amber-500/50 text-amber-700 dark:text-amber-500">
                <AlertTriangle className="h-3 w-3" />
                {atRisk} within ₹1 lakh of the limit
              </Badge>
            )}
            {!embedded && (
              <Button variant="outline" onClick={() => navigate(`/builder-projects/${projectId}`)}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Project
              </Button>
            )}
          </div>
        }
      />

      {/* Re-rating due: a unit crossed ₹45 lakh while carrying 1.5% receipts.
          This posts itself automatically (see the effect above) — this banner
          is only visible in the brief window before that finishes, or if it
          failed and needs a manual look on the Adjustments tab. */}
      {canEdit && reRatingDue.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="text-sm">
            <strong>{reRatingDue.length} unit{reRatingDue.length === 1 ? '' : 's'}</strong>
            {' '}crossed ₹45,00,000 while taxed as affordable
            {' '}({reRatingDue.map((u) => u.unit_no).join(', ')}). The concession never applied — everything
            already taxed at 1.5% is being re-rated to 7.5% automatically. If this doesn't clear on its own,
            check the Adjustments tab.
          </span>
          <Button
            variant="outline" size="sm" className="ml-auto h-7"
            onClick={() => setSurface({ type: 'corrections', unitId: reRatingDue[0].id, action: 'reRate' })}
          >
            View in Adjustments
          </Button>
        </div>
      )}

      {/* Appears only once something is selected, so it never occupies space
          during ordinary entry. */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
          <CheckSquare className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">
            {selected.size} receipt{selected.size === 1 ? '' : 's'} selected
          </span>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
          <Button variant="destructive" size="sm" className="ml-auto" onClick={handleDeleteSelected}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete selected
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{viewMode === 'upto' ? 'Units' : `${prettyPeriodLabel(selectedMonth)} register`}</CardTitle>
          <CardDescription>
            {viewMode === 'upto' ? (
              <>
                "Value taxed" is what a BU event will deduct from — the value offered to tax, not the
                money received, as of the end of {prettyPeriodLabel(selectedMonth)}. Expand a unit to see
                its month-wise ledger.
              </>
            ) : (
              <>
                Every receipt and invoice dated in {prettyPeriodLabel(selectedMonth)}, across every unit,
                oldest first — tally "Bank amount" against your bank statement or Tally, and "GST tax"
                against this period's return.
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {viewMode === 'month' ? (
            monthRegisterGroups.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground">
                <ListChecks className="h-8 w-8 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No receipts or invoices dated in {prettyPeriodLabel(selectedMonth)}.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Document</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Table</TableHead>
                      <TableHead className="text-right">Bank amount</TableHead>
                      <TableHead className="text-right">Taxable</TableHead>
                      <TableHead className="text-right">CGST</TableHead>
                      <TableHead className="text-right">SGST</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthRegisterGroups.map((g) => {
                      const isMulti = g.rows.length > 1;
                      const lineActions = (r: RegisterRow) => (
                        <div className="flex items-center gap-0.5">
                          {canEdit && r.receipt && r.unit && r.booking && (
                            <Button
                              variant="ghost" size="icon" className="h-6 w-6" title="Edit receipt"
                              onClick={() => openEditReceipt(r.unit as UnitRow, r.booking as BookingRow, r.receipt as ReceiptRow)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          )}
                          {canEdit && r.receipt && (
                            <Button
                              variant="ghost" size="icon" className="h-6 w-6" title="Delete receipt"
                              onClick={() => handleDeleteReceipt(r.receipt as ReceiptRow)}
                            >
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          )}
                        </div>
                      );
                      if (!isMulti) {
                        const r = g.rows[0];
                        return (
                          <TableRow key={r.key}>
                            <TableCell className="text-sm tabular-nums">{r.date}</TableCell>
                            <TableCell className="text-sm">
                              {r.unitNo}
                              <span className="block text-xs text-muted-foreground">{r.memberLabel}</span>
                            </TableCell>
                            <TableCell className="text-sm">{r.docType}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{r.ref || '—'}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">{r.tableTag}</Badge>
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums">
                              {r.bankAmount === null ? <span className="text-muted-foreground">—</span> : formatINR(r.bankAmount)}
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{formatINR(r.taxableValue)}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{formatINR(r.cgst)}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{formatINR(r.sgst)}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-0.5">
                                {lineActions(r)}
                                {canEdit && g.booking && g.booking.status === 'Active' && (
                                  <Button
                                    variant="ghost" size="icon" className="h-6 w-6" title="Add receipt"
                                    onClick={() => openReceipt(g.unit, g.booking as BookingRow)}
                                  >
                                    <Plus className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      }
                      const isOpen = registerExpanded.has(g.unitId);
                      const tags = [...new Set(g.rows.map((r) => r.tableTag))];
                      return (
                        <React.Fragment key={g.unitId}>
                          <TableRow
                            className="cursor-pointer bg-muted/30 hover:bg-muted/40"
                            onClick={() => toggleRegisterExpanded(g.unitId)}
                          >
                            <TableCell className="text-sm">
                              <span className="flex items-center gap-1">
                                {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                {g.rows.length} postings
                              </span>
                            </TableCell>
                            <TableCell className="text-sm font-medium">
                              {g.unitNo}
                              <span className="block text-xs font-normal text-muted-foreground">{g.memberLabel}</span>
                            </TableCell>
                            <TableCell colSpan={2} />
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {tags.map((t) => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-sm font-semibold tabular-nums">
                              {g.bank ? formatINR(g.bank) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-right text-sm font-semibold tabular-nums">{formatINR(g.taxable)}</TableCell>
                            <TableCell className="text-right text-sm font-semibold tabular-nums">{formatINR(g.cgst)}</TableCell>
                            <TableCell className="text-right text-sm font-semibold tabular-nums">{formatINR(g.sgst)}</TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              {canEdit && g.booking && g.booking.status === 'Active' && (
                                <Button
                                  variant="ghost" size="icon" className="h-6 w-6" title="Add receipt"
                                  onClick={() => openReceipt(g.unit, g.booking as BookingRow)}
                                >
                                  <Plus className="h-3 w-3" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                          {isOpen && g.rows.map((r) => (
                            <TableRow key={r.key} className="bg-muted/10">
                              <TableCell className="pl-8 text-sm tabular-nums">{r.date}</TableCell>
                              <TableCell />
                              <TableCell className="text-sm">{r.docType}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{r.ref || '—'}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs">{r.tableTag}</Badge>
                              </TableCell>
                              <TableCell className="text-right text-sm tabular-nums">
                                {r.bankAmount === null ? <span className="text-muted-foreground">—</span> : formatINR(r.bankAmount)}
                              </TableCell>
                              <TableCell className="text-right text-sm tabular-nums">{formatINR(r.taxableValue)}</TableCell>
                              <TableCell className="text-right text-sm tabular-nums">{formatINR(r.cgst)}</TableCell>
                              <TableCell className="text-right text-sm tabular-nums">{formatINR(r.sgst)}</TableCell>
                              <TableCell>{lineActions(r)}</TableCell>
                            </TableRow>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={5} className="font-semibold">
                        Bank total — tally against your statement or Tally
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatINR(registerTotals.bank)}</TableCell>
                      <TableCell colSpan={4} />
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={6} className="font-semibold">
                        GST tax posted this period — tally against the return
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatINR(registerTotals.taxable)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatINR(registerTotals.cgst)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatINR(registerTotals.sgst)}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )
          ) : units.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No units in this project yet.</p>
              {canEdit && (
                <>
                  <p className="mx-auto mt-1 max-w-md text-xs">
                    Import the unit list to begin. Afterwards this is reached from Client setup —
                    it is an onboarding job, not a monthly one.
                  </p>
                  <Button size="sm" className="mt-4" onClick={() => setSurface({ type: 'masters' })}>
                    <Layers className="mr-2 h-4 w-4" /> Units &amp; masters
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>
                      <Popover onOpenChange={(open) => { if (!open) setUnitNoSearch(''); }}>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" className="h-auto p-0 font-semibold hover:bg-transparent flex items-center gap-1">
                            Unit
                            <ChevronDown className="h-3 w-3" />
                            {(unitTypeFilter.length > 0 || unitNoFilter !== null) && (
                              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                                {unitNoFilter !== null ? unitNoFilter.length : unitTypeFilter.length}
                              </Badge>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-2 bg-background border" align="start">
                          <div className="space-y-1">
                            <div className="text-xs font-medium text-muted-foreground mb-2">Filter by type</div>
                            {(['Residential', 'Commercial'] as UnitType[]).map((t) => (
                              <div key={t} className="flex items-center space-x-2 p-1 hover:bg-muted rounded">
                                <Checkbox
                                  id={`unittype-${t}`}
                                  checked={unitTypeFilter.includes(t)}
                                  onCheckedChange={() => toggleInArray(setUnitTypeFilter, t)}
                                />
                                <label htmlFor={`unittype-${t}`} className="text-xs cursor-pointer flex-1">{t}</label>
                              </div>
                            ))}

                            <div className="border-t mt-2 pt-2">
                              <div className="text-xs font-medium text-muted-foreground mb-1">Filter by unit no.</div>
                              <Input
                                value={unitNoSearch}
                                onChange={(e) => setUnitNoSearch(e.target.value)}
                                placeholder="Search unit..."
                                className="h-7 text-xs mb-1"
                              />
                              <div className="flex items-center gap-2 px-1 pb-1 mb-1 border-b text-xs">
                                <button type="button" className="text-primary hover:underline" onClick={() => setUnitNoFilter(null)}>
                                  Select all
                                </button>
                                <span className="text-muted-foreground">·</span>
                                <button type="button" className="text-primary hover:underline" onClick={() => setUnitNoFilter([])}>
                                  Clear all
                                </button>
                              </div>
                              <div className="max-h-48 overflow-y-auto space-y-0.5">
                                {allUnitNos
                                  .filter((no) => no.toLowerCase().includes(unitNoSearch.toLowerCase()))
                                  .map((no) => (
                                    <div key={no} className="flex items-center space-x-2 p-1 hover:bg-muted rounded">
                                      <Checkbox
                                        id={`unitno-${no}`}
                                        checked={unitNoFilter === null || unitNoFilter.includes(no)}
                                        onCheckedChange={() => toggleUnitNo(no)}
                                      />
                                      <label htmlFor={`unitno-${no}`} className="text-xs cursor-pointer flex-1">{no}</label>
                                    </div>
                                  ))}
                                {allUnitNos.filter((no) => no.toLowerCase().includes(unitNoSearch.toLowerCase())).length === 0 && (
                                  <p className="text-xs text-muted-foreground p-1">No matching units.</p>
                                )}
                              </div>
                            </div>

                            {(unitTypeFilter.length > 0 || unitNoFilter !== null) && (
                              <Button
                                variant="ghost" size="sm" className="w-full mt-2 h-6 text-xs"
                                onClick={() => { setUnitTypeFilter([]); setUnitNoFilter(null); }}
                              >
                                Clear
                              </Button>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </TableHead>
                    <TableHead>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" className="h-auto p-0 font-semibold hover:bg-transparent flex items-center gap-1">
                            Member(s)
                            <ChevronDown className="h-3 w-3" />
                            {bookingFilter.length > 0 && (
                              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{bookingFilter.length}</Badge>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-48 p-2 bg-background border" align="start">
                          <div className="space-y-1">
                            <div className="text-xs font-medium text-muted-foreground mb-2">Filter by booking</div>
                            {(['Booked', 'Unbooked'] as const).map((b) => (
                              <div key={b} className="flex items-center space-x-2 p-1 hover:bg-muted rounded">
                                <Checkbox
                                  id={`booking-${b}`}
                                  checked={bookingFilter.includes(b)}
                                  onCheckedChange={() => toggleInArray(setBookingFilter, b)}
                                />
                                <label htmlFor={`booking-${b}`} className="text-xs cursor-pointer flex-1">{b}</label>
                              </div>
                            ))}
                            {bookingFilter.length > 0 && (
                              <Button variant="ghost" size="sm" className="w-full mt-2 h-6 text-xs" onClick={() => setBookingFilter([])}>Clear</Button>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </TableHead>
                    <TableHead className="text-right">Carpet</TableHead>
                    <TableHead>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" className="h-auto p-0 font-semibold hover:bg-transparent flex items-center gap-1">
                            Rate
                            <ChevronDown className="h-3 w-3" />
                            {rateFilter.length > 0 && (
                              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{rateFilter.length}</Badge>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-2 bg-background border" align="start">
                          <div className="space-y-1">
                            <div className="text-xs font-medium text-muted-foreground mb-2">Filter by rate</div>
                            {(Object.keys(RATE_CODE_LABEL) as BuilderRateCode[]).map((code) => (
                              <div key={code} className="flex items-center space-x-2 p-1 hover:bg-muted rounded">
                                <Checkbox
                                  id={`rate-${code}`}
                                  checked={rateFilter.includes(code)}
                                  onCheckedChange={() => toggleInArray(setRateFilter, code)}
                                />
                                <label htmlFor={`rate-${code}`} className="text-xs cursor-pointer flex-1">{RATE_CODE_LABEL[code]}</label>
                              </div>
                            ))}
                            {rateFilter.length > 0 && (
                              <Button variant="ghost" size="sm" className="w-full mt-2 h-6 text-xs" onClick={() => setRateFilter([])}>Clear</Button>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </TableHead>
                    <TableHead className="text-right">Agreement</TableHead>
                    <TableHead className="text-right">Opening</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Closing</TableHead>
                    <TableHead className="text-right">Open advance</TableHead>
                    <TableHead>Dastavej</TableHead>
                    <TableHead className="w-36" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUnits.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center text-muted-foreground py-8 text-sm">
                        No units match the current filters.
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredUnits.map((u) => {
                    const cls = classifyFor(u);
                    const booking = activeBookingFor(u.id);
                    const led = ledgerForAsOf(u, selectedMonth);
                    const openingLed = ledgerForAsOf(u, previousPeriod(selectedMonth));
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
                            {u.onboarding_status === 'CLOSED_PRE_ONBOARDING' && (
                              <Badge variant="outline" className="mt-1 text-[10px]" title="Resolved before this project was onboarded here — no BU/dastavej working is computed for it">
                                Closed pre-onboarding
                              </Badge>
                            )}
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
                          <TableCell className="text-right text-sm tabular-nums">
                            {u.carpet_area_sqm || '—'}
                          </TableCell>
                          <TableCell className="text-sm">
                            {cls.ratePct}%
                            <span className="block text-xs text-muted-foreground">eff. {cls.effectiveRatePct}%</span>
                          </TableCell>
                          <TableCell className="text-right text-sm">{formatINR(agreement)}</TableCell>
                          <TableCell className="text-right text-sm">{formatINR(openingLed.valueTaxed)}</TableCell>
                          <TableCell className="text-right text-sm">
                            {formatINR(led.valueTaxed - openingLed.valueTaxed)}
                          </TableCell>
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
                          <TableCell className="text-sm tabular-nums">
                            {u.dastavej_date || <span className="text-muted-foreground">—</span>}
                          </TableCell>
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
                                  {raisesInvoices && (
                                    <Button variant="ghost" size="icon" title="Raise invoice" onClick={() => openInvoice(u, booking)}>
                                      <FileText className="h-4 w-4" />
                                    </Button>
                                  )}
                                </>
                              )}
                              {canEdit && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7">
                                      <MoreHorizontal className="h-4 w-4" />
                                      <span className="sr-only">More actions for unit {u.unit_no}</span>
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-64">
                                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                      This month
                                    </DropdownMenuLabel>
                                    <DropdownMenuItem
                                      onSelect={() => setSurface({ type: 'dastavej', unitId: u.id, action: 'recordDastavej' })}
                                    >
                                      Record dastavej
                                    </DropdownMenuItem>
                                    {booking && (
                                      <DropdownMenuItem onSelect={() => openEditMembers(u, booking)}>
                                        Edit member{mem.length > 1 ? 's' : ''}
                                        {(mem.length === 0 || mem[0].name === 'To be named') ? ' (name not set)' : ''}
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                      Rare — occasional corrections
                                    </DropdownMenuLabel>
                                    <DropdownMenuItem
                                      onSelect={() => setSurface({ type: 'corrections', unitId: u.id, action: 'creditNote' })}
                                    >
                                      Credit note
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={() => setSurface({ type: 'corrections', unitId: u.id, action: 'bounceReversal' })}
                                    >
                                      Bounce reversal
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={() => setSurface({ type: 'corrections', unitId: u.id, action: 'convert' })}
                                    >
                                      Convert to another unit
                                    </DropdownMenuItem>
                                    {activeBookingFor(u.id) && (
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onSelect={() => setSurface({ type: 'corrections', unitId: u.id, action: 'cancelBooking' })}
                                      >
                                        Cancel booking
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                      Setup
                                    </DropdownMenuLabel>
                                    <DropdownMenuItem
                                      onSelect={() => setSurface({ type: 'masters', unitId: u.id, action: 'editUnit' })}
                                    >
                                      Edit unit &amp; charge heads
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={() => setSurface({ type: 'masters', unitId: u.id, action: 'openingBalance' })}
                                    >
                                      Opening balance
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>

                        {isOpen && (
                          <TableRow>
                            <TableCell colSpan={13} className="bg-muted/30 p-4">
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
                                              <TableHead className="h-8 text-right">Bounced</TableHead>
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
                                                  {/* Bounce as a deduction column, right in the register, rather
                                                      than a status buried in the edit dialog's dropdown: ticking
                                                      it deducts this receipt's full consideration — a bounced
                                                      instrument didn't clear for any partial amount. */}
                                                  <TableCell className="text-xs py-1 text-right">
                                                    {r.cheque_status === 'Bounced' ? (
                                                      <span className="text-red-700 font-medium">
                                                        -{formatINR(r.consideration)}
                                                      </span>
                                                    ) : canEdit ? (
                                                      <div className="flex items-center justify-end gap-1">
                                                        <Checkbox
                                                          className="h-3.5 w-3.5"
                                                          checked={false}
                                                          onCheckedChange={(v) => { if (v) setChequeStatus(r, 'Bounced'); }}
                                                          aria-label={`Mark bounced — deduct ${formatINR(r.consideration)}`}
                                                          title={`Deduct ${formatINR(r.consideration)}`}
                                                        />
                                                      </div>
                                                    ) : (
                                                      <span className="text-muted-foreground">—</span>
                                                    )}
                                                  </TableCell>
                                                  <TableCell className="py-1">
                                                    {canEdit && (
                                                      <div className="flex items-center gap-0.5">
                                                        <Checkbox
                                                          className="mr-1 h-3.5 w-3.5"
                                                          checked={selected.has(r.id)}
                                                          onCheckedChange={() => toggleSelect(r.id)}
                                                          aria-label={`Select receipt of ${formatINR(r.amount_entered)}`}
                                                        />
                                                        <Button
                                                          variant="ghost" size="icon" className="h-6 w-6"
                                                          title="Edit receipt"
                                                          onClick={() => openEditReceipt(u, booking, r)}
                                                        >
                                                          <Pencil className="h-3 w-3" />
                                                        </Button>
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

      <Dialog open={membersDialog} onOpenChange={setMembersDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit member(s) — {membersDialogTarget?.unit.unit_no}</DialogTitle>
            <DialogDescription>
              Renaming here does not change the booking date, consideration, or any receipts/invoices already
              recorded — only who the buyer(s) are on record. Ratios must total 100%.
            </DialogDescription>
          </DialogHeader>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Members</Label>
              <Button
                variant="outline" size="sm"
                onClick={() => setEditMembers([...editMembers, { ...emptyMember, ownership_ratio: '0' }])}
              >
                <Plus className="h-3 w-3 mr-1" /> Add joint holder
              </Button>
            </div>
            <div className="space-y-2">
              {editMembers.map((m, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <Input
                    className="col-span-5" placeholder="Name" value={m.name}
                    onChange={(e) => {
                      const next = [...editMembers]; next[idx] = { ...m, name: e.target.value };
                      setEditMembers(next);
                    }}
                  />
                  <Input
                    className="col-span-4" placeholder="PAN" value={m.pan}
                    onChange={(e) => {
                      const next = [...editMembers]; next[idx] = { ...m, pan: e.target.value.toUpperCase() };
                      setEditMembers(next);
                    }}
                  />
                  <Input
                    className="col-span-2" type="number" step="0.01" placeholder="%"
                    value={m.ownership_ratio}
                    onChange={(e) => {
                      const next = [...editMembers]; next[idx] = { ...m, ownership_ratio: e.target.value };
                      setEditMembers(next);
                    }}
                  />
                  <Button
                    variant="ghost" size="icon" className="col-span-1"
                    disabled={editMembers.length === 1}
                    onClick={() => setEditMembers(editMembers.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Ratios must total 100%. Currently{' '}
              {editMembers.reduce((s, m) => s + (parseFloat(m.ownership_ratio) || 0), 0)}%.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMembersDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveMembers} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Masters / corrections / dastavej surfaces ───────────────────────── */}
      <Dialog open={!!surface.type} onOpenChange={(o) => !o && setSurface({ type: '' })}>
        <DialogContent className="max-w-[95vw] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {surface.type === 'masters' ? 'Units, charge heads & opening balances'
                : surface.type === 'corrections' ? 'Corrections — re-rating, credit notes, bounces, conversions'
                : 'Dastavej register'}
            </DialogTitle>
          </DialogHeader>
          {surface.type === 'masters' && (
            <BuilderProjectDetailPage
              focusUnitId={surface.unitId}
              focusAction={surface.action === 'editUnit' || surface.action === 'openingBalance' ? surface.action : undefined}
            />
          )}
          {surface.type === 'corrections' && (
            <BuilderAdjustmentsPage
              focusUnitId={surface.unitId}
              focusAction={
                surface.action === 'creditNote' || surface.action === 'reRate'
                || surface.action === 'bounceReversal' || surface.action === 'convert'
                || surface.action === 'cancelBooking'
                  ? surface.action : undefined
              }
            />
          )}
          {surface.type === 'dastavej' && (
            <BuilderDastavejPage
              focusProjectId={projectId ?? undefined}
              focusUnit={(() => {
                const u = units.find((x) => x.id === surface.unitId);
                return u ? { id: u.id, unit_no: u.unit_no, dastavej_date: u.dastavej_date, dastavej_value: u.dastavej_value } : undefined;
              })()}
            />
          )}
        </DialogContent>
      </Dialog>

      {project && (
        <BulkReceiptsDialog
          open={bulkReceipts}
          onOpenChange={setBulkReceipts}
          units={bulkReceiptUnits}
          docSeriesPrefix={project.doc_series_prefix}
          defaultMonth={selectedMonth}
          onSaved={load}
        />
      )}

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
              <Label>Period</Label>
              <SearchableMonthSelect
                options={receiptMonthOptions}
                value={receiptForm.receipt_month}
                onValueChange={(v) => setReceiptForm({ ...receiptForm, receipt_month: v })}
                placeholder="Select month"
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

          {receiptTarget?.unit.bu_event_id && (
            <p className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This unit already went through its BU/dastavej differential — its whole balance was taxed
              at that cut-off. "GST already discharged" is switched on by default so this receipt is
              recorded as a plain collection, not taxed a second time. Turn it off only if that's wrong.
            </p>
          )}

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

          {agreementWarning && (
            <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <p>
                  This receipt takes the unit's value taxed to{' '}
                  <strong>{formatINR(agreementWarning.newValueTaxed)}</strong>, beyond its recorded agreement
                  value of <strong>{formatINR(agreementWarning.agreement)}</strong>. If the customer's price
                  has actually increased, <strong>update the unit's value in Unit Master first</strong> — the
                  ₹45 lakh test and the rate are read from it.
                </p>
                {agreementWarning.crosses45L && (
                  <p>
                    It also takes a unit currently taxed as affordable past <strong>₹45,00,000</strong>. Once
                    the master reflects that, the unit is re-rated to 7.5% on everything already taxed
                    automatically, in the month it crosses — no action needed here.
                  </p>
                )}
                {receiptTarget && (
                  <Button
                    variant="outline" size="sm" className="mt-1 h-7"
                    onClick={() => {
                      setReceiptDialog(false);
                      setSurface({ type: 'masters', unitId: receiptTarget.unit.id, action: 'editUnit' });
                    }}
                  >
                    <Pencil className="mr-1.5 h-3 w-3" /> Update unit value now
                  </Button>
                )}
              </div>
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
