// "Fetch a report" (roadmap Phase 3; audit S-22, U-110-2): queue any portal
// pull the extension can make — notices, returns as filed, ledgers,
// statements — for picked clients or every active client, for a range of
// months or a financial year. The queue's runner logs each client in once — the
// scheduled Chrome, whose CAPTCHA extension fills the CAPTCHA, or the office
// agent, with one CAPTCHA on the wall — and the data is saved where the app's
// pages read it.
import React, { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DownloadCloud, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Note } from '@/components/gstr9/ui';
import { SectionCard } from '@/components/notices/ui/Panel';
import { WS_CONTROL } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { REPORTS_CATALOG } from '@/lib/reportsCatalog';
import {
  REPORT_MODES, enqueueJobs, modeDef, monthRange, periodLabel, periodsLabel, recentFys, recentMonths, type ReportMode, type RunnerMode,
} from '@/lib/autopilot';
import { plural } from '@/lib/noticeFormat';
import { ClientPicker, type PickClient } from './ClientPicker';
import { INLINE_LINK } from './parts';

const GROUPS: ReportMode['group'][] = ['Notices and cases', 'Returns as filed', 'Ledgers and statements', 'Registration and payments'];
const MAX_MONTHS = 24;

/** The Reports pages that show what a pull fetches (src/lib/reportsCatalog.ts). */
function reportsFor(mode: string): string[] {
  const asFiled = (t: string) => (/portal/i.test(t) ? 0 : 1);
  return REPORTS_CATALOG.filter((r) => r.pull?.mode === mode).map((r) => r.title).sort((a, b) => asFiled(a) - asFiled(b));
}

