import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { Settings, Plus, Pencil, Trash2, Loader2, ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface RCMMaster {
  id: string;
  expense_name: string;
  rate: string;
  supply_type: string;
  is_active: boolean;
  created_at: string;
}

const ManageMastersPage: React.FC = () => {
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

  // Check if user has permission
  const hasPermission = canManageRCMMasters();

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
  };

  const handleAdd = async () => {
    if (!expenseName.trim()) {
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
    setShowEditDialog(true);
  };

  const openDeleteDialog = (master: RCMMaster) => {
    setSelectedMaster(master);
    setShowDeleteDialog(true);
  };

  const activeMasters = masters.filter((m) => m.is_active);
  const inactiveMasters = masters.filter((m) => !m.is_active);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/rcm-summary')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="p-2 bg-primary/10 rounded-lg">
            <Settings className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-bold text-foreground">Manage RCM Masters</h1>
            <p className="text-muted-foreground">Add, edit, or delete expense masters</p>
          </div>
        </div>
        {hasPermission && (
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Master
          </Button>
        )}
      </div>

      {/* Active Masters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Active Masters ({activeMasters.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : activeMasters.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No active masters found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Expense Name</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Supply Type</TableHead>
                  <TableHead className="w-24 text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeMasters.map((master) => (
                  <TableRow key={master.id}>
                    <TableCell className="font-medium">{master.expense_name}</TableCell>
                    <TableCell>{master.rate}</TableCell>
                    <TableCell className="capitalize">{master.supply_type}</TableCell>
                    <TableCell>
                      {hasPermission && (
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditDialog(master)}
                            className="h-8 w-8"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openDeleteDialog(master)}
                            className="h-8 w-8 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Inactive Masters (if any) */}
      {inactiveMasters.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg text-muted-foreground">
              Inactive Masters ({inactiveMasters.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Expense Name</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Supply Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inactiveMasters.map((master) => (
                  <TableRow key={master.id} className="opacity-60">
                    <TableCell className="font-medium">{master.expense_name}</TableCell>
                    <TableCell>{master.rate}</TableCell>
                    <TableCell className="capitalize">{master.supply_type}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Add Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Master</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="expenseName">Expense Name</Label>
              <Input
                id="expenseName"
                value={expenseName}
                onChange={(e) => setExpenseName(e.target.value)}
                placeholder="Enter expense name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rate">Rate</Label>
              <Select value={rate} onValueChange={setRate}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5%">5%</SelectItem>
                  <SelectItem value="18%">18%</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplyType">Supply Type</Label>
              <Select value={supplyType} onValueChange={setSupplyType}>
                <SelectTrigger>
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
            <Button variant="outline" onClick={() => { setShowAddDialog(false); resetForm(); }}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add Master
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Master</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="editExpenseName">Expense Name</Label>
              <Input
                id="editExpenseName"
                value={expenseName}
                onChange={(e) => setExpenseName(e.target.value)}
                placeholder="Enter expense name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editRate">Rate</Label>
              <Select value={rate} onValueChange={setRate}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5%">5%</SelectItem>
                  <SelectItem value="18%">18%</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="editSupplyType">Supply Type</Label>
              <Select value={supplyType} onValueChange={setSupplyType}>
                <SelectTrigger>
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
            <Button variant="outline" onClick={() => { setShowEditDialog(false); resetForm(); }}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
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
            <AlertDialogCancel onClick={() => { setShowDeleteDialog(false); resetForm(); }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ManageMastersPage;
