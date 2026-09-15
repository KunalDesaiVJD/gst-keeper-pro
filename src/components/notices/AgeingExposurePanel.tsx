import React, { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

export interface NoticeForAgeing {
  id: string;
  client_id: string;
  staff_status: string | null;
  due_date: string | null;
  extended_due_date: string | null;
  amount_of_demand: number | null;
}

export interface ClientInfo {
  id: string;
  name: string;
}

export interface AgeingExposurePanelProps {
  notices: NoticeForAgeing[];
  clients: ClientInfo[];
  loading?: boolean;
}

const CLOSED_RE = /^(closed|withdrawn|dropped|disposed|deleted|adjudged)/i;

function isOpen(n: NoticeForAgeing): boolean {
  return !CLOSED_RE.test((n.staff_status ?? '').trim());
}

function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function effectiveDue(n: NoticeForAgeing): string | null {
  return n.extended_due_date || n.due_date || null;
}

function ageingDays(n: NoticeForAgeing, today: string): number | null {
  const due = effectiveDue(n);
  if (!due) return null;
  const diff = new Date(today).getTime() - new Date(due).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function formatAmount(v: number): string {
  if (v >= 1e7) return `₹ ${(v / 1e7).toFixed(1)} cr`;
  if (v >= 1e5) return `₹ ${(v / 1e5).toFixed(1)} L`;
  return `₹ ${v.toLocaleString('en-IN')}`;
}

interface Bucket {
  label: string;
  color: string;
  test: (days: number | null) => boolean;
}

const BUCKETS: Bucket[] = [
  { label: 'Not yet due', color: 'bg-emerald-500', test: (d) => d === null || d <= 0 },
  { label: '1–7 days late', color: 'bg-amber-400', test: (d) => d !== null && d >= 1 && d <= 7 },
  { label: '8–30 days late', color: 'bg-orange-500', test: (d) => d !== null && d >= 8 && d <= 30 },
  { label: '31–90 days late', color: 'bg-red-500', test: (d) => d !== null && d >= 31 && d <= 90 },
  { label: '90+ days late', color: 'bg-red-800', test: (d) => d !== null && d > 90 },
];

const DOMAIN_STAGE_COLORS: Record<string, string> = {
  'SCN / reply stage': '#f59e0b',
  'First appeal (s.107)': '#1e3a5f',
  'Recovery / attachment': '#ef4444',
  'Rectification / other': '#10b981',
};

const DOMAIN_STAGE_ORDER = [
  'SCN / reply stage',
  'First appeal (s.107)',
  'Recovery / attachment',
  'Rectification / other',
];

function domainStageOf(status: string | null): string {
  const s = (status ?? '').trim();
  if (/^appeal/i.test(s)) return 'First appeal (s.107)';
  if (/^(order|recovery|attachment|enforcement)/i.test(s)) return 'Recovery / attachment';
  if (/^rectif/i.test(s)) return 'Rectification / other';
  return 'SCN / reply stage';
}

function tableStageInfo(status: string | null): { label: string; color: string } {
  const s = (status ?? '').trim().toLowerCase();
  if (/appeal/.test(s)) return { label: 'Appeal', color: '#ef4444' };
  if (/recovery|attachment/.test(s)) return { label: 'Recovery', color: '#ef4444' };
  if (/order/.test(s)) return { label: 'Order', color: '#f97316' };
  if (/hearing/.test(s)) return { label: 'Hearing', color: '#1e3a5f' };
  if (/reply|draft/.test(s)) return { label: 'SCN reply', color: '#f59e0b' };
  if (/await|data|document/.test(s)) return { label: 'Awaiting data', color: '#0ea5e9' };
  if (/filed|submitted/.test(s)) return { label: 'Filed', color: '#10b981' };
  return { label: 'Captured', color: '#9ca3af' };
}

function AgeingBuckets({ notices }: { notices: NoticeForAgeing[] }) {
  const today = todayIST();
  const open = notices.filter(isOpen);

  const counts = BUCKETS.map((b) => ({
    ...b,
    count: open.filter((n) => b.test(ageingDays(n, today))).length,
  }));

  const max = Math.max(1, ...counts.map((c) => c.count));

  return (
    <div className="space-y-1.5">
      {counts.map((b) => (
        <div key={b.label} className="flex items-center gap-2.5">
          <span className="w-[120px] shrink-0 text-xs font-medium">{b.label}</span>
          <div className="flex-1 h-2 rounded-full bg-muted/40 overflow-hidden">
            <div
              className={cn('h-full rounded-full', b.color, 'transition-all')}
              style={{ width: `${(b.count / max) * 100}%` }}
            />
          </div>
          <span className="w-9 text-xs font-medium text-right tabular-nums text-muted-foreground">
            {b.count}
          </span>
        </div>
      ))}
    </div>
  );
}

function ExposureDonut({ notices }: { notices: NoticeForAgeing[] }) {
  const segments = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notices.filter(isOpen)) {
      const stage = domainStageOf(n.staff_status);
      map.set(stage, (map.get(stage) ?? 0) + (n.amount_of_demand ?? 0));
    }
    return DOMAIN_STAGE_ORDER
      .map((label) => ({
        label,
        color: DOMAIN_STAGE_COLORS[label],
        value: map.get(label) ?? 0,
      }))
      .filter((s) => s.value > 0);
  }, [notices]);

  const total = segments.reduce((a, s) => a + s.value, 0);

  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        <svg width="120" height="120" viewBox="0 0 160 160" className="block">
          {segments.length === 0 ? (
            <circle cx="80" cy="80" r={radius} fill="none" stroke="currentColor" className="text-muted/30" strokeWidth="20" />
          ) : (
            segments.map((seg) => {
              const pct = seg.value / total;
              const dashLen = pct * circumference;
              const el = (
                <circle
                  key={seg.label}
                  cx="80" cy="80" r={radius}
                  fill="none" stroke={seg.color} strokeWidth="20"
                  strokeDasharray={`${dashLen} ${circumference - dashLen}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 80 80)"
                  className="transition-all"
                />
              );
              offset += dashLen;
              return el;
            })
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="font-heading text-sm font-bold leading-tight">
            {total > 0 ? formatAmount(total) : '₹ 0'}
          </span>
          <span className="text-[10px] text-muted-foreground">under dispute</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
              <span className="truncate">{seg.label}</span>
            </span>
            <span className="shrink-0 font-bold tabular-nums">{formatAmount(seg.value)}</span>
          </div>
        ))}
        {segments.length === 0 && (
          <span className="text-xs text-muted-foreground">No exposure data</span>
        )}
      </div>
    </div>
  );
}

function TopExposureTable({ notices, clients }: { notices: NoticeForAgeing[]; clients: ClientInfo[] }) {
  const rows = useMemo(() => {
    const clientMap = new Map(clients.map((c) => [c.id, c.name]));
    const agg = new Map<string, { name: string; exposure: number; dominantStatus: string | null; dominantAmount: number }>();

    for (const n of notices) {
      if (!isOpen(n)) continue;
      const entry = agg.get(n.client_id) ?? { name: clientMap.get(n.client_id) ?? n.client_id, exposure: 0, dominantStatus: null, dominantAmount: 0 };
      entry.exposure += n.amount_of_demand ?? 0;
      if ((n.amount_of_demand ?? 0) > entry.dominantAmount) {
        entry.dominantAmount = n.amount_of_demand ?? 0;
        entry.dominantStatus = n.staff_status;
      }
      agg.set(n.client_id, entry);
    }

    return Array.from(agg.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.exposure - a.exposure)
      .slice(0, 5);
  }, [notices, clients]);

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">No open notices with demand.</p>;
  }

  return (
    <div className="space-y-1">
      {rows.map((r) => {
        const stage = tableStageInfo(r.dominantStatus);
        return (
          <div key={r.id} className="flex items-center gap-2 py-1">
            <span className="flex-1 min-w-0 text-xs font-semibold truncate">{r.name}</span>
            <span className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-medium">
              <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: stage.color }} />
              {stage.label}
            </span>
            <span className="shrink-0 w-[90px] text-right text-xs tabular-nums font-medium">
              {r.exposure > 0 ? r.exposure.toLocaleString('en-IN') : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function AgeingExposurePanel({ notices, clients, loading }: AgeingExposurePanelProps) {
  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Ageing &amp; exposure</h2>
          <p className="text-[11px] text-muted-foreground">Open notices by days past due · demand by stage</p>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
          Open only
        </span>
      </div>
      <CardContent className="pt-3 pb-3 space-y-0">
        <AgeingBuckets notices={notices} />

        <div className="my-3 border-t" />

        <ExposureDonut notices={notices} />

        <div className="my-3 border-t" />

        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Top exposure by client
        </div>
        <TopExposureTable notices={notices} clients={clients} />

        <div className="flex items-center justify-between pt-3 text-[11px] text-muted-foreground">
          <span className="truncate"></span>
          <span className="shrink-0 font-semibold text-primary">By client →</span>
        </div>
      </CardContent>
    </Card>
  );
}
