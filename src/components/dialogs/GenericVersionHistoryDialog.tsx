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
import { History, Download, RotateCcw, Save, RefreshCcw, Trash2, Eye, X } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { ScrollArea } from '@/components/ui/scroll-area';

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
  onView?: (version: GenericVersion) => void;
  onVersionDeleted?: () => void;
  title: string;
  subtitle: string;
  tableName: 'rcm_versions' | 'itc_versions' | 'gst_update_versions';
}

// Helper to render version data as a readable table in a modal
const VersionDataViewer: React.FC<{ version: GenericVersion; onClose: () => void }> = ({ version, onClose }) => {
  const data = version.versionData;

  const renderTable = (rows: any[], title: string) => {
    if (!rows || rows.length === 0) return null;
    // Get all keys from first row
    const keys = Object.keys(rows[0]).filter(k => !['isHeader', 'isAutoLinked', 'editable'].includes(k));
    return (
      <div className="mb-4">
        <h4 className="font-semibold text-sm mb-2">{title}</h4>
        <div className="overflow-x-auto border rounded">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50">
                {keys.map(k => (
                  <th key={k} className="px-2 py-1 text-left border-b font-medium capitalize">
                    {k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any, i: number) => (
                <tr key={i} className={row.isHeader ? 'bg-muted/30 font-semibold' : ''}>
                  {keys.map(k => (
                    <td key={k} className="px-2 py-1 border-b">
                      {typeof row[k] === 'number' ? row[k].toLocaleString('en-IN') : String(row[k] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderContent = () => {
    if (!data) return <p className="text-muted-foreground text-sm">No data available for this version.</p>;

    // ITC Summary format
    if (data.section4A || data.section4B || data.section4D) {
      return (
        <>
          {data.section4A && renderTable(data.section4A, '4(A) ITC Available')}
          {data.section4B && renderTable(data.section4B, '4(B) ITC Reversed')}
          {data.section4D && renderTable(data.section4D, '4(D) Other Details')}
        </>
      );
    }

    // RCM format (array of rows)
    if (Array.isArray(data)) {
      return renderTable(data, 'RCM Data');
    }

    // GST Update format (array or object)
    if (data.updates && Array.isArray(data.updates)) {
      return renderTable(data.updates, 'GST Updates');
    }

    // Fallback: render as JSON
    return (
      <pre className="text-xs bg-muted/30 p-3 rounded overflow-auto max-h-96">
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Version {version.versionNumber} Preview
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Saved by {version.updatedBy} {version.updatedByRole ? `(${version.updatedByRole})` : ''} on{' '}
            {format(new Date(version.updatedAt), 'dd-MMM-yyyy HH:mm')} IST
            {version.actionType === 'RESTORE' && ' • Restored from earlier version'}
          </p>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="pr-4">
            {renderContent()}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

const GenericVersionHistoryDialog: React.FC<GenericVersionHistoryDialogProps> = ({
  open,
  onOpenChange,
  versions,
  onRestore,
  onDownload,
  onView,
  onVersionDeleted,
  title,
  subtitle,
  tableName,
}) => {
  const { user } = useAuth();
  const [confirmRestore, setConfirmRestore] = useState<GenericVersion | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<GenericVersion | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<GenericVersion | null>(null);

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
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setViewingVersion(version)}
                      className="flex items-center gap-1"
                    >
                      <Eye className="h-3 w-3" />
                      View
                    </Button>
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

      {/* Version Data Viewer Modal */}
      {viewingVersion && (
        <VersionDataViewer version={viewingVersion} onClose={() => setViewingVersion(null)} />
      )}

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
