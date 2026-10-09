import React, { useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile, SectionCard } from '@/components/gstr9/ui';
import { WS_PAGE, WS_BTN, WS_TABLE_WRAP, WS_TABLE, WS_TH, WS_TD, WS_TD_NUM, WS_TR, WS_FILTER_LABEL, WS_CONTROL } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Building2,
  ChevronDown,
  ChevronUp,
  FileWarning,
  LayoutDashboard,
  ListTodo
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import ClientManagementSection from './ClientManagementSection';
import UserManagementSection from './UserManagementSection';
import PasswordResetRequestsSection from './PasswordResetRequestsSection';
import TargetDueAlertDialog from './TargetDueAlertDialog';
import TaskReminderDialog from './TaskReminderDialog';
import { ReturnType } from '@/types';
import { generateFilingRecords, DISPLAY_RETURN_TYPES } from '@/lib/filingRecords';
import { SchemeHistoryEntry } from '@/utils/schemeResolver';
import { useState } from 'react';
import { EinvoiceStatusBadge } from '@/components/clients/EinvoiceStatusBadge';
import { loadEinvoiceData, einvoiceAttention, type EinvoiceAttention } from '@/lib/einvoice/thresholdAlerts';
import type { EinvoiceAssessment } from '@/lib/einvoice/threshold';

interface EinvoiceWatchRow {
  id: string;
  name: string;
  exemption: string | null;
  attention: EinvoiceAttention;
  assessment: EinvoiceAssessment;
}

const EINV_ORDER: Record<EinvoiceAttention, number> = { should_tick: 0, next_fy: 1, approaching: 2 };

// Return tabs broken out for the dashboard table (IFF / quarterly shown separately)
const BREAKDOWN_RETURN_TYPES: ReturnType[] = [
  'GSTR-1', 'GSTR-1 (IFF)', 'GSTR-3B', 'GSTR-3B (Q)', 'ITC-04', 'GSTR-6', 'GSTR-7', 'CMP-08',
];

// Due date constants for each return type
const RETURN_DUE_DATES: Record<string, number> = {
  'GSTR-1': 11,
  'GSTR-7': 10,
  'GSTR-6': 13,
  'GSTR-1 (IFF)': 13,
  'GSTR-3B': 20,
  'GSTR-3B (Q)': 22,
  'ITC-04': 25,
  'CMP-08': 18,
};

interface DashboardMetrics {
  totalClients: number;
  pendingFilings: number;
  targetDueToday: number;
  filedThisMonth: number;
}

interface ReturnMetrics {
  returnType: ReturnType;
  totalClients: number;
  pending: number;
  filed: number;
}

interface ReturnBreakdown {
  returnType: string;
  count: number;
}

const SESSION_ALERT_KEY = 'target_due_alert_shown';

