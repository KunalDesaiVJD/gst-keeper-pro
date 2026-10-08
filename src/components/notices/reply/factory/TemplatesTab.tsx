// "Reply templates" (asked by the firm on 6 October 2026; contract §B, §C;
// docs/REPLY_TEMPLATES.md, REPLY_FACTORY_POSITIONS §12): the wording every
// prepared reply starts from, so the firm can read and change it without SQL.
// On top the signature block; then the templates by form (a template for
// several forms is listed under each; the general ones last), each with its
// stance, version, the notices holding an option from it and whether it is
// offered. Reading, the wording view and the preview are open to all staff;
// editing, New template, Duplicate and the switch are for a GST manager or the
// superadmin. Filters and the open template live in the URL (rq, rform,
// ractive, rt, rview; the Notice types tab uses tq, tneed, tdash). No text on
// this tab holds a hyphen or dash: it is the firm's reply area.
import React, { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Pencil, Plus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Note } from '@/components/gstr9/ui';
import { SectionCard } from '@/components/notices/ui/Panel';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_HEADING } from '@/components/workspace/theme';
import { FilterPill } from '@/components/notices/FilterPill';
import { EmptyBox, INLINE_LINK, LoadError } from '@/components/notices/autopilot/parts';
import { StanceChip } from '@/components/notices/workspace/ReplyOptions';
import { useAuth } from '@/contexts/AuthContext';
import { useNoticeTypes } from '@/lib/noticeTypes';
import { plural } from '@/lib/noticeFormat';
import {
  factoryHref, invalidateReplyTemplates, setTemplateActive, templateChangedWords, useReplyTemplates, useTemplateOptionCounts,
  type Actor, type ReplyTemplate,
} from '@/lib/replyFactory';
import { CountLink } from './parts';
import type { FormOption } from './FormsPicker';
import { SignatureCard } from './SignatureCard';
import { TemplateEditDialog, type TemplateEditState } from './TemplateEditDialog';
import { TemplateViewDialog, type TemplateView } from './TemplateViewDialog';
import { cn } from '@/lib/utils';

const GENERAL = 'general';
const GENERAL_TITLE = 'Any other notice (general)';

/** The notice type's name without the code in brackets at its end, as the replies name it. */
const cleanLabel = (label: string | null | undefined) => (label ? label.replace(/\s*\([^)]*\)\s*$/, '') : null);

interface Group { id: string; form: string | null; rows: ReplyTemplate[] }

function groupByForm(rows: ReplyTemplate[], only: string): Group[] {
  const m = new Map<string, ReplyTemplate[]>();
  for (const t of rows) {
    for (const f of t.forms.length ? t.forms : [GENERAL]) {
      if (only !== 'all' && f !== only) continue;
      if (!m.has(f)) m.set(f, []);
      m.get(f)?.push(t);
    }
  }
  return [...m.entries()]
    .sort(([a], [b]) => Number(a === GENERAL) - Number(b === GENERAL) || a.localeCompare(b))
    .map(([f, list]) => ({ id: f, form: f === GENERAL ? null : f, rows: [...list].sort((x, y) => x.sort - y.sort || x.key.localeCompare(y.key)) }));
}

