import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileJson, Loader2, Sparkles, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  GSTR9C_UTILITY_VERSION,
  buildGstr9cPortalJson,
  cleanReasonText,
  portalTotals,
  type Gstr9cCheck,
} from '@/lib/gstr9/gstr9cJson';
import { downloadBlob } from '@/lib/gstr9/export/download';
import type { Gstr9cDoc } from '@/lib/gstr9/types';
import { fmtMoney } from '../grid/money';
import { KpiTile, Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';

const REASON_FIELDS = ['t6Reasons', 't8Reasons', 't10Reasons', 't13Reasons', 't15Reasons'] as const;

/** Which tab of this step a check's table opens (Table 6 reasons sit on the Table 5 tab, and so on). */
const TAB_OF: Record<string, string> = {
  '5': '5', '6': '5', '7': '7', '8': '7', '9': '9', '10': '9', '11': '11', '12': '12', '13': '12', '14': '14', '15': '14', '16': '16', V: 'liability',
};

const tableText = (t: string) => (t === 'Home' ? 'Home' : t === 'JSON' ? 'JSON' : t === 'V' ? 'Part V' : `Table ${t}`);

/**
 * The GSTR-9C JSON for upload on the GST portal, built from the working with
 * the checks of the government's offline utility (v2.9). Errors stop the file,
 * as they stop the utility's "Generate JSON File to upload"; warnings don't.
 */
const PortalJsonPart: React.FC<{ onOpenTable?: (tab: string) => void }> = ({ onOpenTable }) => {
  const ws = useWorkspace();
  const { docs, workings, client, financialYear, update, readOnly } = ws;
  const [busy, setBusy] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const tolerance = docs.settings?.tolerance ?? 0;

  const build = useMemo(
    () => buildGstr9cPortalJson({ gstin: client.gstin, financialYear, workings, doc: docs.gstr9c, tolerance }),
    [client.gstin, financialYear, workings, docs.gstr9c, tolerance],
  );
  const errors = build.checks.filter((c) => c.severity === 'error');
  const warnings = build.checks.filter((c) => c.severity === 'warning');
  const hashProblems = errors.some((c) => c.rule === 'HASH');
  const totals = build.payload ? portalTotals(build.payload) : null;

  const actName = docs.gstr9c.actName ?? '';

  const cleanReasons = () => {
    update(
      'gstr9c',
      (d: Gstr9cDoc) => {
        const next = { ...d };
        REASON_FIELDS.forEach((f) => { next[f] = cleanReasonText(d[f] ?? ''); });
        return next;
      },
      { action: 'Reasons rewritten in the characters the GSTR-9C utility accepts' },
    );
    toast.success('Reasons rewritten: ₹ as “Rs.”, % as “percent”, dashes and quotes plain. Read them through before you file.');
  };

  const download = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Build from what the save left in the database, never from unsaved figures.
      const r = await ws.flush();
      if (!r.ok || !r.docs || !r.workings) {
        toast.error('The JSON was not generated: your latest changes could not be saved (or someone else changed the same sheet). Check the figures and try again.');
        return;
      }
      const b = buildGstr9cPortalJson({ gstin: client.gstin, financialYear, workings: r.workings, doc: r.docs.gstr9c, tolerance: r.docs.settings?.tolerance ?? 0 });
      if (!b.text) {
        toast.error(`${b.errors} check${b.errors === 1 ? '' : 's'} stop the JSON. Correct ${b.errors === 1 ? 'it' : 'them'} and generate again.`);
        return;
      }
      downloadBlob(new Blob([b.text], { type: 'application/json' }), b.fileName);
      toast.success(`Downloaded ${b.fileName}. Upload it on the GST portal: Returns → Annual Return → GSTR-9C → Prepare offline → Upload.`);
    } catch (e) {
      toast.error('Could not generate the JSON: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title="Portal JSON · GSTR-9C for upload"
      description={`The file the government's GSTR-9C offline utility (v${GSTR9C_UTILITY_VERSION}, FY 2025-26) writes with “Generate JSON File to upload”, built from this working with the utility's own checks. For FY 2020-21 onwards the statement is self-certified: no auditor's certificate and no signature go in the JSON.`}
      excelRef="GSTR_9C_Offline_Utility.xlsm v2.9"
      actions={
        <>
          {!readOnly && hashProblems && (
            <Button type="button" size="sm" variant="outline" onClick={cleanReasons}>
              <Sparkles className="mr-1 h-3.5 w-3.5" /> Fix characters in reasons
            </Button>
          )}
          <Button type="button" size="sm" onClick={() => void download()} disabled={busy || errors.length > 0} title={errors.length ? 'Correct the errors below first' : 'Saves pending changes first'}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FileJson className="mr-1 h-3.5 w-3.5" />}
            Generate JSON
          </Button>
        </>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="Errors (stop the JSON)" value={errors.length} tone={errors.length ? 'error' : 'ok'} hint={errors.length ? 'As the utility stops on them' : 'None, the JSON can be generated'} />
        <KpiTile label="Warnings" value={warnings.length} tone={warnings.length ? 'warn' : 'ok'} hint="Worth reading; they don't stop the file" />
        <KpiTile label="5R · 7G (JSON)" value={totals ? `${fmtMoney(totals.r5)} · ${fmtMoney(totals.g7)}` : '—'} hint="Un-reconciled turnover · taxable turnover" />
        <KpiTile label="9R · 12F · 14T (JSON)" value={totals ? `${fmtMoney(totals.r9)} · ${fmtMoney(totals.f12)} · ${fmtMoney(totals.t14)}` : '—'} hint="Payment · net ITC · ITC by head (S − R)" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 2xl:max-w-[900px]">
        <div className="space-y-1">
          <Label htmlFor="gstr9c-act-name" className="text-xs text-muted-foreground">
            Name of Act, if liable to audit under any Act (Home sheet, optional)
          </Label>
          <Input
            id="gstr9c-act-name"
            className="h-9"
            value={actName}
            maxLength={60}
            disabled={readOnly}
            placeholder={readOnly ? '' : 'e.g. Companies Act, 2013'}
            aria-invalid={actName.trim().length > 30}
            onChange={(e) => {
              const v = e.target.value;
              update('gstr9c', (d) => ({ ...d, actName: v }));
            }}
          />
          <p className={cn('text-[11px]', actName.trim().length > 30 ? 'text-destructive-strong' : 'text-muted-foreground')}>
            {actName.trim().length}/30 characters, the most the utility takes.
          </p>
        </div>
        <div className="space-y-1 text-xs">
          <div className="text-muted-foreground">GSTIN · FY · file</div>
          <div className="font-medium tabular-nums">{client.gstin || '—'} · {financialYear} · fp {build.payload?.gstr9cdata.audited_data.fp ?? `0320${financialYear.slice(-2)}`}</div>
          <div className="break-all font-mono text-[11px] text-muted-foreground">{build.fileName}</div>
        </div>
      </div>

      {build.checks.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success/5 px-3 py-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-success" /> Every check of the utility passes, and every total ties with the tables of this step.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-semibold">Check</th>
                <th className="px-2 py-1.5 font-semibold">Table</th>
                <th className="px-2 py-1.5 font-semibold">Rule</th>
                <th className="px-2 py-1.5 font-semibold">What to do</th>
              </tr>
            </thead>
            <tbody>
              {[...errors, ...warnings].map((c: Gstr9cCheck, i) => {
                const tab = TAB_OF[c.table];
                return (
                  <tr key={`${c.rule}-${i}`} className="border-t align-top">
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {c.severity === 'error' ? (
                        <span className="inline-flex items-center gap-1 font-medium text-destructive-strong"><XCircle className="h-3.5 w-3.5" /> Error</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-medium text-warning"><AlertTriangle className="h-3.5 w-3.5" /> Warning</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {tab && onOpenTable ? (
                        <button type="button" className="text-primary hover:underline" onClick={() => onOpenTable(tab)}>{tableText(c.table)}</button>
                      ) : (
                        tableText(c.table)
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[11px] text-muted-foreground">{c.rule}</td>
                    <td className="px-2 py-1.5">{c.message}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Note>
        Built from the utility's macros: the same keys and codes, the same checks (amounts of at most 13 digits and 2 decimals, negatives allowed; reasons of at most 1,000
        characters, ten per table, in the characters the utility accepts; Name of Act of at most 30), and its formula rows (5P, 5R, 7A, 7E, 7G, 9P, 9R, 12D, 12F, 14R, 14T)
        worked out again from the rounded rows. Each line of a reasons box is one reason. Table 14 carries eligible ITC as both “Total ITC” and “eligible ITC availed”. Rules
        EM13 / EM14 are warnings here because a figure in this app is never blank (the utility accepts 0).
      </Note>

      {build.text && (
        <div className="space-y-1">
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setShowJson((s) => !s)} aria-expanded={showJson}>
            {showJson ? 'Hide' : 'Show'} the JSON
          </Button>
          {showJson && (
            <pre className="max-h-[420px] overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-snug">{JSON.stringify(build.payload, null, 2)}</pre>
          )}
        </div>
      )}
    </SectionCard>
  );
};

export default PortalJsonPart;
