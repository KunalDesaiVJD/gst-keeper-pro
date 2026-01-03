import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Download, FileText } from 'lucide-react';
import { mockFilingStatus } from '@/data/mockData';
import { FilingStatusType } from '@/types';

const FilingStatusPage: React.FC = () => {
  const [selectedMonth, setSelectedMonth] = useState<string>('01/2026');
  const [selectedTab, setSelectedTab] = useState<string>('gstr1');

  const getStatusBadgeStyle = (status: FilingStatusType) => {
    switch (status) {
      case 'Filed':
      case 'Filed - NIL':
        return 'status-filed';
      case 'Prepared':
      case 'Prepared - NIL':
        return 'status-pending';
      case 'Ready to Verify':
        return 'bg-info/10 text-info border-info/20';
      case 'Not to be Filed':
        return 'bg-muted text-muted-foreground';
      default:
        return '';
    }
  };

  const gstr1Records = mockFilingStatus.filter(f => f.returnType === 'GSTR-1');
  const gstr3bRecords = mockFilingStatus.filter(f => f.returnType === 'GSTR-3B');

  const FilingTable = ({ records }: { records: typeof mockFilingStatus }) => (
    <div className="overflow-x-auto">
      <table className="gst-table">
        <thead>
          <tr>
            <th className="w-12">No.</th>
            <th>Client Name</th>
            <th>Accountant</th>
            <th>Frequency</th>
            <th>OTP/DSC Person</th>
            <th>Contact</th>
            <th>Email</th>
            <th>Status</th>
            <th className="w-20">Target</th>
            <th className="w-28">Filed Date</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record, idx) => (
            <tr key={record.id}>
              <td>{idx + 1}</td>
              <td className="font-medium">{record.clientName}</td>
              <td>{record.accountantName}</td>
              <td>
                <Badge variant="outline" className="text-xs">
                  {record.filingFrequency}
                </Badge>
              </td>
              <td>{record.otpDscPerson}</td>
              <td>{record.contactNumber}</td>
              <td className="text-xs">{record.clientEmail}</td>
              <td>
                <Select defaultValue={record.status}>
                  <SelectTrigger className="w-36 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Prepared">Prepared</SelectItem>
                    <SelectItem value="Prepared - NIL">Prepared - NIL</SelectItem>
                    <SelectItem value="Ready to Verify">Ready to Verify</SelectItem>
                    <SelectItem value="Filed">Filed</SelectItem>
                    <SelectItem value="Filed - NIL">Filed - NIL</SelectItem>
                    <SelectItem value="Not to be Filed">Not to be Filed</SelectItem>
                  </SelectContent>
                </Select>
              </td>
              <td className="text-center">{record.targetDate}</td>
              <td>
                {record.filedDate 
                  ? new Date(record.filedDate).toLocaleDateString('en-IN')
                  : '-'
                }
              </td>
              <td className="text-xs text-muted-foreground">{record.remarks || '-'}</td>
            </tr>
          ))}
          {records.length === 0 && (
            <tr>
              <td colSpan={11} className="text-center py-8 text-muted-foreground">
                No records found for the selected period.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Filing Status</h1>
          <p className="text-muted-foreground">Track GST return filing status</p>
        </div>
        <Button variant="outline" className="flex items-center gap-2">
          <Download className="h-4 w-4" />
          Export PDF
        </Button>
      </div>

      {/* Month Filter */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="w-48">
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Month" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="01/2026">January 2026</SelectItem>
                  <SelectItem value="12/2025">December 2025</SelectItem>
                  <SelectItem value="11/2025">November 2025</SelectItem>
                  <SelectItem value="10/2025">October 2025</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filing Status Tabs */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="gstr1" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            GSTR-1
          </TabsTrigger>
          <TabsTrigger value="gstr3b" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            GSTR-3B
          </TabsTrigger>
        </TabsList>

        <TabsContent value="gstr1">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">GSTR-1 Filing Status - {selectedMonth}</CardTitle>
            </CardHeader>
            <CardContent>
              <FilingTable records={gstr1Records} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="gstr3b">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">GSTR-3B Filing Status - {selectedMonth}</CardTitle>
            </CardHeader>
            <CardContent>
              <FilingTable records={gstr3bRecords} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default FilingStatusPage;
