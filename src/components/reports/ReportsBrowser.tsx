import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMonthSelect } from '@/components/ui/searchable-month-select';
import {
  FileSpreadsheet, FileText, Loader2, Search, Star, X, LayoutGrid,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  REPORT_CATEGORY_LABELS,
  REPORT_CATEGORY_ORDER,
  REPORT_STATUS_META,
  type ReportCategory,
  type ReportDefinition,
  type ReportStatus,
} from '@/lib/reportRegistry';

const PIN_STORAGE_KEY = 'gstk_pinned_reports_v1';
const STATUS_ORDER: ReportStatus[] = ['ready', 'ready-approx', 'extends-login', 'new-login', 'ai-assisted'];

interface ClientLite { id: string; name: string; gstin: string; }

export interface ReportsBrowserProps {
  reports: ReportDefinition[];
  monthOptions: { value: string; label: string }[];
  selectedMonth: string;
  onMonthChange: (value: string) => void;
  clients: ClientLite[];
  selectedClientId: string;
  onClientChange: (value: string) => void;
  fyLabel: string;
  busy: { key: string; format: 'xlsx' | 'pdf' } | null;
  onDownload: (report: ReportDefinition, format: 'xlsx' | 'pdf') => void;
}

const loadPinned = (): Set<string> => {
  try {
    const raw = localStorage.getItem(PIN_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
};

export const ReportsBrowser: React.FC<ReportsBrowserProps> = ({
  reports, monthOptions, selectedMonth, onMonthChange, clients, selectedClientId, onClientChange,
  fyLabel, busy, onDownload,
}) => {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<ReportCategory | 'all'>('all');
  const [activeStatuses, setActiveStatuses] = useState<Set<ReportStatus>>(new Set());
  const [pinned, setPinned] = useState<Set<string>>(() => loadPinned());
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses search from anywhere on the page, unless already typing
  // somewhere else — the same convenience power users expect from Linear,
  // GitHub, Notion, etc.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const togglePin = (key: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify([...next])); } catch { /* best-effort only */ }
      return next;
    });
  };

  const toggleStatus = (status: ReportStatus) => {
    setActiveStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      return next;
    });
  };

  const categoryCounts = useMemo(() => {
    const counts = new Map<ReportCategory, number>();
    for (const r of reports) counts.set(r.category, (counts.get(r.category) || 0) + 1);
    return counts;
  }, [reports]);

  const filteredReports = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reports.filter((r) => {
      if (activeCategory !== 'all' && r.category !== activeCategory) return false;
      if (activeStatuses.size > 0 && !activeStatuses.has(r.status)) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        REPORT_CATEGORY_LABELS[r.category].toLowerCase().includes(q)
      );
    });
  }, [reports, search, activeCategory, activeStatuses]);

  const pinnedReports = useMemo(
    () => reports.filter((r) => pinned.has(r.key)),
    [reports, pinned],
  );

  // Grouped-by-category view is the "browse everything" experience; a flat
  // list takes over the moment the user narrows things down (search, a
  // status filter, or a specific category) — grouping headers only help
  // when scanning the whole catalog.
  const isBrowsingAll = activeCategory === 'all' && !search.trim() && activeStatuses.size === 0;
  const grouped = useMemo(() => {
    if (!isBrowsingAll) return null;
    const map = new Map<ReportCategory, ReportDefinition[]>();
    for (const cat of REPORT_CATEGORY_ORDER) {
      const rows = reports.filter((r) => r.category === cat);
      if (rows.length) map.set(cat, rows);
    }
    return map;
  }, [isBrowsingAll, reports]);

  const needsMonth = (r: ReportDefinition) => r.needs === 'month' || r.needs === 'client+month';
  const needsClient = (r: ReportDefinition) => r.needs === 'client+month' || r.needs === 'client';
  const isReportDisabled = (r: ReportDefinition) =>
    (needsMonth(r) && !selectedMonth) || (needsClient(r) && !selectedClientId);
  const missingInputHint = (r: ReportDefinition): string | null => {
    const missingMonth = needsMonth(r) && !selectedMonth;
    const missingClient = needsClient(r) && !selectedClientId;
    if (missingMonth && missingClient) return 'Pick a month and a client first';
    if (missingMonth) return 'Pick a month first';
    if (missingClient) return 'Pick a client first';
    return null;
  };

  const hasFilters = search.trim() || activeCategory !== 'all' || activeStatuses.size > 0;
  const clearFilters = () => { setSearch(''); setActiveCategory('all'); setActiveStatuses(new Set()); };

  const ReportRow: React.FC<{ report: ReportDefinition }> = ({ report }) => {
    const Icon = report.icon;
    const xlsxBusy = busy?.key === report.key && busy.format === 'xlsx';
    const pdfBusy = busy?.key === report.key && busy.format === 'pdf';
    const disabled = isReportDisabled(report);
    const hint = missingInputHint(report);
    const statusMeta = REPORT_STATUS_META[report.status];
    const isPinned = pinned.has(report.key);

    return (
      <div className="group flex items-start gap-3 px-3 py-3 rounded-lg hover:bg-muted/50 transition-colors">
        <div className="shrink-0 rounded-md bg-primary/10 p-2 mt-0.5">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm leading-tight">{report.title}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Badge variant={statusMeta.badgeVariant} className="shrink-0 cursor-default">{statusMeta.shortLabel}</Badge>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">{statusMeta.label}</TooltipContent>
            </Tooltip>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{report.description}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:bg-muted"
                onClick={() => togglePin(report.key)}
                aria-label={isPinned ? `Unpin ${report.title}` : `Pin ${report.title}`}
              >
                <Star className={cn('h-4 w-4', isPinned ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{isPinned ? 'Unpin' : 'Pin to top'}</TooltipContent>
          </Tooltip>
          {(() => {
            const excelBtn = (
              <Button
                onClick={() => onDownload(report, 'xlsx')}
                disabled={disabled || xlsxBusy}
                variant="outline"
                size="sm"
                aria-label={`Download ${report.title} as Excel`}
              >
                {xlsxBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" /> : <FileSpreadsheet className="h-3.5 w-3.5 sm:mr-1.5" />}
                <span className="hidden sm:inline">Excel</span>
              </Button>
            );
            return disabled && hint ? (
              <Tooltip><TooltipTrigger asChild><span>{excelBtn}</span></TooltipTrigger><TooltipContent side="top">{hint}</TooltipContent></Tooltip>
            ) : excelBtn;
          })()}
          {(() => {
            const pdfBtn = (
              <Button
                onClick={() => onDownload(report, 'pdf')}
                disabled={disabled || pdfBusy}
                variant="outline"
                size="sm"
                aria-label={`Download ${report.title} as PDF`}
              >
                {pdfBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" /> : <FileText className="h-3.5 w-3.5 sm:mr-1.5" />}
                <span className="hidden sm:inline">PDF</span>
              </Button>
            );
            return disabled && hint ? (
              <Tooltip><TooltipTrigger asChild><span>{pdfBtn}</span></TooltipTrigger><TooltipContent side="top">{hint}</TooltipContent></Tooltip>
            ) : pdfBtn;
          })()}
        </div>
      </div>
    );
  };

  const CategoryNavItem: React.FC<{ cat: ReportCategory | 'all'; label: string; count: number }> = ({ cat, label, count }) => {
    const active = activeCategory === cat;
    const disabled = cat !== 'all' && count === 0;
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setActiveCategory(cat)}
        className={cn(
          'w-full flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm text-left transition-colors',
          active ? 'bg-primary text-primary-foreground font-medium' : 'text-foreground hover:bg-muted',
          disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent',
        )}
      >
        <span className="truncate">{label}</span>
        <span className={cn('text-xs tabular-nums shrink-0', active ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{count}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Sidebar — desktop only; mobile/tablet gets an inline category select in the toolbar below */}
      <aside className="hidden lg:block w-60 shrink-0">
        <div className="sticky top-4 space-y-4">
          {pinnedReports.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 px-3 mb-1.5">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pinned</span>
              </div>
              <div className="space-y-0.5">
                {pinnedReports.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => { setActiveCategory('all'); setSearch(r.title); }}
                    className="w-full text-left truncate rounded-md px-3 py-1 text-sm text-foreground hover:bg-muted transition-colors"
                    title={r.title}
                  >
                    {r.title}
                  </button>
                ))}
              </div>
              <Separator className="mt-3" />
            </div>
          )}
          <div className="space-y-0.5">
            <CategoryNavItem cat="all" label="All Reports" count={reports.length} />
            {REPORT_CATEGORY_ORDER.map((cat) => (
              <CategoryNavItem key={cat} cat={cat} label={REPORT_CATEGORY_LABELS[cat]} count={categoryCounts.get(cat) || 0} />
            ))}
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="min-w-0 flex-1 space-y-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search reports… (press /)"
                  className="pl-9"
                  aria-label="Search reports"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="lg:hidden w-44">
                <SearchableSelect
                  options={[{ value: 'all', label: `All Reports (${reports.length})` }, ...REPORT_CATEGORY_ORDER.map((cat) => ({ value: cat, label: `${REPORT_CATEGORY_LABELS[cat]} (${categoryCounts.get(cat) || 0})` }))]}
                  value={activeCategory}
                  onValueChange={(v) => setActiveCategory(v as ReportCategory | 'all')}
                  placeholder="Category"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium whitespace-nowrap text-muted-foreground">Month</span>
                <div className="w-36">
                  <SearchableMonthSelect options={monthOptions} value={selectedMonth} onValueChange={onMonthChange} placeholder="Select" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium whitespace-nowrap text-muted-foreground">Client</span>
                <div className="w-52">
                  <SearchableSelect
                    options={clients.map((c) => ({ value: c.id, label: c.name, sublabel: c.gstin }))}
                    value={selectedClientId}
                    onValueChange={onClientChange}
                    placeholder="Any client"
                    searchPlaceholder="Type to search…"
                    emptyText="No clients found."
                  />
                </div>
              </div>
            </div>
            {fyLabel && (
              <p className="text-xs text-muted-foreground">Per-client reports that span a year use {fyLabel}.</p>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground mr-1">Status:</span>
              {STATUS_ORDER.map((status) => {
                const meta = REPORT_STATUS_META[status];
                const active = activeStatuses.has(status);
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => toggleStatus(status)}
                    className={cn(
                      'text-xs rounded-full border px-2.5 py-0.5 font-medium transition-colors',
                      active ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent text-muted-foreground border-border hover:border-primary/50 hover:text-foreground',
                    )}
                  >
                    {meta.shortLabel}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {isBrowsingAll ? <>{reports.length} reports</> : <>Showing <span className="font-medium text-foreground">{filteredReports.length}</span> of {reports.length}</>}
          </p>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 text-xs text-muted-foreground">
              <X className="h-3 w-3 mr-1" /> Clear filters
            </Button>
          )}
        </div>

        {grouped ? (
          <Card>
            <CardContent className="p-2 divide-y divide-border">
              {[...grouped.entries()].map(([cat, rows]) => (
                <div key={cat} className="py-3 first:pt-2 last:pb-2">
                  <div className="flex items-center gap-2 px-3 mb-1">
                    <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{REPORT_CATEGORY_LABELS[cat]}</h3>
                    <span className="text-xs text-muted-foreground">({rows.length})</span>
                  </div>
                  <div className="divide-y divide-border/60">
                    {rows.map((r) => <ReportRow key={r.key} report={r} />)}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : filteredReports.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center">
              <p className="text-sm text-muted-foreground">No reports match your filters.</p>
              <Button variant="link" size="sm" onClick={clearFilters}>Clear filters</Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-2 divide-y divide-border/60">
              {filteredReports.map((r) => <ReportRow key={r.key} report={r} />)}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default ReportsBrowser;
