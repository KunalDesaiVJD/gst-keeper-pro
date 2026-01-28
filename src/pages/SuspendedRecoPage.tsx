import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileText, Save, Loader2 } from 'lucide-react';
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
  
  // Portal values (editable)
  const [portalCgst, setPortalCgst] = useState<number>(0);
  const [portalSgst, setPortalSgst] = useState<number>(0);
  const [portalIgst, setPortalIgst] = useState<number>(0);
  
  // Books values (auto-linked from 2B)
  const [booksCgst, setBooksCgst] = useState<number>(0);
  const [booksSgst, setBooksSgst] = useState<number>(0);
  const [booksIgst, setBooksIgst] = useState<number>(0);

  const selectedClientData = clients.find(c => c.id === selectedClientId);
  const isStaff = isStaffRole();

  // Generate month options
  const generateMonthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    
    // Find registration date from selected client
    const client = clients.find(c => c.id === selectedClientId);
    let startDate = new Date(now.getFullYear(), now.getMonth() - 12, 1);
    
    if (client?.registration_date) {
      const regDate = new Date(client.registration_date);
      startDate = new Date(regDate.getFullYear(), regDate.getMonth(), 1);
    }
    
    const futureLimit = new Date(now.getFullYear(), now.getMonth() + 12, 1);
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

  // Fetch clients - fix for client login: match by id for clients, show all for staff
  const fetchClients = useCallback(async () => {
    let query = supabase
      .from('clients')
      .select('id, name, gstin, registration_date')
      .order('name');
    
    // For client users, we need to match their client record
    // The user.id for clients IS the client table's id
    if (user && !isStaff) {
      // Try to match by client id (user.id is client's id for client login)
      query = query.eq('id', user.id);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Error fetching clients:', error);
      return;
    }
    setClients(data || []);
    
    // Auto-select for client users
    if (!isStaff && data && data.length > 0 && !selectedClientId) {
      setSelectedClientId(data[0].id);
    }
  }, [user, isStaff, selectedClientId, setSelectedClientId]);

  // Fetch suspended reco data
  const fetchData = useCallback(async () => {
    if (!selectedClientId || !selectedMonth) return;

    setIsLoading(true);
    try {
      // Fetch portal data from suspended_reco table
      const { data: suspendedData } = await supabase
        .from('suspended_reco')
        .select('*')
        .eq('client_id', selectedClientId)
        .eq('period_month', selectedMonth)
        .maybeSingle();
      
      if (suspendedData) {
        setPortalCgst(Number(suspendedData.portal_cgst) || 0);
        setPortalSgst(Number(suspendedData.portal_sgst) || 0);
        setPortalIgst(Number(suspendedData.portal_igst) || 0);
      } else {
        setPortalCgst(0);
        setPortalSgst(0);
        setPortalIgst(0);
      }

      // Fetch books data from bills_not_in_2b 
      // RULE: Sum of values where RECLAIM is blank
      // EXCEPTION: If BOTH reversal AND reclaim are blank, exclude that row
      const { data: booksData } = await supabase
        .from('bills_not_in_2b')
        .select('input_cgst, input_sgst, input_igst, reversal_month, reclaim_month')
        .eq('client_id', selectedClientId)
        .eq('period_month', selectedMonth);
      
      if (booksData && booksData.length > 0) {
        // Filter logic:
        // 1. Reclaim must be blank (include only blank reclaim rows)
        // 2. EXCEPTION: If BOTH reversal AND reclaim are blank, exclude that row
        // So: Include rows where Reclaim is blank AND Reversal is NOT blank
        const filteredData = booksData.filter(row => {
          const reversalBlank = row.reversal_month === null || row.reversal_month === '';
          const reclaimBlank = row.reclaim_month === null || row.reclaim_month === '';
          // Include only if: Reclaim is blank AND Reversal is NOT blank
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
          portal_cgst: portalCgst,
          portal_sgst: portalSgst,
          portal_igst: portalIgst,
          updated_by: user?.id,
          updated_at: new Date().toISOString(),
        }, {
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

  // Helper to normalize -0 to 0
  const normalizeZero = (num: number): number => {
    return Object.is(num, -0) ? 0 : num;
  };

  // Calculate totals and difference
  const portalTotal = portalCgst + portalSgst + portalIgst;
  const booksTotal = booksCgst + booksSgst + booksIgst;
  const diffCgst = normalizeZero(portalCgst - booksCgst);
  const diffSgst = normalizeZero(portalSgst - booksSgst);
  const diffIgst = normalizeZero(portalIgst - booksIgst);
  const diffTotal = normalizeZero(portalTotal - booksTotal);

  const formatNumber = (num: number): string => {
    // Handle -0 case by converting to 0
    const normalized = Object.is(num, -0) ? 0 : num;
    if (normalized === 0) return '0';
    return normalized.toLocaleString('en-IN', { maximumFractionDigits: 2 });
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
                {/* As Per Portal Row - Editable */}
                <TableRow>
                  <TableCell className="font-medium border border-border">AS PER PORTAL</TableCell>
                  <TableCell className="p-0 border border-border">
                    {isStaff ? (
                      <Input
                        type="number"
                        value={portalCgst || ''}
                        onChange={(e) => setPortalCgst(parseFloat(e.target.value) || 0)}
                        className="h-10 text-right border-0 shadow-none rounded-none"
                        min="0"
                      />
                    ) : (
                      <span className="block text-right px-3">{formatNumber(portalCgst)}</span>
                    )}
                  </TableCell>
                  <TableCell className="p-0 border border-border">
                    {isStaff ? (
                      <Input
                        type="number"
                        value={portalSgst || ''}
                        onChange={(e) => setPortalSgst(parseFloat(e.target.value) || 0)}
                        className="h-10 text-right border-0 shadow-none rounded-none"
                        min="0"
                      />
                    ) : (
                      <span className="block text-right px-3">{formatNumber(portalSgst)}</span>
                    )}
                  </TableCell>
                  <TableCell className="p-0 border border-border">
                    {isStaff ? (
                      <Input
                        type="number"
                        value={portalIgst || ''}
                        onChange={(e) => setPortalIgst(parseFloat(e.target.value) || 0)}
                        className="h-10 text-right border-0 shadow-none rounded-none"
                        min="0"
                      />
                    ) : (
                      <span className="block text-right px-3">{formatNumber(portalIgst)}</span>
                    )}
                  </TableCell>
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
                  <TableCell className="font-medium border border-border">AS PER BOOKS</TableCell>
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

                {/* Difference Row */}
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
