import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, FileSpreadsheet, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile, Note, SectionCard } from '@/components/gstr9/ui';
import { fmtMoney } from '@/components/gstr9/grid/money';
import {
  WS_BTN, WS_TABLE_WRAP, WS_TABLE, WS_TH, WS_TD, WS_TD_NUM, WS_TR,
} from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import {
  isPullFresh, summariseReco,
  type EinvDoc, type EinvRecoRow, type EinvRecoStatus, type EinvUploadPlan, type EinvoiceDocRow,
} from '@/lib/einvoice/einvoice';
import type { EinvoicePullRow } from '@/lib/einvoice/einvoiceData';

export type { EinvoicePullRow } from '@/lib/einvoice/einvoiceData';

type Filter = 'all' | 'einv' | EinvRecoStatus;

/**
 * Every status in plain words (docs/GSTR1_EINVOICE_POSITIONS.md §3): the tile
 * label, what happens at push (the tile's second line), the badge and the
 * full sentence for the badge's tooltip and the export.
 */
const STATUS_LOOK: Record<EinvRecoStatus, {
  tile: string;
  atPush: string;
  badge: string;
  full: string;
  variant: 'success' | 'destructive' | 'warning' | 'info' | 'secondary';
  tone: 'ok' | 'warn' | 'error' | 'neutral';
}> = {
  matched: {
    tile: 'On the portal as e-invoice',
    atPush: 'Left out of the upload (IRN kept)',
    badge: 'On portal, left out',
    full: 'On the portal as e-invoice — left out of the upload (IRN kept)',
    variant: 'success',
    tone: 'ok',
  },
  books_irn: {
    tile: 'IRN in the books JSON',
    atPush: 'Left out of the upload (IRN kept)',
    badge: 'IRN in books, left out',
    full: 'The books JSON carries its own IRN and no record says otherwise — left out of the upload (IRN kept)',
    variant: 'success',
    tone: 'ok',
  },
  pending: {
    tile: 'Pending auto-population',
    atPush: 'Not on the draft yet: blocks the push',
    badge: 'Pending auto-population',
    full: 'Pending auto-population — the IRN is generated but the portal\'s draft does not have it yet. In the books, it blocks the push until a later pull shows it on the draft (or is uploaded without its IRN if you tick that in the upload dialog); not in the books, it is missing from GSTR-1 if the return is filed first',
    variant: 'warning',
    tone: 'warn',
  },
  not_einvoiced: {
    tile: 'No IRN found',
    atPush: 'Uploaded from the books',
    badge: 'No IRN found',
    full: 'E-invoiceable, but no IRN was found — uploaded from the books',
    variant: 'warning',
    tone: 'neutral',
  },
  mismatch: {
    tile: 'Changed after IRN',
    atPush: 'Blocks the push',
    badge: 'Changed after IRN',
    full: 'Changed after IRN — blocks the push',
    variant: 'destructive',
    tone: 'error',
  },
  number_differs: {
    tile: 'Number differs from e-invoice',
    atPush: 'Blocks the push',
    badge: 'Number differs',
    full: 'Number differs from e-invoice — blocks the push',
    variant: 'destructive',
    tone: 'error',
  },
  autopop_failed: {
    tile: 'Auto-population failed',
    atPush: 'Uploaded without IRN',
    badge: 'Auto-population failed',
    full: 'Auto-population failed — the books document is uploaded without its IRN; with no books copy it is not among the IRN documents on the draft and not in the upload, so missing from GSTR-1 (unless it is on the portal without its IRN)',
    variant: 'warning',
    tone: 'warn',
  },
  irn_lost: {
    tile: 'IRN lost on the portal',
    atPush: 'Uploaded; the IRN is not restored',
    badge: 'IRN lost on portal',
    full: 'IRN lost on the portal — the latest pull no longer shows it as an e-invoice; the books document is uploaded, which cannot restore the IRN; with no books copy it is missing from GSTR-1 (unless it is on the portal without its IRN)',
    variant: 'warning',
    tone: 'warn',
  },
  not_in_books: {
    tile: 'IRN not in books',
    atPush: 'Stays on the portal and is filed',
    badge: 'IRN not in books',
    full: 'IRN not in books — the e-invoice stays on the portal and is filed with the return',
    variant: 'warning',
    tone: 'warn',
  },
};

