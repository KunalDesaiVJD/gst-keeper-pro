/**
 * Record one collection run across many units.
 *
 * The monthly job is not "open unit 101, add a receipt, close, open unit 102".
 * It is a bank statement with thirty credits on it. This turns that into one
 * screen: fix the date and the instrument once, then type down a single amount
 * column. Every row derives its own rate, land deduction and tax as you type,
 * because the rate is a property of the unit, not of the run.
 *
 * Only units with an **active booking** appear. A receipt has to hang off a
 * booking — there is nobody to have paid otherwise — and silently dropping
 * rows at save time would be worse than not offering them.
 *
 * Amounts are saved through the same derivation the single-receipt dialog uses
 * (`deriveReceipt`), so a bulk row and a hand-keyed row are byte-identical.
 * That matters more than it sounds: two paths that compute tax slightly
 * differently is how a reconciliation becomes unexplainable.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Loader2, Wallet, AlertTriangle, Users } from 'lucide-react';
import { formatINR, computeTds194IA, isTds194IAApplicable, type BuilderRateCode } from '@/utils/builderRates';
import { deriveReceipt, prettyPeriodLabel } from '@/utils/builderLedger';
import { recheckStaleScheduleIII } from '@/lib/builderBuPosting';

// Must match the builder_receipts_instrument_type_check DB constraint exactly,
// or every save fails — 'NEFT'/'RTGS'/'IMPS' are NOT valid values there.
const INSTRUMENTS = ['NEFT/RTGS', 'Cheque', 'UPI', 'Cash', 'Bank Transfer', 'Adjustment', 'Other'];

/** One line the caller offers for collection. */
export interface BulkReceiptUnit {
  unitId: string;
  unitNo: string;
  /**
   * The unit's active booking, or null for an unbooked unit. When null, a
   * receipt entered against the unit auto-creates its booking on save — the
   * builder reality being that money received IS the moment of sale, so the
   * booking follows the receipt rather than blocking it.
   */
  bookingId: string | null;
  rateCode: BuilderRateCode;
  ratePct: number;
  /** Agreement value, for the 194-IA threshold test and the auto-booking's total consideration. */
  totalConsideration: number;
  balanceToTax: number;
  /** Joint holders, for the per-member split entry. Empty for an unbooked unit. */
  members: { name: string; ratio: number }[];
  /** Block/Wing/Tower/Phase — units are grouped by this (and by project, if given) rather than listed flat. */
  groupLabel?: string | null;
  /** Set when the caller spans more than one project (a client-wide run). */
  projectName?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  units: BulkReceiptUnit[];
  docSeriesPrefix?: string | null;
  /** The month already selected on the main screen ('MM/YYYY') — the dialog
   *  opens straight onto it rather than asking again. Falls back to the
   *  calendar-current month if not given. */
  defaultMonth?: string | null;
  onSaved: () => void | Promise<void>;
}

