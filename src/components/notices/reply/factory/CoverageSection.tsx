// (a) Due dates on open notices (roadmap Phase 4 acceptance, target ≥ 98%;
// audit R-28, S-27): how many open notices carry the date they run on — a
// reply date, a hearing, an appeal period, or "no reply needed" — by what the
// date is and where it came from, and the notices still without one, by
// form, each a link to its notice. Counts are reply_factory_status(); the
// lists are notice_due_coverage(), the function those counts come from.
import React, { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/gstr9/badge';
import { SectionCard } from '@/components/gstr9/ui';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR, WS_TR_HEADING, WS_TR_TOTAL } from '@/components/workspace/theme';
import { Pager } from '@/components/notices/Pager';
import { INLINE_LINK } from '@/components/notices/autopilot/parts';
import {
  DUE_COVERAGE_TARGET, coverageKindLabel, coverageKinds, factoryHref, fmtShare, sourceLabel, targetTone, useCoverageRows, useListPage,
  type CoverageItem, type ReplyFactoryStatus,
} from '@/lib/replyFactory';
import { fmtDate, plural } from '@/lib/noticeFormat';
import { CountLink, DrillFrame, NoticeCell, TargetMark } from './parts';
import { cn } from '@/lib/utils';

const UNKNOWN_FORM = '(unknown)';

type CovFilter = { kind?: string; covered?: boolean; source?: string; form?: string };

function parseFilter(show: string, sp: URLSearchParams): CovFilter | null {
  if (!show.startsWith('cov:')) return null;
  const k = show.slice(4);
  const form = sp.get('cform') || undefined;
  if (k === 'all') return { form };
  if (k === 'covered') return { covered: true, form };
  if (k === 'src') return { source: sp.get('src') || 'none', form };
  return /^[a-z_]+$/.test(k) ? { kind: k, form } : null;
}

function filterTitle(f: CovFilter): string {
  const formWords = f.form ? ` · ${f.form === UNKNOWN_FORM ? 'form not known' : f.form}` : '';
  if (f.kind === 'missing') return `Open notices without a date${formWords}`;
  if (f.kind) return `Open notices running on: ${coverageKindLabel(f.kind).toLowerCase()}${formWords}`;
  if (f.covered) return `Open notices with a date${formWords}`;
  if (f.source) return `Open notices whose date came from: ${sourceLabel(f.source).toLowerCase()}${formWords}`;
  return `Every open notice${formWords}`;
}

const matches = (r: CoverageItem, f: CovFilter) => (!f.kind || r.kind === f.kind)
  && (!f.covered || r.kind !== 'missing')
  && (!f.source || (r.source ?? 'none') === f.source)
  && (!f.form || (r.form_code ?? UNKNOWN_FORM) === f.form);

