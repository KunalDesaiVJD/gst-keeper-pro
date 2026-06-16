import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { FileSpreadsheet, Plus, Save, Loader2, Trash2, Download, History, Clock } from 'lucide-react';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { exportGSTUpdateToPDF } from '@/utils/gstUpdatePdfExport';
import GenericVersionHistoryDialog, { GenericVersion } from '@/components/dialogs/GenericVersionHistoryDialog';
import * as XLSX from 'xlsx';
import RowVersionHistoryDialog from '@/components/dialogs/RowVersionHistoryDialog';

interface Client {
  id: string;
  name: string;
  gstin: string;
}

interface StaffUser {
  id: string;
  name: string;
  role: string;
}

interface GSTUpdate {
  id?: string;
  client_id: string;
  client_name?: string;
  update_effect_month: string;
  update_in_return: string;
  update_type: string;
  update_instructions_by: string;
  instructions_by_employee_id: string;
  matter_brief: string;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  interest: number;
  effect_month: string;
  remarks: string;
  remarks_checked: boolean;
  isNew?: boolean;
}

const RETURN_OPTIONS = ['GSTR-1', 'GSTR-3B', 'GSTR-7', 'GSTR-1 & 3B'];
const UPDATE_TYPE_OPTIONS = ['Claim ITC', 'Reversal ITC', 'Liability', 'RCM Liability', 'Reclaim', 'Reclaim (Expense out)'];

