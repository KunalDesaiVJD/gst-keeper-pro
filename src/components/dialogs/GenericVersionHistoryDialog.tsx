import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { History, Download, RotateCcw, Save, RefreshCcw, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

export interface GenericVersion {
  id: string;
  versionNumber: number;
  versionData: any;
  updatedBy: string;
  updatedByRole?: string;
  updatedAt: string;
  isCurrent: boolean;
  actionType?: string;
  restoredFromVersionId?: string | null;
}

interface GenericVersionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versions: GenericVersion[];
  onRestore: (version: GenericVersion) => void;
  onDownload: (version: GenericVersion) => void;
  onVersionDeleted?: () => void;
  title: string;
  subtitle: string;
  tableName: 'rcm_versions' | 'itc_versions' | 'gst_update_versions';
}

const GenericVersionHistoryDialog: React.FC<GenericVersionHistoryDialogProps> = ({
  open,
  onOpenChange,
  versions,
  onRestore,
  onDownload,
  onVersionDeleted,
  title,
  subtitle,
  tableName,
}) => {
  const { user } = useAuth();
  const [confirmRestore, setConfirmRestore] = useState<GenericVersion | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<GenericVersion | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Only superadmin can restore and delete versions
  const canRestore = user?.role === 'superadmin';
  const canDelete = user?.role === 'superadmin';

  const handleRestoreClick = (version: GenericVersion) => {
    setConfirmRestore(version);
  };

  const handleConfirmRestore = () => {
    if (confirmRestore) {
      onRestore(confirmRestore);
      setConfirmRestore(null);
    }
  };

  const handleDeleteClick = (version: GenericVersion) => {
    setConfirmDelete(version);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    
    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', confirmDelete.id);

      if (error) throw error;

      toast.success(`Version ${confirmDelete.versionNumber} deleted successfully`);
      setConfirmDelete(null);
      onVersionDeleted?.();
    } catch (error: any) {
      console.error('Error deleting version:', error);
      toast.error('Failed to delete version');
    } finally {
      setIsDeleting(false);
    }
  };

  const getActionIcon = (actionType?: string) => {
    if (actionType === 'RESTORE') {
      return <RefreshCcw className="h-3 w-3" />;
    }
    return <Save className="h-3 w-3" />;
  };

  const getActionColor = (actionType?: string) => {
    if (actionType === 'RESTORE') {
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    }
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              {title}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              {subtitle}
            </p>
          </DialogHeader>

          <div className="mt-4 space-y-3 max-h-96 overflow-y-auto">
            {versions.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No version history available. Save changes to create versions.
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
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">
                          {format(new Date(version.updatedAt), 'dd-MMM-yyyy HH:mm')} IST
                        </p>
                        <Badge className={`text-xs flex items-center gap-1 ${getActionColor(version.actionType)}`}>
                          {getActionIcon(version.actionType)}
                          {version.actionType || 'SAVE'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        By: {version.updatedBy} {version.updatedByRole ? `(${version.updatedByRole})` : ''}
                      </p>
                      {version.actionType === 'RESTORE' && version.restoredFromVersionId && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          Restored from earlier version
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteClick(version)}
                        className="flex items-center gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                    {canRestore && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRestoreClick(version)}
                        className="flex items-center gap-1"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Restore
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onDownload(version)}
                      className="flex items-center gap-1"
                    >
                      <Download className="h-3 w-3" />
                      Download
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          {!canRestore && versions.length > 0 && (
            <p className="text-xs text-muted-foreground text-center mt-4">
              Only Superadmin can restore or delete previous versions.
            </p>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmRestore} onOpenChange={() => setConfirmRestore(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore Version {confirmRestore?.versionNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace all current data with the data from version {confirmRestore?.versionNumber}. 
              A new version snapshot will be created to track this restore action.
              Make sure you have saved or downloaded the current data if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRestore}>
              Restore Version
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Version {confirmDelete?.versionNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete version {confirmDelete?.versionNumber}. 
              This action cannot be undone. Make sure you have downloaded this version if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete Version'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default GenericVersionHistoryDialog;
