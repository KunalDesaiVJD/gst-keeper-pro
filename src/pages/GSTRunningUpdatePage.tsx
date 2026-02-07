import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { FileSpreadsheet, Plus, Save, Loader2, Trash2 } from 'lucide-react';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface Client {
  id: string;
  name: string;
  gstin: string;
}

interface GSTUpdate {
  id?: string;
  client_id: string;
  client_name?: string;
  update_effect_month: string;
  update_in_return: string;
  update_type: string;
  update_instructions_by: string;
  matter_brief: string;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  interest: number;
  effect_month: string;
  remarks: string;
  isNew?: boolean;
}

const RETURN_OPTIONS = ['GSTR-1', 'GSTR-3B', 'GSTR-7', 'GSTR-1 & 3B'];
const UPDATE_TYPE_OPTIONS = ['Claim ITC', 'Reversal ITC', 'Liability', 'RCM', 'Reclaim', 'Reclaim (Expense out)'];

const GSTRunningUpdatePage: React.FC = () => {
  const { user, isStaffRole } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [updates, setUpdates] = useState<GSTUpdate[]>([]);
  const [originalUpdates, setOriginalUpdates] = useState<GSTUpdate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Filter states
  const [filterClient, setFilterClient] = useState<string>('');
  const [filterUpdateEffectMonth, setFilterUpdateEffectMonth] = useState<string>('');
  const [filterEffectMonth, setFilterEffectMonth] = useState<string>('');
  const [filterReturn, setFilterReturn] = useState<string>('');
  const [filterUpdateType, setFilterUpdateType] = useState<string>('');

  const isStaff = isStaffRole();

  // Generate month options with blank option for effect month
  const monthOptions = useMemo(() => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    const startDate = new Date(2024, 3, 1); // April 2024
    const endDate = new Date(now.getFullYear(), now.getMonth() + 12, 1);
    
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const yearShort = String(currentDate.getFullYear()).slice(-2);
      const value = `${monthNames[currentDate.getMonth()]}-${yearShort}`;
      months.push({ value, label: value });
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
    
    return months.sort((a, b) => {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const parseDate = (s: string) => {
        const [m, y] = s.split('-');
        return (2000 + parseInt(y)) * 12 + monthNames.indexOf(m);
      };
      return parseDate(b.value) - parseDate(a.value);
    });
  }, []);

  // Month options with blank option for effect_month
  const effectMonthOptions = useMemo(() => {
    return [{ value: '__blank__', label: '(Blank)' }, ...monthOptions];
  }, [monthOptions]);

  // Fetch clients
  const fetchClients = useCallback(async () => {
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, gstin')
      .order('name');
    
    if (error) {
      console.error('Error fetching clients:', error);
      return;
    }
    setClients(data || []);
  }, []);

  // Fetch updates
  const fetchUpdates = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('gst_running_updates')
        .select('*, clients(name)')
        .order('created_at', { ascending: false });
      
      if (error) throw error;

      const formattedData: GSTUpdate[] = (data || []).map(d => ({
        id: d.id,
        client_id: d.client_id,
        client_name: (d.clients as any)?.name || '',
        update_effect_month: d.update_effect_month,
        update_in_return: d.update_in_return,
        update_type: d.update_type,
        update_instructions_by: d.update_instructions_by || '',
        matter_brief: d.matter_brief || '',
        taxable_value: Number(d.taxable_value) || 0,
        cgst: Number(d.cgst) || 0,
        sgst: Number(d.sgst) || 0,
        igst: Number(d.igst) || 0,
        interest: Number(d.interest) || 0,
        effect_month: d.effect_month || '',
        remarks: d.remarks || '',
      }));

      setUpdates(formattedData);
      setOriginalUpdates(JSON.parse(JSON.stringify(formattedData)));
    } catch (error: any) {
      toast.error('Failed to fetch data: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClients();
    fetchUpdates();
  }, [fetchClients, fetchUpdates]);

  useEffect(() => {
    setHasChanges(JSON.stringify(updates) !== JSON.stringify(originalUpdates));
  }, [updates, originalUpdates]);

  const handleAddRow = () => {
    const defaultClient = clients[0];
    setUpdates([
      ...updates,
      {
        client_id: defaultClient?.id || '',
        client_name: defaultClient?.name || '',
        update_effect_month: '',
        update_in_return: 'GSTR-1',
        update_type: 'Claim ITC',
        update_instructions_by: '',
        matter_brief: '',
        taxable_value: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        interest: 0,
        effect_month: '',
        remarks: '',
        isNew: true,
      },
    ]);
  };

  const handleDeleteRow = (index: number) => {
    const newUpdates = updates.filter((_, i) => i !== index);
    setUpdates(newUpdates);
  };

  const handleFieldChange = (index: number, field: keyof GSTUpdate, value: any) => {
    const newUpdates = [...updates];
    
    if (field === 'client_id') {
      const client = clients.find(c => c.id === value);
      newUpdates[index] = {
        ...newUpdates[index],
        client_id: value,
        client_name: client?.name || '',
      };
    } else {
      (newUpdates[index] as any)[field] = value;
    }
    
    setUpdates(newUpdates);
  };

  const handleSave = async () => {
    if (!isStaff) return;

    setIsSaving(true);
    try {
      // Get IDs of existing records
      const existingIds = originalUpdates.map(u => u.id).filter(Boolean);
      const currentIds = updates.filter(u => u.id).map(u => u.id);
      
      // Delete removed records
      const toDelete = existingIds.filter(id => !currentIds.includes(id));
      if (toDelete.length > 0) {
        await supabase.from('gst_running_updates').delete().in('id', toDelete);
      }

      // Upsert all records
      for (const update of updates) {
        if (!update.client_id || !update.update_effect_month) continue;

        const data = {
          client_id: update.client_id,
          update_effect_month: update.update_effect_month,
          update_in_return: update.update_in_return,
          update_type: update.update_type,
          update_instructions_by: update.update_instructions_by,
          matter_brief: update.matter_brief,
          taxable_value: update.taxable_value,
          cgst: update.cgst,
          sgst: update.sgst,
          igst: update.igst,
          interest: update.interest,
          effect_month: update.effect_month,
          remarks: update.remarks,
          updated_by: user?.id,
          updated_at: new Date().toISOString(),
        };

        if (update.id && !update.isNew) {
          await supabase.from('gst_running_updates').update(data).eq('id', update.id);
        } else {
          await supabase.from('gst_running_updates').insert(data);
        }
      }

      toast.success('Changes saved successfully');
      fetchUpdates();
    } catch (error: any) {
      toast.error('Failed to save: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Apply filters
  const filteredUpdates = useMemo(() => {
    return updates.filter(u => {
      if (filterClient && u.client_id !== filterClient) return false;
      if (filterUpdateEffectMonth && u.update_effect_month !== filterUpdateEffectMonth) return false;
      if (filterEffectMonth && u.effect_month !== filterEffectMonth) return false;
      if (filterReturn && u.update_in_return !== filterReturn) return false;
      if (filterUpdateType && u.update_type !== filterUpdateType) return false;
      return true;
    });
  }, [updates, filterClient, filterUpdateEffectMonth, filterEffectMonth, filterReturn, filterUpdateType]);

  const formatNumber = (num: number): string => {
    if (num === 0 || !num) return '';
    return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <FileSpreadsheet className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-bold text-foreground">GST Update Sheet</h1>
            <p className="text-muted-foreground">Track GST updates and changes</p>
          </div>
        </div>
        {isStaff && (
          <div className="flex items-center gap-2">
            <Button onClick={handleAddRow} variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              Add Row
            </Button>
            <Button onClick={handleSave} disabled={isSaving || !hasChanges}>
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Changes
            </Button>
          </div>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Update Effect Month:</span>
              <div className="w-32">
                <SearchableMonthSelect
                  options={monthOptions}
                  value={filterUpdateEffectMonth}
                  onValueChange={setFilterUpdateEffectMonth}
                  placeholder="All"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Mistake Month:</span>
              <div className="w-32">
                <SearchableMonthSelect
                  options={monthOptions}
                  value={filterEffectMonth}
                  onValueChange={setFilterEffectMonth}
                  placeholder="All"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Client:</span>
              <div className="w-48">
                <SearchableSelect
                  options={[{ value: '', label: 'All Clients' }, ...clients.map(c => ({ value: c.id, label: c.name }))]}
                  value={filterClient}
                  onValueChange={setFilterClient}
                  placeholder="All Clients"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Return:</span>
              <Select value={filterReturn || '__all__'} onValueChange={(val) => setFilterReturn(val === '__all__' ? '' : val)}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All</SelectItem>
                  {RETURN_OPTIONS.map(opt => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Correction Type:</span>
              <Select value={filterUpdateType || '__all__'} onValueChange={(val) => setFilterUpdateType(val === '__all__' ? '' : val)}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All</SelectItem>
                  {UPDATE_TYPE_OPTIONS.map(opt => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {(filterClient || filterUpdateEffectMonth || filterEffectMonth || filterReturn || filterUpdateType) && (
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => {
                  setFilterClient('');
                  setFilterUpdateEffectMonth('');
                  setFilterEffectMonth('');
                  setFilterReturn('');
                  setFilterUpdateType('');
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Data Table */}
      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="w-full">
              <div className="min-w-[1600px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#4A90A4] hover:bg-[#4A90A4]">
                      <TableHead className="font-bold text-white border border-[#2E5A6B] w-12">Sr.No.</TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] w-40">CLIENT</TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] w-24">Mistake Month</TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] w-28">Update Effect Month</TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] w-28">Update in GSTR</TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] w-36">Correction Type</TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] w-32">Instructions By</TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] w-48">Matter Brief</TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] text-right w-24">Taxable Value</TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] text-right w-20">CGST</TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] text-right w-20">SGST</TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] text-right w-20">IGST</TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] text-right w-20">Interest</TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] min-w-[150px]">Remarks</TableHead>
                      {isStaff && <TableHead className="font-bold text-white border border-[#2E5A6B] w-12"></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUpdates.map((update, index) => {
                      const originalIndex = updates.indexOf(update);
                      return (
                        <TableRow key={update.id || `new-${index}`}>
                          <TableCell className="border border-border text-center">{index + 1}</TableCell>
                          <TableCell className="p-0 border border-border">
                            {isStaff ? (
                              <SearchableSelect
                                options={clients.map(c => ({ value: c.id, label: c.name }))}
                                value={update.client_id}
                                onValueChange={(val) => handleFieldChange(originalIndex, 'client_id', val)}
                                placeholder="Select..."
                              />
                            ) : (
                              <span className="px-2">{update.client_name}</span>
                            )}
                          </TableCell>
                          <TableCell className="p-0 border border-border">
                            {isStaff ? (
                              <SearchableMonthSelect
                                options={effectMonthOptions}
                                value={update.effect_month === '' ? '__blank__' : update.effect_month}
                                onValueChange={(val) => handleFieldChange(originalIndex, 'effect_month', val === '__blank__' ? '' : val)}
                                placeholder="Select..."
                              />
                            ) : (
                              <span className="px-2">{update.effect_month || '(Blank)'}</span>
                            )}
                          </TableCell>
                          <TableCell className="p-0 border border-border">
                            {isStaff ? (
                              <SearchableMonthSelect
                                options={monthOptions}
                                value={update.update_effect_month}
                                onValueChange={(val) => handleFieldChange(originalIndex, 'update_effect_month', val)}
                                placeholder="Select..."
                              />
                            ) : (
                              <span className="px-2">{update.update_effect_month}</span>
                            )}
                          </TableCell>
                          <TableCell className="p-0 border border-border">
                            {isStaff ? (
                              <Select
                                value={update.update_in_return}
                                onValueChange={(val) => handleFieldChange(originalIndex, 'update_in_return', val)}
                              >
                                <SelectTrigger className="border-0 shadow-none">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {RETURN_OPTIONS.map(opt => (
                                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="px-2">{update.update_in_return}</span>
                            )}
                          </TableCell>
                          <TableCell className="p-0 border border-border">
                            {isStaff ? (
                              <Select
                                value={update.update_type}
                                onValueChange={(val) => handleFieldChange(originalIndex, 'update_type', val)}
                              >
                                <SelectTrigger className="border-0 shadow-none w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {UPDATE_TYPE_OPTIONS.map(opt => (
                                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="px-2">{update.update_type}</span>
                            )}
                          </TableCell>
                          <TableCell className="p-0 border border-border">
                            <Input
                              value={update.update_instructions_by}
                              onChange={(e) => handleFieldChange(originalIndex, 'update_instructions_by', e.target.value)}
                              className="h-8 border-0 shadow-none"
                              disabled={!isStaff}
                            />
                          </TableCell>
                          <TableCell className="p-0 border border-border">
                            <Input
                              value={update.matter_brief}
                              onChange={(e) => handleFieldChange(originalIndex, 'matter_brief', e.target.value)}
                              className="h-8 border-0 shadow-none"
                              disabled={!isStaff}
                            />
                          </TableCell>
                          <TableCell className="p-0 border border-border">
                            <Input
                              type="number"
                              value={update.taxable_value || ''}
                              onChange={(e) => handleFieldChange(originalIndex, 'taxable_value', parseFloat(e.target.value) || 0)}
                              className="h-8 text-right border-0 shadow-none"
                              disabled={!isStaff}
                            />
                          </TableCell>
                          <TableCell className="p-0 border border-border">
                            <Input
                              type="number"
                              value={update.cgst || ''}
                              onChange={(e) => handleFieldChange(originalIndex, 'cgst', parseFloat(e.target.value) || 0)}
                              className="h-8 text-right border-0 shadow-none"
                              disabled={!isStaff}
                            />
                          </TableCell>
                          <TableCell className="p-0 border border-border">
                            <Input
                              type="number"
                              value={update.sgst || ''}
                              onChange={(e) => handleFieldChange(originalIndex, 'sgst', parseFloat(e.target.value) || 0)}
                              className="h-8 text-right border-0 shadow-none"
                              disabled={!isStaff}
                            />
                          </TableCell>
                          <TableCell className="p-0 border border-border">
                            <Input
                              type="number"
                              value={update.igst || ''}
                              onChange={(e) => handleFieldChange(originalIndex, 'igst', parseFloat(e.target.value) || 0)}
                              className="h-8 text-right border-0 shadow-none"
                              disabled={!isStaff}
                            />
                          </TableCell>
                          <TableCell className="p-0 border border-border">
                            <Input
                              type="number"
                              value={update.interest || ''}
                              onChange={(e) => handleFieldChange(originalIndex, 'interest', parseFloat(e.target.value) || 0)}
                              className="h-8 text-right border-0 shadow-none"
                              disabled={!isStaff}
                            />
                          </TableCell>
                          <TableCell className="p-0 border border-border min-w-[150px]">
                            <textarea
                              value={update.remarks}
                              onChange={(e) => handleFieldChange(originalIndex, 'remarks', e.target.value)}
                              className="w-full min-h-[32px] max-h-[80px] text-xs px-2 py-1 border-0 shadow-none bg-transparent resize-y"
                              disabled={!isStaff}
                            />
                          </TableCell>
                          {isStaff && (
                            <TableCell className="border border-border text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteRow(originalIndex)}
                                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                    {filteredUpdates.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={isStaff ? 15 : 14} className="text-center py-8 text-muted-foreground">
                          No records found. {isStaff && 'Click "Add Row" to create a new entry.'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default GSTRunningUpdatePage;
