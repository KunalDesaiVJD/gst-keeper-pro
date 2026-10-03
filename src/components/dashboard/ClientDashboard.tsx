import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/gstr9/badge';
import { SectionCard } from '@/components/gstr9/ui';
import { WS_PAGE, WS_BTN, WS_TABLE_WRAP, WS_TABLE, WS_TH, WS_TD, WS_TR } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Building2,
  LayoutDashboard,
  Loader2,
  Phone,
  Mail
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import ClientPasswordResetRequest from '@/components/clients/ClientPasswordResetRequest';

interface ClientData {
  id: string;
  name: string;
  gstin: string;
  registration_type: string;
  registration_date: string;
  mobile: string | null;
  email: string | null;
  selected_returns: string[] | null;
}

interface FilingStatus {
  return_type: string;
  period_month: string;
  status: string;
}

const ClientDashboard: React.FC = () => {
  const { user } = useAuth();
  const [client, setClient] = useState<ClientData | null>(null);
  const [filingStatuses, setFilingStatuses] = useState<FilingStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchClientData = useCallback(async () => {
    if (!user?.userId) return;

    setIsLoading(true);
    try {
      // Find client by matching PAN (userId) in GSTIN
      const { data: clients, error } = await supabase
        .from('clients')
        .select('*')
        .ilike('gstin', `%${user.userId.toUpperCase()}%`);

      if (error) {
        console.error('Error fetching client:', error);
        return;
      }

      if (clients && clients.length > 0) {
        const clientData = clients[0];
        setClient(clientData);

        // Fetch filing status for this client
        const { data: statusData } = await supabase
          .from('filing_status')
          .select('return_type, period_month, status')
          .eq('client_id', clientData.id)
          .order('period_month', { ascending: false });

        setFilingStatuses(statusData || []);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user?.userId]);

  useEffect(() => {
    fetchClientData();
  }, [fetchClientData]);

  // Real-time subscription
  useEffect(() => {
    if (!client?.id) return;

    const channel = supabase
      .channel('client-dashboard-changes')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'filing_status',
        filter: `client_id=eq.${client.id}`
      }, () => {
        fetchClientData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [client?.id, fetchClientData]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </CardContent>
      </Card>
    );
  }

  if (!client) {
    return (
      <div className="flex items-center justify-center h-64">
        <TableEmptyState
          icon={<Building2 className="h-6 w-6" />}
          title="Client data not found"
          description="We couldn't find a client profile linked to your login. Please contact your GST manager."
        />
      </div>
    );
  }

  const selectedReturns = client.selected_returns || [];

  // Generate months from registration date
  const getMonthsFromRegistration = () => {
    const regDate = new Date(client.registration_date);
    const now = new Date();
    const months: string[] = [];
    
    let current = new Date(regDate.getFullYear(), regDate.getMonth(), 1);
    while (current <= now) {
      const monthStr = `${String(current.getMonth() + 1).padStart(2, '0')}/${current.getFullYear()}`;
      months.push(monthStr);
      current.setMonth(current.getMonth() + 1);
    }
    
    return months.slice(-12).reverse(); // Last 12 months, most recent first
  };

  const months = getMonthsFromRegistration();

  const getFilingStatusForMonth = (returnType: string, month: string) => {
    const status = filingStatuses.find(
      f => f.return_type === returnType && f.period_month === month
    );
    return status?.status || 'Pending';
  };

  const isFiledStatus = (status: string) => {
    return status === 'Filed';
  };

  return (
    <div className={WS_PAGE}>
      <PageHeader
        compact
        title="Dashboard"
        subtitle="Your GST registration details and filing history."
        icon={<LayoutDashboard />}
      />

      {/* Client Header */}
      <Card>
        <CardContent className="px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-base font-heading font-bold leading-tight text-foreground">
                  {client.name}
                </h2>
                <p className="text-xs text-muted-foreground">
                  GSTIN: <span className="font-mono">{client.gstin}</span>
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge variant="info" className="text-[10px] font-medium">
                    {client.registration_type}
                  </Badge>
                  {client.mobile && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      {client.mobile}
                    </span>
                  )}
                  {client.email && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Mail className="h-3 w-3" />
                      {client.email}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open('https://eofficeportal.com/client/', '_blank')}
              className={WS_BTN}
            >
              <Download className="h-3.5 w-3.5" />
              Download Portal
              <ExternalLink className="h-3 w-3" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Selected Return Types */}
      <SectionCard title="Return Types">
        <div className="flex flex-wrap gap-1.5">
          {selectedReturns.map((returnType) => (
            <Badge key={returnType} variant="outline" className="text-[10px] font-medium">
              {returnType}
            </Badge>
          ))}
          {selectedReturns.length === 0 && (
            <p className="text-sm text-muted-foreground">No return types assigned</p>
          )}
        </div>
      </SectionCard>

      {/* Filing Tracker - Monthly matrix showing Filed/Not Filed */}
      <SectionCard title="Filing Tracker">
        <div className={WS_TABLE_WRAP}>
          <table className={WS_TABLE}>
            <thead>
              <tr>
                <th className={WS_TH}>
                  Month
                </th>
                {selectedReturns.map((returnType) => (
                  <th
                    key={returnType}
                    className={cn(WS_TH, 'text-center')}
                  >
                    {returnType}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.length === 0 && (
                <TableEmptyState
                  colSpan={selectedReturns.length + 1}
                  icon={<Clock className="h-6 w-6" />}
                  title="No filing periods yet"
                  description="Filing periods appear here once your registration date has passed."
                />
              )}
              {months.map((month) => (
                <tr key={month} className={WS_TR}>
                  <td className={cn(WS_TD, 'font-medium tabular-nums')}>{month}</td>
                  {selectedReturns.map((returnType) => {
                    const status = getFilingStatusForMonth(returnType, month);
                    const isFiled = isFiledStatus(status);

                    return (
                      <td key={returnType} className={cn(WS_TD, 'text-center')}>
                        {isFiled ? (
                          <Badge variant="success" className="gap-1 text-[10px] font-medium">
                            <CheckCircle2 className="h-3 w-3 text-success" />
                            Filed
                          </Badge>
                        ) : (
                          <Badge variant="warning" className="gap-1 text-[10px] font-medium">
                            <Clock className="h-3 w-3 text-warning" />
                            Not Filed
                          </Badge>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Password Reset Request Section */}
      <ClientPasswordResetRequest />
    </div>
  );
};

export default ClientDashboard;
