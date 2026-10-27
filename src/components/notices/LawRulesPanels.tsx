// The law the notices module counts with, and the holidays it skips (the law
// audit of 26 Oct 2026: L15 holidays in the working-day clocks, L16 nothing had
// ever been confirmed by a partner). Every period, percentage, form rule and
// limitation year is shown with whether a partner has confirmed it; a GST
// Manager or the superadmin confirms one, correcting it in the same step
// (litigation_rule_confirm, notice_form_rule_confirm, gst_limitation_year_confirm,
// 20261026130000). Holidays: gst_holiday_set (20261026100000).
import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { Panel } from '@/components/notices/ui/Panel';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TH, WS_TR } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { canManageNoticeTypes } from '@/lib/noticeTypes';
import { fmtDate } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

type Rule = Database['public']['Tables']['litigation_rules']['Row'];
type FormRule = Database['public']['Tables']['notice_form_rules']['Row'];
type Year = Database['public']['Tables']['gst_limitation_years']['Row'];
type Holiday = Database['public']['Tables']['gst_holidays']['Row'];

const answer = (data: unknown) => {
  const r = data as { error?: string } | null;
  if (r?.error) throw new Error(r.error);
};

const Confirmed: React.FC<{ at: string | null; by: string | null }> = ({ at, by }) => at
  ? <span className="inline-flex items-center gap-1 text-[11px] text-success"><Check className="h-3 w-3" aria-hidden />{by ?? 'Confirmed'} · {fmtDate(at.slice(0, 10))}</span>
  : <span className="text-[11px] font-medium text-warning">Not confirmed</span>;

