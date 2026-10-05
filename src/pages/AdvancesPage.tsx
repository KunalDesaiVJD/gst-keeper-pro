import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { PageHeader } from '@/components/layout/PageHeader';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { HandCoins, Plus, Loader2, Trash2, Pencil, Wand2, Link2, FileDown, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile, Note, SectionCard } from '@/components/gstr9/ui';
import { TAB_LIST_CLASS, TAB_TRIGGER_CLASS } from '@/components/gstr9/reco/StepTabs';
import {
  WS_PAGE, WS_BTN, WS_TABLE_WRAP, WS_TABLE, WS_TH, WS_TD, WS_TD_NUM, WS_TR,
  WS_FILTER_LABEL, WS_CONTROL, WS_CELL_INPUT,
} from '@/components/workspace/theme';
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
import { fetchProjects, fetchRaBills, type ContractProject, type ContractRaBill } from '@/lib/contractProjects';
import ContractProjectsPanel from '@/components/advances/ContractProjectsPanel';
import OverrideApprovalsPanel from '@/components/advances/OverrideApprovalsPanel';
import { fetchPendingOverrides } from '@/lib/advanceSetoffOverrides';
import {
  buildLedgerReport, buildRegisterReport, buildControlSheet, fetchOverridesForCertificate,
  type ControlSheetRow,
} from '@/lib/advanceReportData';
import {
  advanceLedgerPdf, advanceAgeingPdf, setoffRegisterPdf, amendmentBridgePdf,
  controlSheetPdf, overrideCertificatePdf,
} from '@/utils/advanceReportsPdf';

interface Client { id: string; name: string; gstin: string; regular_sub_type?: string | null }

