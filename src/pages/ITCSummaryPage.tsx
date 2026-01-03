import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Lock, AlertCircle, Unlock, Save } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';

interface ITCRow {
  srNo: string;
  particular: string;
  igst: number;
  cgst: number;
  sgst: number;
  isHeader?: boolean;
  isAutoLinked?: boolean;
  editable?: boolean;
}

interface ITCData {
  section4A: ITCRow[];
  section4B: ITCRow[];
  section4D: ITCRow[];
}

interface Client {
  id: string;
  name: string;
  gstin: string;
}

const ITCSummaryPage: React.FC = () => {
  const { canUnlockSheets, user } = useAuth();
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>('01/2026');
  const [isLocked, setIsLocked] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [itcSummaryId, setItcSummaryId] = useState<string | null>(null);

  // Editable ITC data state
  const [itcData, setItcData] = useState<ITCData>({
    section4A: [
      { srNo: '(1)', particular: 'Import of Goods', igst: 0, cgst: 0, sgst: 0, editable: true },
      { srNo: '(2)', particular: 'Import of Services', igst: 0, cgst: 0, sgst: 0, editable: true },
      { srNo: '(3)', particular: 'RCM ITC', igst: 0, cgst: 0, sgst: 0, editable: true },
      { srNo: '(4)', particular: 'Inward Supplies from ISD', igst: 0, cgst: 0, sgst: 0, editable: true },
      { srNo: '(5)', particular: 'All other ITC', igst: 0, cgst: 0, sgst: 0, isHeader: true },
      { srNo: '5.1', particular: 'ITC for the Month', igst: 0, cgst: 0, sgst: 0, editable: true },
      { srNo: '5.2', particular: 'ITC for Previous Month, if any', igst: 0, cgst: 0, sgst: 0, editable: true },
      { srNo: '5.3', particular: 'Debit Note', igst: 0, cgst: 0, sgst: 0, editable: true },
      { srNo: '5.4', particular: 'Reclaim of ITC Reversed for Previous months', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true },
      { srNo: '5.5', particular: 'Reclaim of ITC Reversed due to 180 days rule', igst: 0, cgst: 0, sgst: 0, editable: true },
    ],
    section4B: [
      { srNo: '(1)', particular: 'ITC Reversal under Rule 38, 42 & 43, and Section 17(5)', igst: 0, cgst: 0, sgst: 0, editable: true },
      { srNo: '(2)', particular: 'Others', igst: 0, cgst: 0, sgst: 0, editable: true },
      { srNo: '', particular: 'ITC Reversal for current month as per 2B RECO', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true },
      { srNo: '', particular: 'ITC Reversal for previous months, if any', igst: 0, cgst: 0, sgst: 0, editable: true },
      { srNo: '', particular: 'ITC Reversal due to 180 days Analysis', igst: 0, cgst: 0, sgst: 0, editable: true },
    ],
    section4D: [
      { srNo: '(1)', particular: 'ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true },
      { srNo: '1.1', particular: 'Reclaim of ITC Reversed for Previous months', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true },
      { srNo: '1.2', particular: 'Reclaim of ITC Reversed due to 180 days rule', igst: 0, cgst: 0, sgst: 0, editable: true },
      { srNo: '(2)', particular: 'Ineligible ITC under section 16(4) & ITC restricted due to PoS rules', igst: 0, cgst: 0, sgst: 0, editable: true },
    ],
  });

  const selectedClientData = clients.find(c => c.id === selectedClient);

  // Fetch clients
  useEffect(() => {
    const fetchClients = async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, gstin')
        .order('name');
      
      if (error) {
        console.error('Error fetching clients:', error);
        return;
      }
      setClients(data || []);
    };
    fetchClients();
  }, []);

  // Fetch ITC Summary data when client/month changes
  const fetchITCSummary = useCallback(async () => {
    if (!selectedClient || !selectedMonth) return;

    const { data, error } = await supabase
      .from('itc_summaries')
      .select('*')
      .eq('client_id', selectedClient)
      .eq('period_month', selectedMonth)
      .maybeSingle();

    if (error) {
      console.error('Error fetching ITC summary:', error);
      return;
    }

    if (data) {
      setItcSummaryId(data.id);
      setIsLocked(data.is_locked || false);
      const savedData = data.data as unknown as ITCData;
      if (savedData && savedData.section4A) {
        setItcData(savedData);
      }
    } else {
      setItcSummaryId(null);
      setIsLocked(false);
      // Reset to default
      setItcData({
        section4A: [
          { srNo: '(1)', particular: 'Import of Goods', igst: 0, cgst: 0, sgst: 0, editable: true },
          { srNo: '(2)', particular: 'Import of Services', igst: 0, cgst: 0, sgst: 0, editable: true },
          { srNo: '(3)', particular: 'RCM ITC', igst: 0, cgst: 0, sgst: 0, editable: true },
          { srNo: '(4)', particular: 'Inward Supplies from ISD', igst: 0, cgst: 0, sgst: 0, editable: true },
          { srNo: '(5)', particular: 'All other ITC', igst: 0, cgst: 0, sgst: 0, isHeader: true },
          { srNo: '5.1', particular: 'ITC for the Month', igst: 0, cgst: 0, sgst: 0, editable: true },
          { srNo: '5.2', particular: 'ITC for Previous Month, if any', igst: 0, cgst: 0, sgst: 0, editable: true },
          { srNo: '5.3', particular: 'Debit Note', igst: 0, cgst: 0, sgst: 0, editable: true },
          { srNo: '5.4', particular: 'Reclaim of ITC Reversed for Previous months', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true },
          { srNo: '5.5', particular: 'Reclaim of ITC Reversed due to 180 days rule', igst: 0, cgst: 0, sgst: 0, editable: true },
        ],
        section4B: [
          { srNo: '(1)', particular: 'ITC Reversal under Rule 38, 42 & 43, and Section 17(5)', igst: 0, cgst: 0, sgst: 0, editable: true },
          { srNo: '(2)', particular: 'Others', igst: 0, cgst: 0, sgst: 0, editable: true },
          { srNo: '', particular: 'ITC Reversal for current month as per 2B RECO', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true },
          { srNo: '', particular: 'ITC Reversal for previous months, if any', igst: 0, cgst: 0, sgst: 0, editable: true },
          { srNo: '', particular: 'ITC Reversal due to 180 days Analysis', igst: 0, cgst: 0, sgst: 0, editable: true },
        ],
        section4D: [
          { srNo: '(1)', particular: 'ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true },
          { srNo: '1.1', particular: 'Reclaim of ITC Reversed for Previous months', igst: 0, cgst: 0, sgst: 0, isAutoLinked: true },
          { srNo: '1.2', particular: 'Reclaim of ITC Reversed due to 180 days rule', igst: 0, cgst: 0, sgst: 0, editable: true },
          { srNo: '(2)', particular: 'Ineligible ITC under section 16(4) & ITC restricted due to PoS rules', igst: 0, cgst: 0, sgst: 0, editable: true },
        ],
      });
    }
  }, [selectedClient, selectedMonth]);

  useEffect(() => {
    fetchITCSummary();
  }, [fetchITCSummary]);

  // Real-time subscription
  useEffect(() => {
    if (!selectedClient || !selectedMonth) return;

    const channel = supabase
      .channel('itc-summary-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'itc_summaries',
          filter: `client_id=eq.${selectedClient}`
        },
        (payload) => {
          console.log('ITC Summary real-time update:', payload);
          if (payload.new && (payload.new as any).period_month === selectedMonth) {
            const newData = payload.new as any;
            setItcSummaryId(newData.id);
            setIsLocked(newData.is_locked || false);
            if (newData.data && newData.data.section4A) {
              setItcData(newData.data as ITCData);
              toast.info('ITC Summary updated by another user');
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedClient, selectedMonth]);

  // Handle cell value change
  const handleCellChange = (section: keyof ITCData, rowIndex: number, field: 'igst' | 'cgst' | 'sgst', value: string) => {
    if (isLocked) return;

    const numValue = parseFloat(value) || 0;
    
    setItcData(prev => {
      const newData = { ...prev };
      const newSection = [...newData[section]];
      newSection[rowIndex] = { ...newSection[rowIndex], [field]: numValue };
      newData[section] = newSection;

      // Auto-link 4(d)(1) and 4(d) 1.1 to 4(a) 5.4 value
      if (section === 'section4A' && newSection[rowIndex].srNo === '5.4') {
        const reclaimValue = newSection[rowIndex].igst;
        newData.section4D = newData.section4D.map(row => {
          if (row.srNo === '(1)' || row.srNo === '1.1') {
            return { ...row, igst: reclaimValue };
          }
          return row;
        });
      }

      return newData;
    });
  };

  // Save to database
  const handleSave = async () => {
    if (!selectedClient || !selectedMonth) return;

    setIsSaving(true);
    try {
      const payload = {
        client_id: selectedClient,
        period_month: selectedMonth,
        data: JSON.parse(JSON.stringify(itcData)) as Json,
        updated_by: user?.id || null,
        updated_at: new Date().toISOString(),
      };

      if (itcSummaryId) {
        const { error } = await supabase
          .from('itc_summaries')
          .update(payload)
          .eq('id', itcSummaryId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('itc_summaries')
          .insert([payload])
          .select()
          .single();

        if (error) throw error;
        setItcSummaryId(data.id);
      }

      toast.success('ITC Summary saved successfully');
    } catch (error: any) {
      console.error('Error saving ITC summary:', error);
      toast.error('Failed to save: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUnlock = async () => {
    if (!itcSummaryId) return;

    try {
      const { error } = await supabase
        .from('itc_summaries')
        .update({ is_locked: false })
        .eq('id', itcSummaryId);

      if (error) throw error;
      setIsLocked(false);
      toast.success('ITC Summary Sheet unlocked successfully');
    } catch (error: any) {
      toast.error('Failed to unlock: ' + error.message);
    }
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

  const totalReclaimed = itcData.section4A
    .filter(r => r.srNo === '5.4' || r.srNo === '5.5')
    .reduce((acc, r) => acc + r.igst + r.cgst + r.sgst, 0);

  const totalReversal = itcData.section4B
    .reduce((acc, r) => acc + r.igst + r.cgst + r.sgst, 0);

  const renderEditableCell = (section: keyof ITCData, rowIndex: number, row: ITCRow, field: 'igst' | 'cgst' | 'sgst') => {
    const canEdit = row.editable && !isLocked && !row.isAutoLinked;
    
    if (canEdit) {
      return (
        <Input
          type="number"
          value={row[field]}
          onChange={(e) => handleCellChange(section, rowIndex, field, e.target.value)}
          className="w-24 text-right h-8 text-sm"
        />
      );
    }
    return <span>{row[field].toLocaleString('en-IN')}</span>;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">ITC Summary</h1>
          <p className="text-muted-foreground">Input Tax Credit summary for the month</p>
        </div>
        {selectedClient && !isLocked && (
          <Button onClick={handleSave} disabled={isSaving} className="flex items-center gap-2">
            <Save className="h-4 w-4" />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        )}
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
                  {clients.map((client) => (
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
                <p className="text-2xl font-bold text-success">₹{totalReclaimed.toLocaleString('en-IN')}</p>
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
          {canUnlockSheets() && isLocked && (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" className="flex items-center gap-2" onClick={handleUnlock}>
                <Unlock className="h-4 w-4" />
                Unlock ITC Summary Sheet
              </Button>
            </div>
          )}

          {/* Lock indicator */}
          {isLocked && (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 flex items-center gap-2 text-warning">
              <Lock className="h-4 w-4" />
              <span className="text-sm">This sheet is locked because the return has been filed. Only Superadmin or GST Manager can unlock.</span>
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
                        <td className="text-right">{renderEditableCell('section4A', idx, row, 'igst')}</td>
                        <td className="text-right">{renderEditableCell('section4A', idx, row, 'cgst')}</td>
                        <td className="text-right">{renderEditableCell('section4A', idx, row, 'sgst')}</td>
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
                        <td className="text-right">{renderEditableCell('section4B', idx, row, 'igst')}</td>
                        <td className="text-right">{renderEditableCell('section4B', idx, row, 'cgst')}</td>
                        <td className="text-right">{renderEditableCell('section4B', idx, row, 'sgst')}</td>
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
                      <tr key={`4d-${idx}`} className={row.isAutoLinked ? 'cell-locked' : ''}>
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
                        <td className="text-right">{renderEditableCell('section4D', idx, row, 'igst')}</td>
                        <td className="text-right">{renderEditableCell('section4D', idx, row, 'cgst')}</td>
                        <td className="text-right">{renderEditableCell('section4D', idx, row, 'sgst')}</td>
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
