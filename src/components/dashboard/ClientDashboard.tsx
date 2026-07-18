import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
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
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Dashboard"
        subtitle="Your GST registration details and filing history."
        icon={<LayoutDashboard className="h-6 w-6" />}
      />

      {/* Client Header */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="h-16 w-16 rounded-lg bg-primary/10 flex items-center justify-center">
                <Building2 className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-heading font-bold text-foreground">
                  {client.name}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  GSTIN: {client.gstin}
                </p>
                <div className="flex items-center gap-4 mt-2">
                  <Badge variant="outline" className="bg-primary/5">
                    {client.registration_type}
                  </Badge>
                  {client.mobile && (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      {client.mobile}
                    </span>
                  )}
                  {client.email && (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Mail className="h-3 w-3" />
                      {client.email}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => window.open('https://eofficeportal.com/client/', '_blank')}
              className="flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Download Portal
              <ExternalLink className="h-3 w-3" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Selected Return Types */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-heading">Return Types</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {selectedReturns.map((returnType) => (
              <Badge key={returnType} className="bg-primary text-primary-foreground">
                {returnType}
              </Badge>
            ))}
            {selectedReturns.length === 0 && (
              <p className="text-muted-foreground">No return types assigned</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Filing Tracker - Monthly matrix showing Filed/Not Filed */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-heading">Filing Tracker</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-primary text-primary-foreground">
                  <th className="text-left py-3 px-4 font-medium">
                    Month
                  </th>
                  {selectedReturns.map((returnType) => (
                    <th
                      key={returnType}
                      className="text-center py-3 px-4 font-medium"
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
                  <tr key={month} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="py-3 px-4 font-medium tabular-nums">{month}</td>
                    {selectedReturns.map((returnType) => {
                      const status = getFilingStatusForMonth(returnType, month);
                      const isFiled = isFiledStatus(status);
                      
                      return (
                        <td key={returnType} className="text-center py-3 px-4">
                          {isFiled ? (
                            <span className="inline-flex items-center gap-1 text-success">
                              <CheckCircle2 className="h-4 w-4" />
                              Filed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-warning">
                              <Clock className="h-4 w-4" />
                              Not Filed
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Password Reset Request Section */}
      <ClientPasswordResetRequest />
    </div>
  );
};

export default ClientDashboard;