export const CoverageSection: React.FC<{ s: ReplyFactoryStatus; show: string }> = ({ s, show }) => {
  const [sp] = useSearchParams();
  const c = s.due_coverage;
  const filter = parseFilter(show, sp);
  const href = (k: string, extra: Record<string, string> = {}) => factoryHref('overview', { show: `cov:${k}`, ...extra });
  const missing = c.by_kind.missing ?? 0;
  const sources = Object.entries(c.by_source).sort((a, b) => b[1] - a[1]);
  const forms = Object.entries(c.missing_by_form).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const tone = targetTone(c.share, DUE_COVERAGE_TARGET);

  return (
    <SectionCard
      title="Due dates on open notices"
      description={`Target: at least ${DUE_COVERAGE_TARGET}% of open notices carry the date they run on — a reply date, a hearing, an appeal period, or "no reply needed".`}
      actions={<Badge variant={tone === 'ok' ? 'success' : tone === 'warn' ? 'warning' : tone === 'error' ? 'destructive' : 'secondary'} className="text-xs tabular-nums">
        {fmtShare(c.share)}<TargetMark ok={c.share === null ? null : c.share >= DUE_COVERAGE_TARGET} what={`the ${DUE_COVERAGE_TARGET}% target`} />
      </Badge>}
    >
      <p className="text-sm">
        <CountLink to={href('covered')} n={c.covered} /> of <CountLink to={href('all')} n={c.open} /> open notices have a date
        ({fmtShare(c.share)}) · <CountLink to={href('missing')} n={missing} strong /> {missing === 1 ? 'has' : 'have'} none.
      </p>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className={WS_TABLE_WRAP}>
          <table className={WS_TABLE}>
            <caption className="sr-only">Open notices by what their date is</caption>
            <thead><tr><th scope="col" className={WS_TH}>What the date is</th><th scope="col" className={cn(WS_TH, 'text-right')}>Notices</th></tr></thead>
            <tbody>
              {coverageKinds(c.by_kind).map((k) => (
                <tr key={k.key} className={WS_TR}>
                  <th scope="row" className={cn(WS_TD, 'text-left font-normal')}>
                    <span className={cn('text-sm', k.key === 'missing' && 'font-medium')}>{k.label}</span>
                    {k.hint && <span className="block text-[11px] text-muted-foreground">{k.hint}</span>}
                  </th>
                  <td className={WS_TD_NUM}><CountLink to={href(k.key)} n={c.by_kind[k.key] ?? 0} strong={k.key === 'missing'} label={k.label} /></td>
                </tr>
              ))}
              <tr className={WS_TR_TOTAL}>
                <th scope="row" className={cn(WS_TD, 'text-left')}>Open notices</th>
                <td className={WS_TD_NUM}><CountLink to={href('all')} n={c.open} label="open notices" /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className={WS_TABLE_WRAP}>
          <table className={WS_TABLE}>
            <caption className="sr-only">Open notices by where their date came from</caption>
            <thead><tr><th scope="col" className={WS_TH}>Where the date came from</th><th scope="col" className={cn(WS_TH, 'text-right')}>Notices</th></tr></thead>
            <tbody>
              {sources.map(([src, n]) => (
                <tr key={src} className={WS_TR}>
                  <th scope="row" className={cn(WS_TD, 'text-left text-sm font-normal')}>{sourceLabel(src)}</th>
                  <td className={WS_TD_NUM}><CountLink to={href('src', { src })} n={n} strong={src === 'none'} label={sourceLabel(src)} /></td>
                </tr>
              ))}
              {sources.length === 0 && <tr><td colSpan={2} className={cn(WS_TD, 'text-center text-xs text-muted-foreground')}>No open notices.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {forms.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-medium">Still without a date, by form:</span>
          {forms.map(([form, n]) => (
            <Link key={form} to={href('missing', { cform: form })}
              className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-card px-2 py-0.5 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {form === UNKNOWN_FORM ? 'Form not known' : form} <span className="tabular-nums">{n}</span>
            </Link>
          ))}
        </div>
      )}

      {filter && <CoverageList filter={filter} />}
    </SectionCard>
  );
};

