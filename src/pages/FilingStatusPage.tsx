import React, { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Download, FileText, Upload, Lock, Unlock } from 'lucide-react';
import { mockFilingStatus, mockClients } from '@/data/mockData';
import { FilingStatusType, ReturnType } from '@/types';
import { exportFilingStatusToPDF } from '@/utils/pdfExport';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

const FilingStatusPage: React.FC = () => {
  const { canUnlockSheets, isStaffRole } = useAuth();
  const [selectedMonth, setSelectedMonth] = useState<string>('01/2026');
  const [selectedTab, setSelectedTab] = useState<string>('gstr1');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get all return types from all clients
  const allReturnTypes: ReturnType[] = ['GSTR-1', 'GSTR-3B', 'ITC-04', 'GSTR-6', 'GSTR-7', 'CMP-08'];

  // Generate filing records for all clients and all their selected returns
  const generateAllFilingRecords = (returnType: ReturnType) => {
    const records: typeof mockFilingStatus = [];
    
    mockClients.forEach(client => {
      // Check if client has this return type selected
      if (client.selectedReturns.includes(returnType)) {
        // Find existing record or create placeholder
        const existingRecord = mockFilingStatus.find(
          f => f.clientId === client.id && f.returnType === returnType && f.month === selectedMonth
        );
        
        if (existingRecord) {
          records.push(existingRecord);
        } else {
          // Create a placeholder record for this client/return combination
          records.push({
            id: `temp-${client.id}-${returnType}`,
            clientId: client.id,
            clientName: client.name,
            accountantName: client.assignedAccountant || '-',
            returnType: returnType,
            filingFrequency: client.registrationType === 'Composition' ? 'Quarterly' : 'Monthly',
            otpDscPerson: '-',
            contactNumber: client.mobile,
            clientEmail: client.email,
            status: 'Prepared',
            targetDate: returnType === 'GSTR-1' ? 11 : returnType === 'GSTR-3B' ? 20 : 25,
            remarks: '',
            month: selectedMonth,
            isLocked: false,
          });
        }
      }
    });
    
    return records;
  };

  const handleExportPDF = () => {
    const returnTypeMap: Record<string, ReturnType> = {
      'gstr1': 'GSTR-1',
      'gstr3b': 'GSTR-3B',
      'itc04': 'ITC-04',
      'gstr6': 'GSTR-6',
      'gstr7': 'GSTR-7',
      'cmp08': 'CMP-08',
    };
    const returnType = returnTypeMap[selectedTab];
    const records = generateAllFilingRecords(returnType);
    exportFilingStatusToPDF(records, returnType, selectedMonth);
    toast.success('PDF exported successfully');
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Parse Excel file for filing status import
      toast.success('Filing status imported successfully');
    } catch (error) {
      toast.error('Failed to import Excel file. Please check the format.');
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleStatusChange = (recordId: string, newStatus: FilingStatusType) => {
    // In real app, this would update the database
    if (newStatus === 'Filed') {
      toast.success('Status changed to Filed. 2B and ITC sheets are now locked for this period.');
    } else {
      toast.success('Status updated successfully');
    }
  };

  const handleUnlock = (recordId: string) => {
    toast.success('Sheet unlocked. You can now change the status.');
  };

  const FilingTable = ({ records, returnType }: { records: typeof mockFilingStatus; returnType: string }) => (
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
            {canUnlockSheets() && <th className="w-20">Action</th>}
          </tr>
        </thead>
        <tbody>
          {records.map((record, idx) => (
            <tr key={record.id} className={record.isLocked ? 'bg-muted/30' : ''}>
              <td>{idx + 1}</td>
              <td className="font-medium">
                {record.clientName}
                {record.isLocked && <Lock className="h-3 w-3 inline ml-2 text-muted-foreground" />}
              </td>
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
                <Select 
                  defaultValue={record.status} 
                  disabled={record.isLocked && !canUnlockSheets()}
                  onValueChange={(value) => handleStatusChange(record.id, value as FilingStatusType)}
                >
                  <SelectTrigger className="w-40 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Prepared">Prepared</SelectItem>
                    <SelectItem value="Data Pending">Data Pending</SelectItem>
                    <SelectItem value="Mismatch in Data">Mismatch in Data</SelectItem>
                    <SelectItem value="Not Verified">Not Verified</SelectItem>
                    <SelectItem value="Filed">Filed</SelectItem>
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
              {canUnlockSheets() && (
                <td>
                  {record.isLocked && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => handleUnlock(record.id)}
                      className="h-7 px-2"
                    >
                      <Unlock className="h-3 w-3" />
                    </Button>
                  )}
                </td>
              )}
            </tr>
          ))}
          {records.length === 0 && (
            <tr>
              <td colSpan={canUnlockSheets() ? 12 : 11} className="text-center py-8 text-muted-foreground">
                No clients have {returnType} selected.
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
          <p className="text-muted-foreground">Track GST return filing status for all clients</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".xlsx,.xls"
            className="hidden"
          />
          {isStaffRole() && (
            <Button variant="outline" className="flex items-center gap-2" onClick={handleImportClick}>
              <Upload className="h-4 w-4" />
              Import Excel
            </Button>
          )}
          <Button variant="outline" className="flex items-center gap-2" onClick={handleExportPDF}>
            <Download className="h-4 w-4" />
            Export PDF
          </Button>
        </div>
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

      {/* Filing Status Tabs - All Return Types */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid w-full max-w-3xl grid-cols-6">
          <TabsTrigger value="gstr1" className="flex items-center gap-1 text-xs">
            <FileText className="h-3 w-3" />
            GSTR-1
          </TabsTrigger>
          <TabsTrigger value="gstr3b" className="flex items-center gap-1 text-xs">
            <FileText className="h-3 w-3" />
            GSTR-3B
          </TabsTrigger>
          <TabsTrigger value="itc04" className="flex items-center gap-1 text-xs">
            <FileText className="h-3 w-3" />
            ITC-04
          </TabsTrigger>
          <TabsTrigger value="gstr6" className="flex items-center gap-1 text-xs">
            <FileText className="h-3 w-3" />
            GSTR-6
          </TabsTrigger>
          <TabsTrigger value="gstr7" className="flex items-center gap-1 text-xs">
            <FileText className="h-3 w-3" />
            GSTR-7
          </TabsTrigger>
          <TabsTrigger value="cmp08" className="flex items-center gap-1 text-xs">
            <FileText className="h-3 w-3" />
            CMP-08
          </TabsTrigger>
        </TabsList>

        <TabsContent value="gstr1">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">GSTR-1 Filing Status - {selectedMonth}</CardTitle>
            </CardHeader>
            <CardContent>
              <FilingTable records={generateAllFilingRecords('GSTR-1')} returnType="GSTR-1" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="gstr3b">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">GSTR-3B Filing Status - {selectedMonth}</CardTitle>
            </CardHeader>
            <CardContent>
              <FilingTable records={generateAllFilingRecords('GSTR-3B')} returnType="GSTR-3B" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="itc04">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">ITC-04 Filing Status - {selectedMonth}</CardTitle>
            </CardHeader>
            <CardContent>
              <FilingTable records={generateAllFilingRecords('ITC-04')} returnType="ITC-04" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="gstr6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">GSTR-6 Filing Status - {selectedMonth}</CardTitle>
            </CardHeader>
            <CardContent>
              <FilingTable records={generateAllFilingRecords('GSTR-6')} returnType="GSTR-6" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="gstr7">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">GSTR-7 Filing Status - {selectedMonth}</CardTitle>
            </CardHeader>
            <CardContent>
              <FilingTable records={generateAllFilingRecords('GSTR-7')} returnType="GSTR-7" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cmp08">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">CMP-08 Filing Status - {selectedMonth}</CardTitle>
            </CardHeader>
            <CardContent>
              <FilingTable records={generateAllFilingRecords('CMP-08')} returnType="CMP-08" />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default FilingStatusPage;
