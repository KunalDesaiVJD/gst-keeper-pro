import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Lock, RefreshCw, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { T4_ROWS } from '@/lib/gstr9/engine';
import { applyPortalImport, diffPortalImport, parseGstr9Calc, ParsedGstr9 } from '@/lib/gstr9/portalParser';
import type { ImportChange } from '@/lib/gstr9/portalParser';
import {
  clearFormulas,
  compareVersions,
  describePath,
  fmtWhen,
  GSTR9_COVERAGE,
  gstr9FileMismatch,
  gstr9Incoming,
  gstr9Period,
  gstr9RawMeta,
  isPullFailed,
  ITC_ROWS,
  newerThanApplied,
  readPortalJsonFile,
  T5_ROWS,
  T9_ROWS,
  timeOf,
  typedCount,
} from '@/lib/gstr9/portalImport';
import { AsFiledReturn, loadGstr9Calc, saveUploadedGstr9Calc } from '@/lib/gstr9/store';
import type { PortalDoc, PortalMeta, T5Key } from '@/lib/gstr9/types';
import { MatrixTable, Money, Note, SectionCard, SourceChip } from '../ui';
import { StepTab, StepTabsList } from '../reco/StepTabs';
import { useWorkspace } from '../WorkspaceContext';
import { ImportPreviewDialog } from './ImportPreviewDialog';
import { PortalFieldCol, PortalFieldGrid, PortalFieldRow } from './PortalFieldGrid';

/** The browser-extension bridge the Portal step shares between its two sections. */
export interface PullBridge {
  ready: boolean;
  version: string | null;
  /** Posts __gstkPullSection; `onStarted` gets the extension's answer (portal tab opened or not). */
  start: (payload: { mode: string; period_month?: string; period_months?: string[] }, onStarted: (ok: boolean, error?: string) => void) => void;
}

/** First extension version that knows the gstr9_pull mode (older ones would fall through to the ledger pull). */
const GSTR9_PULL_MIN_VERSION = '0.3.3';
const POLL_MS = 10_000;
const POLL_MAX = 36;

const HEADS_VT: PortalFieldCol[] = [
  { key: 't', header: 'Value', width: 132 },
  { key: 'i', header: 'IGST' },
  { key: 'c', header: 'CGST' },
  { key: 's', header: 'SGST' },
  { key: 'x', header: 'Cess', width: 100 },
];
/**
 * The portal's GSTR-9 screen (and the sheet's G:J / F:I blocks) run Central,
 * State/UT, Integrated, Cess for Tables 6, 8 and 9 — so a pasted row or
 * figures typed across in the screen's order land in the right head.
 */
const HEADS_T: PortalFieldCol[] = [
  { key: 'c', header: 'Central' },
  { key: 's', header: 'State/UT' },
  { key: 'i', header: 'Integrated' },
  { key: 'x', header: 'Cess', width: 100 },
];

/** GSTR-9 Table 5 key → the engine's books-side Table 5 row (PL-OUTPUT Part B). */
const T5_BOOKS_ROW: Record<T5Key, 'A' | 'B' | 'C' | 'C1' | 'D' | 'E' | 'F' | 'H' | 'I' | 'J' | 'K'> = {
  zero_rtd: 'A', sez: 'B', rchrg: 'C', ecom_14: 'C1', exmt: 'D', nil: 'E', non_gst: 'F', cr_nt: 'H', dr_nt: 'I', amd_pos: 'J', amd_neg: 'K',
};

