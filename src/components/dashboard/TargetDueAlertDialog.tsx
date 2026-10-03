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
import { Badge } from '@/components/gstr9/badge';
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
          <DialogTitle className="flex items-center gap-2 text-base text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Returns Due Today ({today})
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2.5 py-2">
          <p className="text-sm text-muted-foreground">
            You have <span className="font-bold text-foreground">{totalCount}</span> returns due today that are still pending.
          </p>
          
          <div className="rounded-md border">
            {breakdown.filter(b => b.count > 0).map((item) => (
              <div key={item.returnType} className="flex items-center justify-between border-b px-3 py-1.5 last:border-b-0">
                <Badge variant="outline" className="text-[10px] font-medium">{item.returnType}</Badge>
                <Badge variant="warning" className="text-[10px] font-medium tabular-nums">{item.count} pending</Badge>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Dismiss
          </Button>
          <Button size="sm" onClick={handleViewAll}>
            View All Due Today
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TargetDueAlertDialog;