const BulkReceiptsDialog: React.FC<Props> = ({
  open, onOpenChange, units, docSeriesPrefix, defaultMonth, onSaved,
}) => {
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);

  // Only the return period matters for tax purposes (period_month, not the
  // exact day) — see dateToPeriod's callers throughout builderBuPosting.ts
  // and builderAdjustments.ts, none of which key off a day-of-month. Staff
  // only ever needs to pick the month; the 1st of it satisfies the schema's
  // NOT NULL receipt_date without asking for a date nobody uses.
  const currentMonth = (() => {
    const d = new Date();
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  })();
  const monthOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = -24; i <= 2; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      out.push({ value: `${mm}/${d.getFullYear()}`, label: prettyPeriodLabel(`${mm}/${d.getFullYear()}`) });
    }
    return out.reverse();
  }, []);
  const monthToIsoDate = (mmYyyy: string): string => {
    const [mm, yyyy] = mmYyyy.split('/');
    return `${yyyy}-${mm}-01`;
  };
  const [common, setCommon] = useState({
    receipt_month: defaultMonth || currentMonth,
    receipt_nature: 'ADVANCE',
    instrument_type: 'NEFT/RTGS',
    amount_is_gst_inclusive: false,
    deduct_tds: false,
  });
  // The dialog stays mounted across opens, so re-sync to whatever month is
  // selected on the main screen each time it opens rather than whatever was
  // left over from the last session.
  useEffect(() => {
    if (open) setCommon((c) => ({ ...c, receipt_month: defaultMonth || currentMonth }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultMonth]);
  /** unitId → typed amount. Absent or blank means "not collected from this unit". */
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [refs, setRefs] = useState<Record<string, string>>({});
  /**
   * A joint unit sometimes arrives as two bank credits, not one — each member
   * paying their own share separately. Splitting lets that be typed as it
   * happened instead of added up by hand first. Tax is still derived once off
   * the sum: 194-IA is a flat 1% of the amount paid, so summing members first
   * and deducting once gives the identical figure as deducting per member and
   * summing after.
   */
  const [splits, setSplits] = useState<Record<string, boolean>>({});
  const [memberAmounts, setMemberAmounts] = useState<Record<string, Record<string, string>>>({});
  const [memberRefs, setMemberRefs] = useState<Record<string, Record<string, string>>>({});
  /** Buyer name for an unbooked unit, captured inline so the auto-created booking has a holder. */
  const [buyerNames, setBuyerNames] = useState<Record<string, string>>({});

  const unitAmountFor = useCallback((u: BulkReceiptUnit) => {
    if (!splits[u.unitId]) return amounts[u.unitId] || '';
    const byMember = memberAmounts[u.unitId] || {};
    const sum = u.members.reduce((s, m) => s + (parseFloat(byMember[m.name] || '') || 0), 0);
    return sum > 0 ? String(sum) : '';
  }, [splits, amounts, memberAmounts]);

  /** One instrument_ref field on the receipt, so a split unit's several references are joined. */
  const unitRefFor = useCallback((u: BulkReceiptUnit) => {
    if (!splits[u.unitId]) return refs[u.unitId] || '';
    const byRef = memberRefs[u.unitId] || {};
    return u.members
      .map((m) => (byRef[m.name] || '').trim())
      .filter(Boolean)
      .join(' · ');
  }, [splits, refs, memberRefs]);

  const rows = useMemo(() => units.map((u) => {
    const entered = parseFloat(unitAmountFor(u)) || 0;
    if (entered <= 0) return { u, entered, derived: null, tds: 0 };
    const tdsApplies = common.deduct_tds && isTds194IAApplicable(u.totalConsideration);
    const tds = tdsApplies ? computeTds194IA(u.totalConsideration, entered) : 0;
    const derived = deriveReceipt({
      amountEntered: entered,
      amountIsGstInclusive: common.amount_is_gst_inclusive,
      rateCode: u.rateCode,
      tds194ia: tds,
      bankCredit: null,
    });
    return { u, entered, derived, tds };
  }), [units, unitAmountFor, common.amount_is_gst_inclusive, common.deduct_tds]);

  const active = rows.filter((r) => r.entered > 0);
  const totals = active.reduce((t, r) => ({
    entered: t.entered + r.entered,
    consideration: t.consideration + (r.derived?.tax.consideration || 0),
    cgst: t.cgst + (r.derived?.tax.cgst || 0),
    sgst: t.sgst + (r.derived?.tax.sgst || 0),
    tds: t.tds + r.tds,
  }), { entered: 0, consideration: 0, cgst: 0, sgst: 0, tds: 0 });

  /** Units taking more than their remaining balance — worth flagging, not blocking. */
  const overCollected = active.filter((r) => (r.derived?.tax.consideration || 0) > r.u.balanceToTax);

  /**
   * Block/Phase-wise sections instead of one flat list — essential once a
   * project (or a client-wide run across several) has more than a handful of
   * units. Only turned on when there is actually more than one group, so a
   * small single-block project stays a plain list.
   */
  const groupKeyOf = (u: BulkReceiptUnit) => `${u.projectName ?? ''}::${u.groupLabel ?? 'Ungrouped'}`;
  const groupLabelOf = (u: BulkReceiptUnit) => [u.projectName, u.groupLabel || 'Ungrouped'].filter(Boolean).join(' — ');
  const hasGrouping = useMemo(() => new Set(units.map(groupKeyOf)).size > 1, [units]);
  const groupTotals = useMemo(() => {
    const map = new Map<string, { count: number; entered: number }>();
    rows.forEach((r) => {
      const key = groupKeyOf(r.u);
      const cur = map.get(key) || { count: 0, entered: 0 };
      map.set(key, { count: cur.count + (r.entered > 0 ? 1 : 0), entered: cur.entered + r.entered });
    });
    return map;
  }, [rows]);

  /**
   * Every visible amount box — unit-level or, once split, per-member — in the
   * order it's drawn, so Enter and paste both walk the grid top to bottom
   * regardless of which rows happen to be expanded this render.
   */
  const amountRefs = useRef<(HTMLInputElement | null)[]>([]);
  const orderMeta: { unitId: string; member: string | null }[] = [];
  let orderIndex = 0;
  const registerAmount = (unitId: string, member: string | null) => {
    const idx = orderIndex;
    orderIndex += 1;
    orderMeta[idx] = { unitId, member };
    return {
      ref: (el: HTMLInputElement | null) => { amountRefs.current[idx] = el; },
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        amountRefs.current[idx + 1]?.focus();
      },
      onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => {
        const text = e.clipboardData.getData('text');
        const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (lines.length <= 1) return; // a single value pastes the normal way
        e.preventDefault();
        lines.forEach((val, k) => {
          const meta = orderMeta[idx + k];
          if (!meta) return;
          const cleaned = val.replace(/[^0-9.]/g, '');
          if (meta.member) {
            setMemberAmounts((prev) => ({
              ...prev,
              [meta.unitId]: { ...(prev[meta.unitId] || {}), [meta.member as string]: cleaned },
            }));
          } else {
            setAmounts((prev) => ({ ...prev, [meta.unitId]: cleaned }));
          }
        });
        const lastIdx = idx + lines.length - 1;
        requestAnimationFrame(() => amountRefs.current[lastIdx]?.focus());
      },
    };
  };

  const handleSave = async () => {
    if (!active.length) return;
    setIsSaving(true);
    try {
      const period = common.receipt_month;
      const receiptDate = monthToIsoDate(period);

      // A receipt has to hang off a booking, so any unbooked unit that received
      // money is booked here first — money in is the moment of sale. The booking
      // takes the unit's agreement value as its consideration and a single
      // primary holder, named inline or left "To be named" to complete later.
      const bookingIdByUnit: Record<string, string> = {};
      const autoBookedUnitIds: string[] = [];
      let autoBooked = 0;
      for (const r of active) {
        if (r.u.bookingId) { bookingIdByUnit[r.u.unitId] = r.u.bookingId; continue; }
        const { data: bk, error: bErr } = await supabase.from('builder_bookings').insert({
          unit_id: r.u.unitId,
          booking_date: receiptDate,
          total_consideration: r.u.totalConsideration || 0,
          status: 'Active',
          created_by: user?.id ?? null,
        }).select('id').single();
        if (bErr || !bk) throw new Error(bErr?.message || 'Could not create the booking');
        const { error: mErr } = await supabase.from('builder_booking_members').insert({
          booking_id: bk.id,
          name: (buyerNames[r.u.unitId] || '').trim() || 'To be named',
          pan: null,
          ownership_ratio: 100,
          is_primary: true,
          sort_order: 0,
        });
        if (mErr) throw mErr;
        await supabase.from('builder_units').update({ status: 'Booked' }).eq('id', r.u.unitId);
        bookingIdByUnit[r.u.unitId] = bk.id;
        autoBookedUnitIds.push(r.u.unitId);
        autoBooked += 1;
      }

      const { data, error } = await supabase.from('builder_receipts').insert(
        active.map((r) => ({
          booking_id: bookingIdByUnit[r.u.unitId],
          unit_id: r.u.unitId,
          receipt_date: receiptDate,
          receipt_nature: common.receipt_nature,
          amount_entered: r.entered,
          amount_is_gst_inclusive: common.amount_is_gst_inclusive,
          consideration: r.derived!.tax.consideration,
          rate_code: r.u.rateCode,
          rate_pct: r.derived!.tax.ratePct,
          taxable_value: r.derived!.tax.taxableValue,
          cgst: r.derived!.tax.cgst,
          sgst: r.derived!.tax.sgst,
          tds_194ia: r.tds,
          bank_credit: null,
          instrument_type: common.instrument_type,
          instrument_ref: unitRefFor(r.u).trim() || null,
          cheque_status: 'Cleared',
          gst_already_discharged: false,
          period_month: period,
          doc_series: docSeriesPrefix ?? null,
          doc_no: null,
          created_by: user?.id ?? null,
        })),
      ).select('id');
      if (error) throw error;
      if (!data || !data.length) {
        throw new Error('Write was rejected by the database (no rows returned).');
      }
      toast.success(
        `${data.length} receipt${data.length === 1 ? '' : 's'} recorded for ${prettyPeriodLabel(period)}`
        + (autoBooked ? `; ${autoBooked} unit${autoBooked === 1 ? '' : 's'} auto-booked` : '') + '.',
      );
      setAmounts({}); setRefs({}); setSplits({}); setMemberAmounts({}); setMemberRefs({}); setBuyerNames({});
      onOpenChange(false);
      await onSaved();
      // Any of these fresh bookings may prove a unit already frozen
      // Schedule III off its dastavej/BU was actually booked before that
      // cut-off all along — self-heals that, silently, for whichever apply.
      if (autoBookedUnitIds.length) {
        Promise.allSettled(
          autoBookedUnitIds.map((unitId) => recheckStaleScheduleIII({ unitId, userId: user?.id ?? null })),
        ).then((results) => {
          const reclassified = results.filter((r) => r.status === 'fulfilled' && r.value === 'RECLASSIFIED').length;
          if (reclassified > 0) {
            toast.info(`${reclassified} unit${reclassified === 1 ? '' : 's'} re-checked and no longer Schedule III.`);
            void onSaved();
          }
        });
      }
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Record receipts across units
          </DialogTitle>
          <DialogDescription>
            Set the date and instrument once, then type down the amount column — <kbd className="rounded border px-1 text-[10px]">Enter</kbd> moves
            to the next unit, and pasting a copied column fills it straight down. An <strong>unbooked</strong> unit
            you collect against is booked automatically on save (name the buyer inline, or fill it in later).
            A joint unit paid in more than one transfer can be split by member instead of added up by hand.
          </DialogDescription>
        </DialogHeader>

        {/* Common to the whole run. */}
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label className="mb-1.5 block text-xs">Period</Label>
            <SearchableMonthSelect
              options={monthOptions}
              value={common.receipt_month}
              onValueChange={(v) => setCommon({ ...common, receipt_month: v })}
              placeholder="Select month"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Only the return period matters here — no exact date needed.
            </p>
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Nature</Label>
            <Select
              value={common.receipt_nature}
              onValueChange={(v) => setCommon({ ...common, receipt_nature: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ADVANCE">Advance — taxable on receipt</SelectItem>
                <SelectItem value="AGAINST_INVOICE">Against an invoice — no fresh tax</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Instrument</Label>
            <Select
              value={common.instrument_type}
              onValueChange={(v) => setCommon({ ...common, instrument_type: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INSTRUMENTS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 pt-5">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={common.amount_is_gst_inclusive}
                onCheckedChange={(v) => setCommon({ ...common, amount_is_gst_inclusive: v === true })}
              />
              Amounts include GST
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={common.deduct_tds}
                onCheckedChange={(v) => setCommon({ ...common, deduct_tds: v === true })}
              />
              Members deducted 194-IA
            </label>
          </div>
        </div>

        {overCollected.length > 0 && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            {overCollected.length} unit{overCollected.length === 1 ? '' : 's'} would be collected
            beyond the balance still to be taxed ({overCollected.map((r) => r.u.unitNo).join(', ')}).
            That is legitimate where the customer's price has increased — but update that unit's value in
            Unit Master first, so the ₹45 lakh test and rate stay correct (a residential unit crossing
            ₹45,00,000 is re-rated on everything already taxed).
          </p>
        )}

        <div className="max-h-[46vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>Unit</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead className="text-right">Balance to tax</TableHead>
                <TableHead className="w-40 text-right">Amount</TableHead>
                <TableHead className="text-right">Consideration</TableHead>
                <TableHead className="text-right">CGST</TableHead>
                <TableHead className="text-right">SGST</TableHead>
                {common.deduct_tds && <TableHead className="text-right">TDS</TableHead>}
                <TableHead className="w-36">Reference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, idx) => {
                const isSplit = !!splits[r.u.unitId];
                const hasJoint = r.u.members.length > 1;
                const colCount = common.deduct_tds ? 9 : 8;
                const groupKey = groupKeyOf(r.u);
                const showGroupHeader = hasGrouping && (idx === 0 || groupKeyOf(rows[idx - 1].u) !== groupKey);
                const gt = groupTotals.get(groupKey);
                return (
                  <React.Fragment key={r.u.unitId}>
                    {showGroupHeader && (
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableCell colSpan={colCount} className="py-1.5 text-xs font-semibold text-muted-foreground">
                          {groupLabelOf(r.u)}
                          {gt && gt.count > 0 && (
                            <span className="ml-2 font-normal">
                              ({gt.count} collected, {formatINR(gt.entered)})
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                    <TableRow className={r.entered > 0 ? 'bg-primary/5' : undefined}>
                      <TableCell className="font-medium">
                        {r.u.unitNo}
                        {hasJoint && (
                          <span className="block text-xs text-muted-foreground">
                            {r.u.members[0].name} +{r.u.members.length - 1} joint
                          </span>
                        )}
                        {!r.u.bookingId && (
                          r.entered > 0 ? (
                            <Input
                              className="mt-1 h-6 text-xs"
                              value={buyerNames[r.u.unitId] || ''}
                              onChange={(e) => setBuyerNames({ ...buyerNames, [r.u.unitId]: e.target.value })}
                              placeholder="Buyer name (optional)"
                            />
                          ) : (
                            <span className="block text-[10px] text-muted-foreground">Unbooked — books on save</span>
                          )
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{r.u.ratePct}%</Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {formatINR(r.u.balanceToTax)}
                      </TableCell>
                      <TableCell>
                        {!isSplit ? (
                          <>
                            <Input
                              {...registerAmount(r.u.unitId, null)}
                              inputMode="decimal"
                              className="h-8 text-right tabular-nums"
                              value={amounts[r.u.unitId] || ''}
                              onChange={(e) => setAmounts({ ...amounts, [r.u.unitId]: e.target.value })}
                              placeholder="—"
                            />
                            {hasJoint && (
                              <button
                                type="button"
                                className="mt-1 flex w-full items-center justify-end gap-1 text-xs font-medium text-primary hover:underline"
                                onClick={() => setSplits((prev) => ({ ...prev, [r.u.unitId]: true }))}
                              >
                                <Users className="h-3 w-3" /> split by member
                              </button>
                            )}
                          </>
                        ) : (
                          <button
                            type="button"
                            className="flex w-full items-center justify-end gap-1 text-xs font-medium text-primary hover:underline"
                            onClick={() => setSplits((prev) => ({ ...prev, [r.u.unitId]: false }))}
                          >
                            {r.entered > 0 ? formatINR(r.entered) : 'split'} · {r.u.members.length} members
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {r.derived ? formatINR(r.derived.tax.consideration) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {r.derived ? formatINR(r.derived.tax.cgst) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {r.derived ? formatINR(r.derived.tax.sgst) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      {common.deduct_tds && (
                        <TableCell className="text-right text-sm tabular-nums">
                          {r.tds ? formatINR(r.tds) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      )}
                      <TableCell>
                        {!isSplit ? (
                          <Input
                            className="h-8 text-xs"
                            value={refs[r.u.unitId] || ''}
                            onChange={(e) => setRefs({ ...refs, [r.u.unitId]: e.target.value })}
                            placeholder="UTR / chq"
                            disabled={r.entered <= 0}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">per member</span>
                        )}
                      </TableCell>
                    </TableRow>

                    {isSplit && (
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={colCount} className="py-2 pl-8">
                          <div className="space-y-1.5">
                            {r.u.members.map((m) => (
                              <div key={m.name} className="grid grid-cols-[1fr_140px_140px] items-center gap-3">
                                <span className="text-xs text-muted-foreground">
                                  {m.name} <span className="text-[10px]">({m.ratio}%)</span>
                                </span>
                                <Input
                                  {...registerAmount(r.u.unitId, m.name)}
                                  inputMode="decimal"
                                  className="h-7 text-right text-xs tabular-nums"
                                  value={(memberAmounts[r.u.unitId] || {})[m.name] || ''}
                                  onChange={(e) => setMemberAmounts((prev) => ({
                                    ...prev,
                                    [r.u.unitId]: { ...(prev[r.u.unitId] || {}), [m.name]: e.target.value },
                                  }))}
                                  placeholder="—"
                                />
                                <Input
                                  className="h-7 text-xs"
                                  value={(memberRefs[r.u.unitId] || {})[m.name] || ''}
                                  onChange={(e) => setMemberRefs((prev) => ({
                                    ...prev,
                                    [r.u.unitId]: { ...(prev[r.u.unitId] || {}), [m.name]: e.target.value },
                                  }))}
                                  placeholder="UTR / chq"
                                />
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="font-semibold">
                  {active.length} of {units.length} units
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatINR(totals.entered)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatINR(totals.consideration)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatINR(totals.cgst)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatINR(totals.sgst)}</TableCell>
                {common.deduct_tds && (
                  <TableCell className="text-right font-semibold tabular-nums">{formatINR(totals.tds)}</TableCell>
                )}
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={isSaving || !active.length}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record {active.length || ''} receipt{active.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkReceiptsDialog;
