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
import { History, Download, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { TwoBVersion, BillNotIn2B, BillNotInBooks } from '@/types';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

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
  const [confirmRestore, setConfirmRestore] = useState<TwoBVersion | null>(null);

  const handleDownloadVersion = (version: TwoBVersion) => {
    try {
      const workbook = XLSX.utils.book_new();

      // Sheet 1: Bills Not Available in 2B
      const billsNotIn2B = version.billsNotIn2B || [];
      const sheet1Data = [
        ['Bills Not Available in 2B'],
        [`Client: ${clientName}`, '', '', '', '', '', '', '', `Month: ${month}`],
        [`Version: ${version.versionNumber}`, '', '', '', '', '', '', '', `Saved: ${format(new Date(version.updatedAt), 'dd-MMM-yyyy HH:mm')}`],
        [],
        ['Date', 'Supplier Name', 'Invoice No.', 'GSTIN', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Reversal Month', 'Reclaim Month'],
        ...billsNotIn2B.map((row: BillNotIn2B) => [
          row.date instanceof Date ? format(row.date, 'dd/MM/yyyy') : String(row.date || ''),
          row.supplierName || '',
          row.supplierInvoiceNumber || '',
          row.supplierGstin || '',
          row.taxableValue || 0,
          row.inputIgst || 0,
          row.inputCgst || 0,
          row.inputSgst || 0,
          row.reversalMonth || '',
          row.reclaimMonth || ''
        ]),
        [],
        ['TOTAL', '', '', '',
          billsNotIn2B.reduce((sum: number, r: BillNotIn2B) => sum + (r.taxableValue || 0), 0),
          billsNotIn2B.reduce((sum: number, r: BillNotIn2B) => sum + (r.inputIgst || 0), 0),
          billsNotIn2B.reduce((sum: number, r: BillNotIn2B) => sum + (r.inputCgst || 0), 0),
          billsNotIn2B.reduce((sum: number, r: BillNotIn2B) => sum + (r.inputSgst || 0), 0),
          '', ''
        ]
      ];

      const sheet1 = XLSX.utils.aoa_to_sheet(sheet1Data);
      sheet1['!cols'] = [
        { wch: 12 }, { wch: 30 }, { wch: 15 }, { wch: 18 },
        { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
        { wch: 15 }, { wch: 15 }
      ];
      XLSX.utils.book_append_sheet(workbook, sheet1, 'Bills Not in 2B');

      // Sheet 2: Bills Not Available in Books
      const billsNotInBooks = version.billsNotInBooks || [];
      const sheet2Data = [
        ['Bills Not Available in Books'],
        [`Client: ${clientName}`, '', '', '', '', '', '', '', `Month: ${month}`],
        [`Version: ${version.versionNumber}`, '', '', '', '', '', '', '', `Saved: ${format(new Date(version.updatedAt), 'dd-MMM-yyyy HH:mm')}`],
        [],
        ['Date', 'Supplier Name', 'Invoice No.', 'GSTIN', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Book Entry Month', 'Bill in 2B Month'],
        ...billsNotInBooks.map((row: BillNotInBooks) => [
          row.date instanceof Date ? format(row.date, 'dd/MM/yyyy') : String(row.date || ''),
          row.supplierName || '',
          row.supplierInvoiceNumber || '',
          row.supplierGstin || '',
          row.taxableValue || 0,
          row.inputIgst || 0,
          row.inputCgst || 0,
          row.inputSgst || 0,
          row.bookEntryMonth || '',
          row.billIn2BMonth || ''
        ]),
        [],
        ['TOTAL', '', '', '',
          billsNotInBooks.reduce((sum: number, r: BillNotInBooks) => sum + (r.taxableValue || 0), 0),
          billsNotInBooks.reduce((sum: number, r: BillNotInBooks) => sum + (r.inputIgst || 0), 0),
          billsNotInBooks.reduce((sum: number, r: BillNotInBooks) => sum + (r.inputCgst || 0), 0),
          billsNotInBooks.reduce((sum: number, r: BillNotInBooks) => sum + (r.inputSgst || 0), 0),
          '', ''
        ]
      ];

      const sheet2 = XLSX.utils.aoa_to_sheet(sheet2Data);
      sheet2['!cols'] = [
        { wch: 12 }, { wch: 30 }, { wch: 15 }, { wch: 18 },
        { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
        { wch: 15 }, { wch: 15 }
      ];
      XLSX.utils.book_append_sheet(workbook, sheet2, 'Bills Not in Books');

      // Download
      const fileName = `2B_Version_${version.versionNumber}_${clientName.replace(/\s+/g, '_')}_${month.replace('/', '-')}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      
      toast.success(`Downloaded version ${version.versionNumber}`);
    } catch (error: any) {
      console.error('Error downloading version:', error);
      toast.error('Failed to download version');
    }
  };

  const handleRestoreClick = (version: TwoBVersion) => {
    setConfirmRestore(version);
  };

  const handleConfirmRestore = () => {
    if (confirmRestore) {
      onRestore(confirmRestore);
      setConfirmRestore(null);
    }
  };

  return (
    <>
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
                      <p className="text-sm font-medium">
                        {format(new Date(version.updatedAt), 'dd-MMM-yyyy HH:mm')} IST
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Updated by: {version.updatedBy}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {(version.billsNotIn2B || []).length} bills in 2B table, {(version.billsNotInBooks || []).length} bills in Books table
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRestoreClick(version)}
                      className="flex items-center gap-1"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Restore
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownloadVersion(version)}
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
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmRestore} onOpenChange={() => setConfirmRestore(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore Version {confirmRestore?.versionNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace all current data with the data from version {confirmRestore?.versionNumber}. 
              This action cannot be undone. Make sure you have saved or downloaded the current data if needed.
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
    </>
  );
};

export default VersionHistoryDialog;