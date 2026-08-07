import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { FileCheck2, Download, FileText, Loader2, FileJson, Send, CheckCircle2, XCircle, X } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { fetchGstr3b } from '@/utils/fetchGstr3b';
import type { Gstr3bResult } from '@/utils/buildGstr3bJson';
import { exportGstr3bToPDF } from '@/utils/gstr3bPdf';

interface Client { id: string; name: string; gstin: string; }

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const toShort = (mmYyyy: string) => {
  const [mm, yyyy] = (mmYyyy || '').split('/');
  return mm && yyyy ? `${MONTH_SHORT[Number(mm) - 1]}-${String(yyyy).slice(-2)}` : '';
};
const inr = (n: number | undefined) =>
  (n || n === 0 ? Number(n) : 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum3 = (t?: { igst: number; cgst: number; sgst: number }) => (t ? t.igst + t.cgst + t.sgst : 0);

// One line of a portal-style table (Particulars + up to four amount columns).
const TRow: React.FC<{ label: string; txval?: number; igst?: number; cgst?: number; sgst?: number; bold?: boolean }> = ({ label, txval, igst, cgst, sgst, bold }) => (
  <tr className={bold ? 'font-semibold bg-muted/40' : 'odd:bg-muted/20'}>
    <td className="border border-border p-2">{label}</td>
    <td className="border border-border p-2 text-right tabular-nums">{txval === undefined ? '' : inr(txval)}</td>
    <td className="border border-border p-2 text-right tabular-nums">{igst === undefined ? '' : inr(igst)}</td>
    <td className="border border-border p-2 text-right tabular-nums">{cgst === undefined ? '' : inr(cgst)}</td>
    <td className="border border-border p-2 text-right tabular-nums">{sgst === undefined ? '' : inr(sgst)}</td>
  </tr>
);

const THead: React.FC<{ first: string }> = ({ first }) => (
  <thead className="sticky top-0 z-10">
    <tr className="bg-primary text-primary-foreground">
      <th className="border border-primary-foreground/20 p-2 text-left font-bold">{first}</th>
      <th className="border border-primary-foreground/20 p-2 text-right font-bold w-28">Taxable value</th>
      <th className="border border-primary-foreground/20 p-2 text-right font-bold w-28">Integrated tax</th>
      <th className="border border-primary-foreground/20 p-2 text-right font-bold w-28">Central tax</th>
      <th className="border border-primary-foreground/20 p-2 text-right font-bold w-28">State/UT tax</th>
    </tr>
  </thead>
);

const Gstr3bPage: React.FC = () => {
  const { selectedClientId: selectedClient, setSelectedClientId: setSelectedClient } = useClient();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const { user, isStaffRole, canEditFilingStatus } = useAuth();
  const isStaff = isStaffRole();
  const [clients, setClients] = useState<Client[]>([]);
  const [result, setResult] = useState<Gstr3bResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // NIL Return flag, shared with GSTR-1's filing_status.is_nil mechanism.
  const [isNilReturn, setIsNilReturn] = useState(false);
  const [isTogglingNil, setIsTogglingNil] = useState(false);

  // "Push to GST Portal" — extension-driven, mirrors the GSTR-1 upload bridge.
  // GSTR-3B has no offline-JSON path (it's a live web form), so this fills
  // Table 3.1 + Table 4 directly and stops before Confirm/Offset/File — the
  // human reviews and submits.
  const [extReady, setExtReady] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ ok: boolean; summary: string; skipped?: string[] } | null>(null);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d: any = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.__gstkExtensionReady) setExtReady(true);
      if (d.__gstkPushGstr3bResult) {
        const r = d.__gstkPushGstr3bResult as { ok: boolean; summary?: string; error?: string; skipped?: string[] };
        setIsPushing(false);
        if (r.ok) {
          toast.success(r.summary || 'GSTR-3B form filled.');
          setPushResult({ ok: true, summary: r.summary || 'GSTR-3B form filled.', skipped: r.skipped });
        } else {
          const msg = r.error || r.summary || 'GSTR-3B push failed.';
          toast.error(msg);
          setPushResult({ ok: false, summary: msg });
        }
      }
    };
    window.addEventListener('message', onMsg);
    const ping = () => window.postMessage({ __gstkAppReady: true }, '*');
    ping();
    const t1 = setTimeout(ping, 400);
    const t2 = setTimeout(ping, 1200);
    return () => {
      window.removeEventListener('message', onMsg);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  useEffect(() => { setPushResult(null); }, [selectedClient, selectedMonth]);

  const fetchIsNil = useCallback(async () => {
    if (!selectedClient || !selectedMonth) { setIsNilReturn(false); return; }
    const { data } = await supabase
      .from('filing_status')
      .select('is_nil')
      .eq('client_id', selectedClient)
      .eq('return_type', 'GSTR-3B')
      .eq('period_month', selectedMonth)
      .maybeSingle();
    setIsNilReturn(!!(data as any)?.is_nil);
  }, [selectedClient, selectedMonth]);
  useEffect(() => { fetchIsNil(); }, [fetchIsNil]);

  const handleToggleNilReturn = async (checked: boolean) => {
    if (!selectedClient || !selectedMonth) return;
    setIsTogglingNil(true);
    setIsNilReturn(checked);
    try {
      const { error } = await supabase
        .from('filing_status')
        .upsert(
          { client_id: selectedClient, return_type: 'GSTR-3B', period_month: selectedMonth, is_nil: checked, updated_by: user?.id ?? null },
          { onConflict: 'client_id,return_type,period_month' },
        );
      if (error) throw error;
      toast.success(checked ? 'Marked as NIL Return.' : 'NIL Return unmarked.');
    } catch (err: any) {
      setIsNilReturn(!checked);
      toast.error('Failed to update NIL Return: ' + err.message);
    } finally {
      setIsTogglingNil(false);
    }
  };

  const monthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    const startDate = new Date(2024, 3, 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 12, 1);
    let cur = new Date(startDate);
    while (cur <= endDate) {
      const mm = String(cur.getMonth() + 1).padStart(2, '0');
      months.push({ value: `${mm}/${cur.getFullYear()}`, label: `${MONTH_SHORT[cur.getMonth()]} ${cur.getFullYear()}` });
      cur.setMonth(cur.getMonth() + 1);
    }
    return months.sort((a, b) => {
      const [aM, aY] = a.value.split('/').map(Number);
      const [bM, bY] = b.value.split('/').map(Number);
      return bY * 12 + bM - (aY * 12 + aM);
    });
  }, []);

  useEffect(() => {
    supabase.from('clients').select('id, name, gstin').order('name').then(({ data }) => setClients((data || []) as Client[]));
  }, []);

  const selectedClientData = clients.find((c) => c.id === selectedClient);
  const selectedClientName = selectedClientData?.name || '';

  const compute = useCallback(async () => {
    if (!selectedClient || !selectedMonth) { setResult(null); return; }
    setIsLoading(true);
    try {
      const gstin = clients.find((c) => c.id === selectedClient)?.gstin || '';
      setResult(await fetchGstr3b(selectedClient, gstin, selectedMonth));
    } catch (e: any) {
      toast.error('Failed to build GSTR-3B: ' + (e?.message || 'unknown'));
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [selectedClient, selectedMonth, clients]);

  useEffect(() => { compute(); }, [compute]);

  const s = result?.summary;

  const handleDownloadJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.json, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GSTR3B_${(selectedClientData?.gstin || selectedClientName || 'client')}_${(selectedMonth || '').replace('/', '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('GSTR-3B JSON downloaded.');
  };

  const handleDownloadPdf = () => {
    if (!result) return;
    exportGstr3bToPDF({
      result,
      clientName: selectedClientName || 'Client',
      gstin: selectedClientData?.gstin || '',
      monthLabel: toShort(selectedMonth),
    });
  };

  const handlePush = () => {
    if (!result || !selectedClient || !selectedMonth) return;
    if (!extReady) {
      toast.error('Install / enable the GST Keeper browser extension to push from this page.');
      return;
    }
    if (!selectedClientData?.gstin) {
      toast.error('Selected client has no GSTIN on file.');
      return;
    }
    setIsPushing(true);
    setPushResult(null);
    window.postMessage(
      {
        __gstkPushGstr3b: {
          clientId: selectedClient,
          period_month: selectedMonth,
          actorId: user?.id ?? null,
          gstr3bJson: result.json,
        },
      },
      '*'
    );
    toast.info('Opening the GST portal in a new tab — clear the CAPTCHA and let the fill run. It stops before Confirm/Offset/File; review and submit yourself.');
  };

  const Tile: React.FC<{ label: string; value: number; tone?: 'primary' | 'success' | 'info' }> = ({ label, value, tone = 'primary' }) => (
    <Card className={tone === 'success' ? 'bg-success/5 border-success/20' : tone === 'info' ? 'bg-info/5 border-info/20' : 'bg-primary/5 border-primary/20'}>
      <CardContent className="p-4">
        <h4 className="text-sm font-semibold text-muted-foreground mb-1">{label}</h4>
        <p className={`text-xl font-bold tabular-nums ${tone === 'success' ? 'text-success' : 'text-primary'}`}>₹{inr(value)}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="GSTR-3B"
        subtitle="Draft GSTR-3B assembled from GSTR-1, ITC Summary and RCM — client-wise & month-wise"
        icon={<FileCheck2 className="h-6 w-6" />}
        actions={result ? (
          <>
            <Button variant="outline" onClick={handleDownloadJson}>
              <FileJson className="h-4 w-4 mr-2" /> Download JSON
            </Button>
            <Button variant="outline" onClick={handleDownloadPdf}>
              <Download className="h-4 w-4 mr-2" /> Download PDF
            </Button>
            {isStaff && (
              <Button
                onClick={handlePush}
                disabled={isPushing || !extReady}
                className="bg-success text-success-foreground hover:bg-success/90"
                title={!extReady ? 'Install / enable the GST Keeper browser extension' : 'Fills Table 3.1 + Table 4 on the live GSTR-3B form; stops before Confirm/Offset/File'}
              >
                {isPushing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                {isPushing ? 'Pushing…' : 'Push to GST Portal'}
              </Button>
            )}
          </>
        ) : undefined}
      />

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Client:</span>
              <div className="w-56">
                <SearchableSelect
                  options={clients.map((c) => ({ value: c.id, label: c.name, sublabel: c.gstin }))}
                  value={selectedClient}
                  onValueChange={setSelectedClient}
                  placeholder="Select Client"
                  searchPlaceholder="Type to search clients..."
                  emptyText="No clients found."
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Month:</span>
              <div className="w-40">
                <SearchableMonthSelect
                  options={monthOptions}
                  value={selectedMonth}
                  onValueChange={setSelectedMonth}
                  placeholder="Select Month"
                />
              </div>
            </div>
            {isStaff && selectedClient && selectedMonth && (
              <div className="flex items-center gap-2" title="This period had zero activity for GSTR-3B.">
                <Checkbox
                  id="gstr3b-nil-return"
                  checked={isNilReturn}
                  disabled={!canEditFilingStatus() || isTogglingNil}
                  onCheckedChange={(v) => handleToggleNilReturn(!!v)}
                />
                <label htmlFor="gstr3b-nil-return" className="text-sm font-medium cursor-pointer select-none">
                  NIL Return
                </label>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Push-to-portal result — what got filled, what didn't, and the
          standing reminder that Table 5 / 4(D)(1) are never touched. */}
      {pushResult && (
        <div
          className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
            pushResult.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}
        >
          {pushResult.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-success" /> : <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
          <div className="flex-1">
            <p className="break-words">{pushResult.summary}</p>
            {pushResult.skipped && pushResult.skipped.length > 0 && (
              <ul className="mt-1 text-xs list-disc pl-4 text-foreground/70">
                {pushResult.skipped.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            )}
          </div>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={() => setPushResult(null)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !selectedClient || !selectedMonth ? (
        <Card>
          <CardContent className="p-4">
            <TableEmptyState
              icon={<FileCheck2 className="h-6 w-6" />}
              title="No client or month selected"
              description="Select a client and a return period above to build the GSTR-3B."
            />
          </CardContent>
        </Card>
      ) : !s ? (
        <Card>
          <CardContent className="p-4">
            <TableEmptyState
              icon={<FileCheck2 className="h-6 w-6" />}
              title="Nothing to show"
              description="No source data found for this client and period."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Tile label="Output Tax (3.1a)" value={sum3(s.outward)} />
            <Tile label="RCM Liability (3.1d)" value={sum3(s.rcmLiability)} tone="info" />
            <Tile label="Total Tax Liability" value={sum3(s.totalLiability)} />
            <Tile label="Net ITC (4C)" value={sum3(s.itcNet)} tone="success" />
          </div>

          {/* 3.1 Outward + inward RCM */}
          <Card>
            <CardContent className="p-4">
              <h3 className="text-base font-semibold mb-3">3.1 Details of outward supplies and inward supplies liable to reverse charge</h3>
              <div className="overflow-auto rounded-md border border-border">
                <table className="w-full text-sm border-collapse min-w-[720px]">
                  <THead first="Nature of supplies" />
                  <tbody>
                    <TRow label="(a) Outward taxable supplies (other than zero rated, nil rated and exempted)" txval={s.outward.txval} igst={s.outward.igst} cgst={s.outward.cgst} sgst={s.outward.sgst} />
                    <TRow label="(b) Outward taxable supplies (zero rated)" txval={s.zeroRated.txval} igst={s.zeroRated.igst} cgst={0} sgst={0} />
                    <TRow label="(c) Other outward supplies (nil rated, exempted)" txval={s.nilExempt} igst={0} cgst={0} sgst={0} />
                    <TRow label="(d) Inward supplies (liable to reverse charge)" txval={s.rcmLiability.txval} igst={s.rcmLiability.igst} cgst={s.rcmLiability.cgst} sgst={s.rcmLiability.sgst} />
                    <TRow label="(e) Non-GST outward supplies" txval={s.nonGst} igst={0} cgst={0} sgst={0} />
                    <TRow label="Total tax liability (a + d)" igst={s.totalLiability.igst} cgst={s.totalLiability.cgst} sgst={s.totalLiability.sgst} bold />
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* 4. Eligible ITC */}
          <Card>
            <CardContent className="p-4">
              <h3 className="text-base font-semibold mb-3">4. Eligible ITC</h3>
              <div className="overflow-auto rounded-md border border-border">
                <table className="w-full text-sm border-collapse min-w-[620px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-primary text-primary-foreground">
                      <th className="border border-primary-foreground/20 p-2 text-left font-bold">Details</th>
                      <th className="border border-primary-foreground/20 p-2 text-right font-bold w-28">Integrated tax</th>
                      <th className="border border-primary-foreground/20 p-2 text-right font-bold w-28">Central tax</th>
                      <th className="border border-primary-foreground/20 p-2 text-right font-bold w-28">State/UT tax</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="font-semibold bg-muted/40"><td className="border border-border p-2">(A) ITC Available (whether in full or part)</td><td className="border border-border p-2 text-right tabular-nums">{inr(s.itcAvailable.igst)}</td><td className="border border-border p-2 text-right tabular-nums">{inr(s.itcAvailable.cgst)}</td><td className="border border-border p-2 text-right tabular-nums">{inr(s.itcAvailable.sgst)}</td></tr>
                    {s.itcAvailableRows.map((r) => (
                      <tr key={r.srNo} className="odd:bg-muted/20">
                        <td className="border border-border p-2 pl-6">{r.srNo} {r.label}</td>
                        <td className="border border-border p-2 text-right tabular-nums">{inr(r.igst)}</td>
                        <td className="border border-border p-2 text-right tabular-nums">{inr(r.cgst)}</td>
                        <td className="border border-border p-2 text-right tabular-nums">{inr(r.sgst)}</td>
                      </tr>
                    ))}
                    <tr className="odd:bg-muted/20"><td className="border border-border p-2">(B) ITC reversed</td><td className="border border-border p-2 text-right tabular-nums">{inr(s.itcReversed.igst)}</td><td className="border border-border p-2 text-right tabular-nums">{inr(s.itcReversed.cgst)}</td><td className="border border-border p-2 text-right tabular-nums">{inr(s.itcReversed.sgst)}</td></tr>
                    <tr className="font-semibold bg-muted/40"><td className="border border-border p-2">(C) Net ITC available (A − B)</td><td className="border border-border p-2 text-right tabular-nums">{inr(s.itcNet.igst)}</td><td className="border border-border p-2 text-right tabular-nums">{inr(s.itcNet.cgst)}</td><td className="border border-border p-2 text-right tabular-nums">{inr(s.itcNet.sgst)}</td></tr>
                    <tr className="bg-muted/30 font-medium"><td className="border border-border p-2" colSpan={4}>(D) Other Details</td></tr>
                    {s.itcOtherDetails.map((d) => (
                      <tr key={d.srNo} className="odd:bg-muted/20">
                        <td className="border border-border p-2">{d.srNo} {d.label}</td>
                        <td className="border border-border p-2 text-right tabular-nums">{inr(d.igst)}</td>
                        <td className="border border-border p-2 text-right tabular-nums">{inr(d.cgst)}</td>
                        <td className="border border-border p-2 text-right tabular-nums">{inr(d.sgst)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default Gstr3bPage;
