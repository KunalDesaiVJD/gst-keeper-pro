import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertCircle, Check, CheckCircle2, CircleDot, ClipboardList, Plus, Save, Loader2, Trash2, FileText, History, Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile, Money, Note } from '@/components/gstr9/ui';
import { fmtMoney } from '@/components/gstr9/grid/money';
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
  itc_section: string;
  itc_sr_no: string;
  isNew?: boolean;
}

const RETURN_OPTIONS = ['GSTR-1', 'GSTR-3B', 'GSTR-7', 'GSTR-1 & 3B'];
const UPDATE_TYPE_OPTIONS = ['Claim ITC', 'Reversal ITC', 'Liability', 'RCM Liability', 'Reclaim', 'Reclaim (Expense out)'];

// Cascading "ITC Sr No." dropdown: pick the ITC Summary section, then its row.
// Mirrors the ITC Summary structure so the effect can be traced to the exact line.
const ITC_SECTIONS = ['4A', '4B', '4D'];
const ITC_SR_NO_BY_SECTION: Record<string, { value: string; label: string }[]> = {
  '4A': [
    { value: '(1)', label: '(1) Import of Goods' },
    { value: '(2)', label: '(2) Import of Services' },
    { value: '(3)', label: '(3) RCM ITC' },
    { value: '(4)', label: '(4) Inward Supplies from ISD' },
    { value: '(5)', label: '(5) All other ITC' },
    { value: '5.1', label: '5.1 ITC for the Month' },
    { value: '5.2', label: '5.2 ITC for Previous Month' },
    { value: '5.3', label: '5.3 Debit Note' },
    { value: '5.4', label: '5.4 Reclaim of ITC Reversed (prev months)' },
    { value: '5.5', label: '5.5 Reclaim due to 180 days / Others' },
  ],
  '4B': [
    { value: '(1)', label: '(1) Reversal Rule 38, 42, 43 & 17(5)' },
    { value: '(2)', label: '(2) Others' },
    { value: '(i)', label: '(i) Reversal current month (2B Reco)' },
    { value: '(ii)', label: '(ii) Reversal previous months' },
    { value: '(iii)', label: '(iii) Reversal due to 180 days' },
  ],
  '4D': [
    { value: '(1)', label: '(1) ITC reclaimed reversed under 4(B)(2)' },
    { value: '1.1', label: '1.1 Reclaim of ITC Reversed (prev months)' },
    { value: '1.2', label: '1.2 Reclaim due to 180 days / Others' },
    { value: '(2)', label: '(2) Ineligible ITC u/s 16(4) & PoS' },
  ],
};
// ITC Sr No is mandatory (once remarks are written) for these correction types.
const ITC_SR_NO_REQUIRED_TYPES = ['Reversal ITC', 'Claim ITC', 'Reclaim', 'Reclaim (Expense out)'];
const needsItcSrNo = (u: { update_type: string; remarks: string; itc_section: string; itc_sr_no: string }) =>
  ITC_SR_NO_REQUIRED_TYPES.includes(u.update_type) && !!u.remarks?.trim() && (!u.itc_section || !u.itc_sr_no);

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
        itc_section: (d as any).itc_section || '',
        itc_sr_no: (d as any).itc_sr_no || '',
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
    // Prepend so the new row appears at the top of the table, matching how
    // most data-entry users expect "Add Row" to behave.
    setUpdates([
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
        itc_section: '',
        itc_sr_no: '',
        isNew: true,
      },
      ...updates,
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

  // Section change resets the sub-head in the same update (handleFieldChange
  // reads state non-functionally, so two calls would clobber each other).
  const handleItcSectionChange = (index: number, section: string) => {
    const newUpdates = [...updates];
    newUpdates[index] = { ...newUpdates[index], itc_section: section, itc_sr_no: '' };
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

    // ITC Sr No is mandatory for Reversal/Claim/Reclaim rows once remarks are
    // written — but only for NEW or EDITED rows ("from now"), so the existing
    // backlog isn't blocked.
    const origById = new Map(originalUpdates.filter(u => u.id).map(u => [u.id, u] as const));
    const isChanged = (u: GSTUpdate) => {
      if (!u.id || u.isNew) return true;
      const o = origById.get(u.id);
      if (!o) return true;
      const keys: (keyof GSTUpdate)[] = ['update_type', 'remarks', 'itc_section', 'itc_sr_no', 'cgst', 'sgst', 'igst', 'taxable_value', 'interest', 'matter_brief', 'update_effect_month', 'update_in_return', 'effect_month', 'update_instructions_by'];
      return keys.some(k => (u[k] ?? '') !== (o[k] ?? ''));
    };
    const missingItcSrNo = updates.filter(u =>
      isChanged(u) &&
      ITC_SR_NO_REQUIRED_TYPES.includes(u.update_type) &&
      !!(u.remarks && u.remarks.trim().length > 0) &&
      (!u.itc_section || !u.itc_sr_no),
    );
    if (missingItcSrNo.length > 0) {
      toast.error(`Select the ITC Sr No (section + row) on ${missingItcSrNo.length} row(s): it's required for Reversal/Claim/Reclaim corrections once remarks are written.`);
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
          itc_section: update.itc_section || null,
          itc_sr_no: update.itc_sr_no || null,
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
        const fieldsToTrack = ['client_id', 'update_effect_month', 'update_in_return', 'update_type', 'update_instructions_by', 'instructions_by_employee_id', 'matter_brief', 'taxable_value', 'cgst', 'sgst', 'igst', 'interest', 'effect_month', 'remarks', 'itc_section', 'itc_sr_no'];
        
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
      className="absolute right-0 top-0 bottom-0 z-20 w-1.5 cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
      onMouseDown={(e) => {
        e.preventDefault();
        handleResizeStart(colKey, e.clientX);
      }}
    />
  );

  const activeFilterCount = [filterClient, filterUpdateEffectMonth, filterEffectMonth, filterReturn, filterUpdateType, filterInstructionsBy, filterStatus].filter(Boolean).length;
  const clearFilters = () => {
    setFilterClient('');
    setFilterUpdateEffectMonth('');
    setFilterEffectMonth('');
    setFilterReturn('');
    setFilterUpdateType('');
    setFilterInstructionsBy('');
    setFilterStatus('');
  };

  // Headline figures for the rows in view (after filters).
  const stats = useMemo(() => {
    const sum = (k: 'taxable_value' | 'cgst' | 'sgst' | 'igst' | 'interest') => filteredUpdates.reduce((s, u) => s + (Number(u[k]) || 0), 0);
    const pending = filteredUpdates.filter(u => !u.remarks_checked).length;
    return {
      total: filteredUpdates.length,
      pending,
      given: filteredUpdates.length - pending,
      missingSrNo: filteredUpdates.filter(needsItcSrNo).length,
      taxable: sum('taxable_value'),
      cgst: sum('cgst'),
      sgst: sum('sgst'),
      igst: sum('igst'),
      interest: sum('interest'),
    };
  }, [filteredUpdates]);

  const colSpan = 17 + (canDeleteGSTRows ? 1 : 0);
  const TH = 'sticky top-0 z-10 border-b border-r bg-muted px-2 py-1.5 text-left text-[13px] font-semibold text-muted-foreground whitespace-nowrap';
  const CELL_INPUT = 'h-9 rounded-none border-0 bg-transparent px-2 text-sm md:text-sm shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary focus-visible:ring-offset-0';
  const CELL_SELECT = 'h-9 rounded-none border-0 bg-transparent px-2 text-sm shadow-none';
  const FILTER_LABEL = 'text-[11px] font-medium text-muted-foreground';

  return (
    <div className="space-y-3 animate-fade-in">
      {/* One compact row: what this is, save state, and the sheet's actions (the bell is fixed top-right). */}
      <div className="flex flex-wrap items-center gap-2 md:pr-12">
        <div className="mr-auto flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><ClipboardList className="h-4 w-4" /></div>
          <h1 className="truncate font-heading text-lg font-bold leading-tight">
            GST Update Sheet <span className="font-semibold text-muted-foreground">· corrections to carry into returns</span>
          </h1>
        </div>
        <SaveState isSaving={isSaving} hasChanges={hasChanges} lastSavedBy={lastSavedBy} />
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {canViewVersions && (
              <Button variant="outline" size="sm" className="h-8 gap-1 px-2.5 text-xs" onClick={() => setShowVersionHistory(true)} aria-label="Version history">
                <History className="h-3.5 w-3.5" /> <span className="hidden sm:inline">History</span>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 px-2.5 text-xs"
              onClick={() => {
                exportGSTUpdateToPDF(filteredUpdates, {
                  client: filterClient ? clients.find(c => c.id === filterClient)?.name : undefined,
                  updateEffectMonth: filterUpdateEffectMonth || undefined,
                  effectMonth: filterEffectMonth || undefined,
                });
                toast.success('PDF exported successfully');
              }}
            >
              <FileText className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Export PDF</span>
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1 px-2.5 text-xs" onClick={handleAddRow}>
              <Plus className="h-3.5 w-3.5" /> Add row
            </Button>
            <Button size="sm" className="h-8 gap-1 px-3 text-xs" onClick={handleSave} disabled={isSaving || !hasChanges}>
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save changes
            </Button>
          </div>
        )}
      </div>

      {/* Headline tiles for the rows in view; the status tiles double as the status filter. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <TileButton active={!filterStatus} onClick={() => setFilterStatus('')} title="Show all rows">
          <KpiTile label="Rows in view" value={stats.total} hint={activeFilterCount ? `${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} on` : 'No filters'} />
        </TileButton>
        <TileButton active={filterStatus === 'pending'} onClick={() => setFilterStatus(filterStatus === 'pending' ? '' : 'pending')} title="Show pending rows only">
          <KpiTile label="Pending" value={stats.pending} hint="Effect not yet given" tone={stats.pending ? 'warn' : 'ok'} />
        </TileButton>
        <TileButton active={filterStatus === 'given'} onClick={() => setFilterStatus(filterStatus === 'given' ? '' : 'given')} title="Show given rows only">
          <KpiTile label="Effect given" value={stats.given} hint="Remarks written and ticked" tone={stats.given ? 'ok' : 'neutral'} />
        </TileButton>
        <KpiTile label="ITC Sr No. not picked" value={stats.missingSrNo} hint="Claim / reversal / reclaim rows with remarks — required when such a row is edited" tone={stats.missingSrNo ? 'warn' : 'ok'} />
        <KpiTile
          label="Tax effect · CGST + SGST + IGST"
          value={<Money value={stats.cgst + stats.sgst + stats.igst} />}
          hint={`Taxable ${fmtMoney(stats.taxable)} · Interest ${fmtMoney(stats.interest)}`}
        />
      </div>

      {/* Filters: one labelled toolbar. */}
      <Card>
        <CardContent className="px-3 py-2">
          <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-[repeat(7,minmax(0,1fr))_auto]">
            <label className="min-w-0 space-y-0.5">
              <span className={FILTER_LABEL}>Client</span>
              <SearchableSelect
                options={[{ value: '', label: 'All clients' }, ...clients.map(c => ({ value: c.id, label: c.name, sublabel: c.gstin }))]}
                value={filterClient}
                onValueChange={setFilterClient}
                placeholder="All clients"
                searchPlaceholder="Search client or GSTIN…"
                className="h-8 text-xs"
              />
            </label>
            <label className="min-w-0 space-y-0.5">
              <span className={FILTER_LABEL}>Update effect month</span>
              <SearchableMonthSelect options={monthOptions} value={filterUpdateEffectMonth} onValueChange={setFilterUpdateEffectMonth} placeholder="All" className="h-8 text-xs" />
            </label>
            <label className="min-w-0 space-y-0.5">
              <span className={FILTER_LABEL}>Mistake month</span>
              <SearchableMonthSelect options={monthOptions} value={filterEffectMonth} onValueChange={setFilterEffectMonth} placeholder="All" className="h-8 text-xs" />
            </label>
            <label className="min-w-0 space-y-0.5">
              <span className={FILTER_LABEL}>Return</span>
              <Select value={filterReturn || '__all__'} onValueChange={(val) => setFilterReturn(val === '__all__' ? '' : val)}>
                <SelectTrigger className="h-8 text-xs" aria-label="Return"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All</SelectItem>
                  {RETURN_OPTIONS.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="min-w-0 space-y-0.5">
              <span className={FILTER_LABEL}>Correction type</span>
              <Select value={filterUpdateType || '__all__'} onValueChange={(val) => setFilterUpdateType(val === '__all__' ? '' : val)}>
                <SelectTrigger className="h-8 text-xs" aria-label="Correction type"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All</SelectItem>
                  {UPDATE_TYPE_OPTIONS.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="min-w-0 space-y-0.5">
              <span className={FILTER_LABEL}>Instructions by</span>
              <SearchableSelect
                options={[{ value: '', label: 'All' }, ...staffUsers.map(u => ({ value: u.id, label: u.name, sublabel: u.role }))]}
                value={filterInstructionsBy}
                onValueChange={setFilterInstructionsBy}
                placeholder="All"
                className="h-8 text-xs"
              />
            </label>
            <label className="min-w-0 space-y-0.5">
              <span className={FILTER_LABEL}>Status</span>
              <Select value={filterStatus || '__all__'} onValueChange={(val) => setFilterStatus(val === '__all__' ? '' : (val as 'pending' | 'given'))}>
                <SelectTrigger className="h-8 text-xs" aria-label="Status"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="given">Given</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={clearFilters} disabled={!activeFilterCount}>
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      <Note>
        Pending rows float to the top. Tick <span className="font-medium">Given</span> once the remarks say how the effect was carried into the return. Claim, reversal and reclaim rows also need the ITC Summary section and row (ITC Sr No.) once remarks are written — that cell is tinted red until it is picked, and a new or edited row can't be saved without it.
      </Note>

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
              ['Sr.', 'Client', 'Mistake Month', 'Update Effect Month', 'Return', 'Type', 'Instructions By', 'Matter Brief', 'Taxable', 'CGST', 'SGST', 'IGST', 'Interest', 'Remarks', 'ITC Sr No', '✓'],
            ];
            (versionData || []).forEach((r: any, idx: number) => {
              sheetData.push([idx+1, r.client_name||'', r.effect_month||'', r.update_effect_month||'', r.update_in_return||'', r.update_type||'', r.update_instructions_by||'', r.matter_brief||'', r.taxable_value||0, r.cgst||0, r.sgst||0, r.igst||0, r.interest||0, r.remarks||'', (r.itc_section && r.itc_sr_no ? `${r.itc_section} ${r.itc_sr_no}` : ''), r.remarks_checked?'✓':'']);
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
              ['Sr.', 'Client', 'Mistake Month', 'Update Effect Month', 'Return', 'Type', 'Instructions By', 'Matter Brief', 'Taxable', 'CGST', 'SGST', 'IGST', 'Interest', 'Remarks', 'ITC Sr No', '✓'],
            ];
            (versionData || []).forEach((r: any, idx: number) => {
              sheetData.push([idx+1, r.client_name||'', r.effect_month||'', r.update_effect_month||'', r.update_in_return||'', r.update_type||'', r.update_instructions_by||'', r.matter_brief||'', r.taxable_value||0, r.cgst||0, r.sgst||0, r.igst||0, r.interest||0, r.remarks||'', (r.itc_section && r.itc_sr_no ? `${r.itc_section} ${r.itc_sr_no}` : ''), r.remarks_checked?'✓':'']);
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

      {/* Data table */}
      {isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading updates…
          </CardContent>
        </Card>
      ) : (
        <div className="relative max-h-[70vh] overflow-auto rounded-md border bg-card">
          <table className="w-full min-w-[1650px] table-fixed border-separate border-spacing-0 text-sm" aria-label="GST update sheet">
            <colgroup>
              <col style={{ width: columnWidths['sr'] || 48 }} />
              <col style={{ width: columnWidths['client'] || 180 }} />
              <col style={{ width: columnWidths['mistake'] || 104 }} />
              <col style={{ width: columnWidths['effect'] || 136 }} />
              <col style={{ width: columnWidths['return'] || 112 }} />
              <col style={{ width: columnWidths['type'] || 150 }} />
              <col style={{ width: columnWidths['instructions'] || 128 }} />
              <col style={{ width: columnWidths['brief'] || 250 }} />
              <col style={{ width: columnWidths['taxable'] || 110 }} />
              <col style={{ width: columnWidths['cgst'] || 100 }} />
              <col style={{ width: columnWidths['sgst'] || 100 }} />
              <col style={{ width: columnWidths['igst'] || 100 }} />
              <col style={{ width: columnWidths['interest'] || 90 }} />
              <col style={{ width: columnWidths['remarks'] || 220 }} />
              <col style={{ width: columnWidths['itcsr'] || 180 }} />
              <col style={{ width: columnWidths['check'] || 104 }} />
              {canDeleteGSTRows && <col style={{ width: 36 }} />}
              <col style={{ width: 36 }} />
            </colgroup>
            <thead>
              <tr>
                <th className={cn(TH, 'text-center')}>No.<ResizeHandle colKey="sr" /></th>
                <th className={TH}>Client<ResizeHandle colKey="client" /></th>
                <th className={TH}>Mistake month<ResizeHandle colKey="mistake" /></th>
                <th className={TH}>Update effect month<ResizeHandle colKey="effect" /></th>
                <th className={TH}>Update in GSTR<ResizeHandle colKey="return" /></th>
                <th className={TH}>Correction type<ResizeHandle colKey="type" /></th>
                <th className={TH}>Instructions by<ResizeHandle colKey="instructions" /></th>
                <th className={TH}>Matter brief<ResizeHandle colKey="brief" /></th>
                <th className={cn(TH, 'text-right')}>Taxable value<ResizeHandle colKey="taxable" /></th>
                <th className={cn(TH, 'text-right')}>CGST<ResizeHandle colKey="cgst" /></th>
                <th className={cn(TH, 'text-right')}>SGST<ResizeHandle colKey="sgst" /></th>
                <th className={cn(TH, 'text-right')}>IGST<ResizeHandle colKey="igst" /></th>
                <th className={cn(TH, 'text-right')}>Interest<ResizeHandle colKey="interest" /></th>
                <th className={TH}>Remarks<ResizeHandle colKey="remarks" /></th>
                <th className={TH}>ITC Sr No.<ResizeHandle colKey="itcsr" /></th>
                <th className={cn(TH, 'text-center')}>Status<ResizeHandle colKey="check" /></th>
                {canDeleteGSTRows && <th className={TH} aria-label="Delete row" />}
                <th className={cn(TH, 'border-r-0 text-center')} aria-label="Row history"><Clock className="mx-auto h-3.5 w-3.5" /></th>
              </tr>
            </thead>
            <tbody>
              {filteredUpdates.map((update, index) => {
                const originalIndex = updates.indexOf(update);
                const missingSr = needsItcSrNo(update);
                return (
                  <tr
                    key={update.id || `new-${index}`}
                    className={cn(
                      'group transition-colors hover:bg-muted/30',
                      update.isNew && 'bg-info/5',
                    )}
                  >
                    <td className="border-b border-r px-2 text-center tabular-nums text-muted-foreground">{index + 1}</td>
                    <td className="border-b border-r p-0">
                      {canEdit ? (
                        <SearchableSelect
                          options={clients.map(c => ({ value: c.id, label: c.name, sublabel: c.gstin }))}
                          value={update.client_id}
                          onValueChange={(val) => handleFieldChange(originalIndex, 'client_id', val)}
                          placeholder="Select…"
                          searchPlaceholder="Search client or GSTIN…"
                          className={CELL_SELECT}
                        />
                      ) : (
                        <span className="block truncate px-2">{update.client_name}</span>
                      )}
                    </td>
                    <td className="border-b border-r p-0">
                      {canEdit ? (
                        <SearchableMonthSelect
                          options={effectMonthOptions}
                          value={update.effect_month === '' ? '__blank__' : update.effect_month}
                          onValueChange={(val) => handleFieldChange(originalIndex, 'effect_month', val === '__blank__' ? '' : val)}
                          placeholder="Select…"
                          className={CELL_SELECT}
                        />
                      ) : (
                        <span className="px-2">{update.effect_month || <span className="text-muted-foreground">—</span>}</span>
                      )}
                    </td>
                    <td className="border-b border-r p-0">
                      {canEdit ? (
                        <SearchableMonthSelect
                          options={monthOptions}
                          value={update.update_effect_month}
                          onValueChange={(val) => handleFieldChange(originalIndex, 'update_effect_month', val)}
                          placeholder="Select…"
                          className={cn(CELL_SELECT, !update.update_effect_month && 'text-destructive-strong')}
                        />
                      ) : (
                        <span className="px-2">{update.update_effect_month}</span>
                      )}
                    </td>
                    <td className="border-b border-r p-0">
                      {canEdit ? (
                        <Select value={update.update_in_return} onValueChange={(val) => handleFieldChange(originalIndex, 'update_in_return', val)}>
                          <SelectTrigger className={CELL_SELECT}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {RETURN_OPTIONS.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="px-2">{update.update_in_return}</span>
                      )}
                    </td>
                    <td className="border-b border-r p-0">
                      {canEdit ? (
                        <Select value={update.update_type} onValueChange={(val) => handleFieldChange(originalIndex, 'update_type', val)}>
                          <SelectTrigger className={cn(CELL_SELECT, 'w-full')}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {UPDATE_TYPE_OPTIONS.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="px-2">{update.update_type}</span>
                      )}
                    </td>
                    <td className="border-b border-r p-0">
                      {canEdit ? (
                        <SearchableSelect
                          options={staffUsers.map(u => ({ value: u.id, label: u.name, sublabel: u.role }))}
                          value={update.instructions_by_employee_id}
                          onValueChange={(val) => {
                            const staffUser = staffUsers.find(u => u.id === val);
                            handleFieldChange(originalIndex, 'instructions_by_employee_id', val);
                            handleFieldChange(originalIndex, 'update_instructions_by', staffUser?.name || '');
                          }}
                          placeholder="Select…"
                          className={CELL_SELECT}
                        />
                      ) : (
                        <span className="px-2">{update.update_instructions_by}</span>
                      )}
                    </td>
                    <td className="border-b border-r p-0">
                      <Input
                        value={update.matter_brief}
                        onChange={(e) => handleFieldChange(originalIndex, 'matter_brief', e.target.value)}
                        className={CELL_INPUT}
                        disabled={!canEdit}
                        aria-label="Matter brief"
                      />
                    </td>
                    {(['taxable_value', 'cgst', 'sgst', 'igst', 'interest'] as const).map((k) => (
                      <td key={k} className="border-b border-r p-0">
                        <Input
                          type="number"
                          value={update[k] || ''}
                          onChange={(e) => handleFieldChange(originalIndex, k, parseFloat(e.target.value) || 0)}
                          className={cn(CELL_INPUT, 'text-right tabular-nums', update[k] < 0 && 'text-destructive-strong')}
                          disabled={!canEdit}
                          aria-label={k === 'taxable_value' ? 'Taxable value' : k.toUpperCase()}
                        />
                      </td>
                    ))}
                    <td className="border-b border-r p-0">
                      <textarea
                        value={update.remarks}
                        onChange={(e) => handleFieldChange(originalIndex, 'remarks', e.target.value)}
                        className="block min-h-[36px] max-h-[96px] w-full resize-y [field-sizing:content] border-0 bg-transparent px-2 py-1.5 text-sm leading-snug shadow-none outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!canEdit}
                        placeholder={canEdit ? 'How the effect was given…' : undefined}
                        rows={1}
                        aria-label="Remarks"
                      />
                    </td>
                    <td className={cn('border-b border-r p-0', missingSr && 'bg-destructive/5')}>
                      {!canEdit ? (
                        <span className="px-2">{update.itc_section && update.itc_sr_no ? `${update.itc_section} ${update.itc_sr_no}` : ''}</span>
                      ) : (
                        <div className="flex gap-1 p-1">
                          <Select value={update.itc_section} onValueChange={(val) => handleItcSectionChange(originalIndex, val)}>
                            <SelectTrigger className={cn('h-7 w-16 shrink-0 px-2 text-xs', missingSr && !update.itc_section && 'border-destructive')} aria-label="ITC section">
                              <SelectValue placeholder="Sec." />
                            </SelectTrigger>
                            <SelectContent>
                              {ITC_SECTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Select value={update.itc_sr_no} onValueChange={(val) => handleFieldChange(originalIndex, 'itc_sr_no', val)} disabled={!update.itc_section}>
                            <SelectTrigger className={cn('h-7 min-w-0 flex-1 px-2 text-xs', missingSr && update.itc_section && 'border-destructive')} aria-label="ITC Sr No">
                              <SelectValue placeholder="Sr No" />
                            </SelectTrigger>
                            <SelectContent>
                              {(ITC_SR_NO_BY_SECTION[update.itc_section] || []).map(o => (
                                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </td>
                    <td className="border-b border-r px-2">
                      <label className="flex items-center justify-center gap-1.5">
                        <Checkbox
                          checked={update.remarks_checked}
                          onCheckedChange={(checked) => handleFieldChange(originalIndex, 'remarks_checked', !!checked)}
                          disabled={!canEdit}
                          aria-label="Effect given"
                        />
                        <Badge variant={update.remarks_checked ? 'success' : 'warning'} className="gap-1 whitespace-nowrap px-1.5 text-[10px] font-medium">
                          {update.remarks_checked ? <CheckCircle2 className="h-3 w-3" /> : <CircleDot className="h-3 w-3" />}
                          {update.remarks_checked ? 'Given' : 'Pending'}
                        </Badge>
                      </label>
                    </td>
                    {canDeleteGSTRows && (
                      <td className="border-b border-r px-1 text-center">
                        <button
                          type="button"
                          onClick={() => handleDeleteRow(originalIndex)}
                          aria-label="Delete row"
                          title="Delete row"
                          className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive-strong focus:opacity-100 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                    <td className="border-b px-1 text-center">
                      {update.id && !update.isNew && (
                        <button
                          type="button"
                          onClick={() => {
                            setRowHistoryId(update.id!);
                            setRowHistoryLabel(update.client_name || '');
                          }}
                          aria-label="View row change history"
                          title="View row change history"
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <Clock className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredUpdates.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="px-3 py-10 text-center text-muted-foreground">
                    <ClipboardList className="mx-auto mb-1.5 h-5 w-5" />
                    <div className="font-medium text-foreground">No records found</div>
                    {activeFilterCount ? 'No row matches the filters.' : canEdit ? 'Click “Add row” to create a new entry.' : null}
                  </td>
                </tr>
              )}
            </tbody>
            {filteredUpdates.length > 0 && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className="bg-muted font-semibold">
                  <td colSpan={8} className="h-8 border-t border-r px-2">Total · {stats.total} row{stats.total === 1 ? '' : 's'} in view</td>
                  {([stats.taxable, stats.cgst, stats.sgst, stats.igst, stats.interest]).map((v, i) => (
                    <td key={i} className="h-8 border-t border-r px-2 text-right whitespace-nowrap"><Money value={v} signed /></td>
                  ))}
                  <td colSpan={colSpan - 13} className="h-8 border-t" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

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

/** A KPI tile that also acts as a filter toggle. */
const TileButton: React.FC<{ active: boolean; onClick: () => void; title: string; children: React.ReactNode }> = ({ active, onClick, title, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-pressed={active}
    className={cn(
      'rounded-lg text-left transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>div]:h-full',
      active && 'ring-2 ring-primary/60',
    )}
  >
    {children}
  </button>
);

/** Save state, in the Annual Return workspace's words: unsaved edits outrank the last save. */
const SaveState: React.FC<{
  isSaving: boolean;
  hasChanges: boolean;
  lastSavedBy: { name: string; role: string; time: string; version: number } | null;
}> = ({ isSaving, hasChanges, lastSavedBy }) => {
  if (isSaving) return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</span>;
  if (hasChanges) return <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-xs font-medium text-foreground"><AlertCircle className="h-3.5 w-3.5 text-warning" /> Unsaved changes</span>;
  if (!lastSavedBy) return null;
  const at = new Date(lastSavedBy.time);
  const when = `${at.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} ${at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  const full = `Saved by ${lastSavedBy.name}${lastSavedBy.role ? ` (${lastSavedBy.role})` : ''} on ${when} · v${lastSavedBy.version}`;
  return (
    <span title={full} className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <Check className="h-3.5 w-3.5 shrink-0 text-success-strong" />
      <span className="truncate">Saved by <span className="font-medium text-foreground">{lastSavedBy.name}</span> · {when} · v{lastSavedBy.version}</span>
    </span>
  );
};

export default GSTRunningUpdatePage;