export const FetchReportTab: React.FC<{ runner: RunnerMode; onQueued: () => void }> = ({ runner, onQueued }) => {
  const uid = useId();
  const { user, canEditNoticeStatus } = useAuth();
  const qc = useQueryClient();
  const months = useMemo(() => recentMonths(36), []);
  const [mode, setMode] = useState('gstr3b_pull');
  const [who, setWho] = useState<'all' | 'pick'>('pick');
  const [picked, setPicked] = useState<string[]>([]);
  const [from, setFrom] = useState(months[0]);
  const [to, setTo] = useState(months[0]);
  const [fy, setFy] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ tone: 'success' | 'info' | 'warning'; text: string; mode: string } | null>(null);

  const clients = useQuery({
    queryKey: ['autopilot-clients'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PickClient[]> => {
      const { data, error } = await supabase.from('clients').select('id, name, gstin, gst_user_id, inactive_at_hand, notices_sync_excluded').order('name');
      if (error) throw error;
      return (data ?? []).map((c) => ({
        id: c.id, name: c.name, gstin: c.gstin, hasLogin: !!(c.gst_user_id ?? '').trim(), inactive: !!c.inactive_at_hand, excluded: !!c.notices_sync_excluded,
      }));
    },
  });

  const def = modeDef(mode) ?? REPORT_MODES[0];
  const fys = useMemo(() => recentFys(6, mode !== 'gstr9_pull'), [mode]);
  const fyValue = fys.some((f) => f.value === fy) ? fy : fys[0].value;
  const periods = def.period === 'month' ? monthRange(from, to) : def.period === 'fy' ? [fyValue] : [];
  const tooMany = def.period === 'month' && periods.length > MAX_MONTHS;
  const isBundle = mode === 'notices_bundle';
  const allActive = (clients.data ?? []).filter((c) => c.hasLogin && !c.inactive && !(isBundle && c.excluded)).length;
  const count = who === 'all' ? allActive : picked.length;
  const reports = reportsFor(mode);
  const canQueue = canEditNoticeStatus() && count > 0 && !tooMany && !busy;
  const chrome = runner === 'chrome';

  const queue = async () => {
    setBusy(true);
    const res = await enqueueJobs({
      clientIds: who === 'all' ? null : picked,
      jobType: isBundle ? 'PULL_NOTICES_BUNDLE' : 'FETCH_REPORT',
      mode, periods, origin: isBundle ? 'manual' : 'report',
      actor: user ? { id: user.id, firstName: user.firstName } : null,
    });
    setBusy(false);
    if (!res.ok) { toast.error(res.error); return; }
    setLast({ tone: res.tone, text: res.text, mode });
    toast[res.tone === 'warning' ? 'warning' : 'success'](res.text, {
      description: !res.result.queued ? undefined : chrome ? 'The scheduled Chrome takes them one at a time.' : 'The CAPTCHAs come to the CAPTCHA wall.',
    });
    qc.invalidateQueries({ queryKey: ['autopilot-queue'] });
    qc.invalidateQueries({ queryKey: ['autopilot-status'] });
    onQueued();
  };

  return (
    <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <SectionCard title="Fetch a report now" description={chrome
        ? 'Queue a portal pull for any clients. The scheduled Chrome logs each one in once (its CAPTCHA extension fills the CAPTCHA) and saves it where the app reads it.'
        : 'Queue a portal pull for any clients. The office agent logs each one in once — one CAPTCHA on the wall — and saves it where the app reads it.'}>
        {!canEditNoticeStatus() && <Note tone="info">Queueing a fetch needs the "Edit notice status" permission. You can look at the choices.</Note>}
        <div className="space-y-1">
          <Label htmlFor={`${uid}-mode`} className="text-xs">What to fetch</Label>
          <Select value={mode} onValueChange={(v) => { setMode(v); setLast(null); }}>
            <SelectTrigger id={`${uid}-mode`} className={`${WS_CONTROL} w-full sm:w-96`}><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-80">
              {GROUPS.map((g) => (
                <SelectGroup key={g}>
                  <SelectLabel className="text-[11px] text-foreground/70">{g}</SelectLabel>
                  {REPORT_MODES.filter((m) => m.group === g).map((m) => <SelectItem key={m.mode} value={m.mode} className="text-xs">{m.label}</SelectItem>)}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium">For which clients</legend>
          <RadioGroup value={who} onValueChange={(v) => setWho(v as 'all' | 'pick')} className="space-y-1.5">
            <div className="flex items-start gap-2">
              <RadioGroupItem value="pick" id={`${uid}-pick`} className="mt-0.5" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor={`${uid}-pick`} className="text-xs font-normal">Clients I pick</Label>
                {who === 'pick' && <ClientPicker clients={clients.data ?? []} value={picked} onChange={setPicked} disabled={clients.isLoading} />}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="all" id={`${uid}-all`} className="mt-0.5" />
              <Label htmlFor={`${uid}-all`} className="text-xs font-normal">
                Every active client with a portal login ({allActive}){isBundle ? ', except those excluded from the notices sync' : ''}
              </Label>
            </div>
          </RadioGroup>
        </fieldset>

        {def.period === 'month' && (
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium">Return periods</legend>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor={`${uid}-from`} className="text-[11px] text-muted-foreground">From</Label>
                <Select value={from} onValueChange={setFrom}>
                  <SelectTrigger id={`${uid}-from`} className={`${WS_CONTROL} w-36`}><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72">{months.map((m) => <SelectItem key={m} value={m} className="text-xs">{periodLabel(m)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${uid}-to`} className="text-[11px] text-muted-foreground">To</Label>
                <Select value={to} onValueChange={setTo}>
                  <SelectTrigger id={`${uid}-to`} className={`${WS_CONTROL} w-36`}><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72">{months.map((m) => <SelectItem key={m} value={m} className="text-xs">{periodLabel(m)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <p className="pb-1.5 text-xs text-muted-foreground">{plural(periods.length, 'month')}: {periodsLabel(mode, periods)}</p>
            </div>
            {tooMany && <p className="text-xs text-destructive-strong">Pick {MAX_MONTHS} months or fewer at a time.</p>}
          </fieldset>
        )}
        {def.period === 'fy' && (
          <div className="space-y-1">
            <Label htmlFor={`${uid}-fy`} className="text-xs">Financial year</Label>
            <Select value={fyValue} onValueChange={setFy}>
              <SelectTrigger id={`${uid}-fy`} className={`${WS_CONTROL} w-40`}><SelectValue /></SelectTrigger>
              <SelectContent>{fys.map((f) => <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>)}</SelectContent>
            </Select>
            {def.note && <p className="text-[11px] text-muted-foreground">{def.note}</p>}
            {mode === 'gstr9_pull' && <p className="text-[11px] text-muted-foreground">Only years whose GSTR-9 can have been filed are listed.</p>}
          </div>
        )}
        {def.period === 'none' && <p className="text-xs text-muted-foreground">No period to pick: the portal lists everything on record.</p>}

        <div className="flex flex-wrap items-center gap-2 border-t pt-2.5">
          <Button size="sm" className="h-8 gap-1 text-xs" disabled={!canQueue} onClick={queue}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <DownloadCloud className="h-3.5 w-3.5" aria-hidden />}
            Queue for {plural(count, 'client')}
          </Button>
          <span className="text-xs text-muted-foreground">
            About {plural(count, chrome ? 'login' : 'CAPTCHA')}{def.period === 'month' && periods.length > 1 ? `; each client's ${periods.length} months are read in one login` : ''}.
          </span>
        </div>
        {last && last.mode === mode && (
          <Note tone={last.tone === 'warning' ? 'warn' : 'info'} open>
            {last.text}{' '}
            <Link to={`/notices-autopilot?tab=queue&origin=${isBundle ? 'manual' : 'report'}`} className={INLINE_LINK}>See them in the queue</Link>
          </Note>
        )}
      </SectionCard>

      <SectionCard title="Where the results land" description="Each fetch also shows in the Queue tab while it runs.">
        {def.lands && (
          <p className="text-xs">
            <Link to={def.lands.to} className={INLINE_LINK}>{def.lands.label}</Link>{reports.length ? ', and in Reports:' : '.'}
          </p>
        )}
        {reports.length > 0 ? (
          <>
            {!def.lands && <p className="text-xs">In <Link to="/reports" className={INLINE_LINK}>Reports</Link>:</p>}
            <ul className="list-disc space-y-0.5 pl-4 text-xs">
              {reports.slice(0, 6).map((r) => <li key={r}>{r}</li>)}
              {reports.length > 6 && <li>and {reports.length - 6} more</li>}
            </ul>
            {def.lands && <p className="text-xs"><Link to="/reports" className={INLINE_LINK}>Open Reports</Link></p>}
          </>
        ) : !def.lands && <p className="text-xs text-muted-foreground">Saved on the client's record.</p>}
        <p className="text-[11px] text-muted-foreground">
          Nothing is filed or changed on the portal: every fetch only reads. A client already queued for the same fetch keeps its place.
        </p>
      </SectionCard>
    </div>
  );
};

export default FetchReportTab;
