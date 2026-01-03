import React from 'react';
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
  Phone,
  Mail
} from 'lucide-react';
import { mockClients, mockFilingStatus } from '@/data/mockData';

const ClientDashboard: React.FC = () => {
  const { user } = useAuth();
  
  // Find client data by matching PAN (userId) in GSTIN
  const client = mockClients.find(c => 
    c.gstin.includes(user?.userId || '')
  );

  if (!client) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Client data not found.</p>
      </div>
    );
  }

  // Get filing status for this client only
  const clientFilingStatus = mockFilingStatus.filter(f => f.clientId === client.id);

  // Generate months from registration date
  const getMonthsFromRegistration = () => {
    const regDate = new Date(client.registrationDate);
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
    const status = clientFilingStatus.find(
      f => f.returnType === returnType && f.month === month
    );
    return status?.status || 'Pending';
  };

  const isFiledStatus = (status: string) => {
    return status === 'Filed';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Client Header */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="h-16 w-16 rounded-lg bg-primary/10 flex items-center justify-center">
                <Building2 className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-heading font-bold text-foreground">
                  {client.name}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  GSTIN: {client.gstin}
                </p>
                <div className="flex items-center gap-4 mt-2">
                  <Badge variant="outline" className="bg-primary/5">
                    {client.registrationType}
                  </Badge>
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Phone className="h-3 w-3" />
                    {client.mobile}
                  </span>
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Mail className="h-3 w-3" />
                    {client.email}
                  </span>
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
            {client.selectedReturns.map((returnType) => (
              <Badge key={returnType} className="bg-primary text-primary-foreground">
                {returnType}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Filing Tracker - Monthly matrix showing Filed/Not Filed */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-heading">Filing Tracker</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">
                    Month
                  </th>
                  {client.selectedReturns.map((returnType) => (
                    <th 
                      key={returnType} 
                      className="text-center py-3 px-4 font-medium text-muted-foreground"
                    >
                      {returnType}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {months.map((month) => (
                  <tr key={month} className="border-b border-border hover:bg-muted/30">
                    <td className="py-3 px-4 font-medium">{month}</td>
                    {client.selectedReturns.map((returnType) => {
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
    </div>
  );
};

export default ClientDashboard;
