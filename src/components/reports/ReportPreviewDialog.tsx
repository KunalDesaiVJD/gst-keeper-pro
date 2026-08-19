// On-screen preview for a report — fetches once (via ReportsPage) and lets
// staff look at the data, search/filter it, and open a per-row source PDF,
// before deciding whether they even need an Excel/PDF file at all. Reference:
// the firm's old "Power GST" software rendered reports the same "grid on
// screen with an Export button" way, but as a plain unstyled grid with no
// search, no status coloring, and raw PDF URLs as cell text — this goes
// further: sortable/searchable, status badges, sticky header, right-aligned
// formatted numbers, and PDF links rendered as buttons instead of URLs.
import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { FileSpreadsheet, FileText, Loader2, Search, ExternalLink, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReportTable } from '@/utils/allClientsReports';

export interface ReportPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  loading: boolean;
  error: string | null;
  table: ReportTable | null;
  onExport: (format: 'xlsx' | 'pdf') => void;
  exportBusy: 'xlsx' | 'pdf' | null;
}

const isNumericHeader = (h: string) =>
  /CGST|SGST|IGST|TOTAL|PAYABLE|CASH|CREDIT|CESS|VALUE|QTY|COUNT|RATE|AMOUNT|FEE|INTEREST|PENALTY|CLAIMED|SANCTIONED/i.test(h);

const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v);

const STATUS_COLUMN_RE = /^status$/i;
const STATUS_VARIANT = (v: string): 'success' | 'warning' | 'destructive' | 'secondary' => {
  const s = v.toUpperCase();
  if (/ACKNOWLEDG|APPROV|SANCTION|FILED|ACCEPT|PROCESSED/.test(s)) return 'success';
  if (/PENDING|PROCESSING|SUBMIT/.test(s)) return 'warning';
  if (/FAIL|REJECT|DENIED|CANCEL/.test(s)) return 'destructive';
  return 'secondary';
};

const formatCell = (v: string | number): string => {
  if (typeof v !== 'number') return String(v ?? '');
  if (v === 0) return '0';
  const rounded = Math.round(v * 100) / 100;
  return rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

export const ReportPreviewDialog: React.FC<ReportPreviewDialogProps> = ({
  open, onOpenChange, title, loading, error, table, onExport, exportBusy,
}) => {
  const [search, setSearch] = useState('');

  const statusColIdx = table?.headers.findIndex((h) => STATUS_COLUMN_RE.test(h)) ?? -1;
  const isTotalRow = (row: (string | number)[]) => row.some((c) => String(c).toUpperCase() === 'TOTAL');

  const filteredRows = useMemo(() => {
    if (!table) return [];
    const q = search.trim().toLowerCase();
    if (!q) return table.rows;
    return table.rows.filter((row) => isTotalRow(row) || row.some((c) => String(c).toLowerCase().includes(q)));
  }, [table, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] w-full h-[90vh] flex flex-col p-0 gap-0 sm:max-w-[96vw]">
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="min-w-0">
              <DialogTitle className="text-lg">{title}</DialogTitle>
              <DialogDescription className="mt-1">{table?.subtitle || 'Fetching from the database…'}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {loading && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Loading report…</p>
          </div>
        )}

        {!loading && error && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-8">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <p className="text-sm text-muted-foreground max-w-md">{error}</p>
          </div>
        )}

        {!loading && !error && table && (
          <>
            <div className="flex items-center gap-3 px-5 py-3 border-b shrink-0">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search this report…"
                  className="pl-8 h-8 text-sm"
                />
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {search ? `${filteredRows.length} of ${table.rows.length}` : `${table.rows.length}`} row{table.rows.length === 1 ? '' : 's'}
              </span>
              <div className="flex-1" />
              <Button variant="outline" size="sm" onClick={() => onExport('xlsx')} disabled={exportBusy !== null}>
                {exportBusy === 'xlsx' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />}
                Excel
              </Button>
              <Button variant="outline" size="sm" onClick={() => onExport('pdf')} disabled={exportBusy !== null}>
                {exportBusy === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <FileText className="h-3.5 w-3.5 mr-1.5" />}
                PDF
              </Button>
            </div>

            <div className="flex-1 overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    {table.headers.map((h, i) => (
                      <TableHead
                        key={i}
                        className={cn('px-3 py-2 text-xs font-semibold whitespace-nowrap bg-muted/60', isNumericHeader(h) && 'text-right')}
                      >
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={table.headers.length} className="text-center text-sm text-muted-foreground py-10">
                        No rows match "{search}".
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredRows.map((row, ri) => {
                    const total = isTotalRow(row);
                    return (
                      <TableRow key={ri} className={cn(total && 'bg-primary/5 font-semibold hover:bg-primary/10')}>
                        {row.map((cell, ci) => {
                          const header = table.headers[ci] || '';
                          if (isUrl(cell)) {
                            return (
                              <TableCell key={ci} className="px-3 py-2 text-xs whitespace-nowrap">
                                <a href={cell} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                  <ExternalLink className="h-3 w-3" /> View
                                </a>
                              </TableCell>
                            );
                          }
                          if (ci === statusColIdx && cell !== '' && !total) {
                            return (
                              <TableCell key={ci} className="px-3 py-2 text-xs whitespace-nowrap">
                                <Badge variant={STATUS_VARIANT(String(cell))} className="text-[10px] py-0">{String(cell)}</Badge>
                              </TableCell>
                            );
                          }
                          return (
                            <TableCell
                              key={ci}
                              className={cn('px-3 py-2 text-xs', isNumericHeader(header) ? 'text-right whitespace-nowrap tabular-nums' : 'max-w-[280px]')}
                            >
                              {formatCell(cell)}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
