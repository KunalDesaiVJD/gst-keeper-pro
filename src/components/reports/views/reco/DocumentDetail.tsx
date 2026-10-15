// One document pair opened under its row: both documents field by field (a
// field the two sides disagree on is marked), the difference per head, and the
// reconciliation's reading of it (reason, evidence, what to do, flags). Only
// drawn for a row someone opens, so it may be thorough.
import React from 'react';
import { ArrowRightLeft, CheckCircle2, CircleHelp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { monthLabel } from '@/lib/itcReco/dates';
import { facetLabel } from '@/lib/itcReco/filters';
import type { RecoSideView, RecoViewData, RecoViewRow } from '@/lib/itcReco/viewTypes';
import { DiffText, StatusBadge } from './shared';
import { fmtAmt, fmtIso } from './format';

type Side = RecoSideView | null;

const yesNo = (v: boolean | null | undefined): string => (v === true ? 'Yes' : v === false ? 'No' : '');
const ITC_WHY: Record<string, string> = { P: 'place of supply', C: 'time limit' };
const itcText = (s: Side, data: RecoViewData): string => {
  if (!s || !s.itc) return '';
  const base = facetLabel('itc', s.itc, data);
  const why = s.itcReason ? ITC_WHY[s.itcReason.toUpperCase()] ?? s.itcReason : '';
  return why ? `${base} (${why})` : base;
};

interface TextLine { label: string; get: (s: NonNullable<Side>) => string; mono?: boolean; num?: boolean }
// Grouped as a reviewer reads a document: what it is, how the supplier filed it, then the figures.
const DOC_LINES: TextLine[] = [
  { label: 'Document number', get: (s) => s.number, mono: true },
  { label: 'Document date', get: (s) => fmtIso(s.date) },
  { label: 'Document type', get: (s) => s.docType },
  { label: 'Section', get: (s) => s.section },
  { label: 'Amends', get: (s) => (s.original ? [s.original.number, fmtIso(s.original.date)].filter(Boolean).join(' dated ') : ''), mono: true },
  { label: 'Statement month', get: (s) => monthLabel(s.statementPeriod) },
  { label: 'Place of supply', get: (s) => s.pos ?? '' },
  { label: 'Reverse charge', get: (s) => (s.reverseCharge ? 'Yes' : 'No') },
  { label: 'Document value', get: (s) => fmtAmt(s.docValue), num: true },
  { label: 'Rate', get: (s) => (s.rate === null ? '' : `${s.rate}%`), num: true },
];
const FILING_LINES: TextLine[] = [
  { label: "Supplier's return period", get: (s) => monthLabel(s.supplierPeriod) },
  { label: 'Supplier filed on', get: (s) => fmtIso(s.supplierFiledOn) },
  { label: 'GSTR-1 / IFF filed', get: (s) => yesNo(s.supplierFiled) },
  { label: "Supplier's GSTR-3B filed", get: (s) => yesNo(s.supplier3bFiled) },
  { label: 'Registration cancelled from', get: (s) => fmtIso(s.supplierCancelledFrom) },
];
const AMOUNT_LINES: { label: string; key: 'taxable' | 'igst' | 'cgst' | 'sgst' | 'cess' | 'tax' }[] = [
  { label: 'Taxable value', key: 'taxable' },
  { label: 'IGST', key: 'igst' },
  { label: 'CGST', key: 'cgst' },
  { label: 'SGST', key: 'sgst' },
  { label: 'Cess', key: 'cess' },
  { label: 'Total tax', key: 'tax' },
];

const TH = 'border-b bg-muted px-2.5 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/70';
const TD = 'border-b px-2.5 py-1 align-top';

/** A band naming the group of fields under it. */
const Group: React.FC<{ label: string }> = ({ label }) => (
  <tr>
    <td colSpan={4} className="border-b bg-muted/50 px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-foreground/60">{label}</td>
  </tr>
);

/** One field on both sides; marked when the two documents disagree on it. Left out when neither has it. */
const TextRow: React.FC<{ line: TextLine; l: Side; r: Side }> = ({ line, l, r }) => {
  const a = l ? line.get(l) : '';
  const b = r ? line.get(r) : '';
  if (!a && !b) return null;
  const differs = !!(l && r && a !== b);
  return (
    <tr className={cn(differs && 'bg-destructive/[0.05]')}>
      <td className={cn(TD, 'text-muted-foreground')}>{line.label}</td>
      <td className={cn(TD, line.mono && 'font-mono', line.num && 'text-right tabular-nums', differs && 'font-semibold')}>{a}</td>
      <td className={cn(TD, line.mono && 'font-mono', line.num && 'text-right tabular-nums', differs && 'font-semibold text-destructive-strong')}>{b}</td>
      <td className={cn(TD, 'text-right text-[11px] font-medium text-destructive-strong')}>{differs ? 'Differs' : ''}</td>
    </tr>
  );
};

export const DocumentDetail: React.FC<{ row: RecoViewRow; data: RecoViewData }> = ({ row, data }) => {
  const L = data.left.label;
  const R = data.right.label;
  const l = row.left;
  const r = row.right;
  // ITC is the right-hand statement's word; the 2A states none.
  const itcLine = { l: itcText(l, data), r: itcText(r, data) };
  const extra = [
    { label: 'IMS status', l: l?.imsStatus ?? '', r: r?.imsStatus ?? '' },
    { label: 'IRN', l: l?.irn ?? '', r: r?.irn ?? '', mono: true },
  ];
  return (
    <div className="grid gap-3 px-3 py-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" role="region" aria-label={`Details of document ${row.number}`}>
      <div className="overflow-hidden rounded-md border bg-card">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className={cn(TH, 'w-[30%]')}>Field</th>
              <th className={cn(TH, 'w-[24%]')}>GSTR-{L}{!l && <span className="ml-1 font-normal normal-case text-muted-foreground">(not in {L})</span>}</th>
              <th className={cn(TH, 'w-[24%]')}>GSTR-{R}{!r && <span className="ml-1 font-normal normal-case text-muted-foreground">(not in {R})</span>}</th>
              <th className={cn(TH, 'text-right')}>Difference</th>
            </tr>
          </thead>
          <tbody>
            <Group label="Document" />
            {DOC_LINES.map((line) => <TextRow key={line.label} line={line} l={l} r={r} />)}
            <Group label="Supplier's filing" />
            {FILING_LINES.map((line) => <TextRow key={line.label} line={line} l={l} r={r} />)}
            <Group label={`Figures (${R} minus ${L} under Difference)`} />
            {AMOUNT_LINES.map((line) => {
              const a = l ? l[line.key] : null;
              const b = r ? r[line.key] : null;
              if (line.key === 'cess' && !a && !b) return null;
              const d = row.diff ? row.diff[line.key] : null;
              const strong = line.key === 'tax';
              return (
                <tr key={line.key} className={cn(strong && 'font-semibold')}>
                  <td className={cn(TD, 'text-muted-foreground', strong && 'text-foreground')}>{line.label}</td>
                  <td className={cn(TD, 'text-right tabular-nums', strong && 'border-t border-t-foreground/30')}>{fmtAmt(a)}</td>
                  <td className={cn(TD, 'text-right tabular-nums', strong && 'border-t border-t-foreground/30')}>{fmtAmt(b)}</td>
                  <td className={cn(TD, 'text-right', strong && 'border-t border-t-foreground/30')}><DiffText v={d} tolerance={data.tolerance} /></td>
                </tr>
              );
            })}
            {(itcLine.l || itcLine.r || extra.some((e) => e.l || e.r)) && <Group label="ITC" />}
            {(itcLine.l || itcLine.r) && (
              <tr>
                <td className={cn(TD, 'text-muted-foreground')}>ITC in {R}</td>
                <td className={TD}>{itcLine.l}</td>
                <td className={cn(TD, r && r.itc !== 'available' && 'font-semibold text-destructive-strong')}>{itcLine.r}</td>
                <td className={TD} />
              </tr>
            )}
            {extra.filter((e) => e.l || e.r).map((e) => (
              <tr key={e.label}>
                <td className={cn(TD, 'text-muted-foreground')}>{e.label}</td>
                <td className={cn(TD, e.mono && 'break-all font-mono text-[10.5px]')}>{e.l}</td>
                <td className={cn(TD, e.mono && 'break-all font-mono text-[10.5px]')}>{e.r}</td>
                <td className={TD} />
              </tr>
            ))}
          </tbody>
        </table>
        {!row.diff && (
          <p className="border-t bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            Not compared: the {L} pull does not read this section, so no difference is worked out.
          </p>
        )}
      </div>

      <div className="space-y-2.5 rounded-md border bg-card p-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={row.status} label={row.statusLabel} />
          <span className="text-[13px] font-semibold leading-snug">{row.reasonLabel}</span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{row.supplierName || 'Imports (no GSTIN)'}</span>
          {row.ctin && <span className="ml-1.5 font-mono">{row.ctin}</span>}
          <span className="ml-1.5">· reconciled for {monthLabel(row.period)}</span>
        </div>
        {row.detail && <p className="leading-relaxed">{row.detail.charAt(0).toUpperCase() + row.detail.slice(1)}.</p>}
        <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2">
          {row.evidence && (
            <>
              <dt className="font-semibold text-muted-foreground">Evidence</dt>
              <dd className="flex items-start gap-1.5">
                {row.confirmed === true && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-strong" aria-label="Confirmed" />}
                {row.confirmed === false && <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" aria-label="Not confirmed" />}
                <span>{row.evidence}</span>
              </dd>
            </>
          )}
          <dt className="font-semibold text-muted-foreground">What to do</dt>
          <dd className="font-medium leading-relaxed">{row.action}</dd>
          {row.refPeriod && (
            <>
              <dt className="font-semibold text-muted-foreground">Relies on</dt>
              <dd>The statements of {monthLabel(row.refPeriod)}</dd>
            </>
          )}
          {(row.viaAmendment || row.dateDiffers) && (
            <>
              <dt className="font-semibold text-muted-foreground">Paired</dt>
              <dd className="flex items-start gap-1.5">
                <ArrowRightLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>
                  {row.viaAmendment ? "Through the amendment's original document number" : 'By number'}
                  {row.dateDiffers ? '; the two dates differ' : ''}
                </span>
              </dd>
            </>
          )}
          {row.notes.length > 0 && (
            <>
              <dt className="font-semibold text-muted-foreground">Also note</dt>
              <dd>
                <ul className="space-y-1">
                  {row.notes.map((n, i) => (
                    <li key={`${n.code}${i}`}>
                      {/* A note's sentence often opens with its own label; print the label once. */}
                      {n.text.toLowerCase().startsWith(n.label.toLowerCase()) ? n.text : <><span className="font-semibold">{n.label}:</span> {n.text}</>}
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
};
