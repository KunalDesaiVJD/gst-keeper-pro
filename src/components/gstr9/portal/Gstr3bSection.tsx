import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ClipboardCheck, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { addT, addV } from '@/lib/gstr9/engine';
import { applyPortalImport, diffPortalImport, periodsForFY } from '@/lib/gstr9/portalParser';
import type { ImportChange } from '@/lib/gstr9/portalParser';
import {
  clearFormulas,
  describePath,
  fmtDate,
  fmtWhen,
  gstr3bIncoming,
  Gstr3bImport,
  has3bSummary,
  HEAD_NAME,
  isNotFiled,
  isPullFailed,
  MONTH_FIELDS,
  monthTitle,
  newerThanApplied,
  typedCount,
} from '@/lib/gstr9/portalImport';
import { AsFiledReturn, loadAsFiledGstr3b } from '@/lib/gstr9/store';
import { FY_MONTHS } from '@/lib/gstr9/types';
import type { MonthKey, PortalMeta, PortalMonth } from '@/lib/gstr9/types';
import type { GridFooterRow } from '../grid/SheetGrid';
import { Note, SectionCard, SourceChip } from '../ui';
import { StepTab, StepTabsList, TabSub } from '../reco/StepTabs';
import { useWorkspace } from '../WorkspaceContext';
import type { PullBridge } from './Gstr9Section';
import { ImportPreviewDialog } from './ImportPreviewDialog';
import { PortalFieldCol, PortalFieldGrid, PortalFieldRow } from './PortalFieldGrid';

const POLL_MS = 10_000;
const POLL_MAX = 36;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Field = keyof PortalMonth;
const RECO_FIELDS: Field[] = ['outTax', 'itcExclRcm', 'rcm'];
const OTHER_FIELDS: Field[] = ['itc4aTotal', 'itc4a5', 'itc4b1', 'itc4b2', 'itc4d'];
const fieldInfo = (k: Field) => MONTH_FIELDS.find((f) => f.key === k)!;

/** Portal-side state of one month, as the extension left it in gst_filed_returns. */
const PortalStatus: React.FC<{ row: AsFiledReturn | undefined }> = ({ row }) => {
  if (!row) return <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">Not pulled</Badge>;
  const s = row.status ?? '';
  if (isPullFailed(s)) return <Badge variant="destructive" className="text-[10px] font-medium" title={s}>Pull failed</Badge>;
  if (isNotFiled(s)) return <Badge variant="warning" className="text-[10px] font-medium" title={s}>Not filed</Badge>;
  if (/^filed$/i.test(s)) return <Badge variant="success" className="text-[10px] font-medium">Filed</Badge>;
  return <Badge variant="info" className="text-[10px] font-medium">{s || 'Pulled'}</Badge>;
};

interface MonthRow {
  m: MonthKey;
  row: AsFiledReturn | undefined;
  meta: PortalMeta | undefined;
  usable: boolean;
  applied: boolean;
  typed: number;
}

