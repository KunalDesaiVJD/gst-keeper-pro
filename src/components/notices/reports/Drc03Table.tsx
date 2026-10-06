// The DRC-03 ledger's rows (audit U-77-1..4): client · ARN · cause · period ·
// total paid · status · against · PDF, the client column pinned while the
// table scrolls, the tax heads and the cash / credit split in a row that opens
// under the payment, "—" for anything not captured (a case-only row says
// "details not fetched"; the page fetches them), and what the payment settles: the
// notice or matter it is linked to, else the one it most likely settles, linked
// with one click. A table from lg up, cards below.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { fmtDate, fmtFy, fmtInr, sentenceCase } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import { SortHead } from './ReportBits';
import { periodText, type Drc03Row, type Heads, type NoticeRef } from './ledgerData';

export type Drc03Sort = 'filed' | 'client' | 'total';

const noticeShort = (n: NoticeRef) => `${n.form_code ?? 'Notice'}${n.financial_year ? ` · FY ${fmtFy(n.financial_year)}` : ''}`;

const HEADS: { k: keyof Heads; label: string }[] = [
  { k: 'igst', label: 'IGST' }, { k: 'cgst', label: 'CGST' }, { k: 'sgst', label: 'SGST' }, { k: 'cess', label: 'Cess' },
  { k: 'interest', label: 'Interest' }, { k: 'lateFee', label: 'Late fee' }, { k: 'penalty', label: 'Penalty' },
];

export interface Drc03TableProps {
  rows: Drc03Row[];
  showClient: boolean;
  sort: Drc03Sort;
  dir: 'asc' | 'desc';
  onSort: (k: Drc03Sort) => void;
  total: number;
  /** Links the payment to the suggested notice (notice_payments). */
  onLink?: (row: Drc03Row, notice: NoticeRef) => void;
  linking?: string | null;
}

const Split: React.FC<{ r: Drc03Row; id: string }> = ({ r, id }) => (
  <div id={id} className="space-y-1.5">
    {r.heads ? (
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3 lg:grid-cols-9">
        {HEADS.map((h) => (
          <div key={h.k}><dt className="text-muted-foreground">{h.label}</dt><dd className="tabular-nums">{r.heads?.[h.k] === null ? '—' : fmtInr(r.heads?.[h.k])}</dd></div>
        ))}
        <div><dt className="text-muted-foreground">Paid in cash</dt><dd className="tabular-nums">{r.cash === null ? '—' : fmtInr(r.cash)}</dd></div>
        <div><dt className="text-muted-foreground">From credit</dt><dd className="tabular-nums">{r.credit === null ? '—' : fmtInr(r.credit)}</dd></div>
      </dl>
    ) : <p className="text-xs text-muted-foreground">Tax heads not fetched: only the portal case is on record.</p>}
    <p className="text-[11px] text-muted-foreground">
      {r.section ? `${r.section} · ` : ''}{r.fy ? `FY ${fmtFy(r.fy)} · ` : ''}The portal sync books mixed cash-and-credit lines to cash, so the split can understate credit.
    </p>
  </div>
);

