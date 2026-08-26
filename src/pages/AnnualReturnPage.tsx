import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, ScrollText, ShieldCheck, Lock, Unlock, Info } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { toast } from 'sonner';
import PLOutputCard from '@/components/annualReturn/PLOutputCard';
import PLInputCard from '@/components/annualReturn/PLInputCard';
import DutiesTaxesOutputCard from '@/components/annualReturn/DutiesTaxesOutputCard';
import DutiesTaxesInputCard from '@/components/annualReturn/DutiesTaxesInputCard';
import RcmAnnualReturnCard from '@/components/annualReturn/RcmAnnualReturnCard';
import Gstr9OutputLinesCard from '@/components/annualReturn/Gstr9OutputLinesCard';
import Gstr9OutputPortalCard from '@/components/annualReturn/Gstr9OutputPortalCard';
import PortalCaptureCard from '@/components/annualReturn/PortalCaptureCard';
import PortalTaxPaymentCard from '@/components/annualReturn/PortalTaxPaymentCard';
import ReconciliationCard from '@/components/annualReturn/ReconciliationCard';
import PLInputSummaryCard from '@/components/annualReturn/PLInputSummaryCard';
import AnnualCrossCheckCard from '@/components/annualReturn/AnnualCrossCheckCard';
import Gstr9InputView from '@/components/annualReturn/Gstr9InputView';
import Gstr9OutputDiffView from '@/components/annualReturn/Gstr9OutputDiffView';
import Gstr9cTable12bView from '@/components/annualReturn/Gstr9cTable12bView';
import Annexure1Card from '@/components/annualReturn/Annexure1Card';
import Annexure2Card from '@/components/annualReturn/Annexure2Card';
import Annexure3Card from '@/components/annualReturn/Annexure3Card';
import Annexure4Card from '@/components/annualReturn/Annexure4Card';
import ItcReversalCard from '@/components/annualReturn/ItcReversalCard';
import Gstr9FormView from '@/components/annualReturn/Gstr9FormView';
import NoticeFormatView from '@/components/annualReturn/NoticeFormatView';
import { fyOptions } from '@/lib/annualReturnPeriods';
import { fetchReconciliationLines, isFullyReconciled } from '@/lib/annualReturnReconciliation';

interface Client {
  id: string;
  name: string;
  gstin: string;
  regular_sub_type: string | null;
  builder_itc_type: string | null;
}

type PeriodStatus = 'not_started' | 'in_progress' | 'locked';

interface AnnualReturnPeriod {
  id: string;
  financial_year: string;
  status: PeriodStatus;
  notes: string | null;
  locked_at: string | null;
  updated_at: string;
}

const STATUS_LABEL: Record<PeriodStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  locked: 'Locked',
};

const STATUS_BADGE_VARIANT: Record<PeriodStatus, 'secondary' | 'warning' | 'success'> = {
  not_started: 'secondary',
  in_progress: 'warning',
  locked: 'success',
};

/**
 * Landing page for the Annual Return (GSTR-9 / GSTR-9C) module — deliberately
 * its own top-level nav item, not folded into 2B Reconciliation, ITC Summary
 * or any other existing tab (the working papers this module builds toward
 * span all of those, so it needs to stay a neutral, separate destination).
 *
 * This is Phase 0 of the roadmap: it only tracks whether a (client, FY) pair
 * has been started/is in progress/is locked. Books entry, portal capture,
 * the reconciliation engine and the GSTR-9/9C tables themselves land here in
 * later phases — this page is the anchor they attach to.
 */
