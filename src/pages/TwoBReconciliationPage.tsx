import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Upload, 
  Download, 
  Plus,
  History,
  Lock,
  Unlock,
  AlertCircle
} from 'lucide-react';
import { mockClients, mock2BNotIn2B } from '@/data/mockData';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';

const TwoBReconciliationPage: React.FC = () => {
  const { user, canViewVersionHistory, canUnlockSheets } = useAuth();
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>('01/2026');

  const selectedClientData = mockClients.find(c => c.id === selectedClient);

  const currentMonthData = mock2BNotIn2B.filter(b => b.clientId === selectedClient);

  const totals = currentMonthData.reduce((acc, row) => ({
    taxableValue: acc.taxableValue + row.taxableValue,
    igst: acc.igst + row.inputIgst,
    cgst: acc.cgst + row.inputCgst,
    sgst: acc.sgst + row.inputSgst,
  }), { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 });

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">2B Reconciliation</h1>
          <p className="text-muted-foreground">Manage bills not available in 2B or Books</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Import Excel
          </Button>
          <Button variant="outline" className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export Excel
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 max-w-xs">
              <Select value={selectedClient} onValueChange={setSelectedClient}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Client" />
                </SelectTrigger>
                <SelectContent>
                  {mockClients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-40">
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Month" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="01/2026">Jan 2026</SelectItem>
                  <SelectItem value="12/2025">Dec 2025</SelectItem>
                  <SelectItem value="11/2025">Nov 2025</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {canViewVersionHistory() && selectedClient && (
              <Button variant="outline" className="flex items-center gap-2">
                <History className="h-4 w-4" />
                View Versions
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {!selectedClient ? (
        <Card>
          <CardContent className="p-12 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Please select a client to view 2B reconciliation data.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Last Updated Info */}
          {currentMonthData.length > 0 && (
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                Last Updated: {format(currentMonthData[0].updatedAt, 'dd-MMM-yyyy HH:mm')} IST by {currentMonthData[0].updatedBy}
                <Badge variant="outline" className="text-xs">v{currentMonthData[0].version}</Badge>
              </div>
              {canUnlockSheets() && (
                <Button variant="ghost" size="sm" className="flex items-center gap-1">
                  <Unlock className="h-3 w-3" />
                  Unlock Sheet
                </Button>
              )}
            </div>
          )}

          {/* Table 1: Bills Not Available in 2B */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Bills Not Available in 2B</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Client: {selectedClientData?.name}
                </p>
              </div>
              <Button size="sm" className="flex items-center gap-1">
                <Plus className="h-4 w-4" />
                Add Row
              </Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="gst-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Supplier Name</th>
                      <th>Invoice No.</th>
                      <th>GSTIN</th>
                      <th className="text-right">Taxable Value</th>
                      <th className="text-right">IGST</th>
                      <th className="text-right">CGST</th>
                      <th className="text-right">SGST</th>
                      <th>Reversal Month</th>
                      <th>Reclaim Month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentMonthData.map((row) => (
                      <tr key={row.id}>
                        <td>{format(row.date, 'dd/MM/yyyy')}</td>
                        <td>{row.supplierName}</td>
                        <td>{row.supplierInvoiceNumber}</td>
                        <td className="font-mono text-xs">{row.supplierGstin}</td>
                        <td className="text-right">{row.taxableValue.toLocaleString('en-IN')}</td>
                        <td className="text-right">{row.inputIgst.toLocaleString('en-IN')}</td>
                        <td className="text-right">{row.inputCgst.toLocaleString('en-IN')}</td>
                        <td className="text-right">{row.inputSgst.toLocaleString('en-IN')}</td>
                        <td>{row.reversalMonth}</td>
                        <td>{row.reclaimMonth || '-'}</td>
                      </tr>
                    ))}
                    {currentMonthData.length === 0 && (
                      <tr>
                        <td colSpan={10} className="text-center py-8 text-muted-foreground">
                          No records found. Click "Add Row" to add data.
                        </td>
                      </tr>
                    )}
                    {/* Totals Row */}
                    <tr className="bg-muted/50 font-semibold">
                      <td colSpan={4} className="text-right">TOTAL</td>
                      <td className="text-right">{totals.taxableValue.toLocaleString('en-IN')}</td>
                      <td className="text-right">{totals.igst.toLocaleString('en-IN')}</td>
                      <td className="text-right">{totals.cgst.toLocaleString('en-IN')}</td>
                      <td className="text-right">{totals.sgst.toLocaleString('en-IN')}</td>
                      <td></td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Table 2: Bills Not Available in Books */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Bills Not Available in Books</CardTitle>
              <Button size="sm" className="flex items-center gap-1">
                <Plus className="h-4 w-4" />
                Add Row
              </Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="gst-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Supplier Name</th>
                      <th>Invoice No.</th>
                      <th>GSTIN</th>
                      <th className="text-right">Taxable Value</th>
                      <th className="text-right">IGST</th>
                      <th className="text-right">CGST</th>
                      <th className="text-right">SGST</th>
                      <th>Book Entry Month</th>
                      <th>Bill in 2B Month</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={10} className="text-center py-8 text-muted-foreground">
                        No records found. Click "Add Row" to add data.
                      </td>
                    </tr>
                    {/* Totals Row */}
                    <tr className="bg-muted/50 font-semibold">
                      <td colSpan={4} className="text-right">TOTAL</td>
                      <td className="text-right">0</td>
                      <td className="text-right">0</td>
                      <td className="text-right">0</td>
                      <td className="text-right">0</td>
                      <td></td>
                      <td></td>
                    </tr>
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

export default TwoBReconciliationPage;
