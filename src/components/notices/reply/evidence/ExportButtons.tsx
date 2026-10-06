// Excel and PDF of a working (the PDF on the firm's letterhead). The exporters
// load on the click, so xlsx and jsPDF stay out of the notice page.
import React, { useState } from 'react';
import { FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { WS_BTN } from '@/components/workspace/theme';
import type { ExportModel } from '@/lib/reply/export';

export type ExportBase = Pick<ExportModel, 'title' | 'client' | 'notice'>;

export const ExportButtons: React.FC<{ model: ExportModel }> = ({ model }) => {
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);
  const run = async (kind: 'xlsx' | 'pdf') => {
    setBusy(kind);
    try {
      const m = await import('@/lib/reply/export');
      if (kind === 'xlsx') m.exportAnnexureXlsx(model); else m.exportAnnexurePdf(model);
    } catch (e) {
      toast.error(`Could not export: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(null); }
  };
  return (
    <span className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" className={WS_BTN} onClick={() => run('xlsx')} disabled={!!busy}>
        {busy === 'xlsx' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />} Excel
      </Button>
      <Button size="sm" variant="outline" className={WS_BTN} onClick={() => run('pdf')} disabled={!!busy}>
        {busy === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} PDF
      </Button>
    </span>
  );
};

export default ExportButtons;