const StaffDashboard: React.FC = () => {
  const { user, canManageEmployees } = useAuth();
  const navigate = useNavigate();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalClients: 0,
    pendingFilings: 0,
    targetDueToday: 0,
    filedThisMonth: 0,
  });
  const [returnMetrics, setReturnMetrics] = useState<ReturnMetrics[]>([]);
  const [showReturnBreakdown, setShowReturnBreakdown] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  // Target Due Today alert state
  const [showDueAlert, setShowDueAlert] = useState(false);
  const [dueBreakdown, setDueBreakdown] = useState<ReturnBreakdown[]>([]);

  // Task Reminder dialog — private per staff member (see TaskReminderDialog).
  const [showTaskReminder, setShowTaskReminder] = useState(false);

  // Clients approaching / above the e-invoice limit, or that must e-invoice
  // but are not ticked. Loaded once; the Clients page raises the alerts.
  const [einvWatch, setEinvWatch] = useState<EinvoiceWatchRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadEinvoiceData()
      .then(({ assessments, clientsById }) => {
        if (cancelled) return;
        const rows: EinvoiceWatchRow[] = [];
        assessments.forEach((a, id) => {
          const c = clientsById.get(id);
          if (!c) return;
          const attention = einvoiceAttention(a, !!c.einvoice_applicable);
          if (attention) rows.push({ id, name: c.name, exemption: c.einvoice_exemption, attention, assessment: a });
        });
        rows.sort((x, y) => EINV_ORDER[x.attention] - EINV_ORDER[y.attention]
          || (y.assessment.decidingYear?.turnover ?? 0) - (x.assessment.decidingYear?.turnover ?? 0));
        setEinvWatch(rows);
      })
      .catch((err) => console.error('E-invoice assessment failed:', err));
    return () => { cancelled = true; };
  }, []);

  const generateMonths = useCallback(() => {
    const monthsSet = new Set<string>();
    const now = new Date();
    
    // Future limit: +2 months from today (GST filing logic)
    const maxFutureMonths = 2;
    
    for (let i = -12; i <= maxFutureMonths; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const value = `${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
      monthsSet.add(value);
    }
    
    const months = Array.from(monthsSet).map(value => {
      const [month, year] = value.split('/').map(Number);
      const date = new Date(year, month - 1, 1);
      return {
        value,
        label: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        sortKey: year * 12 + month
      };
    });
    
    return months.sort((a, b) => b.sortKey - a.sortKey).map(({ value, label }) => ({ value, label }));
  }, []);

  const months = generateMonths();

  const fetchMetrics = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data: clientData, count: clientCount } = await supabase
        .from('clients')
        .select('id, selected_returns, registration_date, cancellation_date, registration_cancellation_date, registration_type, target_date_group1, target_date_group2, inactive_at_hand', { count: 'exact' });

      // "Inactive at hand" clients deliberately still count toward Total
      // Clients (a headcount, independent of whether returns are being
      // actively worked) but must NOT count toward anything filing-related
      // below — Pending Filings, Target Due/Overdue, and the breakdown table
      // all need to match the Filing Status page, which already excludes
      // them via generateFilingRecords' own isClientVisibleForMonth check.
      const inactiveClientIds = new Set((clientData || []).filter((c: any) => c.inactive_at_hand).map((c: any) => c.id));

      const { data: filingData } = await supabase
        .from('filing_status')
        .select('status, filed_date, target_date, return_type, client_id')
        .eq('period_month', selectedMonth);

      // Scheme history, so the dashboard resolves the same effective scheme
      // per period as the Filing Status page.
      const { data: schemeData } = await supabase
        .from('client_scheme_history')
        .select('*')
        .order('effective_from_date', { ascending: true });
      const schemeHistoryMap: Record<string, SchemeHistoryEntry[]> = {};
      (schemeData || []).forEach((entry: any) => {
        (schemeHistoryMap[entry.client_id] ??= []).push(entry as SchemeHistoryEntry);
      });

      // Build a client target date lookup from the authoritative clients table
      const clientTargetLookup: Record<string, { g1: number; g2: number }> = {};
      clientData?.forEach((c: any) => {
        clientTargetLookup[c.id] = {
          g1: c.target_date_group1 ?? 11,
          g2: c.target_date_group2 ?? 20,
        };
      });

      // Deliberately does NOT check inactive_at_hand, unlike the shared
      // isClientVisibleForMonth in filingRecords.ts — Total Clients is meant
      // to stay a plain headcount (registered and not cancelled this period)
      // regardless of whether returns are actively being worked on, so
      // "Inactive at hand" clients still count here even though they're
      // excluded from every filing-related tile below.
      const isClientVisibleForMonth = (client: any): boolean => {
        const [monthStr, yearStr] = selectedMonth.split('/');
        const periodDate = new Date(parseInt(yearStr), parseInt(monthStr) - 1, 1);
        const regDate = new Date(client.registration_date);
        const regMonth = new Date(regDate.getFullYear(), regDate.getMonth(), 1);
        if (periodDate < regMonth) return false;
        if (client.cancellation_date) {
          const cancelDate = new Date(client.cancellation_date);
          const cancelMonth = new Date(cancelDate.getFullYear(), cancelDate.getMonth(), 1);
          if (periodDate > cancelMonth) return false;
        }
        return true;
      };

      const visibleClients = clientData?.filter(isClientVisibleForMonth) || [];

      const filedThisMonth = filingData?.filter(f => f.status === 'Filed')?.length || 0;
      
      // Calculate Target Due Today: target_date <= today's day AND status != Filed (includes overdue)
      const todayDate = new Date().getDate();
      // Helper to get authoritative target date for a filing record
      const getAuthoritativeTargetDate = (f: any): number | null => {
        const clientTargets = clientTargetLookup[f.client_id];
        if (!clientTargets) return f.target_date;
        const group1Types = ['GSTR-1', 'GSTR-1 (IFF)', 'GSTR-7', 'GSTR-6'];
        return group1Types.includes(f.return_type) ? clientTargets.g1 : clientTargets.g2;
      };

      const targetDueToday = filingData?.filter(f => {
        if (inactiveClientIds.has(f.client_id)) return false;
        const td = getAuthoritativeTargetDate(f);
        return td !== null && td <= todayDate && f.status !== 'Filed';
      })?.length || 0;

      // Calculate return-wise breakdown for due targets (today + overdue)
      const todayDueFilings = filingData?.filter(f => {
        if (inactiveClientIds.has(f.client_id)) return false;
        const td = getAuthoritativeTargetDate(f);
        return td !== null && td <= todayDate && f.status !== 'Filed';
      }) || [];
      
      const breakdownMap = new Map<string, number>();
      todayDueFilings.forEach(f => {
        let displayType = f.return_type;
        if (f.return_type === 'GSTR-1 (IFF)') displayType = 'GSTR-1';
        if (f.return_type === 'GSTR-3B (Q)') displayType = 'GSTR-3B';
        breakdownMap.set(displayType, (breakdownMap.get(displayType) || 0) + 1);
      });
      
      const breakdown: ReturnBreakdown[] = Array.from(breakdownMap.entries()).map(([returnType, count]) => ({
        returnType,
        count,
      }));
      setDueBreakdown(breakdown);

      // Show alert once per session if there are due filings today
      if (targetDueToday > 0 && !sessionStorage.getItem(SESSION_ALERT_KEY)) {
        setShowDueAlert(true);
        sessionStorage.setItem(SESSION_ALERT_KEY, 'true');
      }

      // Build the canonical per-client filing rows for the month using the same
      // shared logic as the Filing Status page, so the counts always tally.
      const allFilingRows = DISPLAY_RETURN_TYPES.flatMap(dt =>
        generateFilingRecords({
          displayReturnType: dt,
          clients: clientData || [],
          filingRecords: (filingData || []) as any,
          schemeHistoryMap,
          selectedMonth,
        })
      );

      // Return-wise breakdown (IFF / quarterly broken out), grouped by actual return type.
      const returnMetricsData: ReturnMetrics[] = BREAKDOWN_RETURN_TYPES
        .map(rt => {
          const rows = allFilingRows.filter(r => r.return_type === rt);
          if (rows.length === 0) return null;
          const filed = rows.filter(r => r.status === 'Filed').length;
          return {
            returnType: rt,
            totalClients: rows.length,
            pending: rows.length - filed,
            filed,
          } as ReturnMetrics;
        })
        .filter((rm): rm is ReturnMetrics => rm !== null);

      // Pending tile = every applicable filing whose status is not Filed.
      const totalPending = allFilingRows.filter(r => r.status !== 'Filed').length;

      setMetrics({
        totalClients: visibleClients.length,
        pendingFilings: totalPending,
        targetDueToday,
        filedThisMonth,
      });

      setReturnMetrics(returnMetricsData);
    } catch (error) {
      console.error('Error fetching metrics:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedMonth, canManageEmployees]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  useEffect(() => {
    const channel = supabase
      .channel('dashboard-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => fetchMetrics())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'filing_status' }, () => fetchMetrics())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_scheme_history' }, () => fetchMetrics())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_roles' }, () => fetchMetrics())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchMetrics]);

  const handleTargetDueClick = () => {
    const todayDate = new Date().getDate();
    navigate(`/filing-status?filter=target_due_today&targetDate=${todayDate}&includeOverdue=true`);
  };

  const loadingValue = (n: number) => (isLoading ? '—' : n);

  const clientMetricCards: { label: string; value: React.ReactNode; tone: 'ok' | 'warn' | 'error' | 'neutral'; onClick: () => void; title: string }[] = [
    {
      label: 'Total Clients',
      value: loadingValue(metrics.totalClients),
      tone: 'neutral',
      onClick: () => navigate('/clients'),
      title: 'Open Clients',
    },
    {
      label: 'Pending Filings',
      value: loadingValue(metrics.pendingFilings),
      tone: isLoading ? 'neutral' : metrics.pendingFilings ? 'warn' : 'ok',
      onClick: () => navigate('/filing-status?filter=pending'),
      title: 'Open pending filings in Filing Status',
    },
    {
      label: 'Target Due / Overdue',
      value: loadingValue(metrics.targetDueToday),
      tone: isLoading ? 'neutral' : metrics.targetDueToday ? 'error' : 'ok',
      onClick: handleTargetDueClick,
      title: 'Open target due / overdue filings in Filing Status',
    },
    {
      label: 'Filed This Month',
      value: loadingValue(metrics.filedThisMonth),
      tone: isLoading || !metrics.filedThisMonth ? 'neutral' : 'ok',
      onClick: () => navigate('/filing-status?filter=filed'),
      title: 'Open filed returns in Filing Status',
    },
  ];

  return (
    <div className={WS_PAGE}>
      {/* Target Due Today Alert */}
      <TargetDueAlertDialog
        open={showDueAlert}
        onOpenChange={setShowDueAlert}
        totalCount={metrics.targetDueToday}
        breakdown={dueBreakdown}
      />

      {/* Header with Month Selector */}
      <PageHeader
        compact
        title="Dashboard"
        subtitle="Welcome back! Here's your overview."
        icon={<LayoutDashboard />}
        actions={
          <>
            <Button variant="outline" size="sm" className={WS_BTN} onClick={() => setShowTaskReminder(true)}>
              <ListTodo className="h-3.5 w-3.5" />
              Task Reminder
            </Button>
            <label className="flex items-center gap-1.5">
              <span className={WS_FILTER_LABEL}>Return Period</span>
              <div className="w-44">
                <SearchableMonthSelect
                  options={months}
                  value={selectedMonth}
                  onValueChange={setSelectedMonth}
                  placeholder="Select Month"
                  className={WS_CONTROL}
                />
              </div>
            </label>
          </>
        }
      />
      {user && (
        <TaskReminderDialog open={showTaskReminder} onOpenChange={setShowTaskReminder} userId={user.id} />
      )}

      <PasswordResetRequestsSection />

      <SectionCard
        title={
          <span className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            Client Management
          </span>
        }
        description="Overview of client filings and status"
      >
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {clientMetricCards.map((card) => (
            <NavTile key={card.label} onClick={card.onClick} title={card.title}>
              <KpiTile label={card.label} value={card.value} tone={card.tone} />
            </NavTile>
          ))}
        </div>

        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowReturnBreakdown(!showReturnBreakdown)}
            aria-expanded={showReturnBreakdown}
            className={cn(WS_BTN, 'text-muted-foreground')}
          >
            {showReturnBreakdown ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showReturnBreakdown ? 'Hide' : 'Show'} Return-wise Breakdown
          </Button>
        </div>

        {showReturnBreakdown && returnMetrics.length > 0 && (
          <div className={WS_TABLE_WRAP}>
            <table className={WS_TABLE}>
              <thead>
                <tr>
                  <th className={WS_TH}>Return Type</th>
                  <th className={cn(WS_TH, 'text-right')}>Total Clients</th>
                  <th className={cn(WS_TH, 'text-right')}>Pending</th>
                  <th className={cn(WS_TH, 'text-right')}>Filed</th>
                </tr>
              </thead>
              <tbody>
                {returnMetrics.map((rm) => (
                  <tr key={rm.returnType} className={WS_TR}>
                    <td className={WS_TD}><Badge variant="outline" className="text-[10px] font-medium">{rm.returnType}</Badge></td>
                    <td className={WS_TD_NUM}>{rm.totalClients}</td>
                    <td className={cn(WS_TD_NUM, 'font-medium', rm.pending > 0 && 'text-warning')}>{rm.pending}</td>
                    <td className={cn(WS_TD_NUM, 'font-medium', rm.filed > 0 && 'text-success-strong')}>{rm.filed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {einvWatch.length > 0 && (
        <SectionCard
          title={
            <span className="flex items-center gap-2">
              <FileWarning className="h-4 w-4 text-warning" />
              E-invoice threshold
            </span>
          }
          description="Clients approaching or above the ₹5 crore e-invoice limit, or that must e-invoice but are not ticked."
          actions={
            <Button variant="outline" size="sm" className={WS_BTN} onClick={() => navigate('/clients')}>
              Open Clients
            </Button>
          }
        >
          <div className={cn(WS_TABLE_WRAP, 'max-h-64')}>
            <table className={WS_TABLE}>
              <thead>
                <tr>
                  <th className={WS_TH}>Client</th>
                  <th className={WS_TH}>Status</th>
                  <th className={cn(WS_TH, 'text-right')}>FY</th>
                  <th className={cn(WS_TH, 'text-right')}>Turnover</th>
                </tr>
              </thead>
              <tbody>
                {einvWatch.map((r) => (
                  <tr key={r.id} className={WS_TR}>
                    <td className={WS_TD}>
                      <button
                        type="button"
                        className="text-left font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => navigate(`/clients?einvoice=${r.attention === 'should_tick' ? 'should_tick' : 'approaching'}`)}
                        title={r.assessment.message}
                      >
                        {r.name}
                      </button>
                    </td>
                    <td className={WS_TD}>
                      <EinvoiceStatusBadge ticked={false} exemption={r.exemption} assessment={r.assessment} />
                    </td>
                    <td className={WS_TD_NUM}>{r.assessment.decidingYear?.financial_year ?? '—'}</td>
                    <td className={WS_TD_NUM}>
                      {r.assessment.decidingYear
                        ? `₹${(r.assessment.decidingYear.turnover / 1_00_00_000).toFixed(2)} cr`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {canManageEmployees() && <UserManagementSection />}
      <ClientManagementSection />
    </div>
  );
};

/** A KpiTile that navigates elsewhere when clicked. */
const NavTile: React.FC<{ onClick: () => void; title: string; children: React.ReactNode }> = ({ onClick, title, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className="rounded-lg text-left transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>div]:h-full [&>div]:transition-colors [&>div]:hover:bg-muted/30"
  >
    {children}
  </button>
);

export default StaffDashboard;
