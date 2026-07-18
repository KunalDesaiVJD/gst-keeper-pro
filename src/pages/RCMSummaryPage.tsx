import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Calculator, FileSpreadsheet, FileText, Save, Loader2, Lock, Settings, Unlock, History, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import ClearDataDialog from '@/components/dialogs/ClearDataDialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import RCMTable from '@/components/rcm/RCMTable';
import AddMasterDialog from '@/components/rcm/AddMasterDialog';
import { exportRCMToExcel } from '@/utils/rcmExcelExport';
import { exportRCMToPDF } from '@/utils/rcmPdfExport';
import GSTPortalLink from '@/components/clients/GSTPortalLink';
import GenericVersionHistoryDialog, { GenericVersion } from '@/components/dialogs/GenericVersionHistoryDialog';
import * as XLSX from 'xlsx';

interface Client {
  id: string;
  name: string;
  gstin: string;
  registration_type?: string;
}

interface RCMMaster {
  id: string;
  expense_name: string;
  rate: string;
  supply_type: string;
}

interface RCMMonthlyData {
  [month: string]: number;
}

interface RCMDataRow {
  id?: string;
  master_id?: string;
  particulars: string;
  rate: string;
  supply_type: string;
  monthlyValues: RCMMonthlyData;
  isNew?: boolean;
}

interface LockedMonth {
  month: string;
  is_locked: boolean;
}

const MONTHS_ORDER = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
const QUARTER_END_MONTHS = ['Jun', 'Sep', 'Dec', 'Mar']; // Q1 ends Jun, Q2 ends Sep, Q3 ends Dec, Q4 ends Mar

const generateFinancialYears = (): string[] => {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const currentFY = currentMonth < 3 ? currentYear - 1 : currentYear;
  
  const years: string[] = [];
  for (let i = -2; i <= 3; i++) {
    const startYear = currentFY + i;
    const endYear = startYear + 1;
    years.push(`${startYear}-${String(endYear).slice(-2)}`);
  }
  return years;
};

const generateMonthsForFY = (financialYear: string, isQuarterlyClient: boolean = false): string[] => {
  const [startYear] = financialYear.split('-').map((y) => parseInt(y));
  const fullStartYear = startYear < 100 ? 2000 + startYear : startYear;
  const endYear = fullStartYear + 1;
  
  const monthsToUse = isQuarterlyClient ? QUARTER_END_MONTHS : MONTHS_ORDER;
  
  return monthsToUse.map((m) => {
    // Determine year based on month position in FY
    const idx = MONTHS_ORDER.indexOf(m);
    const year = idx < 9 ? fullStartYear : endYear;
    return `${m}-${String(year).slice(-2)}`;
  });
};

// Convert month format "Apr-25" to "04/2025" for filing_status
const convertToFilingMonth = (month: string): string => {
  const monthMap: { [key: string]: string } = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
  };
  
  const [monthName, yearShort] = month.split('-');
  const monthNum = monthMap[monthName] || '01';
  const fullYear = parseInt(yearShort) < 50 ? 2000 + parseInt(yearShort) : 1900 + parseInt(yearShort);
  
  return `${monthNum}/${fullYear}`;
};

