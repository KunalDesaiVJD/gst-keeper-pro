import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Download, FileText, Upload, Lock, Unlock } from 'lucide-react';
import { FilingStatusType, ReturnType } from '@/types';
import { exportFilingStatusToPDF } from '@/utils/pdfExport';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import * as XLSX from 'xlsx';

interface Client {
  id: string;
  name: string;
  gstin: string;
  mobile: string | null;
  email: string | null;
  assigned_accountant: string | null;
  registration_type: string;
  selected_returns: string[] | null;
}

interface FilingRecord {
  id: string;
  client_id: string;
  return_type: string;
  period_month: string;
  status: FilingStatusType;
  target_date: number | null;
  filed_date: string | null;
  remarks: string | null;
  is_locked: boolean | null;
  // Joined client data
  clientName?: string;
  clientEmail?: string;
  contactNumber?: string;
  accountantName?: string;
  filingFrequency?: string;
}

const FilingStatusPage: React.FC = () => {
  const { canUnlockSheets, isStaffRole, user } = useAuth();
  const [selectedMonth, setSelectedMonth] = useState<string>('01/2026');
  const [selectedTab, setSelectedTab] = useState<string>('gstr1');
  const [clients, setClients] = useState<Client[]>([]);
  const [filingRecords, setFilingRecords] = useState<FilingRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allReturnTypes: ReturnType[] = ['GSTR-1', 'GSTR-3B', 'ITC-04', 'GSTR-6', 'GSTR-7', 'CMP-08'];

  // Fetch clients from Supabase
  const fetchClients = useCallback(async () => {
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, gstin, mobile, email, assigned_accountant, registration_type, selected_returns')
      .order('name');
    
    if (error) {
      console.error('Error fetching clients:', error);
      toast.error('Failed to load clients');
      return;
    }
    setClients(data || []);
  }, []);

  // Fetch filing status records
  const fetchFilingRecords = useCallback(async () => {
    const { data, error } = await supabase
      .from('filing_status')
      .select('*')
      .eq('period_month', selectedMonth);
    
    if (error) {
      console.error('Error fetching filing records:', error);
      return;
    }
    setFilingRecords(data || []);
  }, [selectedMonth]);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      await Promise.all([fetchClients(), fetchFilingRecords()]);
      setIsLoading(false);
    };
    loadData();
  }, [fetchClients, fetchFilingRecords]);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel('filing-status-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'filing_status' }, () => {
        fetchFilingRecords();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => {
        fetchClients();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchClients, fetchFilingRecords]);

  // Generate filing records for display
  const generateAllFilingRecords = (returnType: ReturnType): FilingRecord[] => {
    const records: FilingRecord[] = [];
    
    clients.forEach(client => {
      const selectedReturns = client.selected_returns || [];
      if (selectedReturns.includes(returnType)) {
        const existingRecord = filingRecords.find(
          f => f.client_id === client.id && f.return_type === returnType
        );
        
        if (existingRecord) {
          records.push({
            ...existingRecord,
            clientName: client.name,
            clientEmail: client.email || '-',
            contactNumber: client.mobile || '-',
            accountantName: client.assigned_accountant || '-',
            filingFrequency: client.registration_type === 'Composition' ? 'Quarterly' : 'Monthly',
          });
        } else {
          records.push({
            id: `temp-${client.id}-${returnType}`,
            client_id: client.id,
            return_type: returnType,
            period_month: selectedMonth,
            status: 'Prepared',
            target_date: returnType === 'GSTR-1' ? 11 : returnType === 'GSTR-3B' ? 20 : 25,
            filed_date: null,
            remarks: null,
            is_locked: false,
            clientName: client.name,
            clientEmail: client.email || '-',
            contactNumber: client.mobile || '-',
            accountantName: client.assigned_accountant || '-',
            filingFrequency: client.registration_type === 'Composition' ? 'Quarterly' : 'Monthly',
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
    
    // Convert to format expected by PDF export
    const pdfRecords = records.map((r) => ({
      id: r.id,
      clientId: r.client_id,
      clientName: r.clientName || '',
      accountantName: r.accountantName || '-',
      returnType: r.return_type as ReturnType,
      filingFrequency: (r.filingFrequency || 'Monthly') as 'Monthly' | 'Quarterly' | 'Composition',
      otpDscPerson: '-',
      contactNumber: r.contactNumber || '-',
      clientEmail: r.clientEmail || '-',
      status: r.status,
      targetDate: r.target_date || 11,
      filedDate: r.filed_date ? new Date(r.filed_date) : undefined,
      remarks: r.remarks || '',
      month: r.period_month,
      isLocked: r.is_locked || false,
    }));
    
    exportFilingStatusToPDF(pdfRecords, returnType, selectedMonth);
    toast.success('PDF exported successfully');
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(sheet);
      
      // Process each row and upsert to database
      let importCount = 0;
      for (const row of jsonData as any[]) {
        const clientName = row['Client Name'] || row['clientName'];
        const client = clients.find(c => c.name.toLowerCase() === clientName?.toLowerCase());
        
        if (client) {
          const returnType = row['Return Type'] || row['returnType'];
          const status = row['Status'] || row['status'] || 'Prepared';
          
          const { error } = await supabase
            .from('filing_status')
            .upsert({
              client_id: client.id,
              return_type: returnType,
              period_month: selectedMonth,
              status: status,
              target_date: row['Target Date'] || row['targetDate'] || 11,
              remarks: row['Remarks'] || row['remarks'] || null,
              updated_by: user?.id || null,
            }, {
              onConflict: 'client_id,return_type,period_month'
            });
          
          if (!error) importCount++;
        }
      }
      
      toast.success(`Imported ${importCount} filing records successfully`);
      fetchFilingRecords();
    } catch (error) {
      console.error('Import error:', error);
      toast.error('Failed to import Excel file. Please check the format.');
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleStatusChange = async (record: FilingRecord, newStatus: FilingStatusType) => {
    const isNewRecord = record.id.startsWith('temp-');
    
    try {
      if (isNewRecord) {
        // Insert new record
        const { error } = await supabase
          .from('filing_status')
          .insert([{
            client_id: record.client_id,
            return_type: record.return_type as 'GSTR-1' | 'GSTR-3B' | 'ITC-04' | 'GSTR-6' | 'GSTR-7' | 'CMP-08',
            period_month: selectedMonth,
            status: newStatus,
            target_date: record.target_date,
            filed_date: newStatus === 'Filed' ? new Date().toISOString().split('T')[0] : null,
            updated_by: user?.id || null,
          }]);
        
        if (error) throw error;
      } else {
        // Update existing record
        const updateData: Record<string, unknown> = {
          status: newStatus,
          updated_by: user?.id || null,
        };
        
        if (newStatus === 'Filed') {
          updateData.filed_date = new Date().toISOString().split('T')[0];
        }
        
        const { error } = await supabase
          .from('filing_status')
          .update(updateData)
          .eq('id', record.id);
        
        if (error) throw error;
      }
      
      if (newStatus === 'Filed') {
        toast.success('Status changed to Filed. 2B and ITC sheets are now locked for this period.');
      } else {
        toast.success('Status updated successfully');
      }
      
      fetchFilingRecords();
    } catch (error: any) {
      console.error('Error updating status:', error);
      toast.error('Failed to update status: ' + error.message);
    }
  };

  const handleUnlock = async (record: FilingRecord) => {
    if (record.id.startsWith('temp-')) return;
    
    try {
      // Change status back to Prepared and unlock
      const { error } = await supabase
        .from('filing_status')
        .update({
          status: 'Prepared',
          is_locked: false,
          filed_date: null,
          updated_by: user?.id || null,
        })
        .eq('id', record.id);
      
      if (error) throw error;
      
      // Also unlock related 2B and ITC data
      await supabase
        .from('bills_not_in_2b')
        .update({ is_locked: false })
        .eq('client_id', record.client_id)
        .eq('period_month', record.period_month);
      
      await supabase
        .from('bills_not_in_books')
        .update({ is_locked: false })
        .eq('client_id', record.client_id)
        .eq('period_month', record.period_month);
      
      await supabase
        .from('itc_summaries')
        .update({ is_locked: false })
        .eq('client_id', record.client_id)
        .eq('period_month', record.period_month);
      
      toast.success('Sheet unlocked. Status changed to Prepared.');
      fetchFilingRecords();
    } catch (error: any) {
      toast.error('Failed to unlock: ' + error.message);
    }
  };

  const FilingTable = ({ records, returnType }: { records: FilingRecord[]; returnType: string }) => (
    <div className="overflow-x-auto">
      <table className="gst-table">
        <thead>
          <tr>
            <th className="w-12">No.</th>
            <th>Client Name</th>
            <th>Accountant</th>
            <th>Frequency</th>
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
            <tr key={record.id} className={record.is_locked ? 'bg-muted/30' : ''}>
              <td>{idx + 1}</td>
              <td className="font-medium">
                {record.clientName}
                {record.is_locked && <Lock className="h-3 w-3 inline ml-2 text-muted-foreground" />}
              </td>
              <td>{record.accountantName}</td>
              <td>
                <Badge variant="outline" className="text-xs">
                  {record.filingFrequency}
                </Badge>
              </td>
              <td>{record.contactNumber}</td>
              <td className="text-xs">{record.clientEmail}</td>
              <td>
                <Select 
                  value={record.status} 
                  disabled={record.is_locked && !canUnlockSheets()}
                  onValueChange={(value) => handleStatusChange(record, value as FilingStatusType)}
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
              <td className="text-center">{record.target_date}</td>
              <td>
                {record.filed_date 
                  ? new Date(record.filed_date).toLocaleDateString('en-IN')
                  : '-'
                }
              </td>
              <td className="text-xs text-muted-foreground">{record.remarks || '-'}</td>
              {canUnlockSheets() && (
                <td>
                  {record.is_locked && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => handleUnlock(record)}
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
              <td colSpan={canUnlockSheets() ? 11 : 10} className="text-center py-8 text-muted-foreground">
                No clients have {returnType} selected.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

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

      {/* Filing Status Tabs */}
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

        {allReturnTypes.map((returnType) => {
          const tabKey = returnType.toLowerCase().replace('-', '');
          return (
            <TabsContent key={returnType} value={tabKey}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{returnType} Filing Status - {selectedMonth}</CardTitle>
                </CardHeader>
                <CardContent>
                  <FilingTable records={generateAllFilingRecords(returnType)} returnType={returnType} />
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
};

export default FilingStatusPage;
