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

import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Loader2, Wallet, AlertTriangle, Users } from 'lucide-react';
import { formatINR, computeTds194IA, isTds194IAApplicable, type BuilderRateCode } from '@/utils/builderRates';
import { deriveReceipt, dateToPeriod, prettyPeriodLabel } from '@/utils/builderLedger';

const INSTRUMENTS = ['NEFT', 'RTGS', 'IMPS', 'Cheque', 'Cash', 'UPI', 'Other'];

/** One line the caller offers for collection. */
export interface BulkReceiptUnit {
  unitId: string;
  unitNo: string;
  bookingId: string;
  rateCode: BuilderRateCode;
  ratePct: number;
  /** Agreement value, for the 194-IA threshold test. */
  totalConsideration: number;
  balanceToTax: number;
  /** Joint holders, for the per-member split entry. A solo booking has one. */
  members: { name: string; ratio: number }[];
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  units: BulkReceiptUnit[];
  docSeriesPrefix?: string | null;
  onSaved: () => void | Promise<void>;
}

const BulkReceiptsDialog: React.FC<Props> = ({
  open, onOpenChange, units, docSeriesPrefix, onSaved,
}) => {
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const [common, setCommon] = useState({
    receipt_date: today,
    receipt_nature: 'ADVANCE',
    instrument_type: 'NEFT',
    amount_is_gst_inclusive: false,
    deduct_tds: false,
  });
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
      const period = dateToPeriod(common.receipt_date);
      const { data, error } = await supabase.from('builder_receipts').insert(
        active.map((r) => ({
          booking_id: r.u.bookingId,
          unit_id: r.u.unitId,
          receipt_date: common.receipt_date,
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
        `${data.length} receipt${data.length === 1 ? '' : 's'} recorded for ${prettyPeriodLabel(period)}.`,
      );
      setAmounts({}); setRefs({}); setSplits({}); setMemberAmounts({}); setMemberRefs({});
      onOpenChange(false);
      await onSaved();
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
            to the next unit, and pasting a copied column fills it straight down. Only units with an
            active booking are listed, because a receipt has to hang off one. A joint unit paid in
            more than one transfer can be split by member instead of added up by hand.
          </DialogDescription>
        </DialogHeader>

        {/* Common to the whole run. */}
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label className="mb-1.5 block text-xs">Receipt date</Label>
            <Input
              type="date" value={common.receipt_date}
              onChange={(e) => setCommon({ ...common, receipt_date: e.target.value })}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Period {prettyPeriodLabel(dateToPeriod(common.receipt_date))}
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
            That is legitimate where the agreement value has changed — but worth a look first.
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
              {rows.map((r) => {
                const isSplit = !!splits[r.u.unitId];
                const hasJoint = r.u.members.length > 1;
                const colCount = common.deduct_tds ? 9 : 8;
                return (
                  <React.Fragment key={r.u.unitId}>
                    <TableRow className={r.entered > 0 ? 'bg-primary/5' : undefined}>
                      <TableCell className="font-medium">
                        {r.u.unitNo}
                        {hasJoint && (
                          <span className="block text-xs text-muted-foreground">
                            {r.u.members[0].name} +{r.u.members.length - 1} joint
                          </span>
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
