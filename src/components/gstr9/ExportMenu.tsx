import React, { useRef, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { exportGstr9Pdf, exportNoticePdf } from '@/lib/gstr9/exportPdf';
import { exportWorkbook } from '@/lib/gstr9/exportWorkbook';
import { useWorkspace } from './WorkspaceContext';

export type ExportKind = 'excel' | 'gstr9pdf' | 'noticepdf';

const KINDS: Record<ExportKind, { label: string; hint: string; icon: React.ReactNode }> = {
  excel: { label: 'Excel working', hint: 'Every sheet of the firm’s workbook + differences', icon: <FileSpreadsheet className="h-4 w-4" /> },
  gstr9pdf: { label: 'GSTR-9 PDF', hint: 'Form GSTR-9, Tables 4–18', icon: <FileText className="h-4 w-4" /> },
  noticepdf: { label: 'Notice format PDF', hint: 'Outward and inward summary', icon: <FileText className="h-4 w-4" /> },
};

const ORDER: ExportKind[] = ['excel', 'gstr9pdf', 'noticepdf'];

/**
 * Export actions for the open working. Everything pending is saved first,
 * then the file is built from the engine's figures and downloaded.
 * `only` limits the menu to some kinds; with a single kind it renders as one button.
 */
export const ExportMenu: React.FC<{ only?: ExportKind[]; size?: 'sm' | 'default' }> = ({ only, size = 'sm' }) => {
  const ws = useWorkspace();
  // The latest workspace after the save completes (a save can reload the docs).
  const latest = useRef(ws);
  latest.current = ws;
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const kinds = ORDER.filter((k) => !only || only.includes(k));

  const run = async (kind: ExportKind) => {
    if (busy) return;
    setBusy(kind);
    try {
      await ws.flush();
      const { docs, workings, client, financialYear, period } = latest.current;
      const meta = { clientName: client.name, gstin: client.gstin, financialYear };
      let file: string;
      if (kind === 'excel') {
        const status = period?.status === 'locked' ? `Locked${period.locked_by ? ` by ${period.locked_by}` : ''}` : period?.status === 'in_progress' ? 'In progress' : 'Not started';
        file = exportWorkbook(docs, workings, { ...meta, status });
      } else if (kind === 'gstr9pdf') {
        file = exportGstr9Pdf(workings, meta, docs);
      } else {
        file = exportNoticePdf(workings, meta);
      }
      toast.success(`Downloaded ${file}`);
    } catch (e) {
      toast.error(`Could not export the ${KINDS[kind].label}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  if (!kinds.length) return null;

  if (kinds.length === 1) {
    const k = kinds[0];
    return (
      <Button variant="outline" size={size} onClick={() => run(k)} disabled={!!busy} title={KINDS[k].hint}>
        {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <span className="mr-1 [&>svg]:h-3.5 [&>svg]:w-3.5">{KINDS[k].icon}</span>}
        {KINDS[k].label}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} disabled={!!busy}>
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
          {busy ? 'Exporting…' : 'Export'}
          <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Saves pending changes first</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {kinds.map((k) => (
          <DropdownMenuItem key={k} onSelect={() => void run(k)} className="items-start gap-2">
            <span className="mt-0.5 text-muted-foreground">{KINDS[k].icon}</span>
            <span className="flex flex-col">
              <span className="text-sm">{KINDS[k].label}</span>
              <span className="text-[11px] text-muted-foreground">{KINDS[k].hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ExportMenu;