/** What the push does with one row, in a few words. */
const atPushOf = (r: EinvRecoRow): string => {
  if (r.status === 'pending') {
    return r.books ? 'Blocks the push (or uploaded without its IRN)' : 'Not in books, not on the draft yet: do not file until a pull shows it';
  }
  if (r.status === 'not_in_books') return 'Stays on the portal';
  if (r.status === 'mismatch' || r.status === 'number_differs') return 'Blocks the push';
  if (r.status === 'matched' || r.status === 'books_irn') return 'Left out (IRN kept)';
  if ((r.status === 'autopop_failed' || r.status === 'irn_lost') && !r.books) return 'Not in books, not on the draft with its IRN: missing from GSTR-1';
  return 'Uploaded';
};

/** A tile's second line, split where the books decide what happens. */
const tileHintOf = (s: EinvRecoStatus, rows: EinvRecoRow[], fallback: string): string => {
  if (s !== 'pending' && s !== 'autopop_failed' && s !== 'irn_lost') return fallback;
  const mine = rows.filter((r) => r.status === s);
  const withBooks = mine.filter((r) => r.books).length;
  const without = mine.length - withBooks;
  if (!without) return fallback;
  const n = (x: number) => x.toLocaleString('en-IN');
  if (s === 'pending') return `${n(withBooks)} block the push · ${n(without)} not in books`;
  return `${n(withBooks)} uploaded · ${n(without)} missing from GSTR-1`;
};

const TILE_ORDER: EinvRecoStatus[] = [
  'matched', 'books_irn', 'pending', 'not_einvoiced',
  'mismatch', 'number_differs', 'autopop_failed', 'irn_lost', 'not_in_books',
];

const SUM_KEY: Record<EinvRecoStatus, keyof ReturnType<typeof summariseReco>> = {
  matched: 'matched',
  mismatch: 'mismatch',
  number_differs: 'numberDiffers',
  books_irn: 'booksIrn',
  not_einvoiced: 'notEinvoiced',
  not_in_books: 'notInBooks',
  pending: 'pending',
  autopop_failed: 'autopopFailed',
  irn_lost: 'irnLost',
};

const SECTION_LABEL: Record<string, string> = {
  b2b: 'B2B', cdnr: 'CDNR', cdnur: 'CDNUR', exp: 'EXP', b2cl: 'B2CL',
};

const SOURCE_LABEL: Record<string, string> = { portal_gstr1: 'Pull', einvoice_excel: 'Excel' };

const AUTOPOP_LABEL: Record<string, string> = { done: 'Auto-populated', pending: 'Pending', failed: 'Failed' };

const taxOf = (d: EinvDoc | null) => (d ? d.igst + d.cgst + d.sgst + d.cess : null);

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

/** yyyy-mm-dd → "9 Oct 2026". */
const fmtDay = (iso: string) => {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : iso;
};

