import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile, Note, SectionCard } from '@/components/gstr9/ui';
import { fmtMoney } from '@/components/gstr9/grid/money';
import {
  WS_BTN, WS_TABLE_WRAP, WS_TABLE, WS_TH, WS_TD, WS_TD_NUM, WS_TR,
} from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import {
  extractDocs, reconcileEinvoice, summariseReco,
  type EinvDoc, type EinvRecoRow, type EinvRecoStatus, type EinvoiceDocRow,
} from '@/lib/einvoice/einvoice';

/** einvoice_pulls row — the last e-invoice pull for this client + period. */
export interface EinvoicePullRow {
  status: string; // ok | none | pending | failed
  docs_found: number;
  message: string | null;
  pulled_at: string;
  pulled_by?: string | null;
}

type Filter = 'all' | 'einv' | EinvRecoStatus;

const STATUS_LOOK: Record<EinvRecoStatus, { label: string; variant: 'success' | 'destructive' | 'warning' }> = {
  matched: { label: 'Matched', variant: 'success' },
  mismatch: { label: 'Changed after IRN', variant: 'destructive' },
  not_einvoiced: { label: 'In books without IRN', variant: 'warning' },
  not_in_books: { label: 'IRN not in books', variant: 'warning' },
};

const SECTION_LABEL: Record<string, string> = {
  b2b: 'B2B', cdnr: 'CDNR', cdnur: 'CDNUR', exp: 'EXP', b2cl: 'B2CL',
};

const taxOf = (d: EinvDoc | null) => (d ? d.igst + d.cgst + d.sgst + d.cess : null);

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

const pullLine = (p: EinvoicePullRow | null): { text: string; tone: 'muted' | 'warn' | 'error' } => {
  if (!p) return { text: 'E-invoices not pulled yet for this period.', tone: 'warn' };
  const when = fmtWhen(p.pulled_at);
  switch (p.status) {
    case 'ok':
      return { text: `Pulled ${when} · ${p.docs_found.toLocaleString('en-IN')} IRN${p.docs_found === 1 ? '' : 's'}`, tone: 'muted' };
    case 'none':
      return { text: `Pulled ${when} · no e-invoices on the portal for this period`, tone: 'muted' };
    case 'pending':
      return { text: `Pull pending (${when})${p.message ? ` — ${p.message}` : ' — the portal is still preparing the data; pull again shortly.'}`, tone: 'warn' };
    case 'failed':
      return { text: `Last pull failed (${when})${p.message ? ` — ${p.message}` : ''}`, tone: 'error' };
    default:
      return { text: `Pulled ${when} · ${p.status}${p.message ? ` — ${p.message}` : ''}`, tone: 'muted' };
  }
};

interface Props {
  /** The books JSON (gstr1_data.raw_json), or null when nothing is imported. */
  booksJson: unknown | null;
  einvoiceDocs: EinvoiceDocRow[];
  lastPull: EinvoicePullRow | null;
  loading?: boolean;
  /** Show the Pull button at all (staff with filing-status edit rights). */
  canPull: boolean;
  extReady: boolean;
  pulling: boolean;
  onPull: () => void;
  clientName: string;
  /** MM/YYYY */
  periodMonth: string;
}

/**
 * E-invoice (IRN) reconciliation for one client + period: the books JSON
 * against the e-invoices the GST portal auto-populated into GSTR-1.
 */
