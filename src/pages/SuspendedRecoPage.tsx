import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileText, Save, Loader2, Download } from 'lucide-react';
import { exportSuspendedRecoToExcel } from '@/utils/suspendedRecoExcelExport';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useMonth } from '@/contexts/MonthContext';
import { useClient } from '@/contexts/ClientContext';
import { toast } from 'sonner';
import GSTPortalLink from '@/components/clients/GSTPortalLink';

interface Client {
  id: string;
  name: string;
  gstin: string;
  registration_date?: string;
}

const SuspendedRecoPage: React.FC = () => {
  const { user, isStaffRole } = useAuth();
  const { selectedMonth, setSelectedMonth } = useMonth();
  const { selectedClientId, setSelectedClientId } = useClient();
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedBy, setLastSavedBy] = useState<{ name: string; role: string; time: string } | null>(null);
  // Opening balance portal values (editable)
  const [openingCgst, setOpeningCgst] = useState<number>(0);
  const [openingSgst, setOpeningSgst] = useState<number>(0);
  const [openingIgst, setOpeningIgst] = useState<number>(0);
  
  // Current total - auto-calculated from ITC Summary: (4B2i + 4B2ii) - (5.4 + 5.5)
  const [portalCgst, setPortalCgst] = useState<number>(0);
  const [portalSgst, setPortalSgst] = useState<number>(0);
  const [portalIgst, setPortalIgst] = useState<number>(0);
  
  // Books values (auto-linked from 2B)
  const [booksCgst, setBooksCgst] = useState<number>(0);
  const [booksSgst, setBooksSgst] = useState<number>(0);
  const [booksIgst, setBooksIgst] = useState<number>(0);

  const selectedClientData = clients.find(c => c.id === selectedClientId);
  const isStaff = isStaffRole();

  // Generate month options - limited to +2 months future (aligned with dashboard)
  const generateMonthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    const maxFutureMonths = 2;
    
    const client = clients.find(c => c.id === selectedClientId);
    let startDate = new Date(now.getFullYear(), now.getMonth() - 12, 1);
    
    if (client?.registration_date) {
      const regDate = new Date(client.registration_date);
      startDate = new Date(regDate.getFullYear(), regDate.getMonth(), 1);
    }
    
    const futureLimit = new Date(now.getFullYear(), now.getMonth() + maxFutureMonths, 1);
    let currentDate = new Date(startDate);
    
    while (currentDate <= futureLimit) {
      const value = `${String(currentDate.getMonth() + 1).padStart(2, '0')}/${currentDate.getFullYear()}`;
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const label = `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
      months.push({ value, label });
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
    
    return months.sort((a, b) => {
      const [aM, aY] = a.value.split('/').map(Number);
      const [bM, bY] = b.value.split('/').map(Number);
      return bY * 12 + bM - (aY * 12 + aM);
    });
  }, [clients, selectedClientId]);

  // Fetch clients
  const fetchClients = useCallback(async () => {
    let query = supabase
      .from('clients')
      .select('id, name, gstin, registration_date')
      .order('name');
    
    if (user && !isStaff) {
      query = query.eq('id', user.id);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Error fetching clients:', error);
      return;
    }
    setClients(data || []);
    
    if (!isStaff && data && data.length > 0 && !selectedClientId) {
      setSelectedClientId(data[0].id);
    }
  }, [user, isStaff, selectedClientId, setSelectedClientId]);

  // Fetch suspended reco data
  const fetchData = useCallback(async () => {
    if (!selectedClientId || !selectedMonth) return;

    setIsLoading(true);
    try {
      // Fetch portal data from suspended_reco table (opening balance only)
      const { data: suspendedData } = await supabase
        .from('suspended_reco')
        .select('*')
        .eq('client_id', selectedClientId)
        .eq('period_month', selectedMonth)
        .maybeSingle();
      
      if (suspendedData) {
        setOpeningCgst(Number((suspendedData as any).opening_cgst) || 0);
        setOpeningSgst(Number((suspendedData as any).opening_sgst) || 0);
        setOpeningIgst(Number((suspendedData as any).opening_igst) || 0);
        
        // Fetch last saved by info
        const updatedBy = (suspendedData as any).updated_by;
        const updatedAt = (suspendedData as any).updated_at;
        if (updatedBy) {
          const { data: profile } = await supabase.from('profiles').select('first_name').eq('user_id', updatedBy).maybeSingle();
          const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', updatedBy).maybeSingle();
          setLastSavedBy({
            name: profile?.first_name || 'Unknown',
            role: roleData?.role || '',
            time: updatedAt || '',
          });
        } else {
          setLastSavedBy(null);
        }
      } else {
        setOpeningCgst(0);
        setOpeningSgst(0);
        setOpeningIgst(0);
        setLastSavedBy(null);
      }

      // Calculate "Current Total" using formula: (4B(2)(i) + 4B(2)(ii)) − (5.4 + 5.5)
      // 4B(2)(i) and 5.4 are auto-linked from bills_not_in_2b, so we calculate them live
      // 4B(2)(ii) and 5.5 are editable values stored in ITC summary

      // Helper to match month patterns (same logic as ITC Summary page)
      const getMonthPatterns = (monthStr: string) => {
        const [monthNum, year] = monthStr.split('/');
        const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const monthName = monthNames[parseInt(monthNum) - 1] || '';
        const yearShort = year?.slice(-2) || '';
        const yearSingle = year?.slice(-1) || '';
        return { monthName, yearShort, yearSingle, fullYear: year || '', monthNum };
      };

      const monthMatchesFn = (storedMonth: string | null, patterns: ReturnType<typeof getMonthPatterns>): boolean => {
        if (!storedMonth) return false;
        const stored = storedMonth.toLowerCase().trim();
        const { monthName, yearShort, yearSingle, fullYear } = patterns;
        const hasMonth = stored.includes(monthName);
        const hasYear = stored.includes(yearShort) || stored.includes(yearSingle) || stored.includes(fullYear);
        return hasMonth && hasYear;
      };

      const patterns = getMonthPatterns(selectedMonth);

      // 4B(2)(i): reversal bills where reversal_month matches current month
      const { data: reversalBills } = await supabase
        .from('bills_not_in_2b')
        .select('input_igst, input_cgst, input_sgst, reversal_month')
        .eq('client_id', selectedClientId)
        .eq('period_month', selectedMonth)
        .not('reversal_month', 'is', null);

      const matchingReversals = (reversalBills || []).filter(b => monthMatchesFn(b.reversal_month, patterns));
      const row4B2i = matchingReversals.reduce((acc, b) => ({
        cgst: acc.cgst + (Number(b.input_cgst) || 0),
        sgst: acc.sgst + (Number(b.input_sgst) || 0),
        igst: acc.igst + (Number(b.input_igst) || 0),
      }), { cgst: 0, sgst: 0, igst: 0 });

      // 5.4: reclaim bills where reclaim_month matches current month
      const { data: reclaimBills } = await supabase
        .from('bills_not_in_2b')
        .select('input_igst, input_cgst, input_sgst, reclaim_month')
        .eq('client_id', selectedClientId)
        .eq('period_month', selectedMonth)
        .not('reclaim_month', 'is', null);

      const matchingReclaims = (reclaimBills || []).filter(b => monthMatchesFn(b.reclaim_month, patterns));
      const row54 = matchingReclaims.reduce((acc, b) => ({
        cgst: acc.cgst + (Number(b.input_cgst) || 0),
        sgst: acc.sgst + (Number(b.input_sgst) || 0),
        igst: acc.igst + (Number(b.input_igst) || 0),
      }), { cgst: 0, sgst: 0, igst: 0 });

      // 4B(2)(ii) and 5.5: read from saved ITC summary (these are editable, not auto-linked)
      let row4B2ii = { cgst: 0, sgst: 0, igst: 0 };
      let row55 = { cgst: 0, sgst: 0, igst: 0 };

      const { data: itcData } = await supabase
        .from('itc_summaries')
        .select('data')
        .eq('client_id', selectedClientId)
        .eq('period_month', selectedMonth)
        .maybeSingle();

      if (itcData?.data) {
        const itc = itcData.data as any;
        const section4A = itc.section4A || [];
        const section4B = itc.section4B || [];

        const found4B2ii = section4B.find((r: any) => r.srNo === '(ii)' || r.srNo === '4(B)(2)(ii)' || (r.particular && r.particular.includes('ITC Reversal for previous months')));
        if (found4B2ii) {
          row4B2ii = { cgst: Number(found4B2ii.cgst) || 0, sgst: Number(found4B2ii.sgst) || 0, igst: Number(found4B2ii.igst) || 0 };
        }

        const found55 = section4A.find((r: any) => r.srNo === '5.5');
        if (found55) {
          row55 = { cgst: Number(found55.cgst) || 0, sgst: Number(found55.sgst) || 0, igst: Number(found55.igst) || 0 };
        }
      }

      setPortalCgst(row4B2i.cgst + row4B2ii.cgst - row54.cgst - row55.cgst);
      setPortalSgst(row4B2i.sgst + row4B2ii.sgst - row54.sgst - row55.sgst);
      setPortalIgst(row4B2i.igst + row4B2ii.igst - row54.igst - row55.igst);

      // Fetch books data from bills_not_in_2b 
      const { data: booksData } = await supabase
        .from('bills_not_in_2b')
        .select('input_cgst, input_sgst, input_igst, reversal_month, reclaim_month')
        .eq('client_id', selectedClientId)
        .eq('period_month', selectedMonth);
      
      if (booksData && booksData.length > 0) {
        const filteredData = booksData.filter(row => {
          const reversalBlank = row.reversal_month === null || row.reversal_month === '';
          const reclaimBlank = row.reclaim_month === null || row.reclaim_month === '';
          return reclaimBlank && !reversalBlank;
        });
        
        const totals = filteredData.reduce((acc, row) => ({
          cgst: acc.cgst + (Number(row.input_cgst) || 0),
          sgst: acc.sgst + (Number(row.input_sgst) || 0),
          igst: acc.igst + (Number(row.input_igst) || 0),
        }), { cgst: 0, sgst: 0, igst: 0 });
        
        setBooksCgst(totals.cgst);
        setBooksSgst(totals.sgst);
        setBooksIgst(totals.igst);
      } else {
        setBooksCgst(0);
        setBooksSgst(0);
        setBooksIgst(0);
      }
    } catch (error: any) {
      toast.error('Failed to fetch data: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  }, [selectedClientId, selectedMonth]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  useEffect(() => {
    if (selectedClientId && selectedMonth) {
      fetchData();
    }
  }, [selectedClientId, selectedMonth, fetchData]);

  const handleSave = async () => {
    if (!selectedClientId || !selectedMonth) {
      toast.error('Please select a client and month');
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('suspended_reco')
        .upsert({
          client_id: selectedClientId,
          period_month: selectedMonth,
          opening_cgst: openingCgst,
          opening_sgst: openingSgst,
          opening_igst: openingIgst,
          portal_cgst: portalCgst,
          portal_sgst: portalSgst,
          portal_igst: portalIgst,
          updated_by: user?.id,
          updated_at: new Date().toISOString(),
        } as any, {
          onConflict: 'client_id,period_month'
        });

      if (error) throw error;
      toast.success('Data saved successfully');
    } catch (error: any) {
      toast.error('Failed to save: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const normalizeZero = (num: number): number => {
    if (Object.is(num, -0)) return 0;
    const rounded = Math.round(num * 100) / 100;
    if (rounded === 0 || Object.is(rounded, -0)) return 0;
    return rounded;
  };

  // New formula: Difference = Opening Balance + Current Total - As Per Books
  const openingTotal = openingCgst + openingSgst + openingIgst;
  const portalTotal = portalCgst + portalSgst + portalIgst;
  const booksTotal = booksCgst + booksSgst + booksIgst;
  const diffCgst = normalizeZero(openingCgst + portalCgst - booksCgst);
  const diffSgst = normalizeZero(openingSgst + portalSgst - booksSgst);
  const diffIgst = normalizeZero(openingIgst + portalIgst - booksIgst);
  const diffTotal = normalizeZero(openingTotal + portalTotal - booksTotal);

  const formatNumber = (num: number): string => {
    if (num === 0 || Object.is(num, -0)) return '0';
    const rounded = Math.round(num * 100) / 100;
    if (rounded === 0 || Object.is(rounded, -0)) return '0';
    const formatted = rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    return formatted === '-0' ? '0' : formatted;
  };

  const renderEditableCell = (value: number, onChange: (val: number) => void) => {
    if (!isStaff) {
      return <span className="block text-right px-3">{formatNumber(value)}</span>;
    }
    return (
      <Input
        type="number"
        value={value || ''}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="h-10 text-right border-0 shadow-none rounded-none"
        min="0"
      />
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <FileText className="h-6 w-6 text-primary" />
          </div>
           <div>
            <h1 className="text-2xl font-heading font-bold text-foreground">Suspended Reconciliation</h1>
            <p className="text-muted-foreground">Compare portal figures with books data</p>
            {lastSavedBy && (
              <p className="text-xs text-muted-foreground mt-1">
                Last saved by <span className="font-semibold text-foreground">{lastSavedBy.name}</span>
                {lastSavedBy.role && <span className="text-muted-foreground"> ({lastSavedBy.role})</span>}
                {lastSavedBy.time && (
                  <> on {new Date(lastSavedBy.time).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} {new Date(lastSavedBy.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</>
                )}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground whitespace-nowrap">Client:</span>
              <div className="min-w-[250px]">
                <SearchableSelect
                  options={clients.map(c => ({
                    value: c.id,
                    label: c.name,
                    sublabel: c.gstin,
                  }))}
                  value={selectedClientId}
                  onValueChange={setSelectedClientId}
                  placeholder="Select Client..."
                  searchPlaceholder="Type to search clients..."
                  emptyText="No clients found."
                  disabled={!isStaff && clients.length <= 1}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground whitespace-nowrap">Month:</span>
              <div className="w-40">
                <SearchableMonthSelect
                  options={generateMonthOptions}
                  value={selectedMonth}
                  onValueChange={setSelectedMonth}
                  placeholder="Select Month"
                />
              </div>
            </div>

            {selectedClientId && (
              <GSTPortalLink clientId={selectedClientId} clientName={selectedClientData?.name} />
            )}

            {selectedClientId && (
              <Button variant="outline" onClick={() => {
                if (!selectedClientData) return;
                exportSuspendedRecoToExcel({
                  clientName: selectedClientData.name,
                  clientGstin: selectedClientData.gstin,
                  month: selectedMonth,
                  openingCgst, openingSgst, openingIgst,
                  portalCgst, portalSgst, portalIgst,
                  booksCgst, booksSgst, booksIgst,
                  diffCgst, diffSgst, diffIgst,
                });
                toast.success('Excel exported successfully');
              }}>
                <Download className="h-4 w-4 mr-2" />
                Export Excel
              </Button>
            )}
            {isStaff && (
              <Button onClick={handleSave} disabled={isSaving || !selectedClientId} className="ml-auto">
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save Changes
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Suspended Reconciliation Table */}
      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="font-bold text-primary-foreground border border-primary w-48">PARTICULARS</TableHead>
                  <TableHead className="font-bold text-primary-foreground text-center border border-primary">CGST</TableHead>
                  <TableHead className="font-bold text-primary-foreground text-center border border-primary">SGST</TableHead>
                  <TableHead className="font-bold text-primary-foreground text-center border border-primary">IGST</TableHead>
                  <TableHead className="font-bold text-primary-foreground text-center border border-primary">TOTAL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Opening Balance As Per Portal - Editable */}
                <TableRow>
                  <TableCell className="font-medium border border-border">OPENING BALANCE AS PER PORTAL</TableCell>
                  <TableCell className="p-0 border border-border">{renderEditableCell(openingCgst, setOpeningCgst)}</TableCell>
                  <TableCell className="p-0 border border-border">{renderEditableCell(openingSgst, setOpeningSgst)}</TableCell>
                  <TableCell className="p-0 border border-border">{renderEditableCell(openingIgst, setOpeningIgst)}</TableCell>
                  <TableCell className="text-right font-medium border border-border bg-muted/30">
                    {formatNumber(openingTotal)}
                  </TableCell>
                </TableRow>

                {/* Current Total - Auto-calculated from ITC Summary */}
                <TableRow>
                  <TableCell className="font-medium border border-border">
                    CURRENT TOTAL AS PER SUSPENDED RECO
                    <p className="text-[10px] text-muted-foreground font-normal mt-0.5">(4B(2)(i) + 4B(2)(ii)) − (5.4 + 5.5)</p>
                  </TableCell>
                  <TableCell className="text-right border border-border bg-accent/50">{formatNumber(portalCgst)}</TableCell>
                  <TableCell className="text-right border border-border bg-accent/50">{formatNumber(portalSgst)}</TableCell>
                  <TableCell className="text-right border border-border bg-accent/50">{formatNumber(portalIgst)}</TableCell>
                  <TableCell className="text-right font-medium border border-border bg-muted/30">
                    {formatNumber(portalTotal)}
                  </TableCell>
                </TableRow>

                {/* Empty Row for spacing */}
                <TableRow className="h-2 hover:bg-transparent">
                  <TableCell colSpan={5} className="border-0 p-0"></TableCell>
                </TableRow>

                {/* As Per Books Row - Auto-linked */}
                <TableRow>
                  <TableCell className="font-medium border border-border">CLOSING BALANCE AS PER BOOKS</TableCell>
                  <TableCell className="text-right border border-border bg-accent/50">
                    {formatNumber(booksCgst)}
                  </TableCell>
                  <TableCell className="text-right border border-border bg-accent/50">
                    {formatNumber(booksSgst)}
                  </TableCell>
                  <TableCell className="text-right border border-border bg-accent/50">
                    {formatNumber(booksIgst)}
                  </TableCell>
                  <TableCell className="text-right font-medium border border-border bg-muted/30">
                    {formatNumber(booksTotal)}
                  </TableCell>
                </TableRow>

                {/* Empty Row for spacing */}
                <TableRow className="h-2 hover:bg-transparent">
                  <TableCell colSpan={5} className="border-0 p-0"></TableCell>
                </TableRow>

                {/* Difference Row: Opening + Current - Books */}
                <TableRow className="bg-warning/10 hover:bg-warning/10">
                  <TableCell className="font-bold border border-border">DIFFERENCE</TableCell>
                  <TableCell className={`text-right font-medium border border-border ${diffCgst !== 0 ? 'text-destructive' : ''}`}>
                    {formatNumber(diffCgst)}
                  </TableCell>
                  <TableCell className={`text-right font-medium border border-border ${diffSgst !== 0 ? 'text-destructive' : ''}`}>
                    {formatNumber(diffSgst)}
                  </TableCell>
                  <TableCell className={`text-right font-medium border border-border ${diffIgst !== 0 ? 'text-destructive' : ''}`}>
                    {formatNumber(diffIgst)}
                  </TableCell>
                  <TableCell className={`text-right font-bold border border-border ${diffTotal !== 0 ? 'text-destructive' : ''}`}>
                    {formatNumber(diffTotal)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}

          {!selectedClientId && (
            <div className="text-center py-8 text-muted-foreground">
              Please select a client to view suspended reconciliation data.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SuspendedRecoPage;
