import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ClipboardPaste } from 'lucide-react';
import { parseTsvBlock } from '@/lib/pasteImport';

export interface PasteImportResult { imported: number; skipped: number; warnings: string[] }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  /** Column labels in the exact order staff should paste them, e.g. from an Excel copy. Shown as the preview header and in the paste hint. */
  columnLabels: string[];
  /** Runs when "Import" is clicked. Receives the parsed rows (raw cell strings, same order as columnLabels) — validation, field mapping and applying to the card's own state all happen here. */
  onImport: (rows: string[][]) => PasteImportResult;
}

/**
 * Shared paste-preview shell for every "Paste from Excel" entry point in the
 * Annual Return module (25 Aug 2026 UX audit — pattern repeated across 8
 * cards). This component only parses and previews; it never touches a
 * card's own state or the database directly — imported rows are staged into
 * the card's existing grid via onImport and still go through that card's
 * normal batch "Save changes" button. Every value is still independently
 * supplied by staff (paste is just faster keystrokes), so this doesn't
 * touch the firm's manual-entry requirement for books data.
 */
export const PasteFromExcelDialog: React.FC<Props> = ({ open, onOpenChange, title, columnLabels, onImport }) => {
  const [text, setText] = useState('');
  const rows = useMemo(() => parseTsvBlock(text), [text]);

  const close = (o: boolean) => {
    if (!o) setText('');
    onOpenChange(o);
  };

  const handleImport = () => {
    if (rows.length === 0) return;
    onImport(rows);
    close(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title || 'Paste from Excel'}</DialogTitle>
          <DialogDescription>
            Copy rows straight from your working sheet and paste below — columns in this order: {columnLabels.join(' · ')}.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste tab-separated rows here…"
          className="min-h-[140px] font-mono text-xs"
        />
        {rows.length > 0 && (
          <div className="border rounded-md overflow-x-auto max-h-64">
            <Table>
              <TableHeader>
                <TableRow>{columnLabels.map((c) => <TableHead key={c} className="whitespace-nowrap text-xs">{c}</TableHead>)}</TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 50).map((r, i) => (
                  <TableRow key={i}>
                    {columnLabels.map((_, ci) => <TableCell key={ci} className="whitespace-nowrap text-xs">{r[ci] ?? ''}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {rows.length > 50 && <div className="text-xs text-muted-foreground p-2">…and {rows.length - 50} more row{rows.length - 50 === 1 ? '' : 's'}.</div>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
          <Button onClick={handleImport} disabled={rows.length === 0}>
            <ClipboardPaste className="h-3.5 w-3.5 mr-1.5" />
            Import{rows.length > 0 ? ` ${rows.length} row${rows.length === 1 ? '' : 's'}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PasteFromExcelDialog;
