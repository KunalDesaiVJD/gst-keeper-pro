import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface AddMasterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMasterAdded: () => void;
}

const AddMasterDialog: React.FC<AddMasterDialogProps> = ({
  open,
  onOpenChange,
  onMasterAdded,
}) => {
  const [expenseName, setExpenseName] = useState('');
  const [rate, setRate] = useState('5%');
  const [supplyType, setSupplyType] = useState('intrastate');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!expenseName.trim()) {
      toast.error('Expense name is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('rcm_masters').insert({
        expense_name: expenseName.trim(),
        rate,
        supply_type: supplyType,
      });

      if (error) throw error;

      toast.success('Master expense added successfully');
      setExpenseName('');
      setRate('5%');
      setSupplyType('intrastate');
      onMasterAdded();
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to add master');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Master Expense</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="expenseName">Expense Name *</Label>
            <Input
              id="expenseName"
              value={expenseName}
              onChange={(e) => setExpenseName(e.target.value)}
              placeholder="e.g., Transportation Exps, Legal Services"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rate">Rate *</Label>
            <Select value={rate} onValueChange={setRate}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5%">5%</SelectItem>
                <SelectItem value="18%">18%</SelectItem>
                <SelectItem value="18%/1%/5%">18%/1%/5% (FSI)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="supplyType">Supply Type *</Label>
            <Select value={supplyType} onValueChange={setSupplyType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="intrastate">Intrastate (CGST + SGST)</SelectItem>
                <SelectItem value="interstate">Interstate (IGST)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Master
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddMasterDialog;
