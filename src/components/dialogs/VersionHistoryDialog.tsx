import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { History, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { TwoBVersion } from '@/types';
import { toast } from 'sonner';

interface VersionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versions: TwoBVersion[];
  onRestore: (version: TwoBVersion) => void;
  clientName: string;
  month: string;
}

const VersionHistoryDialog: React.FC<VersionHistoryDialogProps> = ({
  open,
  onOpenChange,
  versions,
  onRestore,
  clientName,
  month,
}) => {
  const handleRestore = (version: TwoBVersion) => {
    onRestore(version);
    toast.success(`Restored to version ${version.versionNumber}`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Version History
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {clientName} - {month}
          </p>
        </DialogHeader>

        <div className="mt-4 space-y-3 max-h-96 overflow-y-auto">
          {versions.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No version history available.
            </p>
          ) : (
            versions.map((version) => (
              <div
                key={version.id}
                className={`flex items-center justify-between p-4 rounded-lg border ${
                  version.isCurrent ? 'bg-primary/5 border-primary/20' : 'bg-muted/30'
                }`}
              >
                <div className="flex items-center gap-4">
                  <Badge variant={version.isCurrent ? 'default' : 'outline'}>
                    v{version.versionNumber}
                  </Badge>
                  <div>
                    <p className="text-sm font-medium">
                      {format(new Date(version.updatedAt), 'dd-MMM-yyyy HH:mm')} IST
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Updated by: {version.updatedBy}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {version.billsNotIn2B.length} bills in 2B table, {version.billsNotInBooks.length} bills in Books table
                    </p>
                  </div>
                </div>
                {!version.isCurrent && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRestore(version)}
                    className="flex items-center gap-1"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Restore
                  </Button>
                )}
                {version.isCurrent && (
                  <Badge variant="secondary" className="text-xs">
                    Current
                  </Badge>
                )}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default VersionHistoryDialog;