const GSTRunningUpdatePage: React.FC = () => {
  const { user, isStaffRole, canEditUpdateSheet } = useAuth();
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [updates, setUpdates] = useState<GSTUpdate[]>([]);
  const [originalUpdates, setOriginalUpdates] = useState<GSTUpdate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versions, setVersions] = useState<GenericVersion[]>([]);
  const [lastSavedBy, setLastSavedBy] = useState<{ name: string; role: string; time: string; version: number } | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('gst-update-col-widths');
    return saved ? JSON.parse(saved) : {};
  });
  const [rowHistoryId, setRowHistoryId] = useState<string | null>(null);
  const [rowHistoryLabel, setRowHistoryLabel] = useState<string>('');

  // Filter states
  const [filterClient, setFilterClient] = useState<string>('');
  const [filterUpdateEffectMonth, setFilterUpdateEffectMonth] = useState<string>('');
  const [filterEffectMonth, setFilterEffectMonth] = useState<string>('');
  const [filterReturn, setFilterReturn] = useState<string>('');
  const [filterUpdateType, setFilterUpdateType] = useState<string>('');
  const [filterInstructionsBy, setFilterInstructionsBy] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'' | 'pending' | 'given'>('');

  const isStaff = isStaffRole();
  const canEdit = canEditUpdateSheet();
  const canDeleteGSTRows = user?.role === 'superadmin' || user?.role === 'gst_manager';
  const canViewVersions = user?.role === 'superadmin' || user?.role === 'gst_manager';

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
        instructions_by_employee_id: (d as any).instructions_by_employee_id || '',
        matter_brief: d.matter_brief || '',
        taxable_value: Number(d.taxable_value) || 0,
        cgst: Number(d.cgst) || 0,
        sgst: Number(d.sgst) || 0,
        igst: Number(d.igst) || 0,
        interest: Number(d.interest) || 0,
        effect_month: d.effect_month || '',
        remarks: d.remarks || '',
        remarks_checked: !!(d.remarks && d.remarks.trim().length > 0),
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
    // Fetch staff users for Instructions By dropdown
    const fetchStaffUsers = async () => {
      const { data: profiles } = await supabase.from('profiles').select('user_id, first_name');
      const { data: roles } = await supabase.from('user_roles').select('user_id, role');
      if (profiles && roles) {
        const roleMap = new Map(roles.map(r => [r.user_id, r.role]));
        const users: StaffUser[] = profiles
          .filter(p => roleMap.has(p.user_id))
          .map(p => ({ id: p.user_id, name: p.first_name, role: roleMap.get(p.user_id) || 'employee' }));
        setStaffUsers(users);
      }
    };
    fetchStaffUsers();
  }, [fetchClients, fetchUpdates]);

  // Fetch version history
  const fetchVersions = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('gst_update_versions')
        .select('*')
        .order('version_number', { ascending: false });
      
      if (!data || data.length === 0) { setVersions([]); return; }

      const userIds = [...new Set(data.map(v => v.updated_by).filter(Boolean))];
      let userMap: Record<string, { name: string; role: string }> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('user_id, first_name').in('user_id', userIds);
        const { data: roles } = await supabase.from('user_roles').select('user_id, role').in('user_id', userIds);
        (profiles || []).forEach(p => { userMap[p.user_id] = { name: p.first_name, role: '' }; });
        (roles || []).forEach(r => { if (userMap[r.user_id]) userMap[r.user_id].role = r.role; });
      }
      const formatted = data.map(v => ({
        id: v.id, versionNumber: v.version_number || 1, versionData: v.version_data,
        updatedBy: userMap[v.updated_by]?.name || 'Unknown', updatedByRole: userMap[v.updated_by]?.role || '',
        updatedAt: v.updated_at, isCurrent: v.is_current || false, actionType: v.action_type || 'SAVE',
        restoredFromVersionId: v.restored_from_version_id,
      }));
      setVersions(formatted);
      
      // Set last saved by from latest version
      if (formatted.length > 0) {
        const latest = formatted[0];
        setLastSavedBy({
          name: latest.updatedBy,
          role: latest.updatedByRole || '',
          time: latest.updatedAt,
          version: latest.versionNumber,
        });
      } else {
        setLastSavedBy(null);
      }
    } catch (error) { console.error('Error fetching GST update versions:', error); }
  }, []);

  useEffect(() => { fetchVersions(); }, [fetchVersions]);

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
        instructions_by_employee_id: '',
        matter_brief: '',
        taxable_value: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        interest: 0,
        effect_month: '',
        remarks: '',
        remarks_checked: false,
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
    if (!canEdit) return;

    // Validate: if checkbox is ticked, remarks must be filled; if remarks filled, checkbox must be ticked
    const invalidRows = updates.filter(u => {
      if (u.remarks_checked && (!u.remarks || !u.remarks.trim())) return true;
      return false;
    });

    const uncheckedWithRemarks = updates.filter(u => {
      if (!u.remarks_checked && u.remarks && u.remarks.trim().length > 0) return true;
      return false;
    });

    if (invalidRows.length > 0) {
      toast.error('Some rows have the checkbox ticked but no remarks written. Please fill in remarks.');
      return;
    }

    if (uncheckedWithRemarks.length > 0) {
      toast.error('Some rows have remarks but the checkbox is not ticked. Please tick the checkbox to confirm.');
      return;
    }

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

      // Validate all rows have required fields before saving
      const invalidRows = updates.filter((u, idx) => !u.client_id || !u.update_effect_month);
      if (invalidRows.length > 0) {
        toast.error('Some rows are missing required fields (Client or Update Effect Month). Please fill them before saving.');
        setIsSaving(false);
        return;
      }

      // Upsert all records
      for (const update of updates) {

        const data = {
          client_id: update.client_id,
          update_effect_month: update.update_effect_month,
          update_in_return: update.update_in_return,
          update_type: update.update_type === 'RCM' ? 'RCM Liability' : update.update_type,
          update_instructions_by: update.update_instructions_by,
          instructions_by_employee_id: update.instructions_by_employee_id || null,
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
          const { error: updateError } = await supabase.from('gst_running_updates').update(data).eq('id', update.id);
          if (updateError) {
            console.error('Error updating row:', updateError);
            throw updateError;
          }
        } else {
          const { error: insertError } = await supabase.from('gst_running_updates').insert(data);
          if (insertError) {
            console.error('Error inserting row:', insertError);
            throw insertError;
          }
        }
      }

      // Row-wise version tracking
      try {
        const groupVersionId = crypto.randomUUID();
        const fieldsToTrack = ['client_id', 'update_effect_month', 'update_in_return', 'update_type', 'update_instructions_by', 'instructions_by_employee_id', 'matter_brief', 'taxable_value', 'cgst', 'sgst', 'igst', 'interest', 'effect_month', 'remarks'];
        
        for (const update of updates) {
          if (!update.id || update.isNew) continue;
          const original = originalUpdates.find(o => o.id === update.id);
          if (!original) continue;
          
          for (const field of fieldsToTrack) {
            const oldVal = (original as any)[field];
            const newVal = (update as any)[field];
            if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
              await supabase.from('gst_update_row_versions').insert({
                row_id: update.id,
                changed_by_employee_id: user?.id || null,
                group_version_id: groupVersionId,
                field_name: field,
                old_value: JSON.stringify(oldVal),
                new_value: JSON.stringify(newVal),
              } as any);
            }
          }
        }
      } catch (rvErr) { console.error('Error saving row versions:', rvErr); }

      // Save version snapshot (keep existing full-sheet versioning too)
      try {
        const { data: maxV } = await supabase.from('gst_update_versions').select('version_number').order('version_number', { ascending: false }).limit(1);
        const nextV = (maxV?.[0]?.version_number || 0) + 1;
        await supabase.from('gst_update_versions').update({ is_current: false } as any).eq('is_current', true);
        await supabase.from('gst_update_versions').insert([{ version_number: nextV, version_data: JSON.parse(JSON.stringify(updates)), updated_by: user?.id, is_current: true, action_type: 'SAVE' } as any]);
        fetchVersions();
      } catch (vErr) { console.error('Error saving GST update version:', vErr); }

      toast.success('Changes saved successfully');
      fetchUpdates();
    } catch (error: any) {
      toast.error('Failed to save: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Apply filters, then float pending (unticked) effects to the top so
  // outstanding work is visible first.
  const filteredUpdates = useMemo(() => {
    const filtered = updates.filter(u => {
      if (filterClient && u.client_id !== filterClient) return false;
      if (filterUpdateEffectMonth && u.update_effect_month !== filterUpdateEffectMonth) return false;
      if (filterEffectMonth && u.effect_month !== filterEffectMonth) return false;
      if (filterReturn && u.update_in_return !== filterReturn) return false;
      if (filterUpdateType && u.update_type !== filterUpdateType) return false;
      if (filterInstructionsBy && u.instructions_by_employee_id !== filterInstructionsBy) return false;
      if (filterStatus === 'pending' && u.remarks_checked) return false;
      if (filterStatus === 'given' && !u.remarks_checked) return false;
      return true;
    });
    return [...filtered].sort((a, b) => Number(a.remarks_checked) - Number(b.remarks_checked));
  }, [updates, filterClient, filterUpdateEffectMonth, filterEffectMonth, filterReturn, filterUpdateType, filterInstructionsBy, filterStatus]);

  const formatNumber = (num: number): string => {
    if (num === 0 || !num) return '';
    return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  };

  const handleResizeStart = (colKey: string, startX: number) => {
    const startWidth = columnWidths[colKey] || 150;
    const onMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(60, startWidth + (e.clientX - startX));
      setColumnWidths(prev => {
        const updated = { ...prev, [colKey]: newWidth };
        localStorage.setItem('gst-update-col-widths', JSON.stringify(updated));
        return updated;
      });
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const ResizeHandle = ({ colKey }: { colKey: string }) => (
    <div
      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-white/30 active:bg-white/50 z-20"
      onMouseDown={(e) => {
        e.preventDefault();
        handleResizeStart(colKey, e.clientX);
      }}
    />
  );

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
            {lastSavedBy && (
              <p className="text-xs text-muted-foreground mt-1">
                Last saved by <span className="font-semibold text-foreground">{lastSavedBy.name}</span>
                {lastSavedBy.role && <span className="text-muted-foreground"> ({lastSavedBy.role})</span>}
                {' '}on {new Date(lastSavedBy.time).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} {new Date(lastSavedBy.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                {' '}• v{lastSavedBy.version}
              </p>
            )}
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => {
              exportGSTUpdateToPDF(filteredUpdates, {
                client: filterClient ? clients.find(c => c.id === filterClient)?.name : undefined,
                updateEffectMonth: filterUpdateEffectMonth || undefined,
                effectMonth: filterEffectMonth || undefined,
              });
              toast.success('PDF exported successfully');
            }}>
              <Download className="h-4 w-4 mr-2" />
              Export PDF
            </Button>
            {canViewVersions && (
              <Button variant="outline" onClick={() => setShowVersionHistory(true)}>
                <History className="h-4 w-4 mr-2" />
                View Versions
              </Button>
            )}
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

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Instructions By:</span>
              <div className="w-48">
                <SearchableSelect
                  options={[{ value: '', label: 'All' }, ...staffUsers.map(u => ({ value: u.id, label: u.name, sublabel: u.role }))]}
                  value={filterInstructionsBy}
                  onValueChange={setFilterInstructionsBy}
                  placeholder="All"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Status:</span>
              <Select value={filterStatus || '__all__'} onValueChange={(val) => setFilterStatus(val === '__all__' ? '' : (val as 'pending' | 'given'))}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="given">Given</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(filterClient || filterUpdateEffectMonth || filterEffectMonth || filterReturn || filterUpdateType || filterInstructionsBy || filterStatus) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilterClient('');
                  setFilterUpdateEffectMonth('');
                  setFilterEffectMonth('');
                  setFilterReturn('');
                  setFilterUpdateType('');
                  setFilterInstructionsBy('');
                  setFilterStatus('');
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Version History Dialog */}
      <GenericVersionHistoryDialog
        open={showVersionHistory}
        onOpenChange={setShowVersionHistory}
        versions={versions}
        onRestore={async (version) => {
          toast.info('Restore not supported for GST Update Sheet');
        }}
        onDownload={(version) => {
          try {
            const versionData = version.versionData as GSTUpdate[];
            if (!versionData) { toast.error('Invalid version data'); return; }
            const workbook = XLSX.utils.book_new();
            const sheetData: any[][] = [
              ['GST Update Sheet - Version ' + version.versionNumber],
              [`Saved: ${new Date(version.updatedAt).toLocaleString()}`, '', `By: ${version.updatedBy}`],
              [],
              ['Sr.', 'Client', 'Mistake Month', 'Update Effect Month', 'Return', 'Type', 'Instructions By', 'Matter Brief', 'Taxable', 'CGST', 'SGST', 'IGST', 'Interest', 'Remarks', '✓'],
            ];
            (versionData || []).forEach((r: any, idx: number) => {
              sheetData.push([idx+1, r.client_name||'', r.effect_month||'', r.update_effect_month||'', r.update_in_return||'', r.update_type||'', r.update_instructions_by||'', r.matter_brief||'', r.taxable_value||0, r.cgst||0, r.sgst||0, r.igst||0, r.interest||0, r.remarks||'', r.remarks_checked?'✓':'']);
            });
            const sheet = XLSX.utils.aoa_to_sheet(sheetData);
            XLSX.utils.book_append_sheet(workbook, sheet, 'GST Updates');
            XLSX.writeFile(workbook, `GST_Update_Version_${version.versionNumber}.xlsx`);
            toast.success(`Downloaded version ${version.versionNumber}`);
          } catch (error) { toast.error('Failed to download version'); }
        }}
        onView={(version) => {
          try {
            const versionData = version.versionData as GSTUpdate[];
            if (!versionData) { toast.error('Invalid version data'); return; }
            const workbook = XLSX.utils.book_new();
            const sheetData: any[][] = [
              ['GST Update Sheet - Version ' + version.versionNumber],
              [`Saved: ${new Date(version.updatedAt).toLocaleString()}`, '', `By: ${version.updatedBy}`],
              [],
              ['Sr.', 'Client', 'Mistake Month', 'Update Effect Month', 'Return', 'Type', 'Instructions By', 'Matter Brief', 'Taxable', 'CGST', 'SGST', 'IGST', 'Interest', 'Remarks', '✓'],
            ];
            (versionData || []).forEach((r: any, idx: number) => {
              sheetData.push([idx+1, r.client_name||'', r.effect_month||'', r.update_effect_month||'', r.update_in_return||'', r.update_type||'', r.update_instructions_by||'', r.matter_brief||'', r.taxable_value||0, r.cgst||0, r.sgst||0, r.igst||0, r.interest||0, r.remarks||'', r.remarks_checked?'✓':'']);
            });
            const sheet = XLSX.utils.aoa_to_sheet(sheetData);
            XLSX.utils.book_append_sheet(workbook, sheet, 'GST Updates');
            XLSX.writeFile(workbook, `GST_Update_View_Version_${version.versionNumber}.xlsx`);
            toast.success(`Viewing version ${version.versionNumber} - downloaded as Excel`);
          } catch (error) { toast.error('Failed to view version'); }
        }}
        onVersionDeleted={fetchVersions}
        title="GST Update Sheet Version History"
        subtitle="All versions"
        tableName="gst_update_versions"
      />

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
                <Table className="table-fixed">
                  <colgroup>
                    <col style={{ width: columnWidths['sr'] || 48 }} />
                    <col style={{ width: columnWidths['client'] || 160 }} />
                    <col style={{ width: columnWidths['mistake'] || 96 }} />
                    <col style={{ width: columnWidths['effect'] || 112 }} />
                    <col style={{ width: columnWidths['return'] || 112 }} />
                    <col style={{ width: columnWidths['type'] || 144 }} />
                    <col style={{ width: columnWidths['instructions'] || 128 }} />
                    <col style={{ width: columnWidths['brief'] || 250 }} />
                    <col style={{ width: columnWidths['taxable'] || 96 }} />
                    <col style={{ width: columnWidths['cgst'] || 100 }} />
                    <col style={{ width: columnWidths['sgst'] || 100 }} />
                    <col style={{ width: columnWidths['igst'] || 100 }} />
                    <col style={{ width: columnWidths['interest'] || 80 }} />
                    <col style={{ width: columnWidths['remarks'] || 200 }} />
                    <col style={{ width: columnWidths['check'] || 40 }} />
                    {canDeleteGSTRows && <col style={{ width: columnWidths['delete'] || 48 }} />}
                    <col style={{ width: 40 }} />
                  </colgroup>
                  <TableHeader>
                    <TableRow className="bg-[#4A90A4] hover:bg-[#4A90A4]">
                      <TableHead className="font-bold text-white border border-[#2E5A6B] relative">Sr.No.<ResizeHandle colKey="sr" /></TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] relative">CLIENT<ResizeHandle colKey="client" /></TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] relative">Mistake Month<ResizeHandle colKey="mistake" /></TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] relative">Update Effect Month<ResizeHandle colKey="effect" /></TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] relative">Update in GSTR<ResizeHandle colKey="return" /></TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] relative">Correction Type<ResizeHandle colKey="type" /></TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] relative">Instructions By<ResizeHandle colKey="instructions" /></TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] relative">Matter Brief<ResizeHandle colKey="brief" /></TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] text-right relative">Taxable Value<ResizeHandle colKey="taxable" /></TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] text-right relative">CGST<ResizeHandle colKey="cgst" /></TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] text-right relative">SGST<ResizeHandle colKey="sgst" /></TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] text-right relative">IGST<ResizeHandle colKey="igst" /></TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] text-right relative">Interest<ResizeHandle colKey="interest" /></TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] relative">Remarks<ResizeHandle colKey="remarks" /></TableHead>
                      <TableHead className="font-bold text-white border border-[#2E5A6B] text-center relative">✓<ResizeHandle colKey="check" /></TableHead>
                      {canDeleteGSTRows && <TableHead className="font-bold text-white border border-[#2E5A6B]"></TableHead>}
                      <TableHead className="font-bold text-white border border-[#2E5A6B] text-center">
                        <Clock className="h-3.5 w-3.5 mx-auto" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUpdates.map((update, index) => {
                      const originalIndex = updates.indexOf(update);
                      return (
                        <TableRow key={update.id || `new-${index}`}>
                          <TableCell className="border border-border text-center">{index + 1}</TableCell>
                          <TableCell className="p-0 border border-border">
                            {canEdit ? (
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
                            {canEdit ? (
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
                            {canEdit ? (
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
                            {canEdit ? (
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
                            {canEdit ? (
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
                            {canEdit ? (
                              <SearchableSelect
                                options={staffUsers.map(u => ({ value: u.id, label: u.name, sublabel: u.role }))}
                                value={update.instructions_by_employee_id}
                                onValueChange={(val) => {
                                  const staffUser = staffUsers.find(u => u.id === val);
                                  handleFieldChange(originalIndex, 'instructions_by_employee_id', val);
                                  handleFieldChange(originalIndex, 'update_instructions_by', staffUser?.name || '');
                                }}
                                placeholder="Select..."
                              />
                            ) : (
                              <span className="px-2">{update.update_instructions_by}</span>
                            )}
                          </TableCell>
                          <TableCell className="p-0 border border-border">
                            <Input
                              value={update.matter_brief}
                              onChange={(e) => handleFieldChange(originalIndex, 'matter_brief', e.target.value)}
                              className="h-8 border-0 shadow-none"
                              disabled={!canEdit}
                            />
                          </TableCell>
                          <TableCell className="p-0 border border-border">
                            <Input
                              type="number"
                              value={update.taxable_value || ''}
                              onChange={(e) => handleFieldChange(originalIndex, 'taxable_value', parseFloat(e.target.value) || 0)}
                              className="h-8 text-right border-0 shadow-none"
                              disabled={!canEdit}
                            />
                          </TableCell>
                          <TableCell className="p-0 border border-border">
                            <Input
                              type="number"
                              value={update.cgst || ''}
                              onChange={(e) => handleFieldChange(originalIndex, 'cgst', parseFloat(e.target.value) || 0)}
                              className="h-8 text-right border-0 shadow-none"
                              disabled={!canEdit}
                            />
                          </TableCell>
                          <TableCell className="p-0 border border-border">
                            <Input
                              type="number"
                              value={update.sgst || ''}
                              onChange={(e) => handleFieldChange(originalIndex, 'sgst', parseFloat(e.target.value) || 0)}
                              className="h-8 text-right border-0 shadow-none"
                              disabled={!canEdit}
                            />
                          </TableCell>
                          <TableCell className="p-0 border border-border">
                            <Input
                              type="number"
                              value={update.igst || ''}
                              onChange={(e) => handleFieldChange(originalIndex, 'igst', parseFloat(e.target.value) || 0)}
                              className="h-8 text-right border-0 shadow-none"
                              disabled={!canEdit}
                            />
                          </TableCell>
                          <TableCell className="p-0 border border-border">
                            <Input
                              type="number"
                              value={update.interest || ''}
                              onChange={(e) => handleFieldChange(originalIndex, 'interest', parseFloat(e.target.value) || 0)}
                              className="h-8 text-right border-0 shadow-none"
                              disabled={!canEdit}
                            />
                          </TableCell>
                          <TableCell className="p-0 border border-border min-w-[150px]">
                            <textarea
                              value={update.remarks}
                              onChange={(e) => handleFieldChange(originalIndex, 'remarks', e.target.value)}
                              className="w-full min-h-[32px] max-h-[80px] text-xs px-2 py-1 border-0 shadow-none bg-transparent resize-y"
                              disabled={!canEdit}
                            />
                          </TableCell>
                          <TableCell className="border border-border text-center">
                            <Checkbox
                              checked={update.remarks_checked}
                              onCheckedChange={(checked) => handleFieldChange(originalIndex, 'remarks_checked', !!checked)}
                              disabled={!canEdit}
                            />
                          </TableCell>
                          {canDeleteGSTRows && (
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
                          <TableCell className="border border-border text-center">
                            {update.id && !update.isNew && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setRowHistoryId(update.id!);
                                  setRowHistoryLabel(update.client_name || '');
                                }}
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                                title="View row change history"
                              >
                                <Clock className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {filteredUpdates.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={canDeleteGSTRows ? 17 : 16} className="text-center py-8 text-muted-foreground">
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

      {/* Row Version History Dialog */}
      <RowVersionHistoryDialog
        open={!!rowHistoryId}
        onOpenChange={(open) => { if (!open) setRowHistoryId(null); }}
        rowId={rowHistoryId || ''}
        rowLabel={rowHistoryLabel}
      />
    </div>
  );
};

export default GSTRunningUpdatePage;