const AnnualReturnPage: React.FC = () => {
  const { isStaffRole, user } = useAuth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const [clients, setClients] = useState<Client[]>([]);
  const [financialYear, setFinancialYear] = useState<string>(fyOptions()[2]);
  const [period, setPeriod] = useState<AnnualReturnPeriod | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dutiesVersion, setDutiesVersion] = useState(0);
  const [reconOpenCount, setReconOpenCount] = useState(0);
  const [activeTab, setActiveTab] = useState('status');

  const isStaff = isStaffRole();
  const selectedClient = clients.find((c) => c.id === selectedClientId) || null;
  const isNoItcBuilder = selectedClient?.regular_sub_type === 'Builder' && selectedClient?.builder_itc_type === 'NO_ITC';

  useEffect(() => {
    const fetchClients = async () => {
      let query = supabase
        .from('clients')
        .select('id, name, gstin, regular_sub_type, builder_itc_type')
        .order('name');
      if (user && !isStaff) query = query.eq('id', user.id);
      const { data, error } = await query;
      if (error) { toast.error('Failed to fetch clients: ' + error.message); return; }
      setClients((data || []) as Client[]);
      if (!isStaff && data && data.length > 0 && !selectedClientId) setSelectedClientId(data[0].id);
    };
    fetchClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStaff, user]);

  const loadPeriod = useCallback(async () => {
    if (!selectedClientId || !financialYear) { setPeriod(null); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('annual_return_periods')
      .select('id, financial_year, status, notes, locked_at, updated_at')
      .eq('client_id', selectedClientId)
      .eq('financial_year', financialYear)
      .maybeSingle();
    if (error) { toast.error('Could not load status: ' + error.message); setLoading(false); return; }
    setPeriod((data as AnnualReturnPeriod) || null);
    setLoading(false);
  }, [selectedClientId, financialYear]);

  useEffect(() => { loadPeriod(); }, [loadPeriod]);

  // Powers the Reconciliation tab's badge — same "unexplained gap" count
  // ReconciliationCard computes for its own banner, fetched here too so the
  // tab bar can show it before staff ever click into that tab.
  const loadReconOpenCount = useCallback(async () => {
    if (!selectedClientId || !financialYear) { setReconOpenCount(0); return; }
    try {
      const lines = await fetchReconciliationLines(selectedClientId, financialYear, isNoItcBuilder);
      setReconOpenCount(lines.filter((l) => l.reasonRequired && !l.reason.trim()).length);
    } catch {
      setReconOpenCount(0);
    }
  }, [selectedClientId, financialYear, isNoItcBuilder]);

  useEffect(() => { loadReconOpenCount(); }, [loadReconOpenCount]);

  const updateStatus = async (status: PeriodStatus) => {
    if (!selectedClientId) return;
    setSaving(true);
    try {
      if (status === 'locked') {
        const lines = await fetchReconciliationLines(selectedClientId, financialYear, isNoItcBuilder);
        if (!isFullyReconciled(lines)) {
          const openLabels = lines.filter((l) => l.reasonRequired && !l.reason.trim()).map((l) => l.label);
          toast.error(`Can't lock — reason needed for: ${openLabels.join(', ')}. See the Reconciliation tab.`, {
            action: { label: 'View', onClick: () => setActiveTab('reconciliation') },
          });
          setSaving(false);
          return;
        }
      }
      const payload: Record<string, unknown> = {
        client_id: selectedClientId,
        financial_year: financialYear,
        status,
        updated_at: new Date().toISOString(),
      };
      if (status === 'locked') payload.locked_at = new Date().toISOString();
      if (status === 'not_started' || status === 'in_progress') payload.locked_at = null;
      const { error } = await supabase
        .from('annual_return_periods')
        .upsert(payload, { onConflict: 'client_id,financial_year' });
      if (error) throw error;
      toast.success(`FY ${financialYear} marked "${STATUS_LABEL[status]}".`);
      await loadPeriod();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error('Save failed: ' + message);
    } finally {
      setSaving(false);
    }
  };

  const status = period?.status || 'not_started';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Annual Return (GSTR-9 / 9C)"
        subtitle="Preparation status for the client's annual return — every sheet gets its own tab here, matching the firm's working papers exactly. The GSTR-9/9C tables themselves land as later phases ship."
        icon={<ScrollText className="h-5 w-5" />}
      />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[220px]">
              <Select value={selectedClientId} onValueChange={setSelectedClientId} disabled={!isStaff}>
                <SelectTrigger><SelectValue placeholder="Select a client" /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name} — {c.gstin}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-40">
              <Select value={financialYear} onValueChange={setFinancialYear}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {fyOptions().map((fy) => <SelectItem key={fy} value={fy}>FY {fy}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {!selectedClientId ? (
        <Card><CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          Select a client to see their annual return status.
        </CardContent></Card>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="overflow-x-auto">
            <TabsList>
              <TabsTrigger value="status">Status</TabsTrigger>
              <TabsTrigger value="books">Books Input</TabsTrigger>
              <TabsTrigger value="duties">Duties &amp; Taxes</TabsTrigger>
              <TabsTrigger value="rcm">RCM</TabsTrigger>
              <TabsTrigger value="gstr9input">GSTR 9-Input</TabsTrigger>
              <TabsTrigger value="gstr9output">GSTR 9-Output</TabsTrigger>
              <TabsTrigger value="gstr9c">GSTR 9C</TabsTrigger>
              <TabsTrigger value="annexure">Annexure</TabsTrigger>
              <TabsTrigger value="gstr9form">GSTR-9</TabsTrigger>
              <TabsTrigger value="notice">Notice Format</TabsTrigger>
              <TabsTrigger value="portal">Portal Capture</TabsTrigger>
              <TabsTrigger value="reconciliation" className="gap-1.5">
                Reconciliation
                {reconOpenCount > 0 && (
                  <Badge
                    variant="destructive"
                    className="h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none"
                  >
                    {reconOpenCount}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="status" className="space-y-4">
            {isNoItcBuilder && (
              <Card className="border-info/30 bg-info/5">
                <CardContent className="p-4 flex items-start gap-3 text-sm">
                  <Info className="h-4 w-4 text-info shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium text-foreground">No-ITC scheme client.</span>{' '}
                    <span className="text-muted-foreground">
                      This client is a builder on <code className="text-xs bg-muted px-1 py-0.5 rounded">NO_ITC</code>.
                      The reconciliation engine won&apos;t treat zero ITC here as an unexplained gap —
                      it&apos;s expected for this client, not a mismatch to justify.
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
                <div>
                  <CardTitle className="text-lg">FY {financialYear}</CardTitle>
                  <CardDescription>
                    {period?.updated_at ? `Last updated ${new Date(period.updated_at).toLocaleString('en-IN')}` : 'No activity recorded yet'}
                  </CardDescription>
                </div>
                {loading ? (
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                  </span>
                ) : (
                  <Badge variant={STATUS_BADGE_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={status === 'in_progress' ? 'default' : 'outline'}
                    disabled={saving || status === 'locked'}
                    onClick={() => updateStatus('in_progress')}
                  >
                    <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Mark in progress
                  </Button>
                  {status === 'locked' ? (
                    <Button size="sm" variant="outline" disabled={saving} onClick={() => updateStatus('in_progress')}>
                      <Unlock className="h-3.5 w-3.5 mr-1.5" /> Unlock
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={saving} onClick={() => updateStatus('locked')}>
                      <Lock className="h-3.5 w-3.5 mr-1.5" /> Lock this year
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Locking checks the Reconciliation tab first — every unexplained difference needs a reason on file.
                  The GSTR-9/9C tables themselves aren&apos;t built yet.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="books" className="space-y-4">
            <p className="text-xs text-muted-foreground -mt-1">
              PL-Output and PL-Input — annual, by ledger head, exactly as the firm's working papers have them. No month
              here; monthly entry lives on the Duties &amp; Taxes tab, entered separately by design.
            </p>
            <PLOutputCard clientId={selectedClientId} financialYear={financialYear} />
            <PLInputCard clientId={selectedClientId} financialYear={financialYear} onSaved={() => setDutiesVersion((v) => v + 1)} />
            <PLInputSummaryCard clientId={selectedClientId} financialYear={financialYear} refreshKey={dutiesVersion} />
          </TabsContent>

          <TabsContent value="duties" className="space-y-4">
            <p className="text-xs text-muted-foreground -mt-1">
              Month-wise entry, separate from Books Input by design — the two are meant to cross-check each other's
              annual totals, not derive from one another.
            </p>
            <AnnualCrossCheckCard clientId={selectedClientId} financialYear={financialYear} refreshKey={dutiesVersion} />
            <DutiesTaxesOutputCard clientId={selectedClientId} financialYear={financialYear} onSaved={() => setDutiesVersion((v) => v + 1)} />
            <DutiesTaxesInputCard clientId={selectedClientId} financialYear={financialYear} onSaved={() => setDutiesVersion((v) => v + 1)} />
          </TabsContent>

          <TabsContent value="rcm" className="space-y-4">
            <RcmAnnualReturnCard clientId={selectedClientId} financialYear={financialYear} onSaved={() => setDutiesVersion((v) => v + 1)} />
          </TabsContent>

          <TabsContent value="gstr9input" className="space-y-4">
            <Gstr9InputView clientId={selectedClientId} financialYear={financialYear} />
            <ItcReversalCard clientId={selectedClientId} financialYear={financialYear} />
          </TabsContent>

          <TabsContent value="gstr9output" className="space-y-4">
            <Gstr9OutputLinesCard clientId={selectedClientId} financialYear={financialYear} />
            <Gstr9OutputPortalCard clientId={selectedClientId} financialYear={financialYear} />
            <Gstr9OutputDiffView clientId={selectedClientId} financialYear={financialYear} />
          </TabsContent>

          <TabsContent value="gstr9c" className="space-y-4">
            <Gstr9cTable12bView clientId={selectedClientId} financialYear={financialYear} />
          </TabsContent>

          <TabsContent value="annexure" className="space-y-4">
            <Annexure1Card clientId={selectedClientId} financialYear={financialYear} />
            <Annexure2Card clientId={selectedClientId} financialYear={financialYear} />
            <Annexure3Card clientId={selectedClientId} financialYear={financialYear} />
            <Annexure4Card clientId={selectedClientId} financialYear={financialYear} />
          </TabsContent>

          <TabsContent value="gstr9form" className="space-y-4">
            <p className="text-xs text-muted-foreground -mt-1">
              The full official form, Tables 4–13 — assembled, nothing entered here.
            </p>
            <Gstr9FormView clientId={selectedClientId} financialYear={financialYear} />
          </TabsContent>

          <TabsContent value="notice" className="space-y-4">
            <NoticeFormatView clientId={selectedClientId} financialYear={financialYear} />
          </TabsContent>

          <TabsContent value="portal" className="space-y-4">
            <p className="text-xs text-muted-foreground -mt-1">
              Recent months aren&apos;t auto-pulled reliably yet — enter them from the filed return until that's wired up.
            </p>
            <PortalCaptureCard clientId={selectedClientId} financialYear={financialYear} />
            <PortalTaxPaymentCard clientId={selectedClientId} financialYear={financialYear} />
          </TabsContent>

          <TabsContent value="reconciliation" className="space-y-4">
            <p className="text-xs text-muted-foreground -mt-1">
              Eleven lines, computed live from every sheet above — PL vs Duties &amp; Taxes, RCM Part A vs B, GSTR
              9-Output books vs portal, Table 6/8D/9, and both Annexures. Every unexplained difference needs a
              reason before FY {financialYear} can be locked — no override.
            </p>
            <ReconciliationCard clientId={selectedClientId} financialYear={financialYear} isNoItcBuilder={isNoItcBuilder} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};

export default AnnualReturnPage;