const pullLine = (p: EinvoicePullRow | null): { text: string; tone: 'muted' | 'warn' | 'error' } => {
  if (!p) return { text: 'E-invoices not pulled yet for this period: pull them today before pushing.', tone: 'warn' };
  const when = fmtWhen(p.pulled_at);
  const fresh = isPullFresh(p);
  const age = fresh ? ' · today' : ' · not today: pull again before pushing';
  // The date the portal generated the file the pull read (from its name).
  const file = p.generated_on ? ` · portal file generated ${fmtDay(p.generated_on)}` : '';
  switch (p.status) {
    case 'running':
      // A pull writes 'running' before its first record and its final status
      // after its last (extension 0.8.7): the push waits for it.
      return {
        text: `Pull in progress (started ${when}): wait for it to finish before pushing. If it was interrupted (its portal tab closed, `
          + 'or the connection dropped), pull again.',
        tone: 'warn',
      };
    case 'ok':
      return { text: `Pulled ${when} · ${p.docs_found.toLocaleString('en-IN')} IRN${p.docs_found === 1 ? '' : 's'} on the portal${file}${age}`, tone: fresh ? 'muted' : 'warn' };
    case 'none':
      return { text: `Pulled ${when} · no e-invoices on the portal for this period${file}${age}`, tone: fresh ? 'muted' : 'warn' };
    case 'stale':
      return {
        text: `Last pull (${when}): the portal served an old file${p.generated_on ? `, generated ${fmtDay(p.generated_on)}` : ''}: generate a fresh one. `
          + 'On the portal: Prepare Offline → Download → Generate JSON file to download, wait for it, then pull again. Nothing was saved from the old file.',
        tone: 'error',
      };
    case 'pending':
      return { text: `Pull pending (${when})${p.message ? ` — ${p.message}` : ' — the portal is still preparing the data; pull again shortly.'}`, tone: 'warn' };
    case 'failed':
      return { text: `Last pull failed (${when})${p.message ? ` — ${p.message}` : ''}`, tone: 'error' };
    default:
      return { text: `Pulled ${when} · ${p.status}${p.message ? ` — ${p.message}` : ''}`, tone: 'warn' };
  }
};

const excelLine = (x: EinvoicePullRow | null): string =>
  (x
    ? `E-invoice Excel imported ${fmtWhen(x.pulled_at)} · ${x.docs_found.toLocaleString('en-IN')} document${x.docs_found === 1 ? '' : 's'}`
    : 'No e-invoice Excel imported (the only source for pending, failed or lost IRNs).');

interface Props {
  /** reconcileEinvoice(books, records, { pulledAt }) for this client and period. */
  rows: EinvRecoRow[];
  /** planEinvoiceUpload(rows). */
  plan: EinvUploadPlan;
  /** Every stored e-invoice record (pull and Excel). */
  einvoiceDocs: EinvoiceDocRow[];
  /** Documents in the books JSON (B2B, CDNR, CDNUR, EXP, B2CL); null when nothing is imported. */
  booksDocCount: number | null;
  lastPull: EinvoicePullRow | null;
  lastExcel: EinvoicePullRow | null;
  /** Why this client is an e-invoice client (client_einvoice_evidence, or the tick). */
  reason: string | null;
  /** Set after a push that reached the portal and has no pull since: when it was pushed. */
  pushedWithoutRepull: string | null;
  loading?: boolean;
  /** Show Pull and Import (staff with filing-status edit rights). */
  canPull: boolean;
  extReady: boolean;
  pulling: boolean;
  importing: boolean;
  onPull: () => void;
  onImportExcel: () => void;
  clientName: string;
  /** MM/YYYY */
  periodMonth: string;
}

/**
 * E-invoice (IRN) reconciliation for one client + period: the books JSON
 * against the e-invoices on the portal (the pull) and on the IRP (the
 * e-invoice Excel), and what the push does with each document. E-invoices
 * a pull showed on the portal's draft with the same figures are left out of
 * the upload, so the portal keeps its own record with the IRN; one pending
 * auto-population is never left out. The app never writes an IRN into an
 * upload.
 */
