import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';

interface ReturnBreakdown {
  returnType: string;
  count: number;
}

interface TargetDueAlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalCount: number;
  breakdown: ReturnBreakdown[];
}

const TargetDueAlertDialog: React.FC<TargetDueAlertDialogProps> = ({
  open,
  onOpenChange,
  totalCount,
  breakdown,
}) => {
  const navigate = useNavigate();
  const today = format(new Date(), 'dd MMM yyyy');

  const handleViewAll = () => {
    onOpenChange(false);
    const todayDate = new Date().getDate();
    navigate(`/filing-status?filter=target_due_today&targetDate=${todayDate}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Returns Due Today ({today})
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          <p className="text-sm text-muted-foreground mb-4">
            You have <span className="font-bold text-foreground">{totalCount}</span> returns due today that are still pending.
          </p>
          
          <div className="space-y-2">
            {breakdown.filter(b => b.count > 0).map((item) => (
              <div key={item.returnType} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                <Badge variant="outline">{item.returnType}</Badge>
                <span className="text-sm font-medium text-warning">{item.count} pending</span>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Dismiss
          </Button>
          <Button onClick={handleViewAll}>
            View All Due Today
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TargetDueAlertDialog;