export const TemplatesTab: React.FC = () => {
  const { user, canManageNoticeAlerts } = useAuth();
  const canEdit = canManageNoticeAlerts();
  const actor: Actor | null = user ? { id: user.id, firstName: user.firstName } : null;
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const tq = useReplyTemplates();
  const counts = useTemplateOptionCounts();
  const types = useNoticeTypes();
  const [editing, setEditing] = useState<TemplateEditState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const search = (sp.get('rq') ?? '').trim();
  const form = sp.get('rform') ?? 'all';
  const offered = sp.get('ractive') ?? 'all';
  const openKey = sp.get('rt');
  const rview = sp.get('rview');
  const view: TemplateView = rview === 'preview' || rview === 'notices' ? rview : 'wording';
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => { if (!v || v === 'all') next.delete(k); else next.set(k, v); });
    setSp(next);
  };
  const viewHref = (key: string, v?: TemplateView) => {
    const next = new URLSearchParams(sp);
    next.set('rt', key);
    if (v && v !== 'wording') next.set('rview', v); else next.delete('rview');
    return `?${next.toString()}`;
  };

  const templates = useMemo(() => tq.data ?? [], [tq.data]);
  const typeByCode = useMemo(() => new Map((types.data ?? []).filter((t) => t.form_code).map((t) => [t.form_code as string, t])), [types.data]);
  const formOptions: FormOption[] = useMemo(() => (types.data ?? []).filter((t) => t.form_code)
    .map((t) => ({ code: t.form_code as string, label: cleanLabel(t.label), need: t.response_need })), [types.data]);
  const ownForms = useMemo(() => [...new Set(templates.filter((t) => t.is_active).flatMap((t) => t.forms))].sort(), [templates]);
  const formsWithTemplates = useMemo(() => [...new Set(templates.flatMap((t) => t.forms))].sort(), [templates]);

  const needle = search.toLowerCase();
  const filtered = useMemo(() => templates.filter((t) => (offered === 'all' || (offered === 'on') === t.is_active)
    && (!needle || `${t.key} ${t.title} ${t.summary} ${t.forms.join(' ')} ${t.body}`.toLowerCase().includes(needle))), [templates, offered, needle]);
  const groups = useMemo(() => groupByForm(filtered, form), [filtered, form]);
  const shownCount = new Set(groups.flatMap((g) => g.rows.map((t) => t.key))).size;
  const total = templates.length;
  const onCount = templates.filter((t) => t.is_active).length;
  const generalCount = templates.filter((t) => t.forms.length === 0).length;

  const formTitle = useCallback((f: string | null) => {
    if (!f) return GENERAL_TITLE;
    const label = cleanLabel(typeByCode.get(f)?.label);
    return label ? `${f} · ${label}` : f;
  }, [typeByCode]);
  const formOptionsForFilter = useMemo(() => {
    const codes = [...new Set([...formsWithTemplates, ...formOptions.map((o) => o.code)])].sort();
    return codes.map((c) => {
      const n = templates.filter((t) => t.forms.includes(c)).length;
      return { value: c, label: `${formTitle(c)} (${n ? plural(n, 'template') : 'none of its own'})` };
    });
  }, [formsWithTemplates, formOptions, templates, formTitle]);

  const opened = openKey ? templates.find((t) => t.key === openKey) ?? null : null;
  const closeView = () => set({ rt: null, rview: null });

  const toggle = async (t: ReplyTemplate, on: boolean) => {
    setBusy(t.key);
    try {
      await setTemplateActive(t.key, on, actor);
      // A form left with no active template of its own falls back to the general ones (not a form that needs no reply).
      const orphaned = on ? [] : t.forms.filter((f) => typeByCode.get(f)?.response_need !== 'none'
        && !templates.some((o) => o.key !== t.key && o.is_active && o.forms.includes(f)));
      // The last general template switched off: a notice with no template of its own gets no prepared reply at all.
      const lastGeneral = !on && t.forms.length === 0 && !templates.some((o) => o.key !== t.key && o.is_active && o.forms.length === 0);
      toast.success(on
        ? `Switched on: open notices ${t.forms.length ? `of ${t.forms.join(', ')}` : 'with no template of their own'} get "${t.title}" now.`
        : `Switched off: open notices no longer get "${t.title}".${orphaned.length
          ? ` ${orphaned.join(', ')} ${orphaned.length === 1 ? 'has' : 'have'} no other active template, so ${orphaned.length === 1 ? 'its' : 'their'} notices get the general templates.` : ''}${lastGeneral
          ? ' No general template is on now, so a notice whose form has no template of its own gets no prepared reply.' : ''}`);
      invalidateReplyTemplates(qc);
    } catch (e) {
      toast.error(`Not changed. ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const chips: { key: string; label: string; clear: Record<string, null> }[] = [];
  if (form !== 'all') chips.push({ key: 'rform', label: `Form: ${form === GENERAL ? GENERAL_TITLE : form}`, clear: { rform: null } });
  if (offered !== 'all') chips.push({ key: 'ractive', label: offered === 'on' ? 'Offered on open notices' : 'Switched off', clear: { ractive: null } });
  if (search) chips.push({ key: 'rq', label: `Search: ${search}`, clear: { rq: null } });

  // A form picked in the filter: say what its notices actually get.
  const pickedType = form !== 'all' && form !== GENERAL ? typeByCode.get(form) : undefined;
  const pickedOwnActive = form !== 'all' && form !== GENERAL && ownForms.includes(form);

  return (
    <div className="space-y-3">
      <Note tone="info">
        Every open notice that needs a reply gets one reply per active template for its form, filled with its facts; a person picks one to start
        the draft. The wording is the firm's and holds no hyphen or dash of any kind: the database refuses one. Each template is a starting point
        a partner should review before its first use.
      </Note>
      {!canEdit && (
        <Note tone="info">Only a GST manager or the superadmin changes the templates and the signature block. You can read them and preview them on a notice.</Note>
      )}

      <SignatureCard canEdit={canEdit} actor={actor} />

      <SectionCard title="Templates"
        description="By form; a template for several forms is listed under each. Open one to read its wording or preview it on a notice."
        actions={canEdit ? (
          <Button size="sm" className={WS_BTN} onClick={() => setEditing({ mode: 'new', source: null })} disabled={!tq.data}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> New template
          </Button>
        ) : undefined}>
        {tq.data && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <Link to={factoryHref('templates')} className={INLINE_LINK}>{plural(total, 'template')}</Link>
            <span aria-hidden>·</span>
            <Link to={factoryHref('templates', { ractive: 'on' })} className={INLINE_LINK}>{onCount} offered on open notices</Link>
            <span aria-hidden>·</span>
            <Link to={factoryHref('templates', { ractive: 'off' })} className={INLINE_LINK}>{total - onCount} switched off</Link>
            <span aria-hidden>·</span>
            <Link to={factoryHref('templates', { rform: GENERAL })} className={INLINE_LINK}>{generalCount} general</Link>
            <span>for the forms without templates of their own</span>
          </p>
        )}

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input defaultValue={search} key={search} placeholder="Title, key or words" aria-label="Search the templates"
                onKeyDown={(e) => { if (e.key === 'Enter') set({ rq: (e.target as HTMLInputElement).value.trim() || null }); }}
                onBlur={(e) => { if ((e.target.value.trim() || null) !== (search || null)) set({ rq: e.target.value.trim() || null }); }}
                className="h-8 pl-7 text-xs" />
            </div>
            <FilterPill label="Form" allLabel="Every form" value={form} onChange={(v) => set({ rform: v })} options={[]} className="max-w-full"
              extraOptions={[{ value: GENERAL, label: `${GENERAL_TITLE} (${plural(generalCount, 'template')})` }, ...formOptionsForFilter]} />
            <FilterPill label="Offered" allLabel="On or off" value={offered} onChange={(v) => set({ ractive: v })} options={[]} className="max-w-full"
              extraOptions={[{ value: 'on', label: `Offered on open notices (${onCount})` }, { value: 'off', label: `Switched off (${total - onCount})` }]} />
          </div>
          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
              {chips.map((ch) => (
                <button key={ch.key} type="button" onClick={() => set(ch.clear)}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {ch.label} <X className="h-3 w-3" aria-hidden /><span className="sr-only">(remove this filter)</span>
                </button>
              ))}
              <button type="button" className="text-[11px] text-muted-foreground underline underline-offset-2" onClick={() => set({ rform: null, ractive: null, rq: null })}>
                Clear all
              </button>
            </div>
          )}
        </div>

        {pickedType?.response_need === 'none' && (
          <Note tone="warn">
            {form} needs no reply, so no replies are prepared for its notices. That is set on the{' '}
            <Link to={factoryHref('types')} className={INLINE_LINK}>Notice types</Link> tab.
          </Note>
        )}
        {form !== 'all' && form !== GENERAL && !pickedOwnActive && pickedType?.response_need !== 'none' && (
          <Note tone="warn">
            {form} has no active template of its own, so its open notices get the{' '}
            <Link to={factoryHref('templates', { rform: GENERAL })} className={INLINE_LINK}>general templates</Link>.
          </Note>
        )}

        {tq.error ? <LoadError what="the templates" error={tq.error} onRetry={() => tq.refetch()} />
          : tq.isLoading ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          : groups.length === 0 ? <EmptyBox>No template matches these filters.</EmptyBox>
          : (
            <>
              <h4 className="text-xs font-medium text-foreground/80" aria-live="polite">
                {plural(shownCount, 'template')}{groups.length > 1 ? ` in ${groups.length} groups` : ''}
              </h4>
              <div className="space-y-3 md:hidden">
                {groups.map((g) => (
                  <div key={g.id} className="space-y-1.5">
                    <h5 className="text-xs font-semibold">{formTitle(g.form)} <span className="font-normal text-foreground/70">· {plural(g.rows.length, 'template')}</span></h5>
                    <ul className="space-y-1.5">
                      {g.rows.map((t) => (
                        <TemplateCard key={t.key} t={t} n={counts.data?.get(t.key) ?? 0} canEdit={canEdit} busy={busy === t.key}
                          viewTo={viewHref(t.key)} noticesTo={viewHref(t.key, 'notices')} onToggle={(on) => toggle(t, on)}
                          onEdit={() => setEditing({ mode: 'edit', source: t })} onDuplicate={() => setEditing({ mode: 'duplicate', source: t })} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <div className={cn(WS_TABLE_WRAP, 'hidden md:block')}>
                <table className={WS_TABLE}>
                  <caption className="sr-only">Reply templates by form</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={WS_TH}>Template</th>
                      <th scope="col" className={WS_TH}>Stance</th>
                      <th scope="col" className={WS_TH}>Forms</th>
                      <th scope="col" className={cn(WS_TH, 'text-right')}>Version</th>
                      <th scope="col" className={cn(WS_TH, 'text-right')}>Notices</th>
                      <th scope="col" className={WS_TH}>Offered</th>
                      <th scope="col" className={WS_TH}>Last changed</th>
                      {canEdit && <th scope="col" className={WS_TH}><span className="sr-only">Actions</span></th>}
                    </tr>
                  </thead>
                  {groups.map((g) => (
                    <tbody key={g.id}>
                      <tr className={WS_TR_HEADING}>
                        <th scope="rowgroup" colSpan={canEdit ? 8 : 7} className={cn(WS_TD, 'text-left text-xs')}>
                          {formTitle(g.form)} <span className="font-normal text-foreground/70">· {plural(g.rows.length, 'template')}
                            {g.form === null ? ' · used when a notice\'s form has no active template of its own' : ''}</span>
                        </th>
                      </tr>
                      {g.rows.map((t) => {
                        const n = counts.data?.get(t.key) ?? 0;
                        return (
                          <tr key={t.key} className={cn(WS_TR, !t.is_active && 'bg-muted/40')}>
                            <td className={cn(WS_TD, 'min-w-[16rem] max-w-[26rem]')}>
                              <Link to={viewHref(t.key)} className={cn(INLINE_LINK, 'text-sm')}>{t.title}</Link>
                              {t.summary && <p className="mt-0.5 text-xs text-foreground/80">{t.summary}</p>}
                              <p className="font-mono text-[11px] text-foreground/70">{t.key}</p>
                            </td>
                            <td className={WS_TD}><StanceChip stance={t.stance} /></td>
                            <td className={cn(WS_TD, 'max-w-[12rem] text-xs')}><FormList forms={t.forms} /></td>
                            <td className={WS_TD_NUM}>{t.version}</td>
                            <td className={WS_TD_NUM}>
                              {counts.data ? <CountLink to={viewHref(t.key, 'notices')} n={n} label={n === 1 ? 'notice holds this reply' : 'notices hold this reply'} /> : ''}
                            </td>
                            <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>
                              {canEdit ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <Switch checked={t.is_active} disabled={busy === t.key} onCheckedChange={(on) => toggle(t, on)}
                                    aria-label={`Offer "${t.title}" on open notices`} />
                                  <span aria-hidden>{t.is_active ? 'On' : 'Off'}</span>
                                </span>
                              ) : (t.is_active ? 'On' : <span className="font-semibold">Off</span>)}
                            </td>
                            <td className={cn(WS_TD, 'text-xs text-foreground/80')}>{templateChangedWords(t)}</td>
                            {canEdit && (
                              <td className={cn(WS_TD, 'whitespace-nowrap')}>
                                <div className="flex gap-1">
                                  <Button size="sm" variant="outline" className={WS_BTN} onClick={() => setEditing({ mode: 'edit', source: t })}>
                                    <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit<span className="sr-only"> {t.title}</span>
                                  </Button>
                                  <Button size="sm" variant="outline" className={WS_BTN} onClick={() => setEditing({ mode: 'duplicate', source: t })}>
                                    <Copy className="h-3.5 w-3.5" aria-hidden /> Duplicate<span className="sr-only"> {t.title}</span>
                                  </Button>
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  ))}
                </table>
              </div>
            </>
          )}
      </SectionCard>

      <TemplateViewDialog t={opened} view={view} onView={(v) => set({ rview: v === 'wording' ? null : v })} onClose={closeView}
        count={opened && counts.data ? counts.data.get(opened.key) ?? 0 : null} ownForms={ownForms} canEdit={canEdit}
        onEdit={() => { if (opened) { setEditing({ mode: 'edit', source: opened }); closeView(); } }}
        onDuplicate={() => { if (opened) { setEditing({ mode: 'duplicate', source: opened }); closeView(); } }} />
      <TemplateEditDialog state={editing} templates={templates} formOptions={formOptions} ownForms={ownForms}
        onClose={() => setEditing(null)}
        onSaved={(key) => { const isNew = editing?.mode !== 'edit'; setEditing(null); if (isNew) set({ rt: key, rview: null }); }} />
    </div>
  );
};

/** Form codes keep their hyphen on one line ("REG-CANCEL-REJ", not "REG-" then "CANCEL-REJ"). */
const FormList: React.FC<{ forms: string[] }> = ({ forms }) => (forms.length === 0 ? <>General</> : (
  <>{forms.map((f, i) => <React.Fragment key={f}>{i > 0 && ', '}<span className="whitespace-nowrap">{f}</span></React.Fragment>)}</>
));

const TemplateCard: React.FC<{
  t: ReplyTemplate;
  n: number;
  canEdit: boolean;
  busy: boolean;
  viewTo: string;
  noticesTo: string;
  onToggle: (on: boolean) => void;
  onEdit: () => void;
  onDuplicate: () => void;
}> = ({ t, n, canEdit, busy, viewTo, noticesTo, onToggle, onEdit, onDuplicate }) => (
  <li className={cn('space-y-1.5 rounded-md border bg-card p-2.5', !t.is_active && 'bg-muted/40')}>
    <div className="flex items-start justify-between gap-2">
      <Link to={viewTo} className={cn(INLINE_LINK, 'min-w-0 break-words text-sm')}>{t.title}</Link>
      <StanceChip stance={t.stance} />
    </div>
    {t.summary && <p className="text-xs text-foreground/80">{t.summary}</p>}
    <p className="flex flex-wrap gap-x-2 text-[11px] text-foreground/70">
      <span className="font-mono">{t.key}</span>
      <span aria-hidden>·</span><span>Version {t.version}</span>
      <span aria-hidden>·</span><span>{t.forms.length ? <>For <FormList forms={t.forms} /></> : 'General'}</span>
    </p>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-1.5 text-xs">
      <span><CountLink to={noticesTo} n={n} /> {n === 1 ? 'notice holds' : 'notices hold'} this reply</span>
      {canEdit ? (
        <span className="inline-flex items-center gap-1.5">
          <Switch checked={t.is_active} disabled={busy} onCheckedChange={onToggle} aria-label={`Offer "${t.title}" on open notices`} />
          <span aria-hidden>{t.is_active ? 'On' : 'Off'}</span>
        </span>
      ) : <span className={cn(!t.is_active && 'font-semibold')}>{t.is_active ? 'Offered' : 'Switched off'}</span>}
    </div>
    <p className="text-[11px] text-foreground/70">{templateChangedWords(t)}</p>
    {canEdit && (
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" className={WS_BTN} onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit<span className="sr-only"> {t.title}</span>
        </Button>
        <Button size="sm" variant="outline" className={WS_BTN} onClick={onDuplicate}>
          <Copy className="h-3.5 w-3.5" aria-hidden /> Duplicate<span className="sr-only"> {t.title}</span>
        </Button>
      </div>
    )}
  </li>
);

export default TemplatesTab;