const EinvoiceRecoPanel: React.FC<Props> = ({
  rows, plan, einvoiceDocs, booksDocCount, lastPull, lastExcel, reason, pushedWithoutRepull,
  loading, canPull, extReady, pulling, importing, onPull, onImportExcel, clientName, periodMonth,
}) => {
  const [filter, setFilter] = useState<Filter>('all');

  const sum = useMemo(() => summariseReco(rows), [rows]);
  const shown = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'einv') return rows.filter((r) => !!r.einv);
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);
  const bySource = useMemo(() => {
    const pulled = einvoiceDocs.filter((d) => (d.source ?? 'portal_gstr1') !== 'einvoice_excel').length;
    return { pulled, excel: einvoiceDocs.length - pulled };
  }, [einvoiceDocs]);

  const pull = pullLine(lastPull);
  const toggle = (f: Filter) => setFilter((cur) => (cur === f ? 'all' : f));
  const uploaded = booksDocCount == null ? null : Math.max(0, booksDocCount - plan.keepCount);

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
      Status: STATUS_LOOK[r.status].full,
      Notes: r.notes.join('; '),
      'At push': atPushOf(r),
      'E-invoice from': r.einv ? (SOURCE_LABEL[r.einv.source ?? 'portal_gstr1'] ?? r.einv.source ?? '') : (r.books?.irn ? 'Books JSON' : ''),
      IRN: r.einv?.irn || r.books?.irn || '',
      'IRN date': r.einv?.irn_date || '',
      'Auto-population': r.einv?.autopop_status ? (AUTOPOP_LABEL[r.einv.autopop_status] ?? r.einv.autopop_status) : '',
      'Auto-population date': r.einv?.autopop_date || '',
      Error: r.einv?.error || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'E-invoice reco');
    const safe = (clientName || 'client').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
    XLSX.writeFile(wb, `Einvoice_Reco_${safe}_${periodMonth.replace('/', '-')}.xlsx`);
  };

  const tile = (f: Filter, el: React.ReactNode, title: string) => (
    <button
      key={f}
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
      description={(
        <>
          {reason && <span className="block font-medium text-foreground">E-invoice client: {reason}</span>}
          <span className={cn('block', pull.tone === 'warn' && 'font-medium text-foreground', pull.tone === 'error' && 'text-destructive-strong')}>
            {pull.text}
          </span>
          <span className="block">{excelLine(lastExcel)}</span>
        </>
      )}
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
              onClick={onImportExcel}
              disabled={importing}
              title={'Import the GSTR-1 dashboard\'s "Download details from e-invoices (Excel)" for this period (.xlsx, or the .zip given for more than 500 documents)'}
            >
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
              Import e-invoice Excel
            </Button>
          )}
          {canPull && (
            <Button
              size="sm"
              variant="outline"
              className={WS_BTN}
              onClick={onPull}
              disabled={pulling || !extReady}
              title={extReady
                ? 'Download this period\'s GSTR-1 from the portal and store the e-invoices on it (IRNs). Needs extension 0.8.7 or later.'
                : 'GST Keeper browser extension not detected — install / enable it and reload this page'}
            >
              {pulling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Pull e-invoices
            </Button>
          )}
        </>
      )}
    >
      {pushedWithoutRepull && (
        <Note tone="warn">
          Pushed {fmtWhen(pushedWithoutRepull)}. Pull again to confirm the IRNs are intact: every document left out should
          still show on the portal with Source E-Invoice and its IRN.
        </Note>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {tile('einv', (
          <KpiTile
            label="E-invoice records"
            value={einvoiceDocs.length.toLocaleString('en-IN')}
            hint={`${bySource.pulled.toLocaleString('en-IN')} pulled · ${bySource.excel.toLocaleString('en-IN')} from Excel`}
          />
        ), 'Show documents with an e-invoice record')}
        {TILE_ORDER.map((s) => {
          const look = STATUS_LOOK[s];
          const n = sum[SUM_KEY[s]];
          return tile(s, (
            <KpiTile label={look.tile} value={n.toLocaleString('en-IN')} hint={tileHintOf(s, rows, look.atPush)} tone={n ? look.tone : 'neutral'} />
          ), `Show: ${look.full}`);
        })}
      </div>

      {plan.blockers.length > 0 && (
        <Note tone="warn">
          {plan.blockers.length.toLocaleString('en-IN')} document{plan.blockers.length === 1 ? ' blocks' : 's block'} the push.
          Correct the books to the e-invoice (or cancel and re-issue the IRN on the IRP within its window, or record the
          difference by a credit or debit note), and correct a books number to the e-invoice&apos;s. A different reverse
          charge, invoice type or e-commerce GSTIN counts as a difference: left out, the document would be filed as the
          e-invoice has it. The app never sends a changed document as if it were the e-invoice.
        </Note>
      )}

      {plan.pendingBlockers.length > 0 && (
        <Note tone="warn">
          {plan.pendingBlockers.length.toLocaleString('en-IN')} document{plan.pendingBlockers.length === 1 ? ' is' : 's are'} in
          the books with an e-invoice still pending auto-population: the portal&apos;s draft does not have{' '}
          {plan.pendingBlockers.length === 1 ? 'it' : 'them'} yet, so the push is blocked. To keep the IRN, pull again once the
          portal shows {plan.pendingBlockers.length === 1 ? 'it' : 'them'} (two days after the IRN), then push. The upload dialog
          also lets you upload {plan.pendingBlockers.length === 1 ? 'it' : 'them'} now from the books, without the IRN
          (GSTN para 3(c)).
        </Note>
      )}

      {plan.warnings.missingFromReturn.length > 0 && (() => {
        const k = plan.warnings.missingFromReturn.length;
        return (
          <Note tone="warn">
            {k.toLocaleString('en-IN')} e-invoice{k === 1 ? ' is' : 's are'} not among the IRN documents on the portal draft and
            not in the books: {k === 1 ? 'it' : 'they'} will be missing from GSTR-1 unless added to the books (or the IRN was
            cancelled). If {k === 1 ? 'it is' : 'they are'} on the portal without {k === 1 ? 'its' : 'their'} IRN,{' '}
            {k === 1 ? 'it' : 'they'} will be filed as uploaded.
          </Note>
        );
      })()}

      <Note tone="info">
        On push, {plan.keepCount.toLocaleString('en-IN')} document{plan.keepCount === 1 ? '' : 's'} on the portal as
        e-invoices {plan.keepCount === 1 ? 'is' : 'are'} left out so the portal keeps {plan.keepCount === 1 ? 'its' : 'their'} IRN
        {uploaded != null ? `; ${uploaded.toLocaleString('en-IN')} will be uploaded from the books` : ''}. Only a document
        a pull showed on the draft (or one carrying its own IRN) is left out; one still pending auto-population never is.
        Table 12 (HSN) and Table 13 always go in full. An uploaded copy would overwrite the e-invoice and drop its IRN, so the
        app never re-sends one and never writes an IRN into an upload. Changed after IRN, number differs and pending
        auto-population block the push; the plan rests on a pull taken today, of a file the portal generated today.
        {booksDocCount == null ? ' No JSON is imported for this period, so every e-invoice shows as not in books.' : ''}
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
              <th className={WS_TH}>At push</th>
              <th className={WS_TH}>IRN</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className={cn(WS_TD, 'py-6 text-center text-muted-foreground')} colSpan={12}>
                  <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> Loading e-invoices…
                </td>
              </tr>
            ) : shown.length === 0 ? (
              <tr>
                <td className={cn(WS_TD, 'py-6 text-center text-muted-foreground')} colSpan={12}>
                  {rows.length === 0 ? 'No e-invoiceable documents in the books and no e-invoice records for this period.' : 'No documents in this group.'}
                </td>
              </tr>
            ) : shown.map((r) => {
              const look = STATUS_LOOK[r.status];
              const irn = r.einv?.irn || r.books?.irn || '';
              const from = r.einv ? (SOURCE_LABEL[r.einv.source ?? 'portal_gstr1'] ?? r.einv.source) : (r.books?.irn ? 'Books JSON' : null);
              const notes = [...r.differences, ...r.notes, ...(r.einv?.error ? [`Error: ${r.einv.error}`] : [])];
              const blocks = r.status === 'mismatch' || r.status === 'number_differs';
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
                  <td className={cn(WS_TD, 'min-w-[12rem] text-xs', blocks && 'text-destructive-strong')}>
                    {notes.length ? notes.join(' · ') : '—'}
                  </td>
                  <td className={cn(WS_TD, 'whitespace-nowrap')}>
                    <Badge variant={look.variant} className="px-1.5 text-[10px] font-medium" title={look.full}>{look.badge}</Badge>
                  </td>
                  <td className={cn(WS_TD, 'whitespace-nowrap text-xs', blocks && 'font-medium text-destructive-strong')}>{atPushOf(r)}</td>
                  <td className={cn(WS_TD, 'max-w-[11rem] truncate font-mono text-xs')} title={irn ? `${irn}${from ? ` (${from})` : ''}` : undefined}>
                    {irn ? `${irn.slice(0, 12)}…` : '—'}
                    {from && <span className="ml-1 font-sans text-[10px] text-muted-foreground">{from}</span>}
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
