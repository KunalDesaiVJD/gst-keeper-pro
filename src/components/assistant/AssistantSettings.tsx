// Settings → AI Assistant (23 Nov 2026): the switch, and every user's tokens.
// Superadmin and GST Manager switch the assistant and its filling of figures
// on or off and see every user's tokens; an employee sees their own. The
// tokens are what the Edge Function gst-assistant recorded for each request
// (assistant_usage, which the app can only read). Downloads are the Reports
// Hub's Big4 working papers.
import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SectionCard } from '@/components/gstr9/ui';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_TOTAL } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { renderReportToExcel, type ReportTable } from '@/utils/allClientsReports';
import { downloadReportPdf } from '@/lib/reportExport/pdf';

interface UsageRow {
  month: string; user_id: string; user_name: string | null; user_role: string | null;
  requests: number; calls: number; input_tokens: number; output_tokens: number;
  cache_read_tokens: number; cache_write_tokens: number; total_tokens: number; last_used_at: string;
}

// The model every request uses (src/lib/aiModel.ts: AI_MODEL at AI_EFFORT).
const AI_MODEL_LABEL = 'Claude Sonnet 5.5 at medium effort';
const fmt = (n: number) => Number(n || 0).toLocaleString('en-IN');
const ROLE: Record<string, string> = { superadmin: 'Superadmin', gst_manager: 'GST Manager', employee: 'Employee' };
const monthLabel = (m: string) => {
  const [y, mm] = m.split('-').map(Number);
  return new Date(y, mm - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
};

const AssistantSettings: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'superadmin' || user?.role === 'gst_manager';
  const [settings, setSettings] = useState<{ enabled: boolean; allow_fill: boolean } | null>(null);
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [knowledge, setKnowledge] = useState<{ commit?: string; loaded_at?: string; docs?: number } | null>(null);
  const [month, setMonth] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      const [s, u, k] = await Promise.all([
        supabase.from('assistant_settings' as never).select('enabled, allow_fill').maybeSingle(),
        (() => {
          let q = supabase.from('assistant_usage_monthly' as never).select('*').order('month' as never, { ascending: false });
          if (!isAdmin && user?.userId) q = q.eq('user_id' as never, user.userId as never);
          return q.limit(2000);
        })(),
        supabase.rpc('assistant_knowledge_status' as never),
      ]);
      if (!live) return;
      setSettings((s.data as { enabled: boolean; allow_fill: boolean } | null) ?? { enabled: true, allow_fill: true });
      setRows(((u.data ?? []) as unknown) as UsageRow[]);
      setKnowledge((k.data as { commit?: string; loaded_at?: string; docs?: number } | null) ?? null);
      setLoading(false);
    })();
    return () => { live = false; };
  }, [isAdmin, user?.userId]);

  const months = useMemo(() => [...new Set(rows.map((r) => r.month))].sort().reverse(), [rows]);
  const shown = useMemo(() => {
    const pick = month === 'all' ? rows : rows.filter((r) => r.month === month);
    // One line per user over the months shown.
    const by = new Map<string, UsageRow>();
    for (const r of pick) {
      const p = by.get(r.user_id);
      if (!p) { by.set(r.user_id, { ...r }); continue; }
      p.requests += r.requests; p.calls += r.calls; p.input_tokens += Number(r.input_tokens); p.output_tokens += Number(r.output_tokens);
      p.cache_read_tokens += Number(r.cache_read_tokens); p.cache_write_tokens += Number(r.cache_write_tokens); p.total_tokens += Number(r.total_tokens);
      if (r.last_used_at > p.last_used_at) p.last_used_at = r.last_used_at;
    }
    return [...by.values()].sort((a, b) => Number(b.total_tokens) - Number(a.total_tokens));
  }, [rows, month]);
  const totals = useMemo(() => shown.reduce((t, r) => ({
    requests: t.requests + r.requests, input: t.input + Number(r.input_tokens), output: t.output + Number(r.output_tokens),
    cacheRead: t.cacheRead + Number(r.cache_read_tokens), cacheWrite: t.cacheWrite + Number(r.cache_write_tokens), total: t.total + Number(r.total_tokens),
  }), { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }), [shown]);

  const save = async (patch: Partial<{ enabled: boolean; allow_fill: boolean }>) => {
    const next = { ...(settings ?? { enabled: true, allow_fill: true }), ...patch };
    setSettings(next);
    const { error } = await supabase.from('assistant_settings' as never).update({ ...patch, updated_at: new Date().toISOString(), updated_by: user?.userId ?? null } as never).eq('id' as never, true as never);
    if (error) { toast.error(`Not saved: ${error.message}`); setSettings(settings); } else toast.success('Saved');
  };

  const table = (): ReportTable => ({
    title: 'GST Assistant: tokens by user',
    subtitle: `Period: ${month === 'all' ? 'All months' : monthLabel(month)} | Model: ${AI_MODEL_LABEL}`,
    headers: ['User', 'Level', 'Requests', 'Input tokens', 'Cache read tokens', 'Cache write tokens', 'Output tokens', 'Total tokens', 'Last used'],
    rows: [
      ...shown.map((r) => [r.user_name ?? r.user_id, ROLE[r.user_role ?? ''] ?? (r.user_role ?? ''), r.requests, Number(r.input_tokens), Number(r.cache_read_tokens), Number(r.cache_write_tokens), Number(r.output_tokens), Number(r.total_tokens), new Date(r.last_used_at).toLocaleString('en-IN')]),
      ['TOTAL', '', totals.requests, totals.input, totals.cacheRead, totals.cacheWrite, totals.output, totals.total, ''],
    ],
    fileNameBase: `GST_Assistant_Tokens_${month === 'all' ? 'All' : month}`,
    columnWidths: [26, 14, 11, 15, 17, 17, 15, 15, 20],
  });

  if (loading) return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;

  return (
    <div className="space-y-3">
      <SectionCard title="GST Assistant" description={`The assistant on every staff screen (Ctrl J). Every answer is ${AI_MODEL_LABEL} on the Claude API, and every request's tokens are recorded below.`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label className="text-sm">Assistant on</Label>
              <p className="text-xs text-muted-foreground">Off hides it for everyone.</p>
            </div>
            <Switch checked={!!settings?.enabled} disabled={!isAdmin} onCheckedChange={(v) => void save({ enabled: v })} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label className="text-sm">May fill figures</Label>
              <p className="text-xs text-muted-foreground">Fills a screen's own fields after the user approves; the screen's Save stores them.</p>
            </div>
            <Switch checked={!!settings?.allow_fill} disabled={!isAdmin} onCheckedChange={(v) => void save({ allow_fill: v })} />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          The firm's notes: {knowledge?.docs ? `${knowledge.docs} sections from main (commit ${knowledge.commit ?? 'unknown'}, loaded ${knowledge.loaded_at ? new Date(knowledge.loaded_at).toLocaleString('en-IN') : 'unknown'}).` : 'not loaded yet. They load on the next push to main once the repository secret SUPABASE_ACCESS_TOKEN is set.'} Screens are read from each deploy and from the live page.
          {!isAdmin && ' Only a GST Manager or the superadmin changes these switches.'}
        </p>
      </SectionCard>

      <SectionCard title={isAdmin ? 'Tokens by user' : 'My tokens'} description="Input includes cache reads and writes in the total.">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All months</SelectItem>
              {months.map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="ml-auto flex gap-1.5">
            <Button variant="outline" size="sm" className="h-8 gap-1 px-2.5 text-xs" disabled={!shown.length} onClick={() => void renderReportToExcel(table())}><Download className="h-3.5 w-3.5" />Excel</Button>
            <Button variant="outline" size="sm" className="h-8 gap-1 px-2.5 text-xs" disabled={!shown.length} onClick={() => void downloadReportPdf(table())}><FileText className="h-3.5 w-3.5" />PDF</Button>
          </div>
        </div>
        <div className={WS_TABLE_WRAP}>
          <table className={WS_TABLE}>
            <thead>
              <tr>
                <th className={WS_TH}>User</th><th className={WS_TH}>Level</th>
                <th className={`${WS_TH} text-right`}>Requests</th><th className={`${WS_TH} text-right`}>Input</th>
                <th className={`${WS_TH} text-right`}>Cache read</th><th className={`${WS_TH} text-right`}>Cache write</th>
                <th className={`${WS_TH} text-right`}>Output</th><th className={`${WS_TH} text-right`}>Total</th><th className={WS_TH}>Last used</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><td className={WS_TD} colSpan={9}><span className="text-muted-foreground">No use recorded yet.</span></td></tr>}
              {shown.map((r) => (
                <tr key={r.user_id} className={WS_TR}>
                  <td className={WS_TD}>{r.user_name ?? r.user_id}</td>
                  <td className={WS_TD}>{ROLE[r.user_role ?? ''] ?? r.user_role}</td>
                  <td className={WS_TD_NUM}>{fmt(r.requests)}</td>
                  <td className={WS_TD_NUM}>{fmt(Number(r.input_tokens))}</td>
                  <td className={WS_TD_NUM}>{fmt(Number(r.cache_read_tokens))}</td>
                  <td className={WS_TD_NUM}>{fmt(Number(r.cache_write_tokens))}</td>
                  <td className={WS_TD_NUM}>{fmt(Number(r.output_tokens))}</td>
                  <td className={WS_TD_NUM}>{fmt(Number(r.total_tokens))}</td>
                  <td className={WS_TD}>{new Date(r.last_used_at).toLocaleString('en-IN')}</td>
                </tr>
              ))}
              {shown.length > 0 && (
                <tr className={WS_TR_TOTAL}>
                  <td className={WS_TD}>TOTAL</td><td className={WS_TD} />
                  <td className={WS_TD_NUM}>{fmt(totals.requests)}</td><td className={WS_TD_NUM}>{fmt(totals.input)}</td>
                  <td className={WS_TD_NUM}>{fmt(totals.cacheRead)}</td><td className={WS_TD_NUM}>{fmt(totals.cacheWrite)}</td>
                  <td className={WS_TD_NUM}>{fmt(totals.output)}</td><td className={WS_TD_NUM}>{fmt(totals.total)}</td><td className={WS_TD} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
};

export default AssistantSettings;