// ── Holidays ────────────────────────────────────────────────────────────────
export const HolidaysPanel: React.FC = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEdit = canManageNoticeTypes(user?.role);
  const [day, setDay] = useState('');
  const [name, setName] = useState('');
  const list = useQuery({
    queryKey: ['gst-holidays'],
    queryFn: async () => {
      const { data, error } = await supabase.from('gst_holidays').select('*').gte('day', `${new Date().getFullYear() - 1}-01-01`).order('day');
      if (error) throw error;
      return (data ?? []) as Holiday[];
    },
  });
  const set = async (d: string, n: string, active: boolean) => {
    try {
      const { data, error } = await supabase.rpc('gst_holiday_set', { p_day: d, p_name: n, p_active: active, p_actor: user?.firstName ?? null });
      if (error) throw error;
      answer(data);
      qc.invalidateQueries({ queryKey: ['gst-holidays'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the holiday');
    }
  };
  return (
    <Panel title={`Holidays · ${list.data?.filter((h) => h.is_active).length ?? 0}`}
      info="Days the working-day clocks skip besides Sundays (REG-03, REG-17, REG-23). The fixed national holidays are filled in; add the movable and state ones the officers keep. A holiday switched off counts as a working day again.">
      {list.isLoading ? <Skeleton className="h-12 w-full" /> : (
        <ul className="divide-y">
          {(list.data ?? []).map((h) => (
            <li key={h.day} className="flex items-center gap-2 py-1.5 text-sm">
              <span className="w-28 font-mono text-[12px]">{fmtDate(h.day)}</span>
              <span className={cn('min-w-0 flex-1 truncate', !h.is_active && 'text-muted-foreground line-through')}>{h.name}</span>
              <Switch checked={h.is_active} disabled={!canEdit} aria-label={`Keep ${h.name}`} onCheckedChange={(v) => set(h.day, h.name, v)} />
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="h-8 w-40" aria-label="Holiday date" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Diwali" className="h-8 w-48" />
          <Button size="sm" className={WS_BTN} disabled={!day || !name.trim()} onClick={() => { set(day, name.trim(), true); setDay(''); setName(''); }}>Add</Button>
        </div>
      )}
    </Panel>
  );
};

// ── Law rules ───────────────────────────────────────────────────────────────
type Tab = 'periods' | 'forms' | 'years';

export const LawRulesPanel: React.FC = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEdit = canManageNoticeTypes(user?.role);
  const [tab, setTab] = useState<Tab>('periods');
  const [edit, setEdit] = useState<Record<string, string>>({});
  const data = useQuery({
    queryKey: ['notice-law-rules'],
    queryFn: async () => {
      const [r, f, y] = await Promise.all([
        supabase.from('litigation_rules').select('*').order('key'),
        supabase.from('notice_form_rules').select('*').eq('is_active', true).order('match_order'),
        supabase.from('gst_limitation_years').select('*').order('fy_start'),
      ]);
      if (r.error) throw r.error;
      if (f.error) throw f.error;
      // Before 20261026100000 there are no limitation years.
      return { rules: (r.data ?? []) as Rule[], forms: (f.data ?? []) as FormRule[], years: (y.error ? [] : y.data ?? []) as Year[] };
    },
  });
  const actor = { p_actor_id: user?.id ?? '', p_actor_name: user?.firstName ?? null };
  const run = async (call: () => PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    try {
      const { data: d, error } = await call();
      if (error) throw new Error(error.message);
      answer(d);
      toast.success('Confirmed');
      setEdit({});
      qc.invalidateQueries({ queryKey: ['notice-law-rules'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not confirm');
    }
  };
  const val = (k: string, fallback: string | number | null | undefined) => edit[k] ?? (fallback == null ? '' : String(fallback));
  const put = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setEdit((m) => ({ ...m, [k]: e.target.value }));
  const d = data.data;
  const open = (d?.rules.filter((r) => !r.confirmed_at).length ?? 0) + (d?.forms.filter((r) => !r.confirmed_at && (r.reply_days || r.appeal_section)).length ?? 0)
    + (d?.years.filter((r) => !r.confirmed_at).length ?? 0);
  return (
    <Panel title={`Law rules · ${open} not confirmed`}
      info="The periods, percentages, reply days and limitation dates every clock and key date counts with. Each was set by engineering judgement; a partner confirms it here, correcting the figure where the law or a notification says otherwise. Only a GST Manager or the superadmin can confirm.">
      <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Kind of rule">
        {([['periods', 'Periods and percentages'], ['forms', 'Forms'], ['years', 'Limitation by year']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}
            className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
              tab === k ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}>
            {label}
          </button>
        ))}
      </div>
      {data.isLoading || !d ? <Skeleton className="h-24 w-full" /> : (
        <div className={WS_TABLE_WRAP}>
          {tab === 'periods' && (
            <table className={WS_TABLE}>
              <thead><tr><th className={WS_TH}>Rule</th><th className={WS_TH}>Value</th><th className={WS_TH}>Status</th><th className={WS_TH} /></tr></thead>
              <tbody>
                {d.rules.map((r) => (
                  <tr key={r.key} className={WS_TR}>
                    <td className={WS_TD}><div className="font-mono text-[11px]">{r.key}</div><div className="text-xs text-muted-foreground">{r.note}</div></td>
                    <td className={WS_TD}>
                      <div className="flex items-center gap-1">
                        <Input className="h-7 w-20" inputMode="decimal" disabled={!canEdit} value={val(r.key, r.value)} onChange={put(r.key)} />
                        <span className="text-[11px] text-muted-foreground">{r.unit}</span>
                      </div>
                    </td>
                    <td className={WS_TD}><Confirmed at={r.confirmed_at} by={r.confirmed_by} /></td>
                    <td className={WS_TD}>
                      {canEdit && <Button size="sm" variant="outline" className={WS_BTN}
                        onClick={() => run(() => supabase.rpc('litigation_rule_confirm', { p_key: r.key, p_value: Number(val(r.key, r.value)), p_note: null, ...actor }))}>Confirm</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'forms' && (
            <table className={WS_TABLE}>
              <thead><tr><th className={WS_TH}>Form</th><th className={WS_TH}>Reply days</th><th className={WS_TH}>Appeal</th><th className={WS_TH}>Status</th><th className={WS_TH} /></tr></thead>
              <tbody>
                {d.forms.map((r) => {
                  const kd = `${r.form_code}:days`, kk = `${r.form_code}:kind`, ka = `${r.form_code}:appeal`;
                  return (
                    <tr key={r.form_code} className={WS_TR}>
                      <td className={WS_TD}><div className="text-sm font-medium">{r.form_code}</div><div className="text-xs text-muted-foreground">{r.label}{r.clock_basis ? ` · ${r.clock_basis}` : ''}</div></td>
                      <td className={WS_TD}>
                        <div className="flex items-center gap-1">
                          <Input className="h-7 w-16" inputMode="numeric" disabled={!canEdit} value={val(kd, r.reply_days)} onChange={put(kd)} />
                          <Input className="h-7 w-24" disabled={!canEdit} value={val(kk, r.reply_day_kind)} onChange={put(kk)} aria-label="calendar or working" />
                        </div>
                      </td>
                      <td className={WS_TD}><Input className="h-7 w-16" disabled={!canEdit} value={val(ka, r.appeal_section)} onChange={put(ka)} placeholder="none" aria-label="s107 or s112" /></td>
                      <td className={WS_TD}><Confirmed at={r.confirmed_at} by={r.confirmed_by} /></td>
                      <td className={WS_TD}>
                        {canEdit && <Button size="sm" variant="outline" className={WS_BTN}
                          onClick={() => run(() => supabase.rpc('notice_form_rule_confirm', {
                            p_form_code: r.form_code, p_reply_days: val(kd, r.reply_days) === '' ? null : Number(val(kd, r.reply_days)),
                            p_reply_day_kind: val(kk, r.reply_day_kind) || null, p_appeal_section: val(ka, r.appeal_section) || null, ...actor,
                          }))}>Confirm</Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {tab === 'years' && (
            <table className={WS_TABLE}>
              <thead><tr><th className={WS_TH}>FY</th><th className={WS_TH}>Annual return due</th><th className={WS_TH}>s.73 order by</th><th className={WS_TH}>s.74 order by</th><th className={WS_TH}>s.74A notice by</th><th className={WS_TH}>Status</th><th className={WS_TH} /></tr></thead>
              <tbody>
                {d.years.map((y) => {
                  const k = (c: string) => `${y.fy}:${c}`;
                  const date = (c: keyof Year) => (
                    <Input type="date" className="h-7 w-36" disabled={!canEdit} value={val(k(c), y[c] as string | null)} onChange={put(k(c))} />
                  );
                  return (
                    <tr key={y.fy} className={WS_TR}>
                      <td className={WS_TD}><div className="text-sm font-medium">{y.fy}</div><div className="text-xs text-muted-foreground">{y.s73_basis ?? y.annual_return_note}</div></td>
                      <td className={WS_TD}>{date('annual_return_due')}</td>
                      <td className={WS_TD}>{date('s73_order_by')}</td>
                      <td className={WS_TD}>{date('s74_order_by')}</td>
                      <td className={WS_TD}>{date('s74a_scn_by')}</td>
                      <td className={WS_TD}><Confirmed at={y.confirmed_at} by={y.confirmed_by} /></td>
                      <td className={WS_TD}>
                        {canEdit && <Button size="sm" variant="outline" className={WS_BTN}
                          onClick={() => run(() => supabase.rpc('gst_limitation_year_confirm', {
                            p_fy: y.fy, p_annual_return_due: val(k('annual_return_due'), y.annual_return_due),
                            p_s73_order_by: val(k('s73_order_by'), y.s73_order_by) || null, p_s74_order_by: val(k('s74_order_by'), y.s74_order_by) || null,
                            p_s74a_scn_by: val(k('s74a_scn_by'), y.s74a_scn_by) || null, ...actor,
                          }))}>Confirm</Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Panel>
  );
};
