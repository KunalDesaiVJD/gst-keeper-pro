import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SectionCard } from '@/components/gstr9/ui';
import { Badge } from '@/components/gstr9/badge';
import {
  WS_PAGE, WS_BTN, WS_TABLE_WRAP, WS_TABLE, WS_TH, WS_TD, WS_TD_NUM, WS_TR,
} from '@/components/workspace/theme';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/PageHeader';
import { TableEmptyState } from '@/components/ui/table-empty-state';
import { Settings, Plus, Pencil, Trash2, Loader2, ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

interface RCMMaster {
  id: string;
  expense_name: string;
  rate: string;
  supply_type: string;
  is_active: boolean;
  created_at: string;
}

/** Small red asterisk marking a required field. */
const RequiredMark: React.FC = () => (
  <span className="text-destructive" aria-hidden="true">
    {' '}
    *
  </span>
);

interface ManageMastersPageProps {
  /** Rendered inside another page (the Settings "Masters" tab): hides the back
   *  button and uses a smaller heading so there is no duplicate page title. */
  embedded?: boolean;
}

const ManageMastersPage: React.FC<ManageMastersPageProps> = ({ embedded = false }) => {
  const navigate = useNavigate();
  const { user, canManageRCMMasters } = useAuth();
  const [masters, setMasters] = useState<RCMMaster[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedMaster, setSelectedMaster] = useState<RCMMaster | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [expenseName, setExpenseName] = useState('');
  const [rate, setRate] = useState<string>('5%');
  const [supplyType, setSupplyType] = useState<string>('intrastate');
  const [showValidation, setShowValidation] = useState(false);

  // Check if user has permission
  const hasPermission = canManageRCMMasters();

  const expenseNameInvalid = showValidation && !expenseName.trim();

  const fetchMasters = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('rcm_masters')
        .select('*')
        .order('expense_name');

      if (error) throw error;
      setMasters(data || []);
    } catch (error: any) {
      toast.error('Failed to fetch masters: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMasters();
  }, [fetchMasters]);

  const resetForm = () => {
    setExpenseName('');
    setRate('5%');
    setSupplyType('intrastate');
    setSelectedMaster(null);
    setShowValidation(false);
  };

  const handleAdd = async () => {
    if (!expenseName.trim()) {
      setShowValidation(true);
      toast.error('Please enter expense name');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('rcm_masters').insert([
        {
          expense_name: expenseName.trim(),
          rate,
          supply_type: supplyType,
          is_active: true,
        },
      ]);

      if (error) throw error;

      toast.success('Master added successfully');
      setShowAddDialog(false);
      resetForm();
      fetchMasters();
    } catch (error: any) {
      toast.error('Failed to add master: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedMaster || !expenseName.trim()) {
      setShowValidation(true);
      toast.error('Please enter expense name');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('rcm_masters')
        .update({
          expense_name: expenseName.trim(),
          rate,
          supply_type: supplyType,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedMaster.id);

      if (error) throw error;

      toast.success('Master updated successfully');
      setShowEditDialog(false);
      resetForm();
      fetchMasters();
    } catch (error: any) {
      toast.error('Failed to update master: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedMaster) return;

    setIsSubmitting(true);
    try {
      // Soft delete by setting is_active to false
      const { error } = await supabase
        .from('rcm_masters')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', selectedMaster.id);

      if (error) throw error;

      toast.success('Master deleted successfully');
      setShowDeleteDialog(false);
      resetForm();
      fetchMasters();
    } catch (error: any) {
      toast.error('Failed to delete master: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditDialog = (master: RCMMaster) => {
    setSelectedMaster(master);
    setExpenseName(master.expense_name);
    setRate(master.rate);
    setSupplyType(master.supply_type);
    setShowValidation(false);
    setShowEditDialog(true);
  };

  const openDeleteDialog = (master: RCMMaster) => {
    setSelectedMaster(master);
    setShowDeleteDialog(true);
  };

  const activeMasters = masters.filter((m) => m.is_active);
  const inactiveMasters = masters.filter((m) => !m.is_active);

  return (
    <div className={embedded ? 'space-y-3' : WS_PAGE}>
      {/* Header */}
      <div className="flex items-center gap-1">
        {!embedded && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back to RCM Summary"
            onClick={() => navigate('/rcm-summary')}
            className="h-8 w-8 shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <PageHeader
          className="flex-1"
          compact
          embedded={embedded}
          title="Manage RCM Masters"
          subtitle="Add, edit, or delete expense masters"
          icon={<Settings />}
          actions={
            hasPermission ? (
              <Button
                size="sm"
                className={WS_BTN}
                onClick={() => {
                  resetForm();
                  setShowAddDialog(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Master
              </Button>
            ) : undefined
          }
        />
      </div>

      {/* Active Masters */}
      <SectionCard
        title={
          <span className="flex items-center gap-2">
            Active Masters
            <Badge variant="success">{activeMasters.length}</Badge>
          </span>
        }
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className={WS_TABLE_WRAP}>
            <table className={WS_TABLE}>
              <thead>
                <tr>
                  <th className={WS_TH}>Expense Name</th>
                  <th className={cn(WS_TH, 'w-28 text-right')}>Rate</th>
                  <th className={cn(WS_TH, 'w-40')}>Supply Type</th>
                  <th className={cn(WS_TH, 'w-24 text-center')}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeMasters.length === 0 ? (
                  <TableEmptyState
                    colSpan={4}
                    icon={<Settings className="h-6 w-6" />}
                    title="No active masters"
                    description="Add an expense master to make it available in the RCM dropdown."
                  />
                ) : (
                  activeMasters.map((master) => (
                    <tr key={master.id} className={WS_TR}>
                      <td className={cn(WS_TD, 'font-medium')}>{master.expense_name}</td>
                      <td className={WS_TD_NUM}>{master.rate}</td>
                      <td className={cn(WS_TD, 'capitalize')}>{master.supply_type}</td>
                      <td className={cn(WS_TD, 'py-0.5')}>
                        {hasPermission && (
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Edit ${master.expense_name}`}
                              onClick={() => openEditDialog(master)}
                              className="h-8 w-8"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Delete ${master.expense_name}`}
                              onClick={() => openDeleteDialog(master)}
                              className="h-8 w-8 text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Inactive Masters (if any) */}
      {inactiveMasters.length > 0 && (
        <SectionCard
          title={
            <span className="flex items-center gap-2 text-muted-foreground">
              Inactive Masters
              <Badge variant="secondary">{inactiveMasters.length}</Badge>
            </span>
          }
        >
          <div className={WS_TABLE_WRAP}>
            <table className={WS_TABLE}>
              <thead>
                <tr>
                  <th className={WS_TH}>Expense Name</th>
                  <th className={cn(WS_TH, 'w-28 text-right')}>Rate</th>
                  <th className={cn(WS_TH, 'w-40')}>Supply Type</th>
                </tr>
              </thead>
              <tbody>
                {inactiveMasters.map((master) => (
                  <tr key={master.id} className={cn(WS_TR, 'opacity-60')}>
                    <td className={cn(WS_TD, 'font-medium')}>{master.expense_name}</td>
                    <td className={WS_TD_NUM}>{master.rate}</td>
                    <td className={cn(WS_TD, 'capitalize')}>{master.supply_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Add Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Master</DialogTitle>
            <DialogDescription>
              Create an RCM expense master. It becomes selectable in the RCM expense dropdown.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="expenseName">
                Expense Name
                <RequiredMark />
              </Label>
              <Input
                id="expenseName"
                value={expenseName}
                onChange={(e) => setExpenseName(e.target.value)}
                placeholder="Enter expense name"
                aria-invalid={expenseNameInvalid}
                aria-describedby={expenseNameInvalid ? 'expenseName-error' : undefined}
                className={cn(expenseNameInvalid && 'border-destructive focus-visible:ring-destructive')}
              />
              {expenseNameInvalid && (
                <p id="expenseName-error" className="text-xs text-destructive">
                  Expense name is required.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="rate">
                Rate
                <RequiredMark />
              </Label>
              <Select value={rate} onValueChange={setRate}>
                <SelectTrigger id="rate">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5%">5%</SelectItem>
                  <SelectItem value="18%">18%</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplyType">
                Supply Type
                <RequiredMark />
              </Label>
              <Select value={supplyType} onValueChange={setSupplyType}>
                <SelectTrigger id="supplyType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="intrastate">Intrastate</SelectItem>
                  <SelectItem value="interstate">Interstate</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={isSubmitting}
              onClick={() => {
                setShowAddDialog(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isSubmitting ? 'Adding…' : 'Add Master'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Master</DialogTitle>
            <DialogDescription>
              Update the name, rate or supply type of this RCM expense master.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="editExpenseName">
                Expense Name
                <RequiredMark />
              </Label>
              <Input
                id="editExpenseName"
                value={expenseName}
                onChange={(e) => setExpenseName(e.target.value)}
                placeholder="Enter expense name"
                aria-invalid={expenseNameInvalid}
                aria-describedby={expenseNameInvalid ? 'editExpenseName-error' : undefined}
                className={cn(expenseNameInvalid && 'border-destructive focus-visible:ring-destructive')}
              />
              {expenseNameInvalid && (
                <p id="editExpenseName-error" className="text-xs text-destructive">
                  Expense name is required.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="editRate">
                Rate
                <RequiredMark />
              </Label>
              <Select value={rate} onValueChange={setRate}>
                <SelectTrigger id="editRate">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5%">5%</SelectItem>
                  <SelectItem value="18%">18%</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="editSupplyType">
                Supply Type
                <RequiredMark />
              </Label>
              <Select value={supplyType} onValueChange={setSupplyType}>
                <SelectTrigger id="editSupplyType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="intrastate">Intrastate</SelectItem>
                  <SelectItem value="interstate">Interstate</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={isSubmitting}
              onClick={() => {
                setShowEditDialog(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isSubmitting ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Master</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedMaster?.expense_name}"? This master will be
              marked as inactive and won't appear in the dropdown.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isSubmitting}
              onClick={() => {
                setShowDeleteDialog(false);
                resetForm();
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isSubmitting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isSubmitting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ManageMastersPage;
