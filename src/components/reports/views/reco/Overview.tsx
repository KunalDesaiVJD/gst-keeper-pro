// The top of the reconciliation view: the identification strip (client, GSTIN,
// months, when each statement was pulled), the figures across the top, a bar
// of how the documents split by status, and the notes. The figures and the bar
// count the filtered documents, so they always agree with the tabs below; a
// figure says "of N" once a filter leaves out part of the report.
import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, ChevronDown, CircleSlash } from 'lucide-react';
import { KpiTile } from '@/components/gstr9/ui';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { dayLabel, monthLabel } from '@/lib/itcReco/dates';
import { STATUS_BUCKETS } from '@/lib/itcReco/filters';
import { statusLabel } from '@/lib/itcReco/reasons';
import type { RecoStatus } from '@/lib/itcReco/types';
import { sideTotals, statusCounts } from '@/lib/itcReco/viewModel';
import type { RecoViewData, RecoViewRow } from '@/lib/itcReco/viewTypes';
import { STATUS_FILL, bucketCounts, fmtAmt, fmtCountPlain, pct } from './format';

/** "Jul 2025", or "Apr 2025 to Mar 2026 (12 months)" (the report's own wording). */
const periodText = (periods: string[]): string => {
  if (!periods.length) return 'none built';
  if (periods.length === 1) return monthLabel(periods[0]);
  return `${monthLabel(periods[0])} to ${monthLabel(periods[periods.length - 1])} (${periods.length} months)`;
};

const dayRange = (isos: (string | null)[]): string => {
  const known = [...new Set(isos.filter((d): d is string => !!d).map((d) => d.slice(0, 10)))].sort();
  if (!known.length) return 'unknown';
  return known.length === 1 ? dayLabel(known[0]) : `${dayLabel(known[0])} to ${dayLabel(known[known.length - 1])}`;
};

const Field: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className }) => (
  <div className={cn('min-w-0 px-3 py-1.5', className)}>
    <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
    <div className="truncate text-[13px] font-semibold leading-snug text-foreground">{children}</div>
  </div>
);