const EinvoiceRecoPanel: React.FC<Props> = ({
  booksJson, einvoiceDocs, lastPull, loading, canPull, extReady, pulling, onPull, clientName, periodMonth,
}) => {
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo<EinvRecoRow[]>(
    () => reconcileEinvoice(extractDocs(booksJson), einvoiceDocs as EinvDoc[]),
    [booksJson, einvoiceDocs],
  );
  const sum = useMemo(() => summariseReco(rows), [rows]);
  const shown = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'einv') return rows.filter((r) => !!r.einv);
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const pull = pullLine(lastPull);
  const toggle = (f: Filter) => setFilter((cur) => (cur === f ? 'all' : f));

  const exportXlsx = () => {
    const data = shown.map((r) => ({
      Section: SECTION_LABEL[r.section] ?? r.section,
      'Doc type': r.doc_type,
      'Doc no.': r.doc_no,
      'Buyer GSTIN': r.ctin || '',
      'Books taxable': r.books ? r.books.taxable : '',
      'Books tax': r.books ? taxOf(r.books) : '',
      'E-invoice taxable': r.einv ? r.einv.taxable : '',
      'E-invoice tax': r.einv ? taxOf(r.einv) : '',
      Differences: r.differences.join('; '),
      Status: STATUS_LOOK[r.status].label,
      IRN: r.einv?.irn || r.books?.irn || '',
      'IRN date': r.einv?.irn_date || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'E-invoice reco');
    const safe = (clientName || 'client').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
    XLSX.writeFile(wb, `Einvoice_Reco_${safe}_${periodMonth.replace('/', '-')}.xlsx`);
  };

  const tile = (f: Filter, el: React.ReactNode, title: string) => (
    <button
      type="button"
      onClick={() => toggle(f)}
      title={title}
      aria-pressed={filter === f}
      className={cn(
        'rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        filter === f && 'ring-2 ring-primary',
      )}
    >
      {el}
    </button>
  );

  return (
    <SectionCard
      title="E-invoice reconciliation"
      description={
        <span className={cn(pull.tone === 'warn' && 'font-medium text-foreground', pull.tone === 'error' && 'text-destructive-strong')}>
          {pull.text}
        </span>
      }
      actions={(
        <>
          <Button variant="outline" size="sm" className={WS_BTN} onClick={exportXlsx} disabled={shown.length === 0}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          {canPull && (
            <Button
              size="sm"
              variant="outline"
              className={WS_BTN}
              onClick={onPull}
              disabled={pulling || !extReady}
              title={extReady
                ? 'Download this period\'s GSTR-1 from the portal and store its e-invoices (IRNs)'
                : 'GST Keeper browser extension not detected — install / enable it and reload this page'}
            >
              {pulling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Pull e-invoices
            </Button>
          )}
        </>
      )}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {tile('einv', <KpiTile label="E-invoices on portal" value={einvoiceDocs.length.toLocaleString('en-IN')} />, 'Show documents with an e-invoice')}
        {tile('matched', <KpiTile label="Matched" value={sum.matched.toLocaleString('en-IN')} tone={sum.matched ? 'ok' : 'neutral'} />, 'Show matched documents')}
        {tile('mismatch', <KpiTile label="Changed after IRN" value={sum.mismatch.toLocaleString('en-IN')} tone={sum.mismatch ? 'error' : 'neutral'} />, 'Show documents whose books figures differ from the e-invoice')}
        {tile('not_einvoiced', <KpiTile label="In books without IRN" value={sum.notEinvoiced.toLocaleString('en-IN')} tone={sum.notEinvoiced ? 'warn' : 'neutral'} />, 'Show e-invoiceable books documents with no IRN')}
        {tile('not_in_books', <KpiTile label="IRN not in books" value={sum.notInBooks.toLocaleString('en-IN')} tone={sum.notInBooks ? 'warn' : 'neutral'} />, 'Show e-invoices missing from the books JSON')}
      </div>

      <Note>
        Books figures that were changed after the IRN was generated show as "Changed after IRN" — the books
        figures are what get uploaded. On push, every matched document (and every changed one) is sent with its
        IRN, so the portal keeps it as an e-invoice. {booksJson ? null : 'No JSON is imported for this period, so every e-invoice shows as not in books.'}
      </Note>

      {filter !== 'all' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          Showing {shown.length.toLocaleString('en-IN')} of {rows.length.toLocaleString('en-IN')} documents.
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => setFilter('all')}>Show all</button>
        </div>
      )}

      <div className={cn(WS_TABLE_WRAP, 'max-h-[60vh]')}>
        <table className={WS_TABLE}>
          <thead>
            <tr>
              <th className={WS_TH}>Section</th>
              <th className={WS_TH}>Doc type</th>
              <th className={WS_TH}>Doc no.</th>
              <th className={WS_TH}>Buyer GSTIN</th>
              <th className={cn(WS_TH, 'text-right')}>Books taxable</th>
              <th className={cn(WS_TH, 'text-right')}>Books tax</th>
              <th className={cn(WS_TH, 'text-right')}>E-invoice taxable</th>
              <th className={cn(WS_TH, 'text-right')}>E-invoice tax</th>
              <th className={WS_TH}>Differences</th>
              <th className={WS_TH}>Status</th>
              <th className={WS_TH}>IRN</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className={cn(WS_TD, 'py-6 text-center text-muted-foreground')} colSpan={11}>
                  <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> Loading e-invoices…
                </td>
              </tr>
            ) : shown.length === 0 ? (
              <tr>
                <td className={cn(WS_TD, 'py-6 text-center text-muted-foreground')} colSpan={11}>
                  {rows.length === 0 ? 'No e-invoiceable documents in the books and no e-invoices pulled for this period.' : 'No documents in this group.'}
                </td>
              </tr>
            ) : shown.map((r) => {
              const look = STATUS_LOOK[r.status];
              const irn = r.einv?.irn || r.books?.irn || '';
              return (
                <tr key={r.key} className={WS_TR}>
                  <td className={WS_TD}>{SECTION_LABEL[r.section] ?? r.section}</td>
                  <td className={WS_TD}>{r.doc_type}</td>
                  <td className={cn(WS_TD, 'whitespace-nowrap font-medium')}>{r.doc_no}</td>
                  <td className={cn(WS_TD, 'whitespace-nowrap font-mono text-xs')}>{r.ctin || '—'}</td>
                  <td className={WS_TD_NUM}>{r.books ? fmtMoney(r.books.taxable) : '—'}</td>
                  <td className={WS_TD_NUM}>{r.books ? fmtMoney(taxOf(r.books) ?? 0) : '—'}</td>
                  <td className={WS_TD_NUM}>{r.einv ? fmtMoney(r.einv.taxable) : '—'}</td>
                  <td className={WS_TD_NUM}>{r.einv ? fmtMoney(taxOf(r.einv) ?? 0) : '—'}</td>
                  <td className={cn(WS_TD, 'min-w-[12rem] text-xs', r.status === 'mismatch' && 'text-destructive-strong')}>
                    {r.differences.length ? r.differences.join(' · ') : '—'}
                  </td>
                  <td className={cn(WS_TD, 'whitespace-nowrap')}>
                    <Badge variant={look.variant} className="px-1.5 text-[10px] font-medium">{look.label}</Badge>
                  </td>
                  <td className={cn(WS_TD, 'max-w-[10rem] truncate font-mono text-xs')} title={irn || undefined}>
                    {irn ? `${irn.slice(0, 12)}…` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
};

export default EinvoiceRecoPanel;
