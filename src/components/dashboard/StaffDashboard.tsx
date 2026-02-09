import React, { useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { 
  AlertTriangle, 
  CheckCircle2, 
  Clock,
  Calendar,
  Building2,
  ChevronDown,
  ChevronUp,
  Target
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import ClientManagementSection from './ClientManagementSection';
import UserManagementSection from './UserManagementSection';
import PasswordResetRequestsSection from './PasswordResetRequestsSection';
import TargetDueAlertDialog from './TargetDueAlertDialog';
import { ReturnType, QUARTERLY_RETURN_TYPES, isQuarterEndMonth } from '@/types';
import { useState } from 'react';

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

  const generateMonths = useCallback(() => {
    const monthsSet = new Set<string>();
    const now = new Date();
    
    for (let i = -12; i < 24; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
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
        .select('id, selected_returns, registration_date, cancellation_date, registration_type', { count: 'exact' });

      const { data: filingData } = await supabase
        .from('filing_status')
        .select('status, filed_date, target_date, return_type, client_id')
        .eq('period_month', selectedMonth);

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

      const pendingStatuses = ['Prepared', 'Data Pending', 'Mismatch in Data', 'Not Verified', 'Prepared Pending', 'Data Received'];
      const pendingFilings = filingData?.filter(f => pendingStatuses.includes(f.status || ''))?.length || 0;
      const filedThisMonth = filingData?.filter(f => f.status === 'Filed')?.length || 0;
      
      // Calculate Target Due Today: target_date <= today's day AND status != Filed (includes overdue)
      const todayDate = new Date().getDate();
      const targetDueToday = filingData?.filter(f => 
        f.target_date !== null && f.target_date <= todayDate && f.status !== 'Filed'
      )?.length || 0;

      // Calculate return-wise breakdown for due targets (today + overdue)
      const todayDueFilings = filingData?.filter(f => 
        f.target_date !== null && f.target_date <= todayDate && f.status !== 'Filed'
      ) || [];
      
      const breakdownMap = new Map<string, number>();
      todayDueFilings.forEach(f => {
        // Merge IFF into GSTR-1 and GSTR-3B(Q) into GSTR-3B for display
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

      setMetrics({
        totalClients: visibleClients.length,
        pendingFilings,
        targetDueToday,
        filedThisMonth,
      });

      // Show alert once per session if there are due filings today
      if (targetDueToday > 0 && !sessionStorage.getItem(SESSION_ALERT_KEY)) {
        setShowDueAlert(true);
        sessionStorage.setItem(SESSION_ALERT_KEY, 'true');
      }

      // Calculate return-wise metrics with IFF/Normal bifurcation for GSTR-1 and GSTR-3B
      const allReturnTypes: ReturnType[] = ['GSTR-1', 'GSTR-3B', 'ITC-04', 'GSTR-6', 'GSTR-7', 'CMP-08'];
      const [monthStr] = selectedMonth.split('/');
      const currentMonthNum = parseInt(monthStr);
      const isQuarterEnd = isQuarterEndMonth(currentMonthNum);
      
      const returnMetricsData: ReturnMetrics[] = [];
      
      for (const rt of allReturnTypes) {
        if (QUARTERLY_RETURN_TYPES.includes(rt) && !isQuarterEnd) continue;
        
        if (rt === 'GSTR-1') {
          // Normal GSTR-1 clients
          const normalClients = visibleClients.filter(c => 
            (c.selected_returns || []).includes('GSTR-1') && c.registration_type !== 'IFF'
          );
          const normalFilings = filingData?.filter(f => f.return_type === 'GSTR-1') || [];
          const normalFiled = normalFilings.filter(f => f.status === 'Filed').length;
          
          if (normalClients.length > 0) {
            returnMetricsData.push({
              returnType: 'GSTR-1' as ReturnType,
              totalClients: normalClients.length,
              pending: Math.max(0, normalClients.length - normalFiled),
              filed: normalFiled,
            });
          }
          
          // IFF clients
          const iffClients = visibleClients.filter(c => 
            (c.selected_returns || []).includes('GSTR-1 (IFF)')
          );
          if (iffClients.length > 0 && isQuarterEnd) {
            const iffFilings = filingData?.filter(f => f.return_type === 'GSTR-1 (IFF)') || [];
            const iffFiled = iffFilings.filter(f => f.status === 'Filed').length;
            returnMetricsData.push({
              returnType: 'GSTR-1 (IFF)' as ReturnType,
              totalClients: iffClients.length,
              pending: Math.max(0, iffClients.length - iffFiled),
              filed: iffFiled,
            });
          }
        } else if (rt === 'GSTR-3B') {
          // Normal GSTR-3B clients
          const normalClients = visibleClients.filter(c => {
            const hasGSTR3B = (c.selected_returns || []).includes('GSTR-3B');
            const isQuarterlyClient = c.registration_type === 'IFF' || c.registration_type === 'Composition';
            return hasGSTR3B && !isQuarterlyClient;
          });
          const normalFilings = filingData?.filter(f => f.return_type === 'GSTR-3B') || [];
          const normalFiled = normalFilings.filter(f => f.status === 'Filed').length;
          
          if (normalClients.length > 0) {
            returnMetricsData.push({
              returnType: 'GSTR-3B' as ReturnType,
              totalClients: normalClients.length,
              pending: Math.max(0, normalClients.length - normalFiled),
              filed: normalFiled,
            });
          }
          
          // Quarterly GSTR-3B (Q) clients
          if (isQuarterEnd) {
            const qClients = visibleClients.filter(c => {
              const hasGSTR3BQ = (c.selected_returns || []).includes('GSTR-3B (Q)');
              const isQuarterlyClient = c.registration_type === 'IFF' || c.registration_type === 'Composition';
              return hasGSTR3BQ && isQuarterlyClient;
            });
            if (qClients.length > 0) {
              const qFilings = filingData?.filter(f => f.return_type === 'GSTR-3B (Q)') || [];
              const qFiled = qFilings.filter(f => f.status === 'Filed').length;
              returnMetricsData.push({
                returnType: 'GSTR-3B (Q)' as ReturnType,
                totalClients: qClients.length,
                pending: Math.max(0, qClients.length - qFiled),
                filed: qFiled,
              });
            }
          }
        } else {
          const clientsWithReturn = visibleClients.filter(c => {
            if (!((c.selected_returns || []).includes(rt))) return false;
            if (rt === 'CMP-08') return c.registration_type === 'Composition';
            return true;
          });
          
          const returnFilings = filingData?.filter(f => f.return_type === rt) || [];
          const filed = returnFilings.filter(f => f.status === 'Filed').length;

          if (clientsWithReturn.length > 0) {
            returnMetricsData.push({
              returnType: rt,
              totalClients: clientsWithReturn.length,
              pending: Math.max(0, clientsWithReturn.length - filed),
              filed,
            });
          }
        }
      }

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_roles' }, () => fetchMetrics())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchMetrics]);

  const handleTargetDueClick = () => {
    const todayDate = new Date().getDate();
    navigate(`/filing-status?filter=target_due_today&targetDate=${todayDate}&includeOverdue=true`);
  };

  const clientMetricCards = [
    {
      label: 'Total Clients',
      value: metrics.totalClients,
      icon: <Building2 className="h-8 w-8 text-primary" />,
      onClick: () => navigate('/clients'),
      bgColor: 'bg-primary/5',
    },
    {
      label: 'Pending Filings',
      value: metrics.pendingFilings,
      icon: <AlertTriangle className="h-8 w-8 text-warning" />,
      onClick: () => navigate('/filing-status?filter=pending'),
      bgColor: 'bg-warning/5',
    },
    {
      label: 'Target Due / Overdue',
      value: metrics.targetDueToday,
      icon: <Target className="h-8 w-8 text-destructive" />,
      onClick: handleTargetDueClick,
      bgColor: 'bg-destructive/5',
    },
    {
      label: 'Filed This Month',
      value: metrics.filedThisMonth,
      icon: <CheckCircle2 className="h-8 w-8 text-success" />,
      onClick: () => navigate('/filing-status?filter=filed'),
      bgColor: 'bg-success/5',
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Target Due Today Alert */}
      <TargetDueAlertDialog
        open={showDueAlert}
        onOpenChange={setShowDueAlert}
        totalCount={metrics.targetDueToday}
        breakdown={dueBreakdown}
      />

      {/* Header with Month Selector */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back! Here's your overview.</p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-[10px] text-muted-foreground mb-0.5">Return Period</p>
            <div className="w-48">
              <SearchableMonthSelect
                options={months}
                value={selectedMonth}
                onValueChange={setSelectedMonth}
                placeholder="Select Month"
              />
            </div>
          </div>
        </div>
      </div>

      <PasswordResetRequestsSection />
      <Card>
        <CardHeader className="pb-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Client Management
            </CardTitle>
            <CardDescription>Overview of client filings and status</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {clientMetricCards.map((card, index) => (
              <Card 
                key={index}
                className="metric-card cursor-pointer hover:shadow-card-hover transition-all duration-200 border"
                onClick={card.onClick}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground font-medium">{card.label}</p>
                      <p className="text-3xl font-bold text-foreground mt-1">
                        {isLoading ? '...' : card.value}
                      </p>
                    </div>
                    <div className={`p-2 rounded-full ${card.bgColor}`}>
                      {card.icon}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowReturnBreakdown(!showReturnBreakdown)}
            className="text-sm text-muted-foreground mb-2"
          >
            {showReturnBreakdown ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
            {showReturnBreakdown ? 'Hide' : 'Show'} Return-wise Breakdown
          </Button>

          {showReturnBreakdown && returnMetrics.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 font-medium">Return Type</th>
                    <th className="text-center p-2 font-medium">Total Clients</th>
                    <th className="text-center p-2 font-medium">Pending</th>
                    <th className="text-center p-2 font-medium">Filed</th>
                  </tr>
                </thead>
                <tbody>
                  {returnMetrics.map((rm) => (
                    <tr key={rm.returnType} className="border-b hover:bg-muted/30">
                      <td className="p-2"><Badge variant="outline">{rm.returnType}</Badge></td>
                      <td className="text-center p-2">{rm.totalClients}</td>
                      <td className="text-center p-2"><span className="text-warning font-medium">{rm.pending}</span></td>
                      <td className="text-center p-2"><span className="text-success font-medium">{rm.filed}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {canManageEmployees() && <UserManagementSection />}
      <ClientManagementSection />
    </div>
  );
};

export default StaffDashboard;
