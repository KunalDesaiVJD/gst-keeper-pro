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
  ChevronUp
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import ClientManagementSection from './ClientManagementSection';
import UserManagementSection from './UserManagementSection';
import PasswordResetRequestsSection from './PasswordResetRequestsSection';
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
  lateFilings: number;
  filedThisMonth: number;
}

interface ReturnMetrics {
  returnType: ReturnType;
  totalClients: number;
  pending: number;
  filed: number;
}


const StaffDashboard: React.FC = () => {
  const { user, canManageEmployees } = useAuth();
  const navigate = useNavigate();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalClients: 0,
    pendingFilings: 0,
    lateFilings: 0,
    filedThisMonth: 0,
  });
  const [returnMetrics, setReturnMetrics] = useState<ReturnMetrics[]>([]);
  const [showReturnBreakdown, setShowReturnBreakdown] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const generateMonths = useCallback(() => {
    const monthsSet = new Set<string>();
    const now = new Date();
    
    // Add default 24 months (past 12 and future 12)
    for (let i = -12; i < 24; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
      monthsSet.add(value);
    }
    
    // Convert to array and sort descending
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
      // Fetch clients with their selected returns, registration dates, and registration_type
      const { data: clientData, count: clientCount } = await supabase
        .from('clients')
        .select('id, selected_returns, registration_date, cancellation_date, registration_type', { count: 'exact' });

      // Fetch filing status for the selected month
      const { data: filingData } = await supabase
        .from('filing_status')
        .select('status, filed_date, target_date, return_type, client_id')
        .eq('period_month', selectedMonth);

      // Helper to check if client is visible for the selected month
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

      // Filter clients visible for this month
      const visibleClients = clientData?.filter(isClientVisibleForMonth) || [];

      const pendingStatuses = ['Prepared', 'Data Pending', 'Mismatch in Data', 'Not Verified', 'Prepared Pending', 'Data Received'];
      const pendingFilings = filingData?.filter(f => pendingStatuses.includes(f.status || ''))?.length || 0;
      const filedThisMonth = filingData?.filter(f => f.status === 'Filed')?.length || 0;
      
      // Calculate late filings based on return type-specific due dates
      // A filing is "late" if it's Filed AND filed_date day > due date for that return type
      const lateFilings = filingData?.filter(f => {
        if (f.status !== 'Filed' || !f.filed_date) return false;
        const filedDay = new Date(f.filed_date).getDate();
        // Get the due date for this return type, fallback to target_date or 11
        const dueDate = RETURN_DUE_DATES[f.return_type] || f.target_date || 11;
        return filedDay > dueDate;
      })?.length || 0;

      setMetrics({
        totalClients: visibleClients.length,
        pendingFilings,
        lateFilings,
        filedThisMonth,
      });

      // Calculate return-wise metrics using visible clients
      // Get all return types, but filter quarterly ones based on month
      // Don't include GSTR-1 (IFF) and GSTR-3B (Q) as separate tabs - they're merged with GSTR-1 and GSTR-3B
      const allReturnTypes: ReturnType[] = ['GSTR-1', 'GSTR-3B', 'ITC-04', 'GSTR-6', 'GSTR-7', 'CMP-08'];
      
      // Parse current month to check if it's quarter end
      const [monthStr] = selectedMonth.split('/');
      const currentMonthNum = parseInt(monthStr);
      const isQuarterEnd = isQuarterEndMonth(currentMonthNum);
      
      const returnMetricsData: ReturnMetrics[] = allReturnTypes
        .filter(rt => {
          // Filter out quarterly returns (CMP-08) if not in quarter end month
          if (QUARTERLY_RETURN_TYPES.includes(rt) && !isQuarterEnd) {
            return false;
          }
          return true;
        })
        .map(rt => {
        // For GSTR-1, include both GSTR-1 and GSTR-1 (IFF) clients
        // For GSTR-3B, include both GSTR-3B and GSTR-3B (Q) clients (only in quarter-end months for IFF/Composition)
        let clientsWithReturn: typeof visibleClients = [];
        
        if (rt === 'GSTR-1') {
          // Include clients with GSTR-1 or GSTR-1 (IFF)
          clientsWithReturn = visibleClients.filter(c => 
            (c.selected_returns || []).includes('GSTR-1') || 
            (c.selected_returns || []).includes('GSTR-1 (IFF)')
          );
        } else if (rt === 'GSTR-3B') {
          // Include clients with GSTR-3B
          // Also include GSTR-3B (Q) clients only in quarter-end months
          clientsWithReturn = visibleClients.filter(c => {
            const hasGSTR3B = (c.selected_returns || []).includes('GSTR-3B');
            const hasGSTR3BQ = (c.selected_returns || []).includes('GSTR-3B (Q)');
            const isQuarterlyClient = c.registration_type === 'IFF' || c.registration_type === 'Composition';
            
            if (hasGSTR3B && !isQuarterlyClient) return true;
            if (hasGSTR3BQ && isQuarterlyClient && isQuarterEnd) return true;
            return false;
          });
        } else {
          // For other returns, check if client has this return type selected
          // For quarterly returns (CMP-08), only count Composition clients
          clientsWithReturn = visibleClients.filter(c => {
            if (!((c.selected_returns || []).includes(rt))) return false;
            
            // For CMP-08, only count in quarter-end months (already filtered above) for Composition clients
            if (rt === 'CMP-08') {
              return c.registration_type === 'Composition';
            }
            
            return true;
          });
        }
        
        const clientsWithReturnCount = clientsWithReturn.length;

        // Count filings for this return type (including merged types)
        let returnFilings: typeof filingData = [];
        if (rt === 'GSTR-1') {
          returnFilings = filingData?.filter(f => f.return_type === 'GSTR-1' || f.return_type === 'GSTR-1 (IFF)') || [];
        } else if (rt === 'GSTR-3B') {
          returnFilings = filingData?.filter(f => f.return_type === 'GSTR-3B' || f.return_type === 'GSTR-3B (Q)') || [];
        } else {
          returnFilings = filingData?.filter(f => f.return_type === rt) || [];
        }
        const filed = returnFilings.filter(f => f.status === 'Filed').length;
        
        // Pending = clients with return - filed (since not all have filing records yet)
        const pending = clientsWithReturnCount - filed;

        return {
          returnType: rt,
          totalClients: clientsWithReturnCount,
          pending: pending > 0 ? pending : 0,
          filed,
        };
      }).filter(rm => rm.totalClients > 0); // Only show returns with clients

      setReturnMetrics(returnMetricsData);
      // User metrics are now handled by UserManagementSection component
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => {
        fetchMetrics();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'filing_status' }, () => {
        fetchMetrics();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_roles' }, () => {
        fetchMetrics();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchMetrics]);

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
      label: 'Late Filings',
      value: metrics.lateFilings,
      icon: <Clock className="h-8 w-8 text-destructive" />,
      onClick: () => navigate('/filing-status?filter=late'),
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
      {/* Header with Month Selector */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back! Here's your overview.</p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-muted-foreground" />
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


      {/* Password Reset Requests Section - All Staff can see */}
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
          {/* Client Metric Cards */}
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

          {/* Return-wise Breakdown Toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowReturnBreakdown(!showReturnBreakdown)}
            className="text-sm text-muted-foreground mb-2"
          >
            {showReturnBreakdown ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
            {showReturnBreakdown ? 'Hide' : 'Show'} Return-wise Breakdown
          </Button>

          {/* Return-wise Breakdown */}
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
                      <td className="p-2">
                        <Badge variant="outline">{rm.returnType}</Badge>
                      </td>
                      <td className="text-center p-2">{rm.totalClients}</td>
                      <td className="text-center p-2">
                        <span className="text-warning font-medium">{rm.pending}</span>
                      </td>
                      <td className="text-center p-2">
                        <span className="text-success font-medium">{rm.filed}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* User Management Section - Superadmin Only */}
      {canManageEmployees() && <UserManagementSection />}

      {/* Client Management Detail Section */}
      <ClientManagementSection />
    </div>
  );
};

export default StaffDashboard;