export const Drc03Table: React.FC<Drc03TableProps> = ({ rows, showClient, sort, dir, onSort, total, onLink, linking }) => {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const arn = (r: Drc03Row) => {
    const a = r.fact.arn;
    if (!a) return <span className="text-muted-foreground">ARN not captured</span>;
    if (r.hasFolder) {
      return (
        <Link to={`/notices-case-folder/${r.fact.client_id}/${encodeURIComponent(a)}`} className="font-mono font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">
          <span className="sr-only">Case folder </span>{a}
        </Link>
      );
    }
    if (r.caseNotice) {
      return (
        <Link to={`/notices/${r.caseNotice.id}`} className="font-mono font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">
          <span className="sr-only">Open the case </span>{a}
        </Link>
      );
    }
    return <span className="font-mono font-medium">{a}</span>;
  };

  const amount = (r: Drc03Row, id: string) => (r.total === null ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <button type="button" onClick={() => toggle(r.key)} aria-expanded={open.has(r.key)} aria-controls={open.has(r.key) ? id : undefined}
      className="inline-flex items-center gap-1 rounded font-medium tabular-nums hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="sr-only">Tax heads of {r.fact.arn}: </span>{fmtInr(r.total)}
      {open.has(r.key) ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
    </button>
  ));

  const against = (r: Drc03Row) => {
    const { notices, matters } = r.against;
    if (notices.length || matters.length) {
      return (
        <span className="flex flex-col gap-0.5 text-xs">
          {notices.map((n) => (
            <span key={n.id}>
              <Link to={`/notices/${n.id}?tab=payments`} className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">
                <span className="sr-only">Paid against </span>{noticeShort(n)}
              </Link>
              {n.reference_number ? <span className="block font-mono text-[11px] text-muted-foreground">{n.reference_number}</span> : null}
            </span>
          ))}
          {matters.map((m) => (
            <Link key={m.id} to={`/litigation/${m.id}`} className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">
              <span className="sr-only">Paid against matter </span>{m.matter_no}
            </Link>
          ))}
        </span>
      );
    }
    const s = r.suggestion;
    if (!s) return <span className="text-xs text-muted-foreground">{r.fact.origin === 'case' ? '—' : 'no likely notice'}</span>;
    if (s.kind === 'matter') {
      return (
        <span className="text-xs">
          <span className="text-muted-foreground">Likely pre-deposit on </span>
          <Link to={`/litigation/${s.matter.id}`} className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">{s.matter.matter_no}</Link>
          <span className="block text-[11px] text-muted-foreground">record it on the matter</span>
        </span>
      );
    }
    const n = s.notice;
    return (
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
        <span>
          <span className="text-muted-foreground">Likely </span>
          <Link to={`/notices/${n.id}`} className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">{noticeShort(n)}</Link>
          {n.reference_number ? <span className="block font-mono text-[11px] text-muted-foreground">{n.reference_number}</span> : null}
        </span>
        {onLink && (
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={linking === r.key} onClick={() => onLink(r, n)}>
            Link<span className="sr-only"> {r.fact.arn} to {noticeShort(n)}</span>
          </Button>
        )}
      </span>
    );
  };

  const status = (r: Drc03Row) => (
    <span className="flex flex-col items-start gap-1">
      <Badge variant={r.state.tone} className="whitespace-nowrap text-[11px] font-medium">{r.state.label}</Badge>
      {r.state.group === 'nodetails' && <span className="text-[11px] text-muted-foreground">fills in on the next DRC-03 fetch</span>}
    </span>
  );

  const pdf = (r: Drc03Row) => (r.fact.pdf_url ? (
    <a href={r.fact.pdf_url} target="_blank" rel="noreferrer" className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Open the DRC-03 PDF for ${r.fact.arn ?? r.fact.client_name} (opens in a new tab)`}>
      <FileText className="h-4 w-4 text-primary" aria-hidden />
    </a>
  ) : <span className="text-xs text-muted-foreground">none</span>);

  const cols = 7 + (showClient ? 1 : 0);
  const stick = 'sticky left-0 z-[1] bg-card';

  return (
    <>
      {/* Phones and tablets: cards. */}
      <ul className="space-y-2 lg:hidden">
        {rows.map((r) => {
          const id = `drc03-m-${r.key}`;
          return (
            <li key={r.key} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {showClient && <Link to={`/notices-company/${r.fact.client_id}`} className="block truncate text-sm font-semibold hover:underline">{r.fact.client_name}</Link>}
                  <div className="text-sm">{arn(r)}</div>
                </div>
                {status(r)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {r.fact.cause_of_payment ? sentenceCase(r.fact.cause_of_payment) : 'Cause not captured'} · paid {fmtDate(r.fact.filed_date)}
                {periodText(r) ? ` · ${periodText(r)}` : ''}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <div><dt className="text-muted-foreground">Total paid</dt><dd>{amount(r, id)}</dd></div>
                <div><dt className="text-muted-foreground">PDF</dt><dd>{pdf(r)}</dd></div>
                <div className="col-span-2"><dt className="text-muted-foreground">Against</dt><dd>{against(r)}</dd></div>
              </dl>
              {open.has(r.key) && <div className="mt-2 border-t pt-2"><Split r={r} id={id} /></div>}
            </li>
          );
        })}
      </ul>

      <div className={cn(WS_TABLE_WRAP, 'hidden lg:block')}>
        <table className={WS_TABLE}>
          <thead>
            <tr>
              {showClient && <SortHead label="Client" k="client" sort={sort} dir={dir} onSort={onSort} className="left-0 z-20" />}
              <SortHead label="ARN · paid on" k="filed" sort={sort} dir={dir} onSort={onSort} className={showClient ? undefined : 'left-0 z-20'} />
              <th scope="col" className={WS_TH}>Cause</th>
              <th scope="col" className={WS_TH}>Period</th>
              <SortHead label="Total paid" k="total" sort={sort} dir={dir} onSort={onSort} right />
              <th scope="col" className={WS_TH}>Status</th>
              <th scope="col" className={WS_TH}>Against</th>
              <th scope="col" className={cn(WS_TH, 'w-12')}>PDF</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const id = `drc03-d-${r.key}`;
              return (
                <React.Fragment key={r.key}>
                  <tr className={WS_TR}>
                    {showClient && (
                      <td className={cn(WS_TD, stick, 'max-w-[13rem]')}>
                        <Link to={`/notices-company/${r.fact.client_id}`} className="block truncate font-medium hover:underline">{r.fact.client_name}</Link>
                        <div className="font-mono text-[11px] text-muted-foreground">{r.fact.client_gstin}</div>
                      </td>
                    )}
                    <td className={cn(WS_TD, 'whitespace-nowrap', !showClient && stick)}>
                      {arn(r)}
                      <div className="text-xs text-muted-foreground">paid {fmtDate(r.fact.filed_date)}</div>
                    </td>
                    <td className={cn(WS_TD, 'min-w-[12rem] max-w-[18rem]')}>
                      <div className="line-clamp-2 text-xs">{r.fact.cause_of_payment ? sentenceCase(r.fact.cause_of_payment) : <span className="text-muted-foreground">not captured</span>}</div>
                      {r.section && <div className="text-[11px] text-muted-foreground">{r.section}</div>}
                    </td>
                    <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>
                      {periodText(r) ?? <span className="text-muted-foreground">—</span>}
                      {r.fy && <div className="text-[11px] text-muted-foreground">FY {fmtFy(r.fy)}</div>}
                    </td>
                    <td className={WS_TD_NUM}>{amount(r, id)}</td>
                    <td className={WS_TD}>{status(r)}</td>
                    <td className={cn(WS_TD, 'min-w-[11rem]')}>{against(r)}</td>
                    <td className={WS_TD}>{pdf(r)}</td>
                  </tr>
                  {open.has(r.key) && (
                    <tr className="bg-muted/30">
                      <td className={WS_TD} colSpan={cols}><Split r={r} id={id} /></td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className={WS_TR_TOTAL}>
              <th scope="row" className={cn(WS_TD, 'text-left')} colSpan={showClient ? 4 : 3}>Total of the amounts captured</th>
              <td className={WS_TD_NUM}>{fmtInr(total)}</td>
              <td className={WS_TD} colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
};

export default Drc03Table;
