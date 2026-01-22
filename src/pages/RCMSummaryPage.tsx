import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { Calculator, Plus, Upload, FileSpreadsheet, FileText, Save, Loader2, Lock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import RCMTable from '@/components/rcm/RCMTable';
import AddMasterDialog from '@/components/rcm/AddMasterDialog';
import { exportRCMToExcel, importRCMFromExcel } from '@/utils/rcmExcelExport';
import { exportRCMToPDF } from '@/utils/rcmPdfExport';
import GSTPortalLink from '@/components/clients/GSTPortalLink';

interface Client {
  id: string;
  name: string;
  gstin: string;
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

const MONTHS_ORDER = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

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

const generateMonthsForFY = (financialYear: string): string[] => {
  const [startYear] = financialYear.split('-').map((y) => parseInt(y));
  const fullStartYear = startYear < 100 ? 2000 + startYear : startYear;
  const endYear = fullStartYear + 1;
  
  return MONTHS_ORDER.map((m, idx) => {
    const year = idx < 9 ? fullStartYear : endYear;
    return `${m}-${String(year).slice(-2)}`;
  });
};

const RCMSummaryPage: React.FC = () => {
  const { user, isStaffRole } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>('');
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
  const [isLocked, setIsLocked] = useState(false);
  const [showAddMaster, setShowAddMaster] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isStaff = isStaffRole();

  // Set default financial year
  useEffect(() => {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    const currentFY = currentMonth < 3 ? currentYear - 1 : currentYear;
    const defaultFY = `${currentFY}-${String(currentFY + 1).slice(-2)}`;
    setFinancialYear(defaultFY);
  }, []);

  // Update months when FY changes
  useEffect(() => {
    if (financialYear) {
      setMonths(generateMonthsForFY(financialYear));
    }
  }, [financialYear]);

  // Fetch clients
  useEffect(() => {
    const fetchClients = async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, gstin')
        .order('name');

      if (error) {
        toast.error('Failed to fetch clients');
        return;
      }

      setClients(data || []);

      if (!isStaff && data && data.length === 1) {
        setSelectedClient(data[0].id);
      }
    };
    fetchClients();
  }, [isStaff]);

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
      setIsLocked(rcmData?.some((r) => r.is_locked) || false);
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
        const { error: insertError } = await supabase.from('rcm_data').insert(insertData);
        if (insertError) throw insertError;
      }

      toast.success('RCM data saved successfully');
      fetchData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save RCM data');
    } finally {
      setIsSaving(false);
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

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const importedData = await importRCMFromExcel(file, months, masters);
      setData((prevData) => [...prevData, ...importedData]);
      toast.success(`Imported ${importedData.length} rows`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to import Excel');
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Calculator className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-bold text-foreground">RCM Summary</h1>
            <p className="text-muted-foreground">Reverse Charge Mechanism Summary</p>
          </div>
        </div>
        {isLocked && (
          <div className="flex items-center gap-2 text-warning bg-warning/10 px-3 py-1.5 rounded-lg">
            <Lock className="h-4 w-4" />
            <span className="text-sm font-medium">Period Locked</span>
          </div>
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
              {isStaff && !isLocked && (
                <Button variant="outline" size="sm" onClick={() => setShowAddMaster(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  ADD MASTER
                </Button>
              )}

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

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImportExcel}
                accept=".xlsx,.xls"
                className="hidden"
              />
              
              {isStaff && !isLocked && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4 mr-1" />
                  Import
                </Button>
              )}

              <Button variant="outline" size="sm" onClick={handleExportExcel}>
                <FileSpreadsheet className="h-4 w-4 mr-1" />
                Excel
              </Button>

              <Button variant="outline" size="sm" onClick={handleExportPDF}>
                <FileText className="h-4 w-4 mr-1" />
                PDF
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Table Card */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center justify-between">
            <span>
              {selectedClientData
                ? `${selectedClientData.name} - FY ${financialYear}`
                : 'Select a client to view RCM data'}
            </span>
            {hasChanges && isStaff && !isLocked && (
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
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Calculator className="h-16 w-16 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">Select a Client</h3>
              <p className="text-muted-foreground max-w-md">
                Choose a client and financial year to view and manage RCM data.
              </p>
            </div>
          ) : (
            <RCMTable
              data={data}
              masters={masters}
              months={months}
              onDataChange={handleDataChange}
              isLocked={isLocked}
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
    </div>
  );
};

export default RCMSummaryPage;
