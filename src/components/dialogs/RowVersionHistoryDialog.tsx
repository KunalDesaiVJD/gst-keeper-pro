import React, { useEffect, useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

interface RowVersion {
  id: string;
  row_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_by_employee_id: string | null;
  changed_at: string;
  group_version_id: string | null;
}

interface GroupedChange {
  groupId: string;
  changedAt: string;
  changedBy: string;
  changedByRole: string;
  changes: {
    fieldName: string;
    oldValue: string;
    newValue: string;
  }[];
}

// Map field names to user-friendly labels
const FIELD_LABELS: Record<string, string> = {
  client_id: 'Client',
  update_effect_month: 'Update Effect Month',
  update_in_return: 'Return',
  update_type: 'Correction Type',
  update_instructions_by: 'Instructions By',
  instructions_by_employee_id: 'Instructions By (Employee)',
  matter_brief: 'Matter Brief',
  taxable_value: 'Taxable Value',
  cgst: 'CGST',
  sgst: 'SGST',
  igst: 'IGST',
  interest: 'Interest',
  effect_month: 'Mistake Month',
  remarks: 'Remarks',
};

const formatValue = (val: string | null): string => {
  if (!val || val === 'null' || val === '""' || val === '') return '(empty)';
  // Remove JSON quotes
  try {
    const parsed = JSON.parse(val);
    if (parsed === null || parsed === '') return '(empty)';
    if (typeof parsed === 'number') {
      return parsed.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    }
    return String(parsed);
  } catch {
    return val;
  }
};

interface RowVersionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rowId: string;
  rowLabel?: string;
}

const RowVersionHistoryDialog: React.FC<RowVersionHistoryDialogProps> = ({
  open,
  onOpenChange,
  rowId,
  rowLabel,
}) => {
  const [loading, setLoading] = useState(false);
  const [versions, setVersions] = useState<RowVersion[]>([]);

  useEffect(() => {
    if (!open || !rowId) return;

    const fetchVersions = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('gst_update_row_versions')
          .select('*')
          .eq('row_id', rowId)
          .order('changed_at', { ascending: false });

        if (error) throw error;

        // Fetch user names for changed_by_employee_id
        const userIds = [...new Set((data || []).map(v => (v as any).changed_by_employee_id).filter(Boolean))];
        let userMap: Record<string, { name: string; role: string }> = {};
        if (userIds.length > 0) {
          const { data: profiles } = await supabase.from('profiles').select('user_id, first_name').in('user_id', userIds);
          const { data: roles } = await supabase.from('user_roles').select('user_id, role').in('user_id', userIds);
          (profiles || []).forEach(p => { userMap[p.user_id] = { name: p.first_name, role: '' }; });
          (roles || []).forEach(r => { if (userMap[r.user_id]) userMap[r.user_id].role = r.role; });
        }

        setVersions((data || []).map(v => ({
          ...v,
          _changedByName: userMap[(v as any).changed_by_employee_id]?.name || 'Unknown',
          _changedByRole: userMap[(v as any).changed_by_employee_id]?.role || '',
        })) as any);
      } catch (err) {
        console.error('Error fetching row versions:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchVersions();
  }, [open, rowId]);

  // Group by group_version_id
  const grouped = useMemo((): GroupedChange[] => {
    const groups = new Map<string, RowVersion[]>();
    versions.forEach(v => {
      const key = v.group_version_id || v.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(v);
    });

    return Array.from(groups.entries()).map(([groupId, changes]) => ({
      groupId,
      changedAt: changes[0].changed_at,
      changedBy: (changes[0] as any)._changedByName || 'Unknown',
      changedByRole: (changes[0] as any)._changedByRole || '',
      changes: changes.map(c => ({
        fieldName: FIELD_LABELS[c.field_name] || c.field_name,
        oldValue: formatValue(c.old_value),
        newValue: formatValue(c.new_value),
      })),
    }));
  }, [versions]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Row Change History {rowLabel && `— ${rowLabel}`}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : grouped.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No changes recorded for this row.</p>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 pr-4">
              {grouped.map((group) => (
                <div key={group.groupId} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-foreground">{group.changedBy}</span>
                      {group.changedByRole && (
                        <Badge variant="outline" className="text-xs">{group.changedByRole}</Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(group.changedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}{' '}
                      {new Date(group.changedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {group.changes.map((change, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-sm">
                        <span className="font-medium text-muted-foreground min-w-[140px] shrink-0">{change.fieldName}:</span>
                        <span className="text-destructive line-through">{change.oldValue}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-green-600 font-medium">{change.newValue}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default RowVersionHistoryDialog;
