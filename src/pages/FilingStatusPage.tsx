import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Download, FileText, Lock, Unlock, Search, Filter } from 'lucide-react';
import { FilingStatusType, ReturnType } from '@/types';
import { exportFilingStatusToPDF } from '@/utils/pdfExport';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

interface Client {
  id: string;
  name: string;
  gstin: string;
  mobile: string | null;
  email: string | null;
  assigned_accountant: string | null;
  registration_type: string;
  selected_returns: string[] | null;
  registration_date: string;
  cancellation_date?: string | null;
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
  
  // Filter states
  const [clientNameFilter, setClientNameFilter] = useState<string>('');
  const [targetDateFilter, setTargetDateFilter] = useState<string>('all');

  const allReturnTypes: ReturnType[] = ['GSTR-1', 'GSTR-3B', 'ITC-04', 'GSTR-6', 'GSTR-7', 'CMP-08'];

  // Fetch clients from Supabase
  const fetchClients = useCallback(async () => {
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, gstin, mobile, email, assigned_accountant, registration_type, selected_returns, registration_date')
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

  // Helper function to check if client should be visible for selected month
  const isClientVisibleForMonth = (client: Client, periodMonth: string): boolean => {
    // Parse period month (format: MM/YYYY)
    const [monthStr, yearStr] = periodMonth.split('/');
    const periodDate = new Date(parseInt(yearStr), parseInt(monthStr) - 1, 1);
    
    // Parse registration date
    const regDate = new Date(client.registration_date);
    const regMonth = new Date(regDate.getFullYear(), regDate.getMonth(), 1);
    
    // Client should only be visible if period month >= registration month
    if (periodDate < regMonth) {
      return false;
    }
    
    return true;
  };

  // Generate filing records for display
  const generateAllFilingRecords = (returnType: ReturnType): FilingRecord[] => {
    const records: FilingRecord[] = [];
    
    clients.forEach(client => {
      // Check if client should be visible for the selected month
      if (!isClientVisibleForMonth(client, selectedMonth)) {
        return; // Skip this client
      }
      
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

  const handleStatusChange = async (record: FilingRecord, newStatus: FilingStatusType) => {
    const isNewRecord = record.id.startsWith('temp-');
    
    // GSTR-3B dependency check: require GSTR-1 to be filed first
    if (record.return_type === 'GSTR-3B' && newStatus === 'Filed') {
      const gstr1Record = filingRecords.find(
        f => f.client_id === record.client_id && 
             f.return_type === 'GSTR-1' && 
             f.period_month === record.period_month
      );
      
      if (!gstr1Record || gstr1Record.status !== 'Filed') {
        toast.error('Cannot file GSTR-3B: GSTR-1 must be filed first for this period.');
        return;
      }
    }
    
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
          }]);
        
        if (error) throw error;
      } else {
        // Update existing record
        const updateData: Record<string, unknown> = {
          status: newStatus,
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
      
      if (newStatus === 'Filed' && record.return_type === 'GSTR-3B') {
        toast.success('GSTR-3B filed. 2B and ITC sheets are now locked for this period.');
      } else if (newStatus === 'Filed') {
        toast.success('Status updated to Filed.');
      } else {
        toast.success('Status updated successfully');
      }
      
      fetchFilingRecords();
    } catch (error: any) {
      console.error('Error updating status:', error);
      toast.error('Failed to update status: ' + error.message);
    }
  };

  const handleRemarksChange = async (record: FilingRecord, newRemarks: string) => {
    const isNewRecord = record.id.startsWith('temp-');
    
    if (isNewRecord) {
      // Create the record first
      try {
        const { error } = await supabase
          .from('filing_status')
          .insert([{
            client_id: record.client_id,
            return_type: record.return_type as 'GSTR-1' | 'GSTR-3B' | 'ITC-04' | 'GSTR-6' | 'GSTR-7' | 'CMP-08',
            period_month: selectedMonth,
            status: record.status,
            target_date: record.target_date,
            remarks: newRemarks,
          }]);
        
        if (error) throw error;
        fetchFilingRecords();
      } catch (error: any) {
        console.error('Error saving remarks:', error);
      }
    } else {
      try {
        const { error } = await supabase
          .from('filing_status')
          .update({ remarks: newRemarks })
          .eq('id', record.id);
        
        if (error) throw error;
      } catch (error: any) {
        console.error('Error updating remarks:', error);
      }
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

  // Apply filters to records
  const applyFilters = (records: FilingRecord[]): FilingRecord[] => {
    return records.filter(record => {
      // Client name filter
      if (clientNameFilter && !record.clientName?.toLowerCase().includes(clientNameFilter.toLowerCase())) {
        return false;
      }
      // Target date filter
      if (targetDateFilter !== 'all' && record.target_date !== parseInt(targetDateFilter)) {
        return false;
      }
      return true;
    });
  };

  // Get unique target dates for filter dropdown
  const getUniqueTargetDates = (): number[] => {
    const dates = new Set<number>();
    allReturnTypes.forEach(rt => {
      generateAllFilingRecords(rt).forEach(r => {
        if (r.target_date) dates.add(r.target_date);
      });
    });
    return Array.from(dates).sort((a, b) => a - b);
  };

  const FilingTable = ({ records, returnType }: { records: FilingRecord[]; returnType: string }) => {
    const filteredRecords = applyFilters(records);
    const [editingRemarks, setEditingRemarks] = useState<Record<string, string>>({});
    
    return (
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
              <th className="w-40">Remarks</th>
              {canUnlockSheets() && <th className="w-16">Unlock</th>}
            </tr>
          </thead>
          <tbody>
            {filteredRecords.map((record, idx) => (
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
                    <SelectTrigger className="w-40 h-8 [appearance:none]">
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
                <td className="text-center font-mono text-sm">{record.target_date}</td>
                <td>
                  {record.filed_date 
                    ? new Date(record.filed_date).toLocaleDateString('en-IN')
                    : '-'
                  }
                </td>
                <td>
                  <Input
                    value={editingRemarks[record.id] ?? record.remarks ?? ''}
                    onChange={(e) => setEditingRemarks(prev => ({ ...prev, [record.id]: e.target.value }))}
                    onBlur={() => {
                      const newRemarks = editingRemarks[record.id];
                      if (newRemarks !== undefined && newRemarks !== record.remarks) {
                        handleRemarksChange(record, newRemarks);
                      }
                    }}
                    placeholder="Add remarks..."
                    className="h-7 text-xs"
                    disabled={record.is_locked && !canUnlockSheets()}
                  />
                </td>
                {canUnlockSheets() && (
                  <td className="text-center">
                    {record.is_locked && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handleUnlock(record)}
                        className="h-7 px-2"
                        title="Unlock this record"
                      >
                        <Unlock className="h-3 w-3" />
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {filteredRecords.length === 0 && (
              <tr>
                <td colSpan={canUnlockSheets() ? 11 : 10} className="text-center py-8 text-muted-foreground">
                  {records.length === 0 
                    ? `No clients have ${returnType} selected.`
                    : 'No records match your filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  // Generate months for selector
  const generateMonths = () => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 24; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
      const label = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      months.push({ value, label });
    }
    return months;
  };

  const months = generateMonths();

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Filing Status</h1>
          <p className="text-muted-foreground">Track GST return filing status for all clients</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="flex items-center gap-2" onClick={handleExportPDF}>
            <Download className="h-4 w-4" />
            Export PDF
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filters:</span>
            </div>
            
            {/* Month Selector */}
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((month) => (
                  <SelectItem key={month.value} value={month.value}>
                    {month.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Client Name Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search client..."
                value={clientNameFilter}
                onChange={(e) => setClientNameFilter(e.target.value)}
                className="pl-9 w-48"
              />
            </div>

            {/* Target Date Filter */}
            <Select value={targetDateFilter} onValueChange={setTargetDateFilter}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Target Date" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Dates</SelectItem>
                {getUniqueTargetDates().map((date) => (
                  <SelectItem key={date} value={date.toString()}>
                    Day {date}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {(clientNameFilter || targetDateFilter !== 'all') && (
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => {
                  setClientNameFilter('');
                  setTargetDateFilter('all');
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Return Type Tabs */}
      <Card>
        <CardContent className="p-4">
          <Tabs value={selectedTab} onValueChange={setSelectedTab}>
            <TabsList className="grid grid-cols-6 w-full mb-4">
              <TabsTrigger value="gstr1">GSTR-1</TabsTrigger>
              <TabsTrigger value="gstr3b">GSTR-3B</TabsTrigger>
              <TabsTrigger value="itc04">ITC-04</TabsTrigger>
              <TabsTrigger value="gstr6">GSTR-6</TabsTrigger>
              <TabsTrigger value="gstr7">GSTR-7</TabsTrigger>
              <TabsTrigger value="cmp08">CMP-08</TabsTrigger>
            </TabsList>

            <TabsContent value="gstr1">
              <FilingTable records={generateAllFilingRecords('GSTR-1')} returnType="GSTR-1" />
            </TabsContent>
            <TabsContent value="gstr3b">
              <FilingTable records={generateAllFilingRecords('GSTR-3B')} returnType="GSTR-3B" />
            </TabsContent>
            <TabsContent value="itc04">
              <FilingTable records={generateAllFilingRecords('ITC-04')} returnType="ITC-04" />
            </TabsContent>
            <TabsContent value="gstr6">
              <FilingTable records={generateAllFilingRecords('GSTR-6')} returnType="GSTR-6" />
            </TabsContent>
            <TabsContent value="gstr7">
              <FilingTable records={generateAllFilingRecords('GSTR-7')} returnType="GSTR-7" />
            </TabsContent>
            <TabsContent value="cmp08">
              <FilingTable records={generateAllFilingRecords('CMP-08')} returnType="CMP-08" />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default FilingStatusPage;
