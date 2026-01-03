import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Lock, AlertCircle, Unlock } from 'lucide-react';
import { mockClients } from '@/data/mockData';
import { useAuth } from '@/contexts/AuthContext';
const ITCSummaryPage: React.FC = () => {
  const { canUnlockSheets } = useAuth();
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>('01/2026');

  const selectedClientData = mockClients.find(c => c.id === selectedClient);

  // ITC Summary structure based on the Excel file
  const itcData = {
    section4A: [
      { srNo: '(1)', particular: 'Import of Goods', igst: 0, cgst: 0, sgst: 0 },
      { srNo: '(2)', particular: 'Import of Services', igst: 0, cgst: 0, sgst: 0 },
      { srNo: '(3)', particular: 'RCM ITC', igst: 0, cgst: 0, sgst: 0 },
      { srNo: '(4)', particular: 'Inward Supplies from ISD', igst: 0, cgst: 0, sgst: 0 },
      { srNo: '(5)', particular: 'All other ITC', igst: 0, cgst: 0, sgst: 0, isHeader: true },
      { srNo: '5.1', particular: 'ITC for the Month', igst: 45000, cgst: 22500, sgst: 22500 },
      { srNo: '5.2', particular: 'ITC for Previous Month, if any', igst: 0, cgst: 0, sgst: 0 },
      { srNo: '5.3', particular: 'Debit Note', igst: 0, cgst: 0, sgst: 0 },
      { srNo: '5.4', particular: 'Reclaim of ITC Reversed for Previous months', igst: 4500, cgst: 0, sgst: 0, isAutoLinked: true },
      { srNo: '5.5', particular: 'Reclaim of ITC Reversed due to 180 days rule', igst: 0, cgst: 0, sgst: 0 },
    ],
    section4B: [
      { srNo: '(1)', particular: 'ITC Reversal under Rule 38, 42 & 43, and Section 17(5)', igst: 0, cgst: 0, sgst: 0 },
      { srNo: '(2)', particular: 'Others', igst: 0, cgst: 0, sgst: 0 },
      { srNo: '', particular: 'ITC Reversal for current month as per 2B RECO', igst: 9000, cgst: 0, sgst: 0, isAutoLinked: true },
      { srNo: '', particular: 'ITC Reversal for previous months, if any', igst: 0, cgst: 0, sgst: 0 },
      { srNo: '', particular: 'ITC Reversal due to 180 days Analysis', igst: 0, cgst: 0, sgst: 0 },
    ],
    section4D: [
      { srNo: '(1)', particular: 'ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period', igst: 0, cgst: 0, sgst: 0 },
      { srNo: '1.1', particular: 'Reclaim of ITC Reversed for Previous months', igst: 0, cgst: 0, sgst: 0 },
      { srNo: '1.2', particular: 'Reclaim of ITC Reversed due to 180 days rule', igst: 0, cgst: 0, sgst: 0 },
      { srNo: '(2)', particular: 'Ineligible ITC under section 16(4) & ITC restricted due to PoS rules', igst: 0, cgst: 0, sgst: 0 },
    ],
  };

  const total4A = itcData.section4A.reduce((acc, row) => ({
    igst: acc.igst + (row.isHeader ? 0 : row.igst),
    cgst: acc.cgst + (row.isHeader ? 0 : row.cgst),
    sgst: acc.sgst + (row.isHeader ? 0 : row.sgst),
  }), { igst: 0, cgst: 0, sgst: 0 });

  const total4B = itcData.section4B.reduce((acc, row) => ({
    igst: acc.igst + row.igst,
    cgst: acc.cgst + row.cgst,
    sgst: acc.sgst + row.sgst,
  }), { igst: 0, cgst: 0, sgst: 0 });

  const net4C = {
    igst: total4A.igst - total4B.igst,
    cgst: total4A.cgst - total4B.cgst,
    sgst: total4A.sgst - total4B.sgst,
  };

  const totalReclamation = itcData.section4A
    .filter(r => r.srNo === '5.4' || r.srNo === '5.5')
    .reduce((acc, r) => acc + r.igst + r.cgst + r.sgst, 0);

  const totalReversal = itcData.section4B
    .reduce((acc, r) => acc + r.igst + r.cgst + r.sgst, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">ITC Summary</h1>
          <p className="text-muted-foreground">Input Tax Credit summary for the month</p>
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
          </div>
        </CardContent>
      </Card>

      {!selectedClient ? (
        <Card>
          <CardContent className="p-12 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Please select a client to view ITC Summary.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary Boxes */}
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <Card className="bg-success/5 border-success/20">
              <CardContent className="p-4 text-center">
                <p className="text-sm text-muted-foreground">RECLAIMED</p>
                <p className="text-2xl font-bold text-success">₹{totalReclamation.toLocaleString('en-IN')}</p>
              </CardContent>
            </Card>
            <Card className="bg-destructive/5 border-destructive/20">
              <CardContent className="p-4 text-center">
                <p className="text-sm text-muted-foreground">REVERSAL</p>
                <p className="text-2xl font-bold text-destructive">₹{totalReversal.toLocaleString('en-IN')}</p>
              </CardContent>
            </Card>
          </div>

          {/* Unlock Button for Superadmin/GST Manager */}
          {canUnlockSheets() && (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" className="flex items-center gap-2">
                <Unlock className="h-4 w-4" />
                Unlock ITC Summary Sheet
              </Button>
            </div>
          )}

          {/* ITC Summary Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>CLIENT NAME: {selectedClientData?.name}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    ITC SUMMARY FOR THE MONTH: {selectedMonth}
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="gst-table">
                  <thead>
                    <tr>
                      <th className="w-20">Sr. No.</th>
                      <th>PARTICULAR</th>
                      <th className="text-right w-28">IGST</th>
                      <th className="text-right w-28">CGST</th>
                      <th className="text-right w-28">SGST</th>
                      <th className="text-right w-32">TOTAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Section 4A */}
                    <tr className="bg-primary/5">
                      <td colSpan={6} className="font-semibold">4 (A) ITC Available</td>
                    </tr>
                    {itcData.section4A.map((row, idx) => (
                      <tr key={`4a-${idx}`} className={row.isAutoLinked ? 'cell-locked' : ''}>
                        <td>{row.srNo}</td>
                        <td className="flex items-center gap-2">
                          {row.particular}
                          {row.isAutoLinked && (
                            <Badge variant="outline" className="text-xs flex items-center gap-1">
                              <Lock className="h-3 w-3" />
                              Auto-linked
                            </Badge>
                          )}
                        </td>
                        <td className="text-right">{row.igst.toLocaleString('en-IN')}</td>
                        <td className="text-right">{row.cgst.toLocaleString('en-IN')}</td>
                        <td className="text-right">{row.sgst.toLocaleString('en-IN')}</td>
                        <td className="text-right font-medium">
                          {(row.igst + row.cgst + row.sgst).toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-muted/50 font-semibold">
                      <td></td>
                      <td>Total (4A)</td>
                      <td className="text-right">{total4A.igst.toLocaleString('en-IN')}</td>
                      <td className="text-right">{total4A.cgst.toLocaleString('en-IN')}</td>
                      <td className="text-right">{total4A.sgst.toLocaleString('en-IN')}</td>
                      <td className="text-right">
                        {(total4A.igst + total4A.cgst + total4A.sgst).toLocaleString('en-IN')}
                      </td>
                    </tr>

                    {/* Section 4B */}
                    <tr className="bg-primary/5">
                      <td colSpan={6} className="font-semibold">4 (B) ITC Reversed</td>
                    </tr>
                    {itcData.section4B.map((row, idx) => (
                      <tr key={`4b-${idx}`} className={row.isAutoLinked ? 'cell-locked' : ''}>
                        <td>{row.srNo}</td>
                        <td className="flex items-center gap-2">
                          {row.particular}
                          {row.isAutoLinked && (
                            <Badge variant="outline" className="text-xs flex items-center gap-1">
                              <Lock className="h-3 w-3" />
                              Auto-linked
                            </Badge>
                          )}
                        </td>
                        <td className="text-right">{row.igst.toLocaleString('en-IN')}</td>
                        <td className="text-right">{row.cgst.toLocaleString('en-IN')}</td>
                        <td className="text-right">{row.sgst.toLocaleString('en-IN')}</td>
                        <td className="text-right font-medium">
                          {(row.igst + row.cgst + row.sgst).toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-muted/50 font-semibold">
                      <td></td>
                      <td>Total (4B)</td>
                      <td className="text-right">{total4B.igst.toLocaleString('en-IN')}</td>
                      <td className="text-right">{total4B.cgst.toLocaleString('en-IN')}</td>
                      <td className="text-right">{total4B.sgst.toLocaleString('en-IN')}</td>
                      <td className="text-right">
                        {(total4B.igst + total4B.cgst + total4B.sgst).toLocaleString('en-IN')}
                      </td>
                    </tr>

                    {/* Section 4C */}
                    <tr className="bg-success/10 font-bold">
                      <td>4 (C)</td>
                      <td>NET ITC AVAILABLE FOR THE MONTH (A - B)</td>
                      <td className="text-right">{net4C.igst.toLocaleString('en-IN')}</td>
                      <td className="text-right">{net4C.cgst.toLocaleString('en-IN')}</td>
                      <td className="text-right">{net4C.sgst.toLocaleString('en-IN')}</td>
                      <td className="text-right">
                        {(net4C.igst + net4C.cgst + net4C.sgst).toLocaleString('en-IN')}
                      </td>
                    </tr>

                    {/* Section 4D */}
                    <tr className="bg-primary/5">
                      <td colSpan={6} className="font-semibold">4 (D) Other Details</td>
                    </tr>
                    {itcData.section4D.map((row, idx) => (
                      <tr key={`4d-${idx}`}>
                        <td>{row.srNo}</td>
                        <td>{row.particular}</td>
                        <td className="text-right">{row.igst.toLocaleString('en-IN')}</td>
                        <td className="text-right">{row.cgst.toLocaleString('en-IN')}</td>
                        <td className="text-right">{row.sgst.toLocaleString('en-IN')}</td>
                        <td className="text-right font-medium">
                          {(row.igst + row.cgst + row.sgst).toLocaleString('en-IN')}
                        </td>
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

export default ITCSummaryPage;
