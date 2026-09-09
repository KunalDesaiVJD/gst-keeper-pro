import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { PageHeader } from '@/components/layout/PageHeader';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { HandCoins, Plus, Loader2, Trash2, Pencil, Wand2, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import {
  fetchAdvanceLedger, keyOf, parseKey, describeKey, periodOrdinal, mmYyyyToShort,
  type AdvanceLedger,
} from '@/lib/advanceBalance';
import {
  fetchRegister, receiptPositions, registerClosingByKey, reconcileRegister,
  suggestAllocation, buildTxpdFromLegs, saveReceipt, deleteReceipt, saveAdjustments,
  receiptKey, taxForRate,
  type AdvanceReceipt, type ReceiptPosition, type RegisterData,
} from '@/lib/advanceRegister';
import ReceiptFormDialog from '@/components/advances/ReceiptFormDialog';
import ContractProjectsPanel from '@/components/advances/ContractProjectsPanel';

interface Client { id: string; name: string; gstin: string; regular_sub_type?: string | null }

const inr = (n: number) => (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Ageing bucket for an advance open since `since`, as at `now`. */
const ageBucket = (since: string | null, now: string): string => {
  if (!since) return '—';
  const m = periodOrdinal(now) - periodOrdinal(since);
  if (!Number.isFinite(m)) return '—';
  if (m < 3) return '0-3 m';
  if (m < 6) return '3-6 m';
  if (m < 12) return '6-12 m';
  return '> 12 m';
};

const AdvancesPage: React.FC = () => {
  const { user, canManageAdvanceRegister } = useAuth();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const { selectedClientId: selectedClient, setSelectedClientId: setSelectedClient } = useClient();
  const confirm = useConfirm();
  const canEdit = canManageAdvanceRegister();

  const [clients, setClients] = useState<Client[]>([]);
  const [ledger, setLedger] = useState<AdvanceLedger | null>(null);
  const [register, setRegister] = useState<RegisterData>({ receipts: [], adjustments: [] });
  const [loading, setLoading] = useState(false);
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdvanceReceipt | null>(null);

  // Firm-wide board.
  const [board, setBoard] = useState<{ client: Client; open: number; oldest: string | null }[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);

  const selected = clients.find((c) => c.id === selectedClient) || null;
  const isBuilder = selected?.regular_sub_type === 'Builder';
  // The projects layer is unlocked by the client's sub-type, the same way the
  // Builder module is — a contractor's advance is recovered per project, so
  // without one there is nothing to scope the recovery schedule to.
  const isContractor = selected?.regular_sub_type === 'Contractor';
  const homeState = (selected?.gstin || '').slice(0, 2);

  const monthOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    for (let d = new Date(2024, 3, 1); d <= new Date(now.getFullYear(), now.getMonth() + 12, 1); d.setMonth(d.getMonth() + 1)) {
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      out.push({ value: `${mm}/${d.getFullYear()}`, label: `${names[d.getMonth()]} ${d.getFullYear()}` });
    }
    return out;
  }, []);

  useEffect(() => {
    supabase.from('clients').select('id, name, gstin, regular_sub_type').order('name')
      .then(({ data }) => setClients((data || []) as Client[]));
  }, []);

  const load = useCallback(async () => {
    if (!selectedClient || !selected?.gstin || !selectedMonth) { setLedger(null); return; }
    setLoading(true);
    try {
      const [l, reg] = await Promise.all([
        fetchAdvanceLedger({ clientId: selectedClient, gstin: selected.gstin, upto: selectedMonth }),
        fetchRegister(selectedClient),
      ]);
      setLedger(l);
      setRegister(reg);
    } catch (e) {
      toast.error(`Could not load the advance ledger: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [selectedClient, selected?.gstin, selectedMonth]);

  useEffect(() => { load(); }, [load]);

  const positions = useMemo(
    () => receiptPositions(register.receipts, register.adjustments),
    [register],
  );
  const openPositions = useMemo(() => positions.filter((p) => p.open > 0), [positions]);

  const reconciliation = useMemo(() => {
    if (!ledger) return [];
    if (register.receipts.length === 0) return [];
    return reconcileRegister(
      registerClosingByKey(register.receipts, register.adjustments, selectedMonth),
      ledger.closingByKey,
    );
  }, [ledger, register, selectedMonth]);

  // --- firm-wide board --------------------------------------------------
  const loadBoard = useCallback(async () => {
    setBoardLoading(true);
    try {
      // Sequential rather than one big Promise.all: each client's ledger reads
      // that client's whole GSTR-1 history, and firing 200 of those at once is
      // how you get rate-limited rather than fast.
      const rows: { client: Client; open: number; oldest: string | null }[] = [];
      for (const c of clients) {
        if (!c.gstin) continue;
        const l = await fetchAdvanceLedger({ clientId: c.id, gstin: c.gstin, upto: selectedMonth });
        if (l.closingTotal.taxable > 1) {
          rows.push({ client: c, open: l.closingTotal.taxable, oldest: l.oldestOpenPeriod });
        }
      }
      rows.sort((a, b) => b.open - a.open);
      setBoard(rows);
    } catch (e) {
      toast.error(`Could not build the board: ${(e as Error).message}`);
    } finally {
      setBoardLoading(false);
    }
  }, [clients, selectedMonth]);

  // --- set-off workspace -------------------------------------------------
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [invoiceNo, setInvoiceNo] = useState('');
  const [applying, setApplying] = useState(false);

  const suggestFor = (p: ReceiptPosition) => {
    // Suggest the whole open balance of this receipt; the operator trims it
    // where the invoice only partly relates to the advance.
    setAlloc((a) => ({ ...a, [p.receipt.id]: String(p.open) }));
  };

  const suggestAll = () => {
    const next: Record<string, string> = {};
    const byKey = new Map<string, number>();
    openPositions.forEach((p) => {
      const k = keyOf(receiptKey(p.receipt));
      byKey.set(k, (byKey.get(k) || 0) + p.open);
    });
    byKey.forEach((total, k) => {
      suggestAllocation(openPositions, parseKey(k), total).forEach((a) => { next[a.receiptId] = String(a.amount); });
    });
    setAlloc(next);
    toast.message('Oldest advances allocated first. Adjust any line before recording.');
  };

  const allocTotal = useMemo(
    () => r2(Object.values(alloc).reduce((t, v) => t + (Number(v) || 0), 0)),
    [alloc],
  );

  const recordSetoff = async () => {
    const legs = Object.entries(alloc)
      .map(([receiptId, raw]) => ({ receiptId, amount: Number(raw) || 0 }))
      .filter((l) => l.amount > 0);
    if (legs.length === 0) { toast.error('Nothing allocated.'); return; }

    const over = legs.find((l) => {
      const p = positions.find((x) => x.receipt.id === l.receiptId);
      return p ? l.amount - p.open > 0.5 : false;
    });
    if (over) {
      // Adjusting more than is open reverses tax that was never paid — a short
      // payment. Refused here rather than left for the pre-filing gate.
      toast.error('One line adjusts more than that receipt has open. Reduce it before recording.');
      return;
    }

    setApplying(true);
    try {
      await saveAdjustments(
        legs.map((l) => {
          const p = positions.find((x) => x.receipt.id === l.receiptId)!;
          const tax = taxForRate(l.amount, Number(p.receipt.rate_pct), p.receipt.sply_ty);
          return {
            receipt_id: l.receiptId,
            client_id: selectedClient!,
            invoice_no: invoiceNo.trim(),
            period_month: selectedMonth,
            rate_pct: Number(p.receipt.rate_pct),
            consideration_adjusted: l.amount,
            taxable_value_adjusted: l.amount,
            igst: tax.igst, cgst: tax.cgst, sgst: tax.sgst, cess: 0,
            reason: 'INVOICE' as const,
          };
        }),
        { id: user?.id || null, name: user?.firstName || user?.email || 'Unknown' },
      );
      setAlloc({});
      setInvoiceNo('');
      await load();
      toast.success('Set-off recorded. Write it to the GSTR-1 draft when the return is ready.');
    } catch (e) {
      toast.error(`Could not record the set-off: ${(e as Error).message}`);
    } finally {
      setApplying(false);
    }
  };

  /** Write this period's register legs into the GSTR-1 draft as Table 11B. */
  const writeToGstr1 = async () => {
    if (!selectedClient || !selectedMonth) return;
    const txpd = buildTxpdFromLegs(register.receipts, register.adjustments, selectedMonth);
    if (txpd.length === 0) { toast.error('No set-off legs recorded for this period yet.'); return; }
    const shortMonth = mmYyyyToShort(selectedMonth);
    const { data } = await supabase.from('gstr1_data').select('raw_json')
      .eq('client_id', selectedClient).eq('period_month', shortMonth).maybeSingle();
    if (!data) {
      toast.error(`No GSTR-1 draft exists for ${selectedMonth}. Import or build it first.`);
      return;
    }
    const ok = await confirm({
      title: 'Write Table 11B into the GSTR-1 draft?',
      description:
        `Table 11B for ${selectedMonth} will be replaced with the ${txpd.length} group(s) derived from the `
        + 'register. Anything already in Table 11B for this period is overwritten. Nothing is filed by this.',
      confirmText: 'Write Table 11B',
    });
    if (!ok) return;
    const next = { ...((data as { raw_json?: Record<string, unknown> }).raw_json || {}), txpd };
    const { error } = await supabase.from('gstr1_data')
      .update({ raw_json: next as never, updated_at: new Date().toISOString() })
      .eq('client_id', selectedClient).eq('period_month', shortMonth);
    if (error) { toast.error(`Could not write to the draft: ${error.message}`); return; }
    toast.success('Table 11B written to the GSTR-1 draft.');
  };

  const onSaveReceipt = async (values: Partial<AdvanceReceipt>) => {
    try {
      await saveReceipt(
        { ...values, client_id: selectedClient! } as Partial<AdvanceReceipt> & { client_id: string },
        { id: user?.id || null, name: user?.firstName || user?.email || 'Unknown' },
      );
      await load();
      toast.success(values.id ? 'Receipt updated.' : 'Receipt added.');
    } catch (e) {
      toast.error(`Could not save the receipt: ${(e as Error).message}`);
      throw e;
    }
  };

  const removeReceipt = async (p: ReceiptPosition) => {
    const ok = await confirm({
      title: 'Delete this receipt voucher?',
      description: p.legs.length
        ? `This receipt has ${p.legs.length} set-off leg(s) recorded against it. Deleting it removes those too.`
        : 'This cannot be undone.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteReceipt(p.receipt.id);
      await load();
      toast.success('Receipt deleted.');
    } catch (e) {
      toast.error(`Could not delete: ${(e as Error).message}`);
    }
  };

  const clientOptions = clients.map((c) => ({ value: c.id, label: c.name }));

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Advances"
        subtitle="Advance received, its set-off against invoices, and the open position month by month"
        icon={<HandCoins className="h-5 w-5" />}
      />

      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Client:</span>
            <SearchableSelect
              options={clientOptions}
              value={selectedClient || ''}
              onValueChange={setSelectedClient}
              placeholder="Select client"
              className="w-64"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Month:</span>
            <SearchableMonthSelect
              options={monthOptions}
              value={selectedMonth}
              onValueChange={setSelectedMonth}
              className="w-40"
            />
          </div>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {ledger && (
            <div className="ml-auto text-sm">
              <span className="text-muted-foreground">Open advance </span>
              <span className="font-bold tabular-nums text-primary">₹{inr(ledger.closingTotal.taxable)}</span>
              {ledger.oldestOpenPeriod && (
                <span className="text-muted-foreground"> · oldest {ledger.oldestOpenPeriod} ({ageBucket(ledger.oldestOpenPeriod, selectedMonth)})</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Builders are out of scope by construction — their advances are
          generated and balanced by the Builder module (§1 of the doc). Saying
          so plainly beats showing an empty ledger that looks like a bug. */}
      {isBuilder && (
        <Card className="border-info/40 bg-info/5">
          <CardContent className="p-4 text-sm">
            <p className="font-semibold text-foreground">Managed by the Builder module</p>
            <p className="text-muted-foreground mt-1">
              This client&apos;s advances come from bookings and receipts in the Builder module, where Table 11A and
              11B are generated and balanced automatically. The register here is not used for promoter clients.
            </p>
          </CardContent>
        </Card>
      )}

      {!isBuilder && (
        <Tabs defaultValue="ledger">
          <TabsList>
            <TabsTrigger value="ledger">Ledger</TabsTrigger>
            <TabsTrigger value="register">Register</TabsTrigger>
            <TabsTrigger value="setoff">Set-off</TabsTrigger>
            {isContractor && <TabsTrigger value="projects">Projects</TabsTrigger>}
            <TabsTrigger value="board" onClick={() => { if (board.length === 0) loadBoard(); }}>All clients</TabsTrigger>
          </TabsList>

          {/* ---------------- Ledger ---------------- */}
          <TabsContent value="ledger">
            <Card>
              <CardContent className="p-4">
                {!ledger || ledger.months.length === 0 ? (
                  <TableEmptyState title="No advance activity in the imported returns for this client." />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-primary hover:bg-primary">
                        <TableHead className="text-primary-foreground font-bold">Period</TableHead>
                        <TableHead className="text-primary-foreground font-bold text-right">Opening</TableHead>
                        <TableHead className="text-primary-foreground font-bold text-right">11A received</TableHead>
                        <TableHead className="text-primary-foreground font-bold text-right">11B adjusted</TableHead>
                        <TableHead className="text-primary-foreground font-bold text-right">Closing</TableHead>
                        <TableHead className="text-primary-foreground font-bold">Amended</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledger.months.map((m) => (
                        <TableRow key={m.period}>
                          <TableCell className="font-medium">{m.period}</TableCell>
                          <TableCell className="text-right tabular-nums">{inr(m.opening.taxable)}</TableCell>
                          <TableCell className="text-right tabular-nums">{inr(m.effective.received.taxable)}</TableCell>
                          <TableCell className="text-right tabular-nums">{inr(m.effective.adjusted.taxable)}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{inr(m.closing.taxable)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {m.amended
                              ? `Restated in ${m.amendedIn.join(', ')} (11A ${m.differential.received.taxable >= 0 ? '+' : ''}${inr(m.differential.received.taxable)})`
                              : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                {ledger?.hasAmendments && (
                  <p className="text-xs text-muted-foreground mt-3">
                    Amended rows show the <strong>restated</strong> figure — a Table 11(2) amendment replaces the
                    month it corrects rather than adding to it. The differential in brackets is what belongs in
                    GSTR-3B Adjustments for that correction.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Register ---------------- */}
          <TabsContent value="register">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-muted-foreground max-w-2xl">
                    Receipt vouchers and the invoices that absorbed them. GSTR-1 Table 11A carries only place of
                    supply and rate, so this is the only place the party and invoice behind an advance are recorded.
                  </p>
                  {canEdit && selectedClient && (
                    <Button size="sm" onClick={() => { setEditing(null); setReceiptDialogOpen(true); }}>
                      <Plus className="h-3.5 w-3.5 mr-1.5" /> Add receipt
                    </Button>
                  )}
                </div>

                {reconciliation.length > 0 && (
                  <div className="rounded-md border border-warning/40 bg-warning/5 p-3 mb-3 text-xs">
                    <p className="font-semibold text-foreground">Register does not agree with the filed returns</p>
                    {reconciliation.map((row) => (
                      <p key={row.key} className="text-muted-foreground mt-1">
                        {row.label}: register ₹{inr(row.register)} vs returns ₹{inr(row.filed)} — difference ₹{inr(Math.abs(row.difference))}
                      </p>
                    ))}
                  </div>
                )}

                {positions.length === 0 ? (
                  <TableEmptyState title="No receipt vouchers recorded for this client yet." />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-primary hover:bg-primary">
                        <TableHead className="text-primary-foreground font-bold">Receipt</TableHead>
                        <TableHead className="text-primary-foreground font-bold">Date</TableHead>
                        <TableHead className="text-primary-foreground font-bold">Party</TableHead>
                        <TableHead className="text-primary-foreground font-bold">POS / Rate</TableHead>
                        <TableHead className="text-primary-foreground font-bold text-right">Taxable</TableHead>
                        <TableHead className="text-primary-foreground font-bold text-right">Adjusted</TableHead>
                        <TableHead className="text-primary-foreground font-bold text-right">Open</TableHead>
                        <TableHead className="text-primary-foreground font-bold">Status</TableHead>
                        {canEdit && <TableHead className="text-primary-foreground font-bold w-20" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {positions.map((p) => (
                        <TableRow key={p.receipt.id}>
                          <TableCell className="font-medium">{p.receipt.receipt_no || '—'}</TableCell>
                          <TableCell>{p.receipt.receipt_date}</TableCell>
                          <TableCell className="max-w-[200px] truncate">{p.receipt.party_name || p.receipt.party_gstin || '—'}</TableCell>
                          <TableCell className="text-xs">{p.receipt.pos} @ {p.receipt.rate_pct}%</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {p.receipt.supply_nature === 'GOODS' ? <span className="text-muted-foreground text-xs">Goods — not taxable</span> : inr(p.receipt.taxable_value)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{inr(p.adjusted)}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{inr(p.open)}</TableCell>
                          {/* Status is a word, not a colour — these tables get printed. */}
                          <TableCell className="text-xs">{p.derivedStatus}</TableCell>
                          {canEdit && (
                            <TableCell>
                              <div className="flex gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(p.receipt); setReceiptDialogOpen(true); }}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeReceipt(p)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Set-off ---------------- */}
          <TabsContent value="setoff">
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Set off open advances against an invoice</p>
                    <p className="text-xs text-muted-foreground max-w-2xl mt-0.5">
                      Recorded against {selectedMonth}. Legs recorded here become this period&apos;s Table 11B —
                      write them into the GSTR-1 draft once the return is ready.
                    </p>
                  </div>
                  <div className="flex items-end gap-2">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Invoice no.</label>
                      <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} className="w-40 h-9" placeholder="INV-001" />
                    </div>
                    <Button variant="outline" size="sm" onClick={suggestAll} disabled={openPositions.length === 0}>
                      <Wand2 className="h-3.5 w-3.5 mr-1.5" /> Suggest (oldest first)
                    </Button>
                  </div>
                </div>

                {openPositions.length === 0 ? (
                  <TableEmptyState title="No open advances in the register for this client." />
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-primary hover:bg-primary">
                          <TableHead className="text-primary-foreground font-bold">Receipt</TableHead>
                          <TableHead className="text-primary-foreground font-bold">Date</TableHead>
                          <TableHead className="text-primary-foreground font-bold">Party</TableHead>
                          <TableHead className="text-primary-foreground font-bold">POS / Rate</TableHead>
                          <TableHead className="text-primary-foreground font-bold text-right">Open</TableHead>
                          <TableHead className="text-primary-foreground font-bold text-right w-40">Set off now</TableHead>
                          <TableHead className="text-primary-foreground font-bold w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {openPositions.map((p) => (
                          <TableRow key={p.receipt.id}>
                            <TableCell className="font-medium">{p.receipt.receipt_no || '—'}</TableCell>
                            <TableCell>{p.receipt.receipt_date}</TableCell>
                            <TableCell className="max-w-[180px] truncate">{p.receipt.party_name || p.receipt.party_gstin || '—'}</TableCell>
                            <TableCell className="text-xs">{p.receipt.pos} @ {p.receipt.rate_pct}%</TableCell>
                            <TableCell className="text-right tabular-nums">{inr(p.open)}</TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                className="h-8 text-right tabular-nums"
                                value={alloc[p.receipt.id] ?? ''}
                                onChange={(e) => setAlloc({ ...alloc, [p.receipt.id]: e.target.value })}
                                disabled={!canEdit}
                              />
                            </TableCell>
                            <TableCell>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Set off the whole open balance" onClick={() => suggestFor(p)} disabled={!canEdit}>
                                <Link2 className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-border">
                      <div className="text-sm">
                        <span className="text-muted-foreground">Table 11B to report this month: </span>
                        <span className="font-bold tabular-nums text-primary">₹{inr(allocTotal)}</span>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={writeToGstr1} disabled={!canEdit}>
                          Write Table 11B to GSTR-1 draft
                        </Button>
                        <Button size="sm" onClick={recordSetoff} disabled={!canEdit || applying || allocTotal <= 0}>
                          {applying && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                          Record set-off
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Projects (contractors) ---------------- */}
          {isContractor && (
            <TabsContent value="projects">
              <ContractProjectsPanel
                clientId={selectedClient || ''}
                homeState={homeState}
                periodMonth={selectedMonth}
                receipts={register.receipts}
                adjustments={register.adjustments}
                canEdit={canEdit}
                actor={{ id: user?.id || null, name: user?.firstName || user?.email || 'Unknown' }}
                onChanged={load}
              />
            </TabsContent>
          )}

          {/* ---------------- All clients ---------------- */}
          <TabsContent value="board">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-muted-foreground">
                    Every client carrying an open advance as at {selectedMonth}, derived from their filed returns.
                  </p>
                  <Button variant="outline" size="sm" onClick={loadBoard} disabled={boardLoading}>
                    {boardLoading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />} Refresh
                  </Button>
                </div>
                {boardLoading ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Reading every client&apos;s return history — this takes a moment.
                  </p>
                ) : board.length === 0 ? (
                  <TableEmptyState title="No client is carrying an open advance for this period." />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-primary hover:bg-primary">
                        <TableHead className="text-primary-foreground font-bold">Client</TableHead>
                        <TableHead className="text-primary-foreground font-bold text-right">Open advance</TableHead>
                        <TableHead className="text-primary-foreground font-bold">Oldest</TableHead>
                        <TableHead className="text-primary-foreground font-bold">Age</TableHead>
                        <TableHead className="text-primary-foreground font-bold">Managed by</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {board.map((r) => (
                        <TableRow
                          key={r.client.id}
                          className="cursor-pointer"
                          onClick={() => setSelectedClient(r.client.id)}
                        >
                          <TableCell className="font-medium">{r.client.name}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{inr(r.open)}</TableCell>
                          <TableCell>{r.oldest || '—'}</TableCell>
                          <TableCell>{ageBucket(r.oldest, selectedMonth)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {r.client.regular_sub_type === 'Builder' ? 'Builder module' : 'Advance Register'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <ReceiptFormDialog
        open={receiptDialogOpen}
        onOpenChange={setReceiptDialogOpen}
        homeState={homeState}
        periodMonth={selectedMonth}
        existing={editing}
        onSave={onSaveReceipt}
      />
    </div>
  );
};

export default AdvancesPage;