/** A. Client, GSTIN, the months, and as of when each statement was pulled (per month behind a pop-over). */
export const HeaderStrip: React.FC<{ data: RecoViewData }> = ({ data }) => {
  const L = data.left.label;
  const R = data.right.label;
  const single = data.statements.length === 1 ? data.statements[0] : null;
  return (
    <div className="flex flex-wrap items-stretch divide-x rounded-md border border-l-4 border-l-primary bg-card">
      <Field label="Client" className="max-w-[420px]">{data.client.name || 'Client'}</Field>
      <Field label="GSTIN"><span className="font-mono">{data.client.gstin || 'not on record'}</span></Field>
      <Field label="Period">{data.fy ? `FY ${data.fy}` : periodText(data.periods)}</Field>
      <Field label={`${L} pulled`}>{single ? dayLabel(single.leftPulledAt) : dayRange(data.statements.map((s) => s.leftPulledAt))}</Field>
      <Field label={`${R} generated`}>{single ? dayLabel(single.rightGeneratedOn) : dayRange(data.statements.map((s) => s.rightGeneratedOn))}</Field>
      <Field label="Tolerance">₹{data.tolerance.toFixed(2)} per head</Field>
      {data.failed.length > 0 && (
        <Field label="Not built" className="text-destructive-strong">
          <span className="text-destructive-strong">{data.failed.map((f) => monthLabel(f.period)).join(', ')}</span>
        </Field>
      )}
      {data.statements.length > 1 && (
        <div className="flex items-center px-3">
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> As of, by month
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto p-0">
              <table className="border-separate border-spacing-0 text-xs">
                <thead>
                  <tr>
                    {['Month', `${L} pulled`, `${R} generated`].map((h) => (
                      <th key={h} className="border-b bg-muted px-3 py-1.5 text-left font-semibold text-foreground/75">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.statements.map((s) => (
                    <tr key={s.period}>
                      <td className="border-b px-3 py-1 font-medium">{monthLabel(s.period)}</td>
                      <td className="border-b px-3 py-1 tabular-nums">{dayLabel(s.leftPulledAt)}</td>
                      <td className="border-b px-3 py-1 tabular-nums">{dayLabel(s.rightGeneratedOn)}</td>
                    </tr>
                  ))}
                  {data.failed.map((f) => (
                    <tr key={`f${f.period}`} className="text-destructive-strong">
                      <td className="border-b px-3 py-1 font-medium">{monthLabel(f.period)}</td>
                      <td colSpan={2} className="max-w-[320px] border-b px-3 py-1">Not built: {f.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PopoverContent>
          </Popover>
        </div>
      )}
    </div>
  );
};

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((v) => b.includes(v));

/**
 * A figure that filters: a button around the house KpiTile, pressed while its
 * statuses are the status filter. With no statuses (Documents) it is a plain
 * button that clears the status filter, never a toggle.
 */
const Tile: React.FC<{
  label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'ok' | 'warn' | 'error' | 'neutral';
  statuses?: RecoStatus[]; active?: RecoStatus[]; onStatuses?: (s: RecoStatus[]) => void;
}> = ({ label, value, hint, tone, statuses, active, onStatuses }) => {
  if (!statuses || !onStatuses) return <KpiTile label={label} value={value} hint={hint} tone={tone} />;
  const pressed = !!active && (statuses.length ? sameSet(active, statuses) : false);
  return (
    <button
      type="button"
      aria-pressed={statuses.length ? pressed : undefined}
      onClick={() => onStatuses(pressed || !statuses.length ? [] : statuses)}
      title={statuses.length ? (pressed ? 'Show every status' : `Show only ${label.toLowerCase()}`) : 'Show every status'}
      className={cn(
        'rounded-lg text-left transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:shadow-sm [&>div]:h-full',
        pressed && 'ring-2 ring-primary ring-offset-1',
      )}
    >
      <KpiTile label={label} value={value} hint={hint} tone={tone} />
    </button>
  );
};

/** B. The nine figures; the status ones filter by their status when clicked. */
export const KpiBand: React.FC<{
  data: RecoViewData; rows: RecoViewRow[]; filtering: boolean; active: string[]; onStatuses: (s: RecoStatus[]) => void;
}> = ({ data, rows, filtering, active, onStatuses }) => {
  const L = data.left.label;
  const R = data.right.label;
  const all = useMemo(() => bucketCounts(statusCounts(data.rows)), [data.rows]);
  const c = useMemo(() => bucketCounts(statusCounts(rows)), [rows]);
  const lt = useMemo(() => sideTotals(rows, 'left'), [rows]);
  const rt = useMemo(() => sideTotals(rows, 'right'), [rows]);
  const net = useMemo(() => Math.round(rows.reduce((s, r) => s + (r.diff ? r.diff.tax : 0), 0) * 100) / 100, [rows]);
  const n = rows.length;
  const sub = (k: keyof typeof all) => (filtering ? `of ${fmtCountPlain(all[k])} · ${pct(c[k], n)}` : pct(c[k], n));
  const act = active as RecoStatus[];
  const problem = (k: number) => (k ? 'warn' : 'ok');
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-9">
      <Tile
        label="Documents" value={fmtCountPlain(n)} statuses={[]} active={act} onStatuses={onStatuses}
        hint={filtering ? `of ${fmtCountPlain(data.rows.length)}` : `${fmtCountPlain(lt.docs)} in ${L}, ${fmtCountPlain(rt.docs)} in ${R}`}
      />
      <Tile
        label="Matched" value={fmtCountPlain(c.matched)} tone="ok" statuses={['matched']} active={act} onStatuses={onStatuses}
        hint={(
          <span className="flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <span className="block h-full rounded-full bg-success" style={{ width: n ? `${(c.matched / n) * 100}%` : 0 }} />
            </span>
            <span className="tabular-nums">{sub('matched')}</span>
          </span>
        )}
      />
      <Tile label={`Only in ${L}`} value={fmtCountPlain(c.only_left)} tone={problem(c.only_left)} statuses={['only_left']} active={act} onStatuses={onStatuses} hint={sub('only_left')} />
      <Tile label={`Only in ${R}`} value={fmtCountPlain(c.only_right)} tone={problem(c.only_right)} statuses={['only_right']} active={act} onStatuses={onStatuses} hint={sub('only_right')} />
      <Tile
        label="Figures differ" value={fmtCountPlain(c.differs)} tone={c.differs ? 'error' : 'ok'} statuses={['differs', 'itc_differs']} active={act} onStatuses={onStatuses}
        hint={(() => { const itc = rows.reduce((s, r) => s + (r.status === 'itc_differs' ? 1 : 0), 0); return itc ? `incl. ${fmtCountPlain(itc)} ITC differs` : sub('differs'); })()}
      />
      <Tile label="Not compared" value={fmtCountPlain(c.not_compared)} statuses={['not_compared']} active={act} onStatuses={onStatuses} hint={filtering || !c.not_compared ? sub('not_compared') : `not read by the ${L} pull`} />
      <Tile label={`${L} tax`} value={fmtAmt(lt.tax)} hint={`${fmtCountPlain(lt.docs)} documents`} />
      <Tile label={`${R} tax`} value={fmtAmt(rt.tax)} hint={`${fmtCountPlain(rt.docs)} documents`} />
      <Tile label="Net difference" value={fmtAmt(net)} tone={Math.abs(net) > data.tolerance ? 'error' : 'ok'} hint={`${R} minus ${L}`} />
    </div>
  );
};

/** C. How the shown documents split by status: one bar, and a legend that filters. */
export const StatusBar: React.FC<{ data: RecoViewData; rows: RecoViewRow[]; active: string[]; onStatuses: (s: RecoStatus[]) => void }> = ({ data, rows, active, onStatuses }) => {
  const c = useMemo(() => bucketCounts(statusCounts(rows)), [rows]);
  const n = rows.length;
  const segs = STATUS_BUCKETS.map((b) => ({
    ...b,
    status: b.statuses[0],
    label: b.key === 'differs' ? 'Figures differ' : statusLabel(b.statuses[0], data.left.label, data.right.label),
    n: c[b.key as keyof typeof c],
  }));
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border bg-card px-3 py-2">
      <div className="flex h-2.5 min-w-[240px] flex-1 overflow-hidden rounded-full bg-muted" role="img" aria-label={segs.map((s) => `${s.label} ${s.n}`).join(', ')}>
        {segs.filter((s) => s.n > 0).map((s) => (
          <div key={s.key} className={cn('h-full border-r border-card last:border-r-0', STATUS_FILL[s.status])} style={{ width: `${(s.n / n) * 100}%` }} title={`${s.label}: ${fmtCountPlain(s.n)} (${pct(s.n, n)})`} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
        {segs.map((s) => {
          const pressed = sameSet(active, s.statuses);
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={pressed}
              onClick={() => onStatuses(pressed ? [] : s.statuses)}
              className={cn('inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', pressed && 'bg-primary/[0.08] font-semibold', !s.n && 'opacity-50')}
            >
              <span className={cn('h-2.5 w-2.5 rounded-sm', STATUS_FILL[s.status])} aria-hidden="true" />
              {s.label}
              <span className="tabular-nums text-muted-foreground">{fmtCountPlain(s.n)} · {pct(s.n, n)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/** D. The "could not confirm / not compared" lines and the months that could not be built; folded when there are more than three. */
export const NotesPanel: React.FC<{ data: RecoViewData }> = ({ data }) => {
  const many = data.periods.length + data.failed.length > 1;
  const lines = useMemo(() => {
    const idx = (p: string) => { const m = /^(\d{2})\/(\d{4})$/.exec(p); return m ? Number(m[2]) * 12 + Number(m[1]) : 0; };
    return [
      ...data.failed.map((f) => ({ period: f.period, text: `Not built: ${f.reason}`, failed: true })),
      ...data.notes.map((n) => ({ ...n, failed: false })),
    ].map((l, i) => ({ ...l, i })).sort((a, b) => idx(a.period) - idx(b.period) || Number(b.failed) - Number(a.failed) || a.i - b.i);
  }, [data]);
  const [open, setOpen] = useState(lines.length <= 3);
  if (!lines.length) return null;
  const failed = data.failed.length;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border border-warning/50 bg-warning/[0.08]">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
          <span className="font-semibold">Notes</span>
          <span className="text-muted-foreground">
            {fmtCountPlain(lines.length)} line{lines.length === 1 ? '' : 's'}: what could not be confirmed or compared
            {failed > 0 && <span className="font-semibold text-destructive-strong"> · {failed} month{failed === 1 ? '' : 's'} not built</span>}
          </span>
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-primary">
            {open ? 'Hide' : 'Show'} <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="max-h-64 space-y-1 overflow-y-auto border-t border-warning/40 px-3 py-2 text-xs">
          {lines.map((l) => (
            <li key={`${l.period}|${l.i}|${l.failed}`} className={cn('flex gap-2', l.failed && 'font-medium text-destructive-strong')}>
              {l.failed ? <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-foreground/50" aria-hidden="true" />}
              {many && <span className="w-[62px] shrink-0 font-semibold tabular-nums">{monthLabel(l.period)}</span>}
              <span className="min-w-0">{l.text}</span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
};