const CoverageList: React.FC<{ filter: CovFilter }> = ({ filter }) => {
  const q = useCoverageRows(true);
  const pager = useListPage();
  // Notices without a date are listed by form; the others by the date they run on.
  const byForm = filter.kind === 'missing';
  const rows = useMemo(() => (q.data ?? []).filter((r) => matches(r, filter)).sort((a, b) =>
    (byForm ? Number(a.form_code === null) - Number(b.form_code === null) || (a.form_code ?? '').localeCompare(b.form_code ?? '') : 0)
    || (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999') || (a.notice?.issue_date ?? '').localeCompare(b.notice?.issue_date ?? '')), [q.data, filter, byForm]);
  const pageRows = pager.slice(rows);
  const formCount = (f: string | null) => rows.filter((r) => (r.form_code ?? null) === f).length;
  const newGroup = (i: number) => byForm && (i === 0 || (pageRows[i - 1].form_code ?? null) !== (pageRows[i].form_code ?? null));
  const groupTitle = (f: string | null) => `${f ?? 'Form not known'} · ${plural(formCount(f), 'notice')}`;
  // Consecutive rows of one form (one group in all when not listing by form).
  const groups = pageRows.reduce<{ key: string; form: string | null; rows: CoverageItem[] }[]>((out, r, i) => {
    if (newGroup(i) || out.length === 0) out.push({ key: `${r.form_code ?? '-'}-${i}`, form: r.form_code ?? null, rows: [] });
    out[out.length - 1].rows.push(r);
    return out;
  }, []);
  return (
    <DrillFrame title={filterTitle(filter)} count={q.data ? rows.length : null} closeTo={factoryHref('overview', { show: 'none' })}
      loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} empty="No open notice matches.">
      {filter.kind === 'missing' && (
        <p className="text-xs text-foreground/80">
          Open each notice and type its due date (or the hearing date) from the notice itself; once a date is there it counts as covered.
        </p>
      )}
      <ul className="space-y-1.5 md:hidden">
        {pageRows.map((r, i) => (
          <li key={r.notice_id} className="space-y-1.5">
            {newGroup(i) && <h4 className="pt-1 text-xs font-semibold">{groupTitle(r.form_code)}</h4>}
            <div className="space-y-1 rounded-md border bg-card p-2.5">
              <NoticeCell n={r.notice} id={r.notice_id} />
              <div className="text-xs">
                {r.kind === 'missing' ? <span className="font-medium text-destructive-strong">No date</span>
                  : <>{coverageKindLabel(r.kind)} <span className="font-medium">{fmtDate(r.due_on)}</span></>}
                {r.kind !== 'missing' && <span className="text-muted-foreground"> · {sourceLabel(r.source)}</span>}
              </div>
              <div className="text-[11px] text-muted-foreground">Issued {fmtDate(r.notice?.issue_date)}</div>
            </div>
          </li>
        ))}
      </ul>
      <div className={cn(WS_TABLE_WRAP, 'hidden md:block')}>
        <table className={WS_TABLE}>
          <caption className="sr-only">{filterTitle(filter)}</caption>
          <thead>
            <tr>
              <th scope="col" className={WS_TH}>Notice</th>
              <th scope="col" className={WS_TH}>Issued</th>
              <th scope="col" className={WS_TH}>The date it runs on</th>
              {!byForm && <th scope="col" className={WS_TH}>Where it came from</th>}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.key}>
              {byForm && (
                <tr className={WS_TR_HEADING}><th scope="rowgroup" colSpan={3} className={cn(WS_TD, 'text-left text-xs')}>{groupTitle(g.form)}</th></tr>
              )}
              {g.rows.map((r) => (
                <tr key={r.notice_id} className={WS_TR}>
                  <td className={cn(WS_TD, 'max-w-[20rem]')}><NoticeCell n={r.notice} id={r.notice_id} /></td>
                  <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>{fmtDate(r.notice?.issue_date)}</td>
                  <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>
                    {r.kind === 'missing' ? <span className="font-medium text-destructive-strong">No date</span>
                      : <><span className="font-medium">{fmtDate(r.due_on)}</span> <span className="text-muted-foreground">({coverageKindLabel(r.kind).toLowerCase()})</span></>}
                  </td>
                  {!byForm && <td className={cn(WS_TD, 'text-xs')}>{r.kind === 'missing' ? '—' : sourceLabel(r.source)}</td>}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <Pager page={pager.page} pageSize={pager.pageSize} total={rows.length} onPage={pager.setPage} />
      {filter.kind === 'missing' && rows.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {plural(rows.length, 'notice')} · the same notices are in{' '}
          <Link to="/notices-all?filter=nodue" className={INLINE_LINK}>All notices without a due date</Link>, which also lists notices with only a hearing or an appeal clock.
        </p>
      )}
    </DrillFrame>
  );
};

export default CoverageSection;