/** Working-side state of one month: applied, waiting to be applied, or its own source (typed …). */
const InWorking: React.FC<{ r: MonthRow }> = ({ r }) => (
  <span className="inline-flex flex-wrap items-center gap-0.5">
    {r.usable && r.applied && <Badge variant="success" className="text-[10px] font-medium">Applied</Badge>}
    {r.usable && !r.applied && (
      <Badge variant="warning" className="text-[10px] font-medium">
        {r.meta?.source === 'as_filed_3b' ? 'Newer pull — not applied' : 'Not applied'}
      </Badge>
    )}
    {!(r.usable && r.applied) && <SourceChip meta={r.meta} />}
    {r.typed > 0 && <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">{r.typed} typed</Badge>}
  </span>
);

export const Gstr3bSection: React.FC<{ bridge: PullBridge }> = ({ bridge }) => {
  const { client, financialYear, docs, workings, update, readOnly, canEditSource } = useWorkspace();
  // Typing over a portal figure is the superadmin's alone (sourceLock.ts).
  const typeIt = canEditSource ? 'type the figures below' : 'ask a superadmin to type the figures';
  const portal = docs.portal;
  const periods = useMemo(() => periodsForFY(financialYear), [financialYear]);

  const [rows, setRows] = useState<AsFiledReturn[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [polling, setPolling] = useState<{ tries: number; fresh: number } | null>(null);
  const [preview, setPreview] = useState<Gstr3bImport | null>(null);
  const [tab, setTab] = useState('reco');
  const [details, setDetails] = useState(false);
  const anyCess = FY_MONTHS.some((m) => Object.values(portal.months[m]).some((t) => Math.abs(t.x) > 0.004));
  const [showCess, setShowCess] = useState<boolean>(anyCess);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async (): Promise<AsFiledReturn[] | null> => {
    try {
      const r = await loadAsFiledGstr3b(client.id, financialYear);
      setRows(r);
      setLoadError(null);
      return r;
    } catch (e) {
      setLoadError(errMsg(e));
      return null;
    } finally {
      setLoaded(true);
    }
  }, [client.id, financialYear]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const onFocus = () => { if (!timer.current) void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const stopPoll = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setPolling(null);
  }, []);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const byPeriod = useMemo(() => new Map(rows.map((r) => [r.period, r])), [rows]);
  const monthRows: Array<MonthRow & { period: string }> = FY_MONTHS.map((m, idx) => {
    const row = byPeriod.get(periods[idx]);
    const meta: PortalMeta | undefined = portal.monthMeta[m];
    const usable = has3bSummary(row) && !isNotFiled(row?.status);
    const applied = usable && meta?.source === 'as_filed_3b' && !newerThanApplied(row?.updatedAt, meta);
    return { m, period: periods[idx], row, meta, usable, applied, typed: typedCount(portal, `months.${m}.`) };
  });
  const usableCount = monthRows.filter((r) => r.usable).length;
  const pendingCount = monthRows.filter((r) => r.usable && !r.applied).length;

  const openPreview = useCallback(
    (list: AsFiledReturn[]) => {
      const imp = gstr3bIncoming(list, financialYear);
      if (!imp.months.length) {
        toast.info(`No as-filed GSTR-3B has been pulled for this year yet. Pull the 12 months from the portal first — or ${typeIt}.`);
        return;
      }
      setPreview(imp);
    },
    [financialYear, typeIt],
  );

  const pull = () => {
    if (readOnly) return;
    if (!bridge.ready) {
      toast.error(`The GST Keeper browser extension was not detected. Install/enable it to pull from the portal — or ${typeIt}.`);
      return;
    }
    const before = new Map(rows.map((r) => [r.period, `${r.updatedAt ?? ''}|${r.status ?? ''}`]));
    bridge.start({ mode: 'gstr3b_pull', period_month: periods[0], period_months: periods }, (ok, err) => {
      if (ok) toast.success('A GST portal tab is opening — type the CAPTCHA there once; it then reads all 12 months one after another.');
      else {
        stopPoll();
        toast.error(`Could not start the pull: ${err || 'the extension did not answer'}`);
      }
    });
    if (timer.current) clearInterval(timer.current);
    let tries = 0;
    setPolling({ tries: 0, fresh: 0 });
    const run = setInterval(async () => {
      tries += 1;
      let list: AsFiledReturn[] | null = null;
      try {
        list = await loadAsFiledGstr3b(client.id, financialYear);
      } catch {
        list = null;
      }
      // "Stop waiting" (or a new pull) while this read was in flight: drop it.
      if (timer.current !== run) return;
      const fresh = list ? list.filter((r) => before.get(r.period) !== `${r.updatedAt ?? ''}|${r.status ?? ''}`).length : 0;
      if (list) setRows(list);
      setPolling({ tries, fresh });
      const done = fresh >= periods.length;
      if (done || tries >= POLL_MAX) {
        stopPoll();
        if (fresh > 0 && list) {
          toast.success(done ? 'As-filed GSTR-3B received for all 12 months.' : `As-filed GSTR-3B received for ${fresh} of 12 months — the rest may not be filed, or the pull stopped early.`);
          openPreview(list);
        } else {
          toast.warning(`No GSTR-3B arrived after 6 minutes. Check the portal tab; you can also ${typeIt}.`);
        }
      }
    }, POLL_MS);
    timer.current = run;
  };

  const changes = useMemo<ImportChange[]>(
    () => (preview ? diffPortalImport(portal, preview.incoming, (p) => describePath(p, financialYear).label) : []),
    [preview, portal, financialYear],
  );

  const apply = (selected: ImportChange[]) => {
    if (!preview) return;
    const touched = new Set(selected.map((c) => c.path.split('.')[1]));
    const changedMonths = new Set(changes.map((c) => c.path.split('.')[1]));
    // Record the source for each month brought in — or already identical. A month whose every change was left unticked keeps its old source.
    const stamped = preview.months.filter((m) => touched.has(m) || !changedMonths.has(m));
    update('portal', (d) => {
      const next = clearFormulas(applyPortalImport(d, selected), selected.map((c) => c.path));
      const monthMeta = { ...next.monthMeta };
      stamped.forEach((m) => { if (preview.metas[m]) monthMeta[m] = { ...preview.metas[m]! }; });
      return { ...next, monthMeta };
    }, { action: 'Imported as-filed GSTR-3B from the portal' });
    toast.success(`As-filed GSTR-3B applied for ${stamped.length} month${stamped.length === 1 ? '' : 's'}${selected.length ? ` (${selected.length} figure${selected.length === 1 ? '' : 's'} changed)` : ''}.`);
    setPreview(null);
  };

  // --- grids -----------------------------------------------------------------
  const heads = useMemo(() => (showCess ? ['i', 'c', 's', 'x'] : ['i', 'c', 's']), [showCess]);
  const colsFor = useCallback(
    (fields: Field[]): PortalFieldCol[] =>
      fields.flatMap((f) => {
        const info = fieldInfo(f);
        const hs = f === 'rcm' ? ['t', ...heads] : heads;
        return hs.map((h) => ({ key: `${f}.${h}`, header: HEAD_NAME[h], group: info.label, width: h === 'x' ? 96 : h === 't' ? 124 : 112 }));
      }),
    [heads],
  );
  const recoCols = useMemo(() => colsFor(RECO_FIELDS), [colsFor]);
  const otherCols = useMemo(() => colsFor(OTHER_FIELDS), [colsFor]);
  const gridRows = useCallback(
    (cols: PortalFieldCol[]): PortalFieldRow[] =>
      FY_MONTHS.map((m) => ({ id: m, label: monthTitle(m, financialYear), paths: Object.fromEntries(cols.map((c) => [c.key, `months.${m}.${c.key}`])) })),
    [financialYear],
  );
  const recoRows = useMemo(() => gridRows(recoCols), [gridRows, recoCols]);
  const otherRows = useMemo(() => gridRows(otherCols), [gridRows, otherCols]);

  const sourceExtra = {
    header: 'Source',
    width: 118,
    render: (row: PortalFieldRow) => {
      const m = row.id as MonthKey;
      const meta = portal.monthMeta[m];
      const n = typedCount(portal, `months.${m}.`);
      return (
        <span className="inline-flex items-center gap-1">
          <SourceChip meta={meta} />
          {n > 0 && meta?.source !== 'manual' && <Badge variant="secondary" className="px-1 py-0 text-[10px] font-normal">{n} typed</Badge>}
        </span>
      );
    },
  };

  const footerCells = (fields: Field[]): Record<string, number> => {
    const out: Record<string, number> = {};
    fields.forEach((f) => {
      // Engine totals where the engine keeps one; otherwise the plain Σ of the month column.
      const total =
        f === 'outTax' ? workings.dto.totals.asPer3B
          : f === 'itcExclRcm' ? workings.dti.totals.asPer3B
            : f === 'rcm' ? addV(...FY_MONTHS.map((m) => portal.months[m].rcm))
              : addT(...FY_MONTHS.map((m) => portal.months[m][f]));
      Object.entries(total).forEach(([h, v]) => { out[`${f}.${h}`] = v as number; });
    });
    return out;
  };
  const recoFooter: GridFooterRow[] = [{ key: 'total', label: 'Total', tone: 'total', cells: footerCells(RECO_FIELDS) }];
  const otherFooter: GridFooterRow[] = [{ key: 'total', label: 'Total', tone: 'total', cells: footerCells(OTHER_FIELDS) }];

  return (
    <SectionCard
      title="As-filed GSTR-3B (monthly)"
      description={<>The GSTR-3B as filed for each month of FY {financialYear}, read from the portal by the browser extension — never the app&apos;s own GSTR-3B.</>}
      excelRef="D&T-OUTPUT L:N · D&T-INPUT X:Z · RCM Part A D9:G20"
      actions={
        !readOnly && (
          <>
            <Button size="sm" onClick={pull} disabled={!!polling}>
              <RefreshCw className={cn('mr-1 h-3.5 w-3.5', polling && 'animate-spin')} /> Pull all 12 months from portal
            </Button>
            <Button size="sm" variant={pendingCount ? 'default' : 'outline'} onClick={() => openPreview(rows)} disabled={!usableCount}
              title={usableCount ? undefined : 'Nothing pulled yet'}>
              <ClipboardCheck className="mr-1 h-3.5 w-3.5" /> Apply as-filed GSTR-3B{pendingCount ? ` (${pendingCount})` : ''}
            </Button>
          </>
        )
      }
    >
      {polling && (
        <Note tone="info" className="items-center">
          <span className="inline-flex flex-wrap items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Waiting for the portal — type the CAPTCHA in the portal tab. {polling.fresh}/12 months received; checking every 10 s ({polling.tries}/{POLL_MAX}).
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={stopPoll}>Stop waiting</Button>
          </span>
        </Note>
      )}
      {loadError && <Note tone="warn">Could not read the pulled GSTR-3B: {loadError}</Note>}
      {pendingCount > 0 && !polling && !readOnly && (
        <Note tone="info">
          {pendingCount} month{pendingCount === 1 ? ' has' : 's have'} as-filed GSTR-3B from the portal that {pendingCount === 1 ? 'is' : 'are'} not in the working yet — use <span className="font-medium">Apply as-filed GSTR-3B</span> to review and bring {pendingCount === 1 ? 'it' : 'them'} in.
        </Note>
      )}

      {/* 12-month status: one compact strip; ARN and dates one click away (toggle on the row below) */}
      <div>
        {details ? (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full border-collapse text-sm" aria-label="As-filed GSTR-3B by month">
              <thead className="bg-muted">
                <tr>
                  <th className="border-b border-r px-2 py-1.5 text-left font-semibold text-muted-foreground">Month</th>
                  <th className="border-b border-r px-2 py-1.5 text-left font-semibold text-muted-foreground">On the portal</th>
                  <th className="border-b border-r px-2 py-1.5 text-left font-semibold text-muted-foreground">ARN</th>
                  <th className="border-b border-r px-2 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">Filed on</th>
                  <th className="border-b border-r px-2 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">Last pulled</th>
                  <th className="border-b px-2 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">In the working</th>
                </tr>
              </thead>
              <tbody>
                {monthRows.map((r) => (
                  <tr key={r.m}>
                    <td className="border-b border-r px-2 py-1 font-medium whitespace-nowrap">{monthTitle(r.m, financialYear)}</td>
                    <td className="border-b border-r px-2 py-1"><PortalStatus row={r.row} /></td>
                    <td className="border-b border-r px-2 py-1 font-mono text-[11px]">{r.row?.arn || <span className="text-muted-foreground">—</span>}</td>
                    <td className="border-b border-r px-2 py-1 tabular-nums whitespace-nowrap">{fmtDate(r.row?.filedDate) || <span className="text-muted-foreground">—</span>}</td>
                    <td className="border-b border-r px-2 py-1 tabular-nums whitespace-nowrap">{fmtWhen(r.row?.updatedAt) || <span className="text-muted-foreground">—</span>}</td>
                    <td className="border-b px-2 py-1"><InWorking r={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ul className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-12" aria-label="As-filed GSTR-3B by month">
            {monthRows.map((r) => (
              <li
                key={r.m}
                className="min-w-0 space-y-1 rounded-md border bg-card px-1.5 py-1"
                title={[
                  r.row?.arn && `ARN ${r.row.arn}`,
                  r.row?.filedDate && `filed ${fmtDate(r.row.filedDate)}`,
                  r.row?.updatedAt && `pulled ${fmtWhen(r.row.updatedAt)}`,
                ].filter(Boolean).join(' · ') || undefined}
              >
                <div className="truncate text-[11px] font-semibold">{monthTitle(r.m, financialYear)}</div>
                <div className="flex flex-wrap gap-0.5"><PortalStatus row={r.row} /></div>
                <InWorking r={r} />
              </li>
            ))}
          </ul>
        )}
      </div>
      {!loaded && <p className="text-[11px] text-muted-foreground">Reading what has been pulled…</p>}

      {workings.rcm.partASource === 'gstr9' && (
        <Note tone="info">No month has RCM 3.1(d) yet, so RCM Part A (and GSTR-9 4G) uses the annual 4G figure from the GSTR-9 system-computed data (the GSTR-9 tab).</Note>
      )}

      {/* Month-wise entry */}
      <Tabs value={tab} onValueChange={setTab}>
        <StepTabsList
          level="inner"
          label="As-filed GSTR-3B"
          value={tab}
          actions={
            <>
              <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs font-normal text-muted-foreground" onClick={() => setDetails((o) => !o)} aria-expanded={details}>
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !details && '-rotate-90')} aria-hidden="true" />
                {details ? 'Months: hide ARN & dates' : 'Months: show ARN & dates'}
              </Button>
              <div className="flex items-center gap-2">
                <Switch id="gstr3b-cess" checked={showCess} onCheckedChange={setShowCess} />
                <Label htmlFor="gstr3b-cess" className="text-xs font-normal text-muted-foreground">Show cess</Label>
              </div>
            </>
          }
        >
          <StepTab value="reco">Output, ITC &amp; RCM</StepTab>
          <StepTab value="other" title="Used by GSTR-9 Table 7E, the 6A fallback and the Notice format">Other 3B figures <TabSub>4A/4B/4D</TabSub></StepTab>
        </StepTabsList>
        <TabsContent value="reco" className="space-y-2">
          <PortalFieldGrid
            label="As-filed GSTR-3B by month: output tax, ITC excluding RCM, RCM"
            rows={recoRows}
            cols={recoCols}
            labelHeader="Month"
            labelWidth={84}
            extra={sourceExtra}
            footer={recoFooter}
            maxHeight="max(300px, calc(100vh - 470px))"
          />
          <FieldLegend fields={RECO_FIELDS} />
        </TabsContent>

        <TabsContent value="other" className="space-y-2">
          <PortalFieldGrid
            label="As-filed GSTR-3B by month: 4A total, 4A(5), 4B(1), 4B(2), 4D"
            rows={otherRows}
            cols={otherCols}
            labelHeader="Month"
            labelWidth={84}
            extra={sourceExtra}
            footer={otherFooter}
            maxHeight="max(300px, calc(100vh - 470px))"
          />
          <FieldLegend fields={OTHER_FIELDS} />
        </TabsContent>
      </Tabs>
      <p className="text-[11px] text-muted-foreground">
        These fill the &quot;AS PER 3B&quot; columns of Duties &amp; Taxes (output and input), RCM Part A, and the 4A/4B/4D figures used by GSTR-9 6A (fallback), 7E and the Notice format.
        SGST is its own figure in the filed GSTR-3B, so it does not mirror CGST here. The figures are locked: only a superadmin can type over one. Typed figures show as &quot;typed&quot; and are
        never replaced by a later pull unless a superadmin ticks them in the preview.
      </p>

      <ImportPreviewDialog
        open={!!preview}
        onOpenChange={(o) => { if (!o) setPreview(null); }}
        title="Review as-filed GSTR-3B"
        description={preview ? <>{preview.months.length} month{preview.months.length === 1 ? '' : 's'} pulled from the portal ({preview.months.map((m) => monthTitle(m, financialYear)).join(', ')}). Tick the figures to bring into the working.</> : undefined}
        changes={changes}
        describe={(p) => describePath(p, financialYear)}
        readOnly={readOnly}
        lockTyped={!canEditSource}
        onApply={apply}
      />
    </SectionCard>
  );
};

/** One line per column group: what it is and where it goes. */
const FieldLegend: React.FC<{ fields: Field[] }> = ({ fields }) => (
  <dl className="grid gap-x-6 gap-y-0.5 text-[11px] sm:grid-cols-2">
    {fields.map((f) => {
      const info = fieldInfo(f);
      return (
        <div key={f} className="flex gap-1.5">
          <dt className="whitespace-nowrap font-medium">{info.short}</dt>
          <dd className="text-muted-foreground">= {info.explain}</dd>
        </div>
      );
    })}
  </dl>
);

export default Gstr3bSection;
