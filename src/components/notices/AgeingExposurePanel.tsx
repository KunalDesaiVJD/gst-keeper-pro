import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Loader2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Positive = overdue by that many days; negative/zero = not yet due. */
function ageingDays(n: NoticeForAgeing, today: string): number | null {
  const due = effectiveDue(n);
  if (!due) return null;
  const diff =
    new Date(today).getTime() - new Date(due).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function formatAmount(v: number): string {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(1)} cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`;
  return `₹${v.toLocaleString('en-IN')}`;
}

// ---------------------------------------------------------------------------
// Ageing bucket definitions
// ---------------------------------------------------------------------------

interface Bucket {
  label: string;
  color: string;
  bg: string;
  test: (days: number | null) => boolean;
}

const BUCKETS: Bucket[] = [
  {
    label: 'Not Due',
    color: 'bg-emerald-500',
    bg: 'bg-emerald-100 dark:bg-emerald-900/30',
    test: (d) => d === null || d <= 0,
  },
  {
    label: '1-7 days',
    color: 'bg-yellow-500',
    bg: 'bg-yellow-100 dark:bg-yellow-900/30',
    test: (d) => d !== null && d >= 1 && d <= 7,
  },
  {
    label: '8-30 days',
    color: 'bg-amber-500',
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    test: (d) => d !== null && d >= 8 && d <= 30,
  },
  {
    label: '31-90 days',
    color: 'bg-red-500',
    bg: 'bg-red-100 dark:bg-red-900/30',
    test: (d) => d !== null && d >= 31 && d <= 90,
  },
  {
    label: '90+ days',
    color: 'bg-rose-900',
    bg: 'bg-rose-100 dark:bg-rose-900/30',
    test: (d) => d !== null && d > 90,
  },
];

// ---------------------------------------------------------------------------
// Exposure donut stage definitions
// ---------------------------------------------------------------------------

interface Stage {
  label: string;
  color: string; // SVG stroke color
  match: RegExp;
}

const STAGES: Stage[] = [
  { label: 'Captured', color: '#9ca3af', match: /^captured/i },
  { label: 'Reply drafting', color: '#3b82f6', match: /^reply/i },
  { label: 'Partner review', color: '#8b5cf6', match: /^partner/i },
  { label: 'Filed/submitted', color: '#10b981', match: /^(filed|submitted)/i },
  { label: 'Hearing', color: '#f59e0b', match: /^hearing/i },
  { label: 'Order received', color: '#f97316', match: /^order/i },
  { label: 'Appeal', color: '#ef4444', match: /^appeal/i },
  { label: 'Closed', color: '#64748b', match: CLOSED_RE },
];

function stageOf(status: string | null): string {
  const s = (status ?? '').trim();
  for (const st of STAGES) {
    if (st.match.test(s)) return st.label;
  }
  return 'Captured'; // fallback for null / unrecognised
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AgeingBuckets({ notices }: { notices: NoticeForAgeing[] }) {
  const today = todayIST();
  const open = notices.filter(isOpen);

  const counts = BUCKETS.map((b) => ({
    ...b,
    count: open.filter((n) => b.test(ageingDays(n, today))).length,
  }));

  const max = Math.max(1, ...counts.map((c) => c.count));

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Ageing Buckets
      </h3>
      <div className="space-y-1.5">
        {counts.map((b) => (
          <div key={b.label} className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-xs text-right font-medium">
              {b.label}
            </span>
            <div className="flex-1 h-5 rounded bg-muted/40 overflow-hidden">
              <div
                className={`h-full rounded ${b.color} transition-all`}
                style={{ width: `${(b.count / max) * 100}%` }}
              />
            </div>
            <span className="w-8 text-xs font-semibold text-right tabular-nums">
              {b.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExposureDonut({ notices }: { notices: NoticeForAgeing[] }) {
  const segments = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notices) {
      const stage = stageOf(n.staff_status);
      map.set(stage, (map.get(stage) ?? 0) + (n.amount_of_demand ?? 0));
    }
    return STAGES.map((s) => ({
      label: s.label,
      color: s.color,
      value: map.get(s.label) ?? 0,
    })).filter((s) => s.value > 0);
  }, [notices]);

  const total = segments.reduce((a, s) => a + s.value, 0);

  // SVG donut via stroke-dasharray
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Exposure by Stage
      </h3>
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <svg
            width="160"
            height="160"
            viewBox="0 0 160 160"
            className="block"
          >
            {segments.length === 0 ? (
              <circle
                cx="80"
                cy="80"
                r={radius}
                fill="none"
                stroke="currentColor"
                className="text-muted/30"
                strokeWidth="20"
              />
            ) : (
              segments.map((seg) => {
                const pct = seg.value / total;
                const dashLen = pct * circumference;
                const el = (
                  <circle
                    key={seg.label}
                    cx="80"
                    cy="80"
                    r={radius}
                    fill="none"
                    stroke={seg.color}
                    strokeWidth="20"
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
            <span className="text-base font-bold leading-tight">
              {total > 0 ? formatAmount(total) : '₹0'}
            </span>
            <span className="text-[10px] text-muted-foreground">Total</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-col gap-1 min-w-0">
          {segments.map((seg) => (
            <div key={seg.label} className="flex items-center gap-1.5 text-xs">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: seg.color }}
              />
              <span className="truncate">{seg.label}</span>
            </div>
          ))}
          {segments.length === 0 && (
            <span className="text-xs text-muted-foreground">No data</span>
          )}
        </div>
      </div>
    </div>
  );
}

function TopExposureTable({
  notices,
  clients,
}: {
  notices: NoticeForAgeing[];
  clients: ClientInfo[];
}) {
  const rows = useMemo(() => {
    const clientMap = new Map(clients.map((c) => [c.id, c.name]));
    const agg = new Map<
      string,
      { name: string; openCount: number; exposure: number }
    >();

    for (const n of notices) {
      if (!isOpen(n)) continue;
      const entry = agg.get(n.client_id) ?? {
        name: clientMap.get(n.client_id) ?? n.client_id,
        openCount: 0,
        exposure: 0,
      };
      entry.openCount += 1;
      entry.exposure += n.amount_of_demand ?? 0;
      agg.set(n.client_id, entry);
    }

    return Array.from(agg.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.exposure - a.exposure)
      .slice(0, 5);
  }, [notices, clients]);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Top 5 Exposure by Client
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No open notices.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Client Name</TableHead>
                <TableHead className="text-xs text-right">Open Notices</TableHead>
                <TableHead className="text-xs text-right">Exposure</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm font-medium truncate max-w-[180px]">
                    {r.name}
                  </TableCell>
                  <TableCell className="text-sm text-right tabular-nums">
                    {r.openCount}
                  </TableCell>
                  <TableCell className="text-sm text-right tabular-nums">
                    {formatAmount(r.exposure)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function AgeingExposurePanel({
  notices,
  clients,
  loading,
}: AgeingExposurePanelProps) {
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
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Ageing &amp; Exposure Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <AgeingBuckets notices={notices} />
        <ExposureDonut notices={notices} />
        <TopExposureTable notices={notices} clients={clients} />
      </CardContent>
    </Card>
  );
}
