import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ScrollText, ShieldCheck, Lock, Unlock, Info } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { toast } from 'sonner';

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

// Current FY (Apr–Mar) plus the previous 2 and next 1 — same window every
// other financial-year picker in the app uses.
const fyOptions = (): string[] => {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const years: string[] = [];
  for (let i = -2; i <= 1; i++) {
    const y = startYear + i;
    years.push(`${y}-${String(y + 1).slice(-2)}`);
  }
  return years;
};

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

  const updateStatus = async (status: PeriodStatus) => {
    if (!selectedClientId) return;
    setSaving(true);
    try {
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
        subtitle="Preparation status for the client's annual return — books input, portal capture, reconciliation and the 9/9C tables land here as each phase ships."
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
        <>
          {isNoItcBuilder && (
            <Card className="border-info/30 bg-info/5">
              <CardContent className="p-4 flex items-start gap-3 text-sm">
                <Info className="h-4 w-4 text-info shrink-0 mt-0.5" />
                <div>
                  <span className="font-medium text-foreground">No-ITC scheme client.</span>{' '}
                  <span className="text-muted-foreground">
                    This client is a builder on <code className="text-xs bg-muted px-1 py-0.5 rounded">NO_ITC</code>.
                    When the reconciliation engine ships, zero ITC here won&apos;t be treated as an unexplained gap —
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
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
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
                This is the foundation step only — books entry, portal capture, the reconciliation engine and the
                GSTR-9/9C tables themselves aren&apos;t built yet. Locking here doesn&apos;t yet check for unexplained
                gaps (that rule ships with the reconciliation engine); for now it's a plain status marker.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default AnnualReturnPage;