interface PreviewState {
  title: string;
  description: React.ReactNode;
  incoming: Partial<PortalDoc>;
  coverage: Array<{ label: string; found: boolean }>;
  /** The source to record; fetchedAt null = the moment it is applied. */
  meta: PortalMeta;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const TypedBadge: React.FC<{ n: number }> = ({ n }) =>
  n > 0 ? <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">{n} typed</Badge> : null;

export const Gstr9Section: React.FC<{ bridge: PullBridge }> = ({ bridge }) => {
  const { client, financialYear, docs, workings, update, readOnly, canEditSource } = useWorkspace();
  // Typing over a portal figure is the superadmin's alone (sourceLock.ts).
  const typeIt = canEditSource ? 'type the figures' : 'ask a superadmin to type the figures';
  const portal = docs.portal;
  const meta = portal.gstr9Meta;
  const period = gstr9Period(financialYear);

  const [lastRow, setLastRow] = useState<AsFiledReturn | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState<{ tries: number } | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  // Fetched figures open on what the working uses; typed (or nothing yet) opens straight on Table 4 to type into.
  const [tab, setTab] = useState<string>(() => (!meta?.source || meta.source === 'manual' ? 't4' : 'used'));
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (): Promise<AsFiledReturn | null> => {
    try {
      const r = await loadGstr9Calc(client.id, financialYear);
      setLastRow(r);
      setLoadError(null);
      return r;
    } catch (e) {
      setLoadError(errMsg(e));
      return null;
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

  /** Parse what the portal returned and open the preview. */
  const openPreview = useCallback(
    (raw: unknown, base: Omit<PortalMeta, 'fetchedAt'> & { fetchedAt?: string | null }, where: string) => {
      let parsed: ParsedGstr9;
      try {
        parsed = parseGstr9Calc(raw, financialYear);
      } catch (e) {
        setError(errMsg(e));
        toast.error(errMsg(e));
        return;
      }
      const mismatch = gstr9FileMismatch(parsed, client.gstin, financialYear);
      if (mismatch) {
        setError(mismatch);
        toast.error(mismatch);
        return;
      }
      if (!Object.values(parsed.found).some(Boolean)) {
        const m = 'No GSTR-9 figures were found in this data (Table 4, 6A, 8A and Table 9 are all missing).';
        setError(m);
        toast.error(m);
        return;
      }
      const rawMeta = gstr9RawMeta(raw);
      setError(null);
      setPreview({
        title: 'Review GSTR-9 system-computed figures',
        description: <>{where} · FY {financialYear} (return period {period}). Tick the figures to bring into the working.</>,
        incoming: gstr9Incoming(parsed),
        coverage: GSTR9_COVERAGE.map((c) => ({ label: c.label, found: parsed.found[c.key] })),
        meta: { ...base, arn: base.arn ?? rawMeta.arn, filedDate: base.filedDate ?? rawMeta.filedDate, fetchedAt: base.fetchedAt ?? null },
      });
    },
    [client.gstin, financialYear, period],
  );

  const openFromRow = useCallback(
    (r: AsFiledReturn) => {
      const uploaded = /^uploaded/i.test(r.status ?? '');
      openPreview(
        r.summary,
        { source: uploaded ? 'upload' : 'extension', arn: r.arn, filedDate: r.filedDate, status: r.status, fetchedAt: r.updatedAt },
        uploaded ? `Uploaded ${fmtWhen(r.updatedAt)}` : `Pulled from the portal ${fmtWhen(r.updatedAt)}`,
      );
    },
    [openPreview],
  );

  const pull = () => {
    if (readOnly) return;
    if (!bridge.ready) {
      toast.error(`The GST Keeper browser extension was not detected. Install/enable it to pull from the portal — or use Upload, or ${typeIt}.`);
      return;
    }
    // An extension from before v0.3.0 announces no version and would run its
    // default (ledger) chain for an unknown mode — block it too.
    if (!bridge.version || compareVersions(bridge.version, GSTR9_PULL_MIN_VERSION) < 0) {
      toast.error(`Extension ${bridge.version ? `v${bridge.version}` : '(an old version)'} cannot pull GSTR-9 yet. Update it to v${GSTR9_PULL_MIN_VERSION} or later (chrome://extensions → Reload), then try again.`);
      return;
    }
    setError(null);
    const clickedAt = Date.now();
    bridge.start({ mode: 'gstr9_pull', period_month: period, period_months: [period] }, (ok, err) => {
      if (ok) {
        toast.success('A GST portal tab is opening — type the CAPTCHA there. The figures come back here for review when the pull finishes.');
      } else {
        stopPoll();
        const m = `Could not start the pull: ${err || 'the extension did not answer'}`;
        setError(m);
        toast.error(m);
      }
    });
    if (timer.current) clearInterval(timer.current);
    let tries = 0;
    setPolling({ tries: 0 });
    timer.current = setInterval(async () => {
      tries += 1;
      setPolling({ tries });
      let r: AsFiledReturn | null = null;
      try {
        r = await loadGstr9Calc(client.id, financialYear);
      } catch {
        r = null; // not there yet / network blip — try again next tick
      }
      if (r && timeOf(r.updatedAt) >= clickedAt) {
        stopPoll();
        setLastRow(r);
        if (isPullFailed(r.status)) {
          setError(r.status);
          toast.error(`GSTR-9 pull failed — ${r.status}`);
        } else {
          toast.success('GSTR-9 system-computed figures received from the portal.');
          openFromRow(r);
        }
        return;
      }
      if (tries >= POLL_MAX) {
        stopPoll();
        toast.warning(`No GSTR-9 data has arrived after 6 minutes. Check the portal tab; if the pull failed there, use Upload or ${typeIt}.`);
      }
    }, POLL_MS);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || readOnly) return;
    setBusy(true);
    setError(null);
    try {
      const { raw, name } = await readPortalJsonFile(file);
      let parsed: ParsedGstr9;
      try {
        parsed = parseGstr9Calc(raw, financialYear);
      } catch (err) {
        throw new Error(`${name}: ${errMsg(err)}`);
      }
      const mismatch = gstr9FileMismatch(parsed, client.gstin, financialYear);
      if (mismatch) throw new Error(mismatch);
      try {
        await saveUploadedGstr9Calc(client.id, financialYear, raw);
        void refresh();
      } catch (err) {
        toast.warning(`The figures can still be applied, but the raw copy of the file could not be kept: ${errMsg(err)}`);
      }
      openPreview(raw, { source: 'upload', status: `Uploaded — ${name}` }, `Uploaded file ${name}`);
    } catch (err) {
      setError(errMsg(err));
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const changes = useMemo<ImportChange[]>(
    () => (preview ? diffPortalImport(portal, preview.incoming, (p) => describePath(p, financialYear).label) : []),
    [preview, portal, financialYear],
  );

  const apply = (selected: ImportChange[]) => {
    if (!preview) return;
    const m: PortalMeta = { ...preview.meta, fetchedAt: preview.meta.fetchedAt ?? new Date().toISOString() };
    update('portal', (d) => ({ ...clearFormulas(applyPortalImport(d, selected), selected.map((c) => c.path)), gstr9Meta: m }), {
      action: m.source === 'upload' ? 'Imported GSTR-9 figures from an uploaded file' : 'Imported GSTR-9 system-computed figures from the portal',
    });
    toast.success(selected.length ? `Applied ${selected.length} GSTR-9 figure${selected.length === 1 ? '' : 's'}.` : 'Recorded where the GSTR-9 figures came from.');
    setPreview(null);
  };

  const failed = lastRow && isPullFailed(lastRow.status) ? lastRow : null;
  const pending = !!lastRow && !failed && lastRow.summary != null && !polling && newerThanApplied(lastRow.updatedAt, meta);

  // --- manual grids -------------------------------------------------------
  const t4Rows = useMemo<PortalFieldRow[]>(
    () => T4_ROWS.map((r) => ({ id: r.key, code: r.table, label: r.label, paths: Object.fromEntries(HEADS_VT.map((h) => [h.key, `gstr9.table4.${r.key}.${h.key}`])) })),
    [],
  );
  const t5Rows = useMemo<PortalFieldRow[]>(() => T5_ROWS.map((r) => ({ id: r.key, code: r.table, label: r.label, paths: { t: `gstr9.table5.${r.key}` } })), []);
  const itcRows = useMemo<PortalFieldRow[]>(
    () => ITC_ROWS(financialYear).map((r) => ({ id: r.key, code: r.table, label: r.label, paths: Object.fromEntries(HEADS_T.map((h) => [h.key, `gstr9.${r.key}.${h.key}`])) })),
    [financialYear],
  );
  const t9Cols: PortalFieldCol[] = useMemo(() => [
    { key: 'payable', header: 'Tax payable', width: 132 },
    { key: 'cash', header: 'Paid in cash', width: 124 },
    { key: 'itcC', header: 'Central', group: 'Paid through ITC' },
    { key: 'itcS', header: 'State/UT', group: 'Paid through ITC' },
    { key: 'itcI', header: 'Integrated', group: 'Paid through ITC' },
    { key: 'itcX', header: 'Cess', group: 'Paid through ITC', width: 100 },
  ], []);
  const t9Rows = useMemo<PortalFieldRow[]>(
    () => T9_ROWS.map((r) => ({
      id: r.key,
      code: `9${r.code}`,
      label: r.label,
      paths: Object.fromEntries(t9Cols.filter((c) => r.tax || c.key === 'payable' || c.key === 'cash').map((c) => [c.key, `gstr9.table9.${r.key}.${c.key}`])),
    })),
    [t9Cols],
  );
  const typedT4 = typedCount(portal, 'gstr9.table4.');
  const typedT5 = typedCount(portal, 'gstr9.table5.');
  const typedItc = ITC_ROWS(financialYear).reduce((n, r) => n + typedCount(portal, `gstr9.${r.key}.`), 0);
  const typedT9 = typedCount(portal, 'gstr9.table9.');
  const typedIn = (row: PortalFieldRow) => Object.values(row.paths).filter((p) => p && portal.manual[p]).length;
  const typedExtra = { header: 'Source', width: 84, render: (row: PortalFieldRow) => <TypedBadge n={typedIn(row)} /> };

  const g = portal.gstr9;
  const t9 = workings.g9.t9;
  const flowNote = (s: string) => <span className="text-[10px] text-muted-foreground">{s}</span>;

  return (
    <SectionCard
      title={<span className="inline-flex flex-wrap items-center gap-2">GSTR-9 — system computed (annual) <SourceChip meta={meta} /></span>}
      description={<>The figures the portal auto-populates in GSTR-9 for FY {financialYear} (return period {period}).</>}
      excelRef="GSTR 9-OUTPUT I9:L15 · GSTR-9 6A, 8A, Table 9 (AUTO POPULATE FROM 9)"
      actions={
        !readOnly && (
          <>
            <Button size="sm" onClick={pull} disabled={!!polling || busy}>
              <RefreshCw className={cn('mr-1 h-3.5 w-3.5', polling && 'animate-spin')} /> Pull from portal
            </Button>
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />} Upload GSTR-9 JSON
            </Button>
            <input ref={fileRef} type="file" accept=".json,.zip,application/json,application/zip" className="hidden" onChange={onFile} aria-label="GSTR-9 JSON or ZIP file" />
          </>
        )
      }
    >
      {/* Status line */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex flex-wrap items-center gap-1.5">
          In the working: <SourceChip meta={meta} />
          {meta?.fetchedAt && <span>{fmtWhen(meta.fetchedAt)}</span>}
          {meta?.arn && <span>· ARN <span className="font-mono text-foreground">{meta.arn}</span></span>}
          {meta?.status && <span>· {meta.status}</span>}
        </span>
        <span>
          Last saved from the portal:{' '}
          {lastRow ? <span className="text-foreground">{fmtWhen(lastRow.updatedAt) || '—'}{lastRow.status ? ` · ${lastRow.status}` : ''}</span> : 'nothing yet'}
        </span>
        {loadError && <span className="text-destructive-strong">Could not read the saved portal copy: {loadError}</span>}
      </div>

      {polling && (
        <Note tone="info" className="items-center">
          <span className="inline-flex flex-wrap items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Waiting for the portal — a GST portal tab has opened; type the CAPTCHA there. Checking every 10 s ({polling.tries}/{POLL_MAX}).
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={stopPoll}>Stop waiting</Button>
          </span>
        </Note>
      )}
      {error && <Note tone="warn">{error}</Note>}
      {failed && !error && (
        <Note tone="warn">
          The last pull ({fmtWhen(failed.updatedAt)}) failed: {failed.status}. Pull again, or Upload the JSON saved from the portal, or {typeIt} below.
        </Note>
      )}
      {pending && !readOnly && (
        <Note tone="info" className="items-center">
          <span className="inline-flex flex-wrap items-center gap-2">
            GSTR-9 data {/^uploaded/i.test(lastRow?.status ?? '') ? 'uploaded' : 'pulled from the portal'} on {fmtWhen(lastRow?.updatedAt)} is not in the working yet.
            <Button size="sm" className="h-7" onClick={() => lastRow && openFromRow(lastRow)}>
              {/^uploaded/i.test(lastRow?.status ?? '') ? 'Apply last uploaded data' : 'Apply last pulled data'}
            </Button>
          </span>
        </Note>
      )}

      <Note tone="warn">
        The GSTR-9 pull reads the portal&apos;s own system-computed endpoint (the one its GSTR-9 page uses); it has not been exercised live yet. If it fails, Upload the JSON saved from the portal, or {typeIt} from the portal screen.
      </Note>

      {/* What the working uses, and the tables to type or correct by hand */}
      <Tabs value={tab} onValueChange={setTab}>
        <StepTabsList
          level="inner"
          label="GSTR-9 system computed"
          value={tab}
          actions={
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              {canEditSource ? 'Tables 4 – 9: a superadmin can correct a figure by hand' : <><Lock className="h-3 w-3" aria-hidden /> Locked — figures come from the portal; only a superadmin can correct one</>}
            </span>
          }
        >
          <StepTab value="used">Used in the working</StepTab>
          <StepTab value="t4">Table 4 <TypedBadge n={typedT4} /></StepTab>
          <StepTab value="t5">Table 5 <TypedBadge n={typedT5} /></StepTab>
          <StepTab value="itc">6A · 6G · 8A <TypedBadge n={typedItc} /></StepTab>
          <StepTab value="t9">Table 9 <TypedBadge n={typedT9} /></StepTab>
        </StepTabsList>

        <TabsContent value="used" className="space-y-2">
          <MatrixTable
            label="GSTR-9 portal figures used by the working"
            heads={['t', 'i', 'c', 's', 'x']}
            headLabels={{ t: 'Value', s: 'SGST' }}
            rows={[
              { key: 't4', code: '4', label: 'Outward supplies as auto-populated (excl. 4G), net of credit notes', value: workings.outward.portalTotal, note: flowNote('→ Outward reco') },
              {
                key: 't4g', code: '4G', label: 'Reverse charge (portal)', value: g.table4.rchrg,
                note: flowNote(workings.rcm.partASource === 'gstr9' ? '→ RCM Part A (no monthly 3B yet)' : '→ fallback only; 4G uses 3.1(d) month-wise'),
              },
              {
                key: 't6a', code: '6A', label: 'ITC availed through GSTR-3B', value: g.t6A,
                note: flowNote(workings.g9.t6ASource === 'gstr9' ? '→ GSTR-9 6A' : workings.g9.t6ASource === 'monthly_3b' ? 'not in use — 6A is Σ 4A of the as-filed 3B' : '→ GSTR-9 6A'),
              },
              { key: 't6g', code: '6G', label: 'ITC received from ISD', value: g.t6G, note: flowNote('→ 6G unless typed in the GSTR-9 step') },
              { key: 't8a', code: '8A', label: ITC_ROWS(financialYear)[2].label, value: g.t8A, note: flowNote('→ 8A / 8D') },
              {
                key: 't9p', code: '9', label: 'Tax payable (portal)',
                value: { i: g.table9.igst.payable, c: g.table9.cgst.payable, s: g.table9.sgst.payable, x: g.table9.cess.payable },
                note: flowNote('→ Table 9 payable'),
              },
              {
                key: 't9paid', code: '9', label: 'Total tax paid (cash + ITC)',
                value: { i: t9.igst.paid, c: t9.cgst.paid, s: t9.sgst.paid, x: t9.cess.paid },
                note: flowNote('→ Table 9, Annexure-1'),
              },
            ]}
          />
          <p className="text-[11px] text-muted-foreground">
            They fill GSTR 9-OUTPUT column B (Table 4), 6A, 6G, 8A and Table 9; Table 5 is kept to cross-check the books.
          </p>
        </TabsContent>

        <TabsContent value="t4" className="space-y-2">
          <PortalFieldGrid
            label="GSTR-9 Table 4 as auto-populated"
            rows={t4Rows}
            cols={HEADS_VT}
            codeHeader="Table"
            labelHeader="Nature of supplies"
            labelWidth={260}
            mirror={{ c: 'c', s: 's' }}
            extra={typedExtra}
            maxHeight="max(300px, calc(100vh - 520px))"
            footer={[{
              key: 'total',
              label: 'Total',
              tone: 'total',
              cells: {
                _label: 'Excl. 4G, credit notes and 4L deducted (GSTR 9-OUTPUT I17)',
                t: workings.outward.portalTotal.t, i: workings.outward.portalTotal.i, c: workings.outward.portalTotal.c,
                s: workings.outward.portalTotal.s, x: workings.outward.portalTotal.x,
              },
            }]}
          />
          <Note tone="info">
            SGST is the CGST figure (the sheet&apos;s <span className="font-mono">=K</span> cells) and is locked: a CGST typed here carries it. 4G here is the portal&apos;s annual figure: GSTR-9 4G itself is RCM Part A (3.1(d) of the as-filed GSTR-3B, month by month), and this figure is used only when no month is applied.
          </Note>
        </TabsContent>

        <TabsContent value="t5" className="space-y-2">
          <PortalFieldGrid
            label="GSTR-9 Table 5 as auto-populated"
            rows={t5Rows}
            cols={[{ key: 't', header: 'Portal value', width: 140 }]}
            codeHeader="Table"
            labelHeader="Nature of supplies"
            labelWidth={320}
            maxHeight="max(300px, calc(100vh - 520px))"
            extra={{
              header: 'Books (Part B)',
              width: 140,
              render: (row) => <Money value={workings.g9.t5[T5_BOOKS_ROW[row.id as T5Key]].t} className="block text-right" />,
            }}
          />
          <p className="text-[11px] text-muted-foreground">Table 5 is not compared line by line in the sheet; it is kept here so the books side (Sales step, Part B) can be checked against what the portal shows.</p>
        </TabsContent>

        <TabsContent value="itc" className="space-y-2">
          <PortalFieldGrid
            label="GSTR-9 ITC figures from the portal"
            rows={itcRows}
            cols={HEADS_T}
            codeHeader="Table"
            labelHeader="Details"
            labelWidth={300}
            mirror={{ c: 'c', s: 's' }}
            extra={typedExtra}
          />
          <p className="text-[11px] text-muted-foreground">
            When no GSTR-9 data is here at all, 6A falls back to Σ 4A of the as-filed GSTR-3B (the As-filed GSTR-3B tab). 8A is GSTR-2B from FY 2023-24 (GSTR-2A before).
          </p>
        </TabsContent>

        <TabsContent value="t9" className="space-y-2">
          <PortalFieldGrid
            label="GSTR-9 Table 9 from the portal"
            rows={t9Rows}
            cols={t9Cols}
            codeHeader="No."
            labelHeader="Description"
            labelWidth={150}
            extra={{
              header: 'Total paid',
              width: 132,
              render: (row) => {
                const k = row.id as keyof typeof t9;
                const v = k in t9 ? t9[k].paid : workings.g9.t9Other[row.id as keyof typeof workings.g9.t9Other]?.cash;
                return <Money value={v} className="block text-right font-medium" />;
              },
            }}
          />
          <Note tone="position">
            GSTR-9 Table 9 tax payable is this portal figure (what the portal pre-fills), else the 4N tax, and can be overridden in the GSTR-9 step. The sheet mixes the two (IGST from the portal, CGST/SGST from 4N).
          </Note>
        </TabsContent>
      </Tabs>
      {tab !== 'used' && canEditSource && (
        <div className="text-[11px] text-muted-foreground">
          As superadmin you can type the figures from the portal&apos;s GSTR-9 screen; staff see them locked. A typed figure shows as <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">typed</Badge> and a later pull or upload never replaces it unless you tick it in the preview.
        </div>
      )}

      <ImportPreviewDialog
        open={!!preview}
        onOpenChange={(o) => { if (!o) setPreview(null); }}
        title={preview?.title ?? ''}
        description={preview?.description}
        changes={changes}
        describe={(p) => describePath(p, financialYear)}
        coverage={preview?.coverage}
        readOnly={readOnly}
        lockTyped={!canEditSource}
        onApply={apply}
      />
    </SectionCard>
  );
};

export default Gstr9Section;