const inr = (n: number) => (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;

// Table pieces: the kit's TableHead carries h-12, and its row a hover tint of its own.
const TH = `h-auto ${WS_TH}`;
const TR = `border-0 ${WS_TR}`;
const TABLE_WRAP = `${WS_TABLE_WRAP} max-h-[70vh]`;

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
  const { user, canManageAdvanceRegister, canApproveAdvanceOverride } = useAuth();
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
  const [board, setBoard] = useState<ControlSheetRow[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);

  // Pending override requests, badged on the tab so a manager sees a blocked
  // return waiting on them without having to go looking for it.
  const canApprove = canApproveAdvanceOverride();
  const [pendingCount, setPendingCount] = useState(0);
  const refreshPending = useCallback(async () => {
    if (!canApprove) { setPendingCount(0); return; }
    setPendingCount((await fetchPendingOverrides()).length);
  }, [canApprove]);
  useEffect(() => { refreshPending(); }, [refreshPending]);

  // A contractor's advance is recovered per project and per RA bill; without
  // those links the recovery schedule has nothing to compare and the working
  // paper reports zeros.
  const [projects, setProjects] = useState<ContractProject[]>([]);
  const [raBills, setRaBills] = useState<ContractRaBill[]>([]);
  const [setoffBillId, setSetoffBillId] = useState<string>('');

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
      const projs = selected?.regular_sub_type === 'Contractor'
        ? await fetchProjects(selectedClient)
        : [];
      setProjects(projs);
      const bills = await Promise.all(projs.map((p) => fetchRaBills(p.id)));
      setRaBills(bills.flat());
    } catch (e) {
      toast.error(`Could not load the advance ledger: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [selectedClient, selected?.gstin, selected?.regular_sub_type, selectedMonth]);

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
  // Built by the SAME function the printed control sheet uses, so the screen
  // and the working paper cannot drift apart — they were two implementations
  // of one thing.
  const loadBoard = useCallback(async () => {
    setBoardLoading(true);
    try {
      const rows = await buildControlSheet(selectedMonth);
      setBoard(rows);
    } catch (e) {
      toast.error(`Could not build the board: ${(e as Error).message}`);
    } finally {
      setBoardLoading(false);
    }
  }, [selectedMonth]);

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
          const bill = raBills.find((b) => b.id === setoffBillId);
          return {
            receipt_id: l.receiptId,
            client_id: selectedClient!,
            // Inherited, never re-picked: a leg belongs to whatever project its
            // receipt does, and asking twice is how the two drift apart.
            project_id: p.receipt.project_id || null,
            ra_bill_id: setoffBillId || null,
            invoice_no: invoiceNo.trim() || (bill ? (bill.bill_ref || `RA-${bill.bill_no}`) : ''),
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
      setSetoffBillId('');
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

  // ── Working papers (docs/ADVANCE_SETOFF_POSITIONS.md §8) ────────────────
  // Each one refetches rather than printing whatever the screen happens to be
  // showing: a working paper that quietly disagrees with the ledger it was
  // exported from is worse than no working paper.
  const [exporting, setExporting] = useState<string | null>(null);

  const reportCtx = useMemo(() => ({
    clientId: selectedClient || '',
    clientName: selected?.name || '',
    clientGstin: selected?.gstin || '',
    periodMonth: selectedMonth,
  }), [selectedClient, selected?.name, selected?.gstin, selectedMonth]);

  const runExport = async (name: string, fn: () => Promise<void>) => {
    setExporting(name);
    try {
      await fn();
    } catch (e) {
      toast.error(`Could not generate the report: ${(e as Error).message}`);
    } finally {
      setExporting(null);
    }
  };

  const exportLedger = () => runExport('ledger', async () => {
    advanceLedgerPdf(reportCtx, await buildLedgerReport(reportCtx));
  });
  const exportAgeing = () => runExport('ageing', async () => {
    advanceAgeingPdf(reportCtx, await buildLedgerReport(reportCtx));
  });
  const exportBridge = () => runExport('bridge', async () => {
    const { ledger: l } = await buildLedgerReport(reportCtx);
    amendmentBridgePdf(reportCtx, l);
  });
  const exportCertificate = () => runExport('certificate', async () => {
    overrideCertificatePdf(reportCtx, await fetchOverridesForCertificate(reportCtx.clientId, reportCtx.periodMonth));
  });
  const exportRegister = () => runExport('register', async () => {
    const { ledger: l } = await buildLedgerReport(reportCtx);
    setoffRegisterPdf(reportCtx, await buildRegisterReport(reportCtx, l));
  });
  const exportControlSheet = () => runExport('control', async () => {
    const rows = await buildControlSheet(selectedMonth);
    if (rows.length === 0) { toast.error('No client is carrying an open advance for this period.'); return; }
    controlSheetPdf(selectedMonth, rows);
  });

  const ExportButton: React.FC<{ id: string; label: string; onClick: () => void; disabled?: boolean }> = ({ id, label, onClick, disabled }) => (
    <Button variant="outline" size="sm" className={WS_BTN} onClick={onClick} disabled={disabled || exporting !== null}>
      {exporting === id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );

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

  // Tabs are controlled only so the summary tiles can open the tab they count.
  const [tab, setTab] = useState('ledger');
  const goTo = (t: string) => { setTab(t); if (t === 'board' && board.length === 0) loadBoard(); };

  return (
    <div className={WS_PAGE}>
      <PageHeader
        compact
        title="Advances"
        subtitle="Advance received, its set-off against invoices, and the open position month by month"
        icon={<HandCoins />}
      />

      <Card>
        <CardContent className="px-3 py-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="w-full min-w-0 space-y-0.5 sm:w-64">
              <span className={WS_FILTER_LABEL}>Client</span>
              <SearchableSelect
                options={clientOptions}
                value={selectedClient || ''}
                onValueChange={setSelectedClient}
                placeholder="Select client"
                className={`w-full ${WS_CONTROL}`}
              />
            </label>
            <label className="w-40 min-w-0 space-y-0.5">
              <span className={WS_FILTER_LABEL}>Month</span>
              <SearchableMonthSelect
                options={monthOptions}
                value={selectedMonth}
                onValueChange={setSelectedMonth}
                className={`w-full ${WS_CONTROL}`}
              />
            </label>
            {loading && <Loader2 className="mb-2 h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </CardContent>
      </Card>

      {ledger && !isBuilder && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          <TileButton active={tab === 'ledger'} onClick={() => goTo('ledger')} title="Open the ledger">
            <KpiTile
              label="Open advance"
              value={<>₹{inr(ledger.closingTotal.taxable)}</>}
              hint={ledger.oldestOpenPeriod ? `oldest ${ledger.oldestOpenPeriod} (${ageBucket(ledger.oldestOpenPeriod, selectedMonth)})` : undefined}
            />
          </TileButton>
          <TileButton active={tab === 'register'} onClick={() => goTo('register')} title="Open the register">
            <KpiTile label="Receipt vouchers" value={positions.length} hint={`${openPositions.length} with an open balance`} />
          </TileButton>
          <TileButton active={false} onClick={() => goTo('register')} title="Open the register">
            <KpiTile
              label="Register vs filed returns"
              value={register.receipts.length === 0 ? '—' : reconciliation.length === 0 ? 'Agrees' : `${reconciliation.length} difference${reconciliation.length === 1 ? '' : 's'}`}
              tone={register.receipts.length === 0 ? 'neutral' : reconciliation.length ? 'warn' : 'ok'}
            />
          </TileButton>
          <TileButton active={tab === 'setoff'} onClick={() => goTo('setoff')} title="Open the set-off workspace">
            <KpiTile label="Table 11B to report" value={<>₹{inr(allocTotal)}</>} hint={`Set off now · ${selectedMonth}`} />
          </TileButton>
          {canApprove && (
            <TileButton active={tab === 'approvals'} onClick={() => goTo('approvals')} title="Open override approvals">
              <KpiTile label="Pending approvals" value={pendingCount} tone={pendingCount ? 'warn' : 'ok'} hint="Set-off override requests" />
            </TileButton>
          )}
        </div>
      )}

      {/* Builders are out of scope by construction — their advances are
          generated and balanced by the Builder module (§1 of the doc). Saying
          so plainly beats showing an empty ledger that looks like a bug. */}
      {isBuilder && (
        <Note tone="info" open>
          <span className="font-semibold">Managed by the Builder module.</span>{' '}
          This client&apos;s advances come from bookings and receipts in the Builder module, where Table 11A and
          11B are generated and balanced automatically. The register here is not used for promoter clients.
        </Note>
      )}

      {!isBuilder && (
        <Tabs value={tab} onValueChange={setTab} className="space-y-3">
          <TabsList className={TAB_LIST_CLASS}>
            <TabsTrigger className={TAB_TRIGGER_CLASS} value="ledger">Ledger</TabsTrigger>
            <TabsTrigger className={TAB_TRIGGER_CLASS} value="register">Register</TabsTrigger>
            <TabsTrigger className={TAB_TRIGGER_CLASS} value="setoff">Set-off</TabsTrigger>
            {isContractor && <TabsTrigger className={TAB_TRIGGER_CLASS} value="projects">Projects</TabsTrigger>}
            {canApprove && (
              <TabsTrigger className={TAB_TRIGGER_CLASS} value="approvals">
                Approvals
                {pendingCount > 0 && (
                  <Badge variant="destructive" className="h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none tabular-nums">
                    {pendingCount}
                  </Badge>
                )}
              </TabsTrigger>
            )}
            <TabsTrigger className={TAB_TRIGGER_CLASS} value="board" onClick={() => { if (board.length === 0) loadBoard(); }}>All clients</TabsTrigger>
          </TabsList>

          {/* ---------------- Ledger ---------------- */}
          <TabsContent value="ledger" className="mt-0">
            <SectionCard
              title="Advance ledger"
              description={<>Working papers print as at {selectedMonth}, in the firm&apos;s house style, for filing with the return.</>}
              actions={
                <>
                  <ExportButton id="ledger" label="Ledger" onClick={exportLedger} disabled={!selectedClient} />
                  <ExportButton id="ageing" label="Ageing" onClick={exportAgeing} disabled={!selectedClient} />
                  <ExportButton id="bridge" label="Amendment bridge" onClick={exportBridge} disabled={!selectedClient} />
                  <ExportButton id="certificate" label="Exception certificate" onClick={exportCertificate} disabled={!selectedClient} />
                </>
              }
            >
              {!ledger || ledger.months.length === 0 ? (
                <TableEmptyState title="No advance activity in the imported returns for this client." />
              ) : (
                <Table className={WS_TABLE} containerClassName={TABLE_WRAP}>
                  <TableHeader>
                    <TableRow className="border-0 hover:bg-transparent">
                      <TableHead className={TH}>Period</TableHead>
                      <TableHead className={`${TH} text-right`}>Opening</TableHead>
                      <TableHead className={`${TH} text-right`}>11A received</TableHead>
                      <TableHead className={`${TH} text-right`}>11B adjusted</TableHead>
                      <TableHead className={`${TH} text-right`}>Closing</TableHead>
                      <TableHead className={TH}>Amended</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledger.months.map((m) => (
                      <TableRow key={m.period} className={TR}>
                        <TableCell className={`${WS_TD} font-medium`}>{m.period}</TableCell>
                        <TableCell className={WS_TD_NUM}>{inr(m.opening.taxable)}</TableCell>
                        {/* As-AMENDED is the primary figure (firm's election,
                            Sept 2026); the as-filed number sits under it as a
                            memo so the paper still ties to the portal. */}
                        <TableCell className={WS_TD_NUM}>
                          {inr(m.effective.received.taxable)}
                          {m.amended && Math.abs(m.effective.received.taxable - m.filed.received.taxable) > 0.5 && (
                            <div className="text-[11px] text-muted-foreground font-normal">as filed {inr(m.filed.received.taxable)}</div>
                          )}
                        </TableCell>
                        <TableCell className={WS_TD_NUM}>
                          {inr(m.effective.adjusted.taxable)}
                          {m.amended && Math.abs(m.effective.adjusted.taxable - m.filed.adjusted.taxable) > 0.5 && (
                            <div className="text-[11px] text-muted-foreground font-normal">as filed {inr(m.filed.adjusted.taxable)}</div>
                          )}
                        </TableCell>
                        <TableCell className={`${WS_TD_NUM} font-semibold`}>{inr(m.closing.taxable)}</TableCell>
                        <TableCell className={`${WS_TD} text-muted-foreground`}>
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
                <Note tone="info">
                  Amended rows lead with the <strong>restated</strong> figure, with the amount originally
                  filed shown underneath as a memo — a Table 11(2) amendment replaces the month it corrects
                  rather than adding to it. The differential in brackets is what belongs in GSTR-3B
                  Adjustments for that correction.
                </Note>
              )}
            </SectionCard>
          </TabsContent>

          {/* ---------------- Register ---------------- */}
          <TabsContent value="register" className="mt-0">
            <SectionCard
              title="Receipt register"
              description={<>Receipt vouchers and the invoices that absorbed them. GSTR-1 Table 11A carries only place of
                supply and rate, so this is the only place the party and invoice behind an advance are recorded.</>}
              actions={
                <>
                  <ExportButton id="register" label="Set-off register" onClick={exportRegister} disabled={!selectedClient} />
                  {canEdit && selectedClient && (
                    <Button size="sm" className={WS_BTN} onClick={() => { setEditing(null); setReceiptDialogOpen(true); }}>
                      <Plus className="h-3.5 w-3.5" /> Add receipt
                    </Button>
                  )}
                </>
              }
            >
              {reconciliation.length > 0 && (
                <Note tone="warn">
                  <p className="font-semibold">Register does not agree with the filed returns</p>
                  {reconciliation.map((row) => (
                    <p key={row.key} className="mt-0.5 text-muted-foreground">
                      {row.label}: register ₹{inr(row.register)} vs returns ₹{inr(row.filed)} — difference ₹{inr(Math.abs(row.difference))}
                    </p>
                  ))}
                </Note>
              )}

              {positions.length === 0 ? (
                <TableEmptyState title="No receipt vouchers recorded for this client yet." />
              ) : (
                <Table className={WS_TABLE} containerClassName={TABLE_WRAP}>
                  <TableHeader>
                    <TableRow className="border-0 hover:bg-transparent">
                      <TableHead className={TH}>Receipt</TableHead>
                      <TableHead className={TH}>Date</TableHead>
                      <TableHead className={TH}>Party</TableHead>
                      <TableHead className={TH}>POS / Rate</TableHead>
                      <TableHead className={`${TH} text-right`}>Taxable</TableHead>
                      <TableHead className={`${TH} text-right`}>Adjusted</TableHead>
                      <TableHead className={`${TH} text-right`}>Open</TableHead>
                      <TableHead className={TH}>Status</TableHead>
                      {canEdit && <TableHead className={`${TH} w-20`} />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.map((p) => (
                      <TableRow key={p.receipt.id} className={TR}>
                        <TableCell className={`${WS_TD} font-medium`}>{p.receipt.receipt_no || '—'}</TableCell>
                        <TableCell className={`${WS_TD} whitespace-nowrap`}>{p.receipt.receipt_date}</TableCell>
                        <TableCell className={`${WS_TD} max-w-[200px] truncate`}>{p.receipt.party_name || p.receipt.party_gstin || '—'}</TableCell>
                        <TableCell className={`${WS_TD} whitespace-nowrap`}>{p.receipt.pos} @ {p.receipt.rate_pct}%</TableCell>
                        <TableCell className={WS_TD_NUM}>
                          {p.receipt.supply_nature === 'GOODS' ? <span className="text-muted-foreground">Goods — not taxable</span> : inr(p.receipt.taxable_value)}
                        </TableCell>
                        <TableCell className={WS_TD_NUM}>{inr(p.adjusted)}</TableCell>
                        <TableCell className={`${WS_TD_NUM} font-semibold`}>{inr(p.open)}</TableCell>
                        {/* Status is a word, not a colour — these tables get printed. */}
                        <TableCell className={WS_TD}>{p.derivedStatus}</TableCell>
                        {canEdit && (
                          <TableCell className={`${WS_TD} py-0.5`}>
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
            </SectionCard>
          </TabsContent>

          {/* ---------------- Set-off ---------------- */}
          <TabsContent value="setoff" className="mt-0">
            <SectionCard
              title="Set off open advances against an invoice"
              description={<>Recorded against {selectedMonth}. Legs recorded here become this period&apos;s Table 11B —
                write them into the GSTR-1 draft once the return is ready.</>}
            >
              <div className="flex flex-wrap items-end gap-2">
                <label className="w-40 min-w-0 space-y-0.5">
                  <span className={WS_FILTER_LABEL}>Invoice no.</span>
                  <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} className={WS_CONTROL} placeholder="INV-001" />
                </label>
                {/* Contractors recover an advance from a specific RA bill;
                    without naming it the project's recovery variance has
                    nothing to compare the actual against. */}
                {isContractor && raBills.length > 0 && (
                  <label className="w-52 min-w-0 space-y-0.5">
                    <span className={WS_FILTER_LABEL}>Recovered from RA bill</span>
                    <Select value={setoffBillId} onValueChange={setSetoffBillId}>
                      <SelectTrigger className={WS_CONTROL}><SelectValue placeholder="Select RA bill" /></SelectTrigger>
                      <SelectContent>
                        {raBills.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.bill_ref || `RA-${b.bill_no}`} · {b.period_month}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                )}
                <Button variant="outline" size="sm" className={WS_BTN} onClick={suggestAll} disabled={openPositions.length === 0}>
                  <Wand2 className="h-3.5 w-3.5" /> Suggest (oldest first)
                </Button>
              </div>

              {openPositions.length === 0 ? (
                <TableEmptyState title="No open advances in the register for this client." />
              ) : (
                <>
                  <Table className={WS_TABLE} containerClassName={TABLE_WRAP}>
                    <TableHeader>
                      <TableRow className="border-0 hover:bg-transparent">
                        <TableHead className={TH}>Receipt</TableHead>
                        <TableHead className={TH}>Date</TableHead>
                        <TableHead className={TH}>Party</TableHead>
                        <TableHead className={TH}>POS / Rate</TableHead>
                        <TableHead className={`${TH} text-right`}>Open</TableHead>
                        <TableHead className={`${TH} text-right w-40`}>Set off now</TableHead>
                        <TableHead className={`${TH} w-10`} />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {openPositions.map((p) => (
                        <TableRow key={p.receipt.id} className={TR}>
                          <TableCell className={`${WS_TD} font-medium`}>{p.receipt.receipt_no || '—'}</TableCell>
                          <TableCell className={`${WS_TD} whitespace-nowrap`}>{p.receipt.receipt_date}</TableCell>
                          <TableCell className={`${WS_TD} max-w-[180px] truncate`}>{p.receipt.party_name || p.receipt.party_gstin || '—'}</TableCell>
                          <TableCell className={`${WS_TD} whitespace-nowrap`}>{p.receipt.pos} @ {p.receipt.rate_pct}%</TableCell>
                          <TableCell className={WS_TD_NUM}>{inr(p.open)}</TableCell>
                          <TableCell className="border-b border-r p-0">
                            <Input
                              type="number"
                              className={`${WS_CELL_INPUT} text-right tabular-nums`}
                              value={alloc[p.receipt.id] ?? ''}
                              onChange={(e) => setAlloc({ ...alloc, [p.receipt.id]: e.target.value })}
                              disabled={!canEdit}
                            />
                          </TableCell>
                          <TableCell className={`${WS_TD} py-0.5`}>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Set off the whole open balance" onClick={() => suggestFor(p)} disabled={!canEdit}>
                              <Link2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
                    <div className="text-xs">
                      <span className="text-muted-foreground">Table 11B to report this month: </span>
                      <span className="text-sm font-semibold tabular-nums text-primary">₹{inr(allocTotal)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" className={WS_BTN} onClick={writeToGstr1} disabled={!canEdit}>
                        Write Table 11B to GSTR-1 draft
                      </Button>
                      <Button size="sm" className={WS_BTN} onClick={recordSetoff} disabled={!canEdit || applying || allocTotal <= 0}>
                        {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Record set-off
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </SectionCard>
          </TabsContent>

          {/* ---------------- Projects (contractors) ---------------- */}
          {isContractor && (
            <TabsContent value="projects" className="mt-0">
              <ContractProjectsPanel
                clientId={selectedClient || ''}
                clientName={selected?.name || ''}
                clientGstin={selected?.gstin || ''}
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

          {/* ---------------- Override approvals ---------------- */}
          {canApprove && (
            <TabsContent value="approvals" className="mt-0">
              <OverrideApprovalsPanel onDecided={refreshPending} />
            </TabsContent>
          )}

          {/* ---------------- All clients ---------------- */}
          <TabsContent value="board" className="mt-0">
            <SectionCard
              title="All clients"
              description={<>Every client carrying an open advance as at {selectedMonth}, derived from their filed returns.</>}
              actions={
                <>
                  <ExportButton id="control" label="Control sheet" onClick={exportControlSheet} />
                  <Button variant="outline" size="sm" className={WS_BTN} onClick={loadBoard} disabled={boardLoading}>
                    {boardLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
                  </Button>
                </>
              }
            >
              {boardLoading ? (
                <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Reading every client&apos;s return history — this takes a moment.
                </p>
              ) : board.length === 0 ? (
                <TableEmptyState title="No client is carrying an open advance for this period." />
              ) : (
                <Table className={WS_TABLE} containerClassName={TABLE_WRAP}>
                  <TableHeader>
                    <TableRow className="border-0 hover:bg-transparent">
                      <TableHead className={TH}>Client</TableHead>
                      <TableHead className={`${TH} text-right`}>Open advance</TableHead>
                      <TableHead className={TH}>Oldest</TableHead>
                      <TableHead className={TH}>Age</TableHead>
                      <TableHead className={TH}>Managed by</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {board.map((r) => {
                      const match = clients.find((c) => c.gstin === r.clientGstin);
                      return (
                        <TableRow
                          key={r.clientGstin || r.clientName}
                          className={cn(TR, match && 'cursor-pointer')}
                          onClick={() => match && setSelectedClient(match.id)}
                        >
                          <TableCell className={`${WS_TD} font-medium`}>{r.clientName}</TableCell>
                          <TableCell className={`${WS_TD_NUM} font-semibold`}>{inr(r.open)}</TableCell>
                          <TableCell className={WS_TD}>{r.oldest || '—'}</TableCell>
                          <TableCell className={WS_TD}>{r.bucket}</TableCell>
                          <TableCell className={`${WS_TD} text-muted-foreground`}>{r.managedBy}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </SectionCard>
          </TabsContent>
        </Tabs>
      )}

      <ReceiptFormDialog
        open={receiptDialogOpen}
        onOpenChange={setReceiptDialogOpen}
        homeState={homeState}
        periodMonth={selectedMonth}
        projects={projects}
        existing={editing}
        onSave={onSaveReceipt}
      />
    </div>
  );
};

const TileButton: React.FC<{ active: boolean; onClick: () => void; title: string; children: React.ReactNode }> = ({ active, onClick, title, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-pressed={active}
    className={cn(
      'rounded-lg text-left transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>div]:h-full',
      active && 'ring-2 ring-primary/60',
    )}
  >
    {children}
  </button>
);

export default AdvancesPage;