const RCMSummaryPage: React.FC = () => {
  const { user, isStaffRole, canUnlockSheets } = useAuth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const selectedClient = selectedClientId;
  const setSelectedClient = setSelectedClientId;
  const [selectedClientData, setSelectedClientData] = useState<Client | null>(null);
  const [financialYear, setFinancialYear] = useState<string>('');
  const [financialYears] = useState<string[]>(generateFinancialYears());
  const [months, setMonths] = useState<string[]>([]);
  const [masters, setMasters] = useState<RCMMaster[]>([]);
  const [data, setData] = useState<RCMDataRow[]>([]);
  const [originalData, setOriginalData] = useState<RCMDataRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [lockedMonths, setLockedMonths] = useState<Set<string>>(new Set());
  const [showAddMaster, setShowAddMaster] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versions, setVersions] = useState<GenericVersion[]>([]);
  const [lastSavedBy, setLastSavedBy] = useState<{ name: string; role: string; time: string; version: number } | null>(null);
  const [showClearData, setShowClearData] = useState(false);

  const isStaff = isStaffRole();
  const canUnlock = canUnlockSheets();
  const canViewVersions = user?.role === 'superadmin' || user?.role === 'gst_manager';

  // Check if all months are locked
  const allMonthsLocked = months.length > 0 && months.every(m => lockedMonths.has(m));

  // Set default financial year
  useEffect(() => {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    const currentFY = currentMonth < 3 ? currentYear - 1 : currentYear;
    const defaultFY = `${currentFY}-${String(currentFY + 1).slice(-2)}`;
    setFinancialYear(defaultFY);
  }, []);

  // Check if client requires quarterly months only (IFF or Composition)
  const isQuarterlyClient = selectedClientData?.registration_type === 'IFF' || selectedClientData?.registration_type === 'Composition';

  // Update months when FY or client changes
  useEffect(() => {
    if (financialYear) {
      setMonths(generateMonthsForFY(financialYear, isQuarterlyClient));
    }
  }, [financialYear, isQuarterlyClient]);

  // Fetch clients
  useEffect(() => {
    const fetchClients = async () => {
      let query = supabase
        .from('clients')
        .select('id, name, gstin, registration_type')
        .order('name');
      
      // For client users, match by their client id
      if (user && !isStaff) {
        query = query.eq('id', user.id);
      }

      const { data, error } = await query;

      if (error) {
        toast.error('Failed to fetch clients');
        return;
      }

      setClients(data || []);

      if (!isStaff && data && data.length > 0 && !selectedClient) {
        setSelectedClient(data[0].id);
      }
    };
    fetchClients();
  }, [isStaff, user, selectedClient, setSelectedClient]);

  // Update selected client data
  useEffect(() => {
    const client = clients.find((c) => c.id === selectedClient);
    setSelectedClientData(client || null);
  }, [selectedClient, clients]);

  // Fetch masters
  const fetchMasters = useCallback(async () => {
    const { data, error } = await supabase
      .from('rcm_masters')
      .select('*')
      .eq('is_active', true)
      .order('expense_name');

    if (error) {
      toast.error('Failed to fetch masters');
      return;
    }

    setMasters(data || []);
  }, []);

  useEffect(() => {
    fetchMasters();
  }, [fetchMasters]);

  // Fetch locked months from filing_status (when GSTR-3B or GSTR-3B (Q) is Filed)
  const fetchLockedMonths = useCallback(async () => {
    if (!selectedClient || !months.length) return;

    const filingMonths = months.map(m => convertToFilingMonth(m));
    
    // Check for both GSTR-3B and GSTR-3B (Q)
    const { data: filingData, error } = await supabase
      .from('filing_status')
      .select('period_month, status, return_type')
      .eq('client_id', selectedClient)
      .in('return_type', ['GSTR-3B', 'GSTR-3B (Q)'])
      .in('period_month', filingMonths);

    if (error) {
      console.error('Error fetching filing status:', error);
      return;
    }

    // Create a set of locked months (where GSTR-3B or GSTR-3B (Q) is Filed)
    const locked = new Set<string>();
    (filingData || []).forEach(filing => {
      if (filing.status === 'Filed') {
        // Convert back from "04/2025" to "Apr-25"
        const [monthNum, year] = filing.period_month.split('/');
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthName = monthNames[parseInt(monthNum) - 1];
        const shortYear = year.slice(-2);
        const formattedMonth = `${monthName}-${shortYear}`;
        locked.add(formattedMonth);
      }
    });

    setLockedMonths(locked);
  }, [selectedClient, months]);

  useEffect(() => {
    fetchLockedMonths();
  }, [fetchLockedMonths]);

  // Fetch RCM data for selected client and FY - grouped by particulars with monthly values
  const fetchData = useCallback(async () => {
    if (!selectedClient || !financialYear) return;

    setIsLoading(true);
    try {
      const { data: rcmData, error } = await supabase
        .from('rcm_data')
        .select('*')
        .eq('client_id', selectedClient)
        .eq('financial_year', financialYear)
        .order('particulars');

      if (error) throw error;

      // Group data by particulars - each row has monthly values
      const groupedData: { [key: string]: RCMDataRow } = {};

      (rcmData || []).forEach((row) => {
        const key = row.particulars;
        if (!groupedData[key]) {
          groupedData[key] = {
            id: row.id,
            master_id: row.master_id || undefined,
            particulars: row.particulars,
            rate: row.rate,
            supply_type: row.supply_type,
            monthlyValues: {},
          };
        }
        // Store the taxable value for each month
        if (row.month && row.taxable_value) {
          groupedData[key].monthlyValues[row.month] = Number(row.taxable_value) || 0;
        }
      });

      const formattedData = Object.values(groupedData);
      setData(formattedData);
      setOriginalData(JSON.parse(JSON.stringify(formattedData)));
      setHasChanges(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to fetch RCM data');
    } finally {
      setIsLoading(false);
    }
  }, [selectedClient, financialYear]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch versions for RCM Summary
  const fetchVersions = useCallback(async () => {
    if (!selectedClient || !financialYear) {
      setVersions([]);
      return;
    }

    try {
      const { data: versionsData, error } = await supabase
        .from('rcm_versions')
        .select('*')
        .eq('client_id', selectedClient)
        .eq('financial_year', financialYear)
        .order('version_number', { ascending: false });

      if (error) throw error;

      // Fetch user names for audit trail
      const userIds = [...new Set((versionsData || []).map(v => v.updated_by).filter(Boolean))];
      let userMap: Record<string, { name: string; role: string }> = {};
      
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, first_name')
          .in('user_id', userIds);
        
        const { data: roles } = await supabase
          .from('user_roles')
          .select('user_id, role')
          .in('user_id', userIds);

        (profiles || []).forEach(p => {
          userMap[p.user_id] = { name: p.first_name, role: '' };
        });
        (roles || []).forEach(r => {
          if (userMap[r.user_id]) {
            userMap[r.user_id].role = r.role;
          }
        });
      }

      const formattedVersions: GenericVersion[] = (versionsData || []).map(v => ({
        id: v.id,
        versionNumber: v.version_number || 1,
        versionData: v.version_data,
        updatedBy: userMap[v.updated_by]?.name || 'Unknown',
        updatedByRole: userMap[v.updated_by]?.role || '',
        updatedAt: v.updated_at,
        isCurrent: v.is_current || false,
        actionType: v.action_type || 'SAVE',
        restoredFromVersionId: v.restored_from_version_id,
      }));

      setVersions(formattedVersions);
      
      // Set last saved by from latest version
      if (formattedVersions.length > 0) {
        const latest = formattedVersions[0];
        setLastSavedBy({
          name: latest.updatedBy,
          role: latest.updatedByRole || '',
          time: latest.updatedAt,
          version: latest.versionNumber,
        });
      } else {
        setLastSavedBy(null);
      }
    } catch (error) {
      console.error('Error fetching RCM versions:', error);
    }
  }, [selectedClient, financialYear]);

  useEffect(() => {
    if (selectedClient && financialYear) {
      fetchVersions();
    }
  }, [selectedClient, financialYear, fetchVersions]);

  // Track changes
  useEffect(() => {
    const hasDataChanged = JSON.stringify(data) !== JSON.stringify(originalData);
    setHasChanges(hasDataChanged);
  }, [data, originalData]);

  const handleDataChange = (newData: RCMDataRow[]) => {
    setData(newData);
  };

  // GST calculation helper
  const calculateGST = (taxableValue: number, rate: string, supplyType: string) => {
    const baseRate = rate.includes('18') ? 18 : 5;
    const isInterstate = supplyType === 'interstate';

    if (isInterstate) {
      return {
        cgst_2_5: 0,
        cgst_9: 0,
        sgst_2_5: 0,
        sgst_9: 0,
        igst_5: baseRate === 5 ? taxableValue * 0.05 : 0,
        igst_18: baseRate === 18 ? taxableValue * 0.18 : 0,
      };
    } else {
      const halfRate = baseRate / 2;
      const gstAmount = (taxableValue * halfRate) / 100;
      return {
        cgst_2_5: baseRate === 5 ? gstAmount : 0,
        cgst_9: baseRate === 18 ? gstAmount : 0,
        sgst_2_5: baseRate === 5 ? gstAmount : 0,
        sgst_9: baseRate === 18 ? gstAmount : 0,
        igst_5: 0,
        igst_18: 0,
      };
    }
  };

  const handleSave = async () => {
    if (!selectedClient || !financialYear) {
      toast.error('Please select a client and financial year');
      return;
    }

    setIsSaving(true);
    try {
      // Delete all existing data for this client/FY and re-insert
      const { error: deleteError } = await supabase
        .from('rcm_data')
        .delete()
        .eq('client_id', selectedClient)
        .eq('financial_year', financialYear);

      if (deleteError) throw deleteError;

      // Insert new data - one row per particulars/month combination
      const insertData: any[] = [];

      for (const row of data) {
        for (const month of months) {
          const taxableValue = row.monthlyValues[month] || 0;
          if (taxableValue > 0) {
            const gstValues = calculateGST(taxableValue, row.rate, row.supply_type);
            const isMonthLocked = lockedMonths.has(month);
            insertData.push({
              client_id: selectedClient,
              financial_year: financialYear,
              month: month,
              particulars: row.particulars,
              rate: row.rate,
              supply_type: row.supply_type,
              master_id: row.master_id,
              taxable_value: taxableValue,
              is_locked: isMonthLocked,
              ...gstValues,
              updated_by: user?.id,
              updated_at: new Date().toISOString(),
            });
          }
        }
      }

      if (insertData.length > 0) {
        const { error: insertError } = await supabase.from('rcm_data').insert(insertData);
        if (insertError) throw insertError;
      }

      // Save version snapshot
      try {
        // Get current max version
        const { data: maxVersionData } = await supabase
          .from('rcm_versions')
          .select('version_number')
          .eq('client_id', selectedClient)
          .eq('financial_year', financialYear)
          .order('version_number', { ascending: false })
          .limit(1);

        const nextVersion = (maxVersionData?.[0]?.version_number || 0) + 1;

        // Mark all existing versions as not current
        await supabase
          .from('rcm_versions')
          .update({ is_current: false })
          .eq('client_id', selectedClient)
          .eq('financial_year', financialYear);

        // Insert new version
        await supabase.from('rcm_versions').insert([{
          client_id: selectedClient,
          financial_year: financialYear,
          version_number: nextVersion,
          version_data: JSON.parse(JSON.stringify({ rcmData: data })),
          updated_by: user?.id,
          updated_at: new Date().toISOString(),
          is_current: true,
          action_type: 'SAVE',
        }]);

        fetchVersions();
      } catch (versionError) {
        console.error('Error saving version:', versionError);
      }

      toast.success('RCM data saved successfully');
      fetchData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save RCM data');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUnlockMonth = async (month: string) => {
    if (!canUnlock) {
      toast.error('You do not have permission to unlock months');
      return;
    }

    const filingMonth = convertToFilingMonth(month);

    try {
      // Update the filing_status to not be Filed (reset to Prepared)
      const { error } = await supabase
        .from('rcm_data')
        .update({ is_locked: false })
        .eq('client_id', selectedClient)
        .eq('financial_year', financialYear)
        .eq('month', month);

      if (error) throw error;

      // Remove from lockedMonths set
      setLockedMonths(prev => {
        const newSet = new Set(prev);
        newSet.delete(month);
        return newSet;
      });

      toast.success(`${month} unlocked successfully`);
    } catch (error: any) {
      toast.error('Failed to unlock month: ' + error.message);
    }
  };

  const handleExportExcel = () => {
    if (!selectedClientData) {
      toast.error('Please select a client');
      return;
    }
    exportRCMToExcel(selectedClientData.name, financialYear, data, months);
    toast.success('Excel exported successfully');
  };

  const handleExportPDF = () => {
    if (!selectedClientData) {
      toast.error('Please select a client');
      return;
    }
    exportRCMToPDF(selectedClientData.name, selectedClientData.gstin, financialYear, data, months);
    toast.success('PDF exported successfully');
  };

  // Version restore handler
  const handleRestoreVersion = async (version: GenericVersion) => {
    if (!selectedClient || !financialYear) return;

    try {
      const versionData = version.versionData as { rcmData: RCMDataRow[] };
      if (!versionData?.rcmData) {
        toast.error('Invalid version data');
        return;
      }

      // Delete existing data
      await supabase
        .from('rcm_data')
        .delete()
        .eq('client_id', selectedClient)
        .eq('financial_year', financialYear);

      // Insert restored data
      const insertData: any[] = [];
      for (const row of versionData.rcmData) {
        for (const month of months) {
          const taxableValue = row.monthlyValues[month] || 0;
          if (taxableValue > 0) {
            const gstValues = calculateGST(taxableValue, row.rate, row.supply_type);
            insertData.push({
              client_id: selectedClient,
              financial_year: financialYear,
              month: month,
              particulars: row.particulars,
              rate: row.rate,
              supply_type: row.supply_type,
              master_id: row.master_id,
              taxable_value: taxableValue,
              ...gstValues,
              updated_by: user?.id,
              updated_at: new Date().toISOString(),
            });
          }
        }
      }

      if (insertData.length > 0) {
        await supabase.from('rcm_data').insert(insertData);
      }

      // Save restore version snapshot
      const { data: maxVersionData } = await supabase
        .from('rcm_versions')
        .select('version_number')
        .eq('client_id', selectedClient)
        .eq('financial_year', financialYear)
        .order('version_number', { ascending: false })
        .limit(1);

      const nextVersion = (maxVersionData?.[0]?.version_number || 0) + 1;

      await supabase
        .from('rcm_versions')
        .update({ is_current: false })
        .eq('client_id', selectedClient)
        .eq('financial_year', financialYear);

      await supabase.from('rcm_versions').insert([{
        client_id: selectedClient,
        financial_year: financialYear,
        version_number: nextVersion,
        version_data: JSON.parse(JSON.stringify(versionData)),
        updated_by: user?.id,
        updated_at: new Date().toISOString(),
        is_current: true,
        action_type: 'RESTORE',
        restored_from_version_id: version.id,
      }]);

      toast.success(`Restored to version ${version.versionNumber}`);
      fetchData();
      fetchVersions();
      setShowVersionHistory(false);
    } catch (error: any) {
      console.error('Error restoring version:', error);
      toast.error('Failed to restore version');
    }
  };

  // Version download handler
  const handleDownloadVersion = (version: GenericVersion) => {
    try {
      const versionData = version.versionData as { rcmData: RCMDataRow[] };
      if (!versionData?.rcmData) {
        toast.error('Invalid version data');
        return;
      }

      const workbook = XLSX.utils.book_new();
      
      // Create sheet data
      const sheetData = [
        [`RCM Summary - Version ${version.versionNumber}`],
        [`Client: ${selectedClientData?.name || ''}`, '', '', '', `FY: ${financialYear}`],
        [`Saved: ${new Date(version.updatedAt).toLocaleString()}`, '', '', '', `By: ${version.updatedBy}`],
        [],
        ['Particulars', 'Rate', ...months, 'Total'],
      ];

      for (const row of versionData.rcmData) {
        const total = Object.values(row.monthlyValues).reduce((sum, val) => sum + (val || 0), 0);
        sheetData.push([
          row.particulars,
          row.rate,
          ...months.map(m => row.monthlyValues[m] || 0),
          total,
        ] as any);
      }

      const sheet = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(workbook, sheet, 'RCM Data');

      const fileName = `RCM_Version_${version.versionNumber}_${selectedClientData?.name?.replace(/\s+/g, '_')}_${financialYear}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      
      toast.success(`Downloaded version ${version.versionNumber}`);
    } catch (error) {
      console.error('Error downloading version:', error);
      toast.error('Failed to download version');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="space-y-1">
        <PageHeader
          title="RCM Summary"
          subtitle="Reverse Charge Mechanism Summary"
          icon={<Calculator className="h-6 w-6" />}
          actions={
            <>
              {allMonthsLocked && (
                <div className="flex items-center gap-2 text-warning bg-warning/10 px-3 py-1.5 rounded-lg">
                  <Lock className="h-4 w-4" />
                  <span className="text-sm font-medium">All Periods Locked</span>
                </div>
              )}
              <Button variant="outline" onClick={handleExportPDF} className="gap-2">
                <FileText className="h-4 w-4" />
                Export PDF
              </Button>
              <Button variant="outline" onClick={handleExportExcel} className="gap-2">
                <FileSpreadsheet className="h-4 w-4" />
                Export Excel
              </Button>
              {canViewVersions && selectedClient && (
                <Button variant="outline" onClick={() => setShowVersionHistory(true)} className="gap-2">
                  <History className="h-4 w-4" />
                  View Versions
                </Button>
              )}
              {(user?.role === 'superadmin' || user?.role === 'gst_manager') && selectedClient && (
                <Button variant="destructive" onClick={() => setShowClearData(true)} className="gap-2">
                  <Trash2 className="h-4 w-4" />
                  Clear Data
                </Button>
              )}
            </>
          }
        />
        {lastSavedBy && (
          <p className="text-xs text-muted-foreground">
            Last saved by <span className="font-semibold text-foreground">{lastSavedBy.name}</span>
            {lastSavedBy.role && <span className="text-muted-foreground"> ({lastSavedBy.role})</span>}
            {' '}on {new Date(lastSavedBy.time).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} {new Date(lastSavedBy.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            {' '}• v{lastSavedBy.version}
          </p>
        )}
      </div>

      {/* Controls Card */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Client Label and Dropdown */}
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground whitespace-nowrap">Name of Client :</span>
              <div className="min-w-[250px]">
                <SearchableSelect
                  options={clients.map((c) => ({
                    value: c.id,
                    label: c.name,
                    sublabel: c.gstin,
                  }))}
                  value={selectedClient}
                  onValueChange={setSelectedClient}
                  placeholder="Search Client..."
                  searchPlaceholder="Type to search clients..."
                  emptyText="No clients found."
                  disabled={!isStaff && clients.length <= 1}
                />
              </div>
            </div>

            {/* GST Portal Link */}
            {selectedClient && (
              <GSTPortalLink
                clientId={selectedClient}
                clientName={selectedClientData?.name}
              />
            )}

            {/* Action Buttons - Right side */}
            <div className="flex items-center gap-2 ml-auto">
              {isStaff && (
                <Button variant="outline" size="sm" onClick={() => navigate('/manage-masters')}>
                  <Settings className="h-4 w-4 mr-1" />
                  Manage Masters
                </Button>
              )}

              {/* Add Master button removed - now in Manage Masters page */}

              {/* Financial Year Dropdown */}
              <div className="w-36">
                <Select value={financialYear} onValueChange={setFinancialYear}>
                  <SelectTrigger>
                    <SelectValue placeholder="Financial Year" />
                  </SelectTrigger>
                  <SelectContent>
                    {financialYears.map((fy) => (
                      <SelectItem key={fy} value={fy}>
                        {fy}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

            </div>
          </div>
        </CardContent>
      </Card>

      {/* Locked Months Indicator */}
      {lockedMonths.size > 0 && !allMonthsLocked && (
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <Lock className="h-3.5 w-3.5" />
                Locked Months:
              </span>
              {Array.from(lockedMonths).map((month) => (
                <div key={month} className="flex items-center gap-1 bg-warning/10 text-warning px-2 py-1 rounded text-xs font-medium">
                  <Lock className="h-3 w-3" />
                  {month}
                  {canUnlock && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-4 w-4 p-0 ml-1 hover:bg-warning/20"
                      aria-label={`Unlock ${month}`}
                      onClick={() => handleUnlockMonth(month)}
                    >
                      <Unlock className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Table Card */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center justify-between">
            <span>
              {selectedClientData
                ? `${selectedClientData.name} - FY ${financialYear}`
                : 'Select a client to view RCM data'}
            </span>
            {hasChanges && isStaff && !allMonthsLocked && (
              <Button onClick={handleSave} disabled={isSaving} size="sm">
                {isSaving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Changes
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : !selectedClient ? (
            <TableEmptyState
              icon={<Calculator className="h-6 w-6" />}
              title="Select a client"
              description="Choose a client and financial year to view and manage RCM data."
            />
          ) : (
            <RCMTable
              data={data}
              masters={masters}
              months={months}
              lockedMonths={lockedMonths}
              onDataChange={handleDataChange}
              isLocked={allMonthsLocked}
              isStaff={isStaff}
            />
          )}
        </CardContent>
      </Card>

      {/* Add Master Dialog */}
      <AddMasterDialog
        open={showAddMaster}
        onOpenChange={setShowAddMaster}
        onMasterAdded={fetchMasters}
      />

      {/* Version History Dialog */}
      <GenericVersionHistoryDialog
        open={showVersionHistory}
        onOpenChange={setShowVersionHistory}
        versions={versions}
        onRestore={handleRestoreVersion}
        onDownload={handleDownloadVersion}
        onView={handleDownloadVersion}
        onVersionDeleted={fetchVersions}
        title="Version History"
        subtitle={`${selectedClientData?.name || ''} - FY ${financialYear}`}
        tableName="rcm_versions"
      />
      
      {selectedClient && selectedClientData && (
        <ClearDataDialog
          open={showClearData}
          onOpenChange={setShowClearData}
          module="RCM Summary"
          clientId={selectedClient}
          clientName={selectedClientData.name}
          onCleared={fetchData}
        />
      )}
    </div>
  );
};

export default RCMSummaryPage;
