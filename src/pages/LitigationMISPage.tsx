import React, { useEffect, useState, useMemo } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { NoticesPageHeader } from '@/components/notices/NoticesPageHeader';
import { NoticesCardHeader } from '@/components/notices/NoticesCardHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { BarChart3, Download, FileText, Loader2, Calendar } from 'lucide-react';
import { NoticesTopNav } from '@/components/notices/NoticesTopNav';
import { exportLitigationMIS } from '@/utils/litigationPdfExport';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import * as XLSX from 'xlsx';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Matter {
  id: string;
  client_id: string | null;
  matter_no: string;
  title: string | null;
  status: string | null;
  lifecycle: string | null;
  stage: string | null;
  owner_user_id: string | null;
  demand_tax: number;
  demand_interest: number;
  demand_penalty: number;
  demand_cess: number;
  paid_total: number;
  pre_deposit_total: number;
  hearing_at: string | null;
  created_at: string;
}

interface ClientInfo {
  id: string;
  name: string | null;
  gstin: string | null;
}

interface ProfileInfo {
  user_id: string;
  first_name: string | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const COLORS = [
  '#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#6366f1',
  '#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
];

function demand(m: Matter): number {
  return (m.demand_tax ?? 0) + (m.demand_interest ?? 0) + (m.demand_penalty ?? 0) + (m.demand_cess ?? 0);
}

function isOpen(m: Matter): boolean {
  return (m.status ?? '').toLowerCase() !== 'closed';
}

function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

function ageingBucket(days: number): string {
  if (days <= 30) return '0-30d';
  if (days <= 60) return '31-60d';
  if (days <= 90) return '61-90d';
  if (days <= 180) return '91-180d';
  return '180d+';
}

const BUCKET_ORDER = ['0-30d', '31-60d', '61-90d', '91-180d', '180d+'];

/* ------------------------------------------------------------------ */
/*  Computed analytics                                                 */
/* ------------------------------------------------------------------ */

interface ExposureSummary {
  totalExposure: number;
  paidTotal: number;
  preDepositTotal: number;
  outstanding: number;
  openCount: number;
  closedCount: number;
}

interface ByClientRow {
  clientId: string;
  clientName: string;
  gstin: string;
  openCount: number;
  totalDemand: number;
  paid: number;
  outstanding: number;
}

interface ByStageRow {
  stage: string;
  count: number;
  totalDemand: number;
}

interface ByLifecycleRow {
  lifecycle: string;
  count: number;
  totalDemand: number;
}

interface AgeingRow {
  bucket: string;
  count: number;
  totalDemand: number;
}

interface PerStaffRow {
  staffName: string;
  count: number;
  totalDemand: number;
}

function computeAnalytics(
  matters: Matter[],
  clients: Map<string, ClientInfo>,
  profiles: Map<string, ProfileInfo>,
) {
  const openMatters = matters.filter(isOpen);
  const closedMatters = matters.filter((m) => !isOpen(m));

  /* Exposure */
  const exposure: ExposureSummary = {
    totalExposure: openMatters.reduce((s, m) => s + demand(m), 0),
    paidTotal: openMatters.reduce((s, m) => s + (m.paid_total ?? 0), 0),
    preDepositTotal: openMatters.reduce((s, m) => s + (m.pre_deposit_total ?? 0), 0),
    outstanding: 0,
    openCount: openMatters.length,
    closedCount: closedMatters.length,
  };
  exposure.outstanding = exposure.totalExposure - exposure.paidTotal - exposure.preDepositTotal;

  /* By Client */
  const clientMap = new Map<string, ByClientRow>();
  for (const m of openMatters) {
    const cid = m.client_id ?? 'unknown';
    const c = clients.get(cid);
    if (!clientMap.has(cid)) {
      clientMap.set(cid, {
        clientId: cid,
        clientName: c?.name ?? 'Unknown',
        gstin: c?.gstin ?? '-',
        openCount: 0,
        totalDemand: 0,
        paid: 0,
        outstanding: 0,
      });
    }
    const row = clientMap.get(cid)!;
    row.openCount += 1;
    row.totalDemand += demand(m);
    row.paid += (m.paid_total ?? 0) + (m.pre_deposit_total ?? 0);
  }
  const byClient = Array.from(clientMap.values()).map((r) => ({
    ...r,
    outstanding: r.totalDemand - r.paid,
  }));
  byClient.sort((a, b) => b.outstanding - a.outstanding);

  /* By Stage */
  const stageMap = new Map<string, ByStageRow>();
  for (const m of openMatters) {
    const key = m.stage ?? 'Unknown';
    if (!stageMap.has(key)) stageMap.set(key, { stage: key, count: 0, totalDemand: 0 });
    const row = stageMap.get(key)!;
    row.count += 1;
    row.totalDemand += demand(m);
  }
  const byStage = Array.from(stageMap.values()).sort((a, b) => b.totalDemand - a.totalDemand);

  /* By Lifecycle */
  const lcMap = new Map<string, ByLifecycleRow>();
  for (const m of openMatters) {
    const key = m.lifecycle ?? 'Unknown';
    if (!lcMap.has(key)) lcMap.set(key, { lifecycle: key, count: 0, totalDemand: 0 });
    const row = lcMap.get(key)!;
    row.count += 1;
    row.totalDemand += demand(m);
  }
  const byLifecycle = Array.from(lcMap.values()).sort((a, b) => b.totalDemand - a.totalDemand);

  /* Ageing */
  const ageMap = new Map<string, AgeingRow>();
  for (const bucket of BUCKET_ORDER) {
    ageMap.set(bucket, { bucket, count: 0, totalDemand: 0 });
  }
  for (const m of openMatters) {
    const days = daysSince(m.created_at);
    const bucket = ageingBucket(days);
    const row = ageMap.get(bucket)!;
    row.count += 1;
    row.totalDemand += demand(m);
  }
  const ageing = BUCKET_ORDER.map((b) => ageMap.get(b)!);

  /* Per Staff */
  const staffMap = new Map<string, PerStaffRow>();
  for (const m of openMatters) {
    const uid = m.owner_user_id ?? 'unassigned';
    const p = profiles.get(uid);
    const name = uid === 'unassigned' ? 'Unassigned' : (p?.first_name ?? 'Unknown');
    if (!staffMap.has(uid)) staffMap.set(uid, { staffName: name, count: 0, totalDemand: 0 });
    const row = staffMap.get(uid)!;
    row.count += 1;
    row.totalDemand += demand(m);
  }
  const perStaff = Array.from(staffMap.values()).sort((a, b) => b.totalDemand - a.totalDemand);

  /* Upcoming Hearings */
  const upcomingHearings = openMatters
    .filter((m) => m.hearing_at && new Date(m.hearing_at) >= new Date())
    .sort((a, b) => new Date(a.hearing_at!).getTime() - new Date(b.hearing_at!).getTime())
    .map((m) => {
      const c = clients.get(m.client_id ?? '');
      const owner = m.owner_user_id ? profiles.get(m.owner_user_id) : null;
      return {
        matterNo: m.matter_no,
        matterId: m.id,
        title: m.title || m.matter_no,
        clientName: c?.name ?? 'Unknown',
        hearingDate: m.hearing_at!,
        stage: m.stage ?? 'Unknown',
        owner: owner?.first_name ?? 'Unassigned',
        demand: demand(m),
      };
    });

  return { exposure, byClient, byStage, byLifecycle, ageing, perStaff, upcomingHearings };
}

/* ------------------------------------------------------------------ */
/*  Excel export                                                       */
/* ------------------------------------------------------------------ */

function exportExcel(
  tab: string,
  analytics: ReturnType<typeof computeAnalytics>,
) {
  const wb = XLSX.utils.book_new();

  if (tab === 'exposure') {
    const e = analytics.exposure;
    const data = [
      ['Metric', 'Value'],
      ['Total Exposure', e.totalExposure],
      ['Paid Total', e.paidTotal],
      ['Pre-Deposit Total', e.preDepositTotal],
      ['Outstanding', e.outstanding],
      ['Open Matters', e.openCount],
      ['Closed Matters', e.closedCount],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Exposure Summary');
  } else if (tab === 'by-client') {
    const header = ['Client', 'GSTIN', 'Open Matters', 'Total Demand', 'Paid', 'Outstanding'];
    const rows = analytics.byClient.map((r) => [r.clientName, r.gstin, r.openCount, r.totalDemand, r.paid, r.outstanding]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, 'By Client');
  } else if (tab === 'by-stage') {
    const header = ['Stage', 'Open Matters', 'Total Demand'];
    const rows = analytics.byStage.map((r) => [r.stage, r.count, r.totalDemand]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, 'By Stage');
  } else if (tab === 'by-lifecycle') {
    const header = ['Lifecycle', 'Open Matters', 'Total Demand'];
    const rows = analytics.byLifecycle.map((r) => [r.lifecycle, r.count, r.totalDemand]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, 'By Lifecycle');
  } else if (tab === 'ageing') {
    const header = ['Bucket', 'Count', 'Total Demand'];
    const rows = analytics.ageing.map((r) => [r.bucket, r.count, r.totalDemand]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, 'Ageing');
  } else if (tab === 'per-staff') {
    const header = ['Staff', 'Open Matters', 'Total Demand'];
    const rows = analytics.perStaff.map((r) => [r.staffName, r.count, r.totalDemand]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, 'Per Staff');
  } else if (tab === 'hearings') {
    const header = ['Matter No', 'Title', 'Client', 'Hearing Date', 'Stage', 'Owner', 'Demand'];
    const rows = analytics.upcomingHearings.map((r) => [r.matterNo, r.title, r.clientName, r.hearingDate, r.stage, r.owner, r.demand]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, 'Upcoming Hearings');
  }

  XLSX.writeFile(wb, `Litigation_MIS_${tab}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function exportAllExcel(analytics: ReturnType<typeof computeAnalytics>) {
  const wb = XLSX.utils.book_new();

  const e = analytics.exposure;
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Metric', 'Value'],
    ['Total Exposure', e.totalExposure], ['Paid', e.paidTotal],
    ['Pre-Deposit', e.preDepositTotal], ['Outstanding', e.outstanding],
    ['Open Matters', e.openCount], ['Closed Matters', e.closedCount],
  ]), 'Exposure');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Client', 'GSTIN', 'Open', 'Demand', 'Paid', 'Outstanding'],
    ...analytics.byClient.map((r) => [r.clientName, r.gstin, r.openCount, r.totalDemand, r.paid, r.outstanding]),
  ]), 'By Client');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Stage', 'Count', 'Demand'],
    ...analytics.byStage.map((r) => [r.stage, r.count, r.totalDemand]),
  ]), 'By Stage');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Lifecycle', 'Count', 'Demand'],
    ...analytics.byLifecycle.map((r) => [r.lifecycle, r.count, r.totalDemand]),
  ]), 'By Lifecycle');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Bucket', 'Count', 'Demand'],
    ...analytics.ageing.map((r) => [r.bucket, r.count, r.totalDemand]),
  ]), 'Ageing');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Staff', 'Count', 'Demand'],
    ...analytics.perStaff.map((r) => [r.staffName, r.count, r.totalDemand]),
  ]), 'Per Staff');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Matter No', 'Title', 'Client', 'Hearing Date', 'Stage', 'Owner', 'Demand'],
    ...analytics.upcomingHearings.map((r) => [r.matterNo, r.title, r.clientName, r.hearingDate, r.stage, r.owner, r.demand]),
  ]), 'Hearings');

  XLSX.writeFile(wb, `Litigation_MIS_Full_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const LitigationMISPage: React.FC = () => {
  const { isStaffRole } = useAuth();

  const [matters, setMatters] = useState<Matter[]>([]);
  const [clients, setClients] = useState<Map<string, ClientInfo>>(new Map());
  const [profiles, setProfiles] = useState<Map<string, ProfileInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('exposure');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      const [mRes, cRes, pRes] = await Promise.all([
        supabase.from('litigation_matters').select(
          'id, client_id, matter_no, title, status, lifecycle, stage, owner_user_id, ' +
          'demand_tax, demand_interest, demand_penalty, demand_cess, ' +
          'paid_total, pre_deposit_total, hearing_at, created_at',
        ),
        supabase.from('clients').select('id, name, gstin'),
        supabase.from('profiles').select('user_id, first_name'),
      ]);

      if (cancelled) return;

      setMatters((mRes.data ?? []) as Matter[]);

      const cMap = new Map<string, ClientInfo>();
      (cRes.data ?? []).forEach((c: any) => cMap.set(c.id, c));
      setClients(cMap);

      const pMap = new Map<string, ProfileInfo>();
      (pRes.data ?? []).forEach((p: any) => pMap.set(p.user_id, p));
      setProfiles(pMap);

      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const analytics = useMemo(
    () => computeAnalytics(matters, clients, profiles),
    [matters, clients, profiles],
  );

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { exposure, byClient, byStage, byLifecycle, ageing, perStaff, upcomingHearings } = analytics;

  return (
    <div className="space-y-4 animate-fade-in">
      <NoticesPageHeader
        title="Litigation MIS"
        icon={BarChart3}
        subtitle="Management information overview of all litigation matters"
        actions={
          <>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => exportExcel(tab, analytics)}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export Tab
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => exportAllExcel(analytics)}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export All
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => exportLitigationMIS()}>
              <FileText className="mr-1.5 h-3.5 w-3.5" /> PDF
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <NoticesTopNav />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap items-center gap-0.5 rounded-lg bg-muted p-0.5">
          {[
            ['exposure', 'Exposure'],
            ['by-client', 'By Client'],
            ['by-stage', 'By Stage'],
            ['by-lifecycle', 'By Lifecycle'],
            ['ageing', 'Ageing'],
            ['per-staff', 'Per Staff'],
            ['hearings', `Hearings (${upcomingHearings.length})`],
          ].map(([value, label]) => (
            <TabsTrigger
              key={value}
              value={value}
              className="rounded-md px-3 py-1 text-[11px] font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ---- Exposure Summary ---- */}
        <TabsContent value="exposure">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {([
              ['Outstanding', exposure.outstanding, 'border-l-destructive', true],
              ['Total Exposure', exposure.totalExposure, 'border-l-primary', true],
              ['Pre-Deposit', exposure.preDepositTotal, 'border-l-blue-500', true],
              ['Paid', exposure.paidTotal, 'border-l-emerald-500', true],
              ['Open Matters', exposure.openCount, 'border-l-primary', false],
              ['Closed Matters', exposure.closedCount, 'border-l-muted', false],
            ] as [string, number, string, boolean][]).map(([label, value, border, isMoney]) => (
              <Card key={label} className={`border-l-4 ${border} transition-shadow hover:shadow-md`}>
                <CardContent className="p-3.5 space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
                  <p className="font-heading text-[30px] font-bold tabular-nums leading-none">
                    {isMoney ? INR.format(value) : value}
                    {!isMoney && (
                      <span className="ml-1.5 font-sans text-xs font-medium text-muted-foreground">matters</span>
                    )}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ---- By Client ---- */}
        <TabsContent value="by-client">
          <Card>
            <NoticesCardHeader title="By Client" badge={byClient.length} />
            <CardContent className="p-0">
              <Table containerClassName="overflow-auto rounded-md border">
                <TableHeader>
                  <TableRow>
                    <TableHead className="bg-muted text-[10px] font-semibold uppercase">Client</TableHead>
                    <TableHead className="bg-muted text-[10px] font-semibold uppercase">GSTIN</TableHead>
                    <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Open</TableHead>
                    <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Total Demand</TableHead>
                    <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Paid</TableHead>
                    <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byClient.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-xs text-center text-muted-foreground py-6">No data</TableCell></TableRow>
                  )}
                  {byClient.map((r) => (
                    <TableRow key={r.clientId}>
                      <TableCell className="text-xs">
                        <Link to={`/notices-company/${r.clientId}`} className="font-medium text-primary hover:underline">
                          {r.clientName}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-[10px] text-muted-foreground">{r.gstin}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{r.openCount}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{INR.format(r.totalDemand)}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{INR.format(r.paid)}</TableCell>
                      <TableCell className="text-xs text-right font-medium tabular-nums">{INR.format(r.outstanding)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- By Stage ---- */}
        <TabsContent value="by-stage">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <NoticesCardHeader title="Stage Breakdown" badge={byStage.length} />
              <CardContent className="p-0">
                <Table containerClassName="overflow-auto rounded-md border">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="bg-muted text-[10px] font-semibold uppercase">Stage</TableHead>
                      <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Open</TableHead>
                      <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Total Demand</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byStage.length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-xs text-center text-muted-foreground py-6">No data</TableCell></TableRow>
                    )}
                    {byStage.map((r) => (
                      <TableRow key={r.stage}>
                        <TableCell className="text-xs">{r.stage}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{r.count}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{INR.format(r.totalDemand)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <NoticesCardHeader title="Stage Distribution" />
              <CardContent className="flex justify-center">
                {byStage.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie
                        data={byStage}
                        dataKey="count"
                        nameKey="stage"
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={100}
                        paddingAngle={2}
                        label={({ stage, count }) => `${stage} (${count})`}
                      >
                        {byStage.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => [value, 'Matters']} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-xs text-muted-foreground py-10">No data</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ---- By Lifecycle ---- */}
        <TabsContent value="by-lifecycle">
          <Card>
            <NoticesCardHeader title="By Lifecycle" badge={byLifecycle.length} />
            <CardContent className="p-0">
              <Table containerClassName="overflow-auto rounded-md border">
                <TableHeader>
                  <TableRow>
                    <TableHead className="bg-muted text-[10px] font-semibold uppercase">Lifecycle</TableHead>
                    <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Open</TableHead>
                    <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Total Demand</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byLifecycle.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-xs text-center text-muted-foreground py-6">No data</TableCell></TableRow>
                  )}
                  {byLifecycle.map((r) => (
                    <TableRow key={r.lifecycle}>
                      <TableCell className="text-xs capitalize">{r.lifecycle}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{r.count}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{INR.format(r.totalDemand)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Ageing ---- */}
        <TabsContent value="ageing">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <NoticesCardHeader title="Ageing Buckets" badge={ageing.length} />
              <CardContent className="p-0">
                <Table containerClassName="overflow-auto rounded-md border">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="bg-muted text-[10px] font-semibold uppercase">Bucket</TableHead>
                      <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Count</TableHead>
                      <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Total Demand</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ageing.map((r) => (
                      <TableRow key={r.bucket}>
                        <TableCell className="text-xs">{r.bucket}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{r.count}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{INR.format(r.totalDemand)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <NoticesCardHeader title="Ageing Chart" />
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={ageing}>
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : String(v))} />
                    <Tooltip formatter={(value: number) => [INR.format(value), 'Demand']} />
                    <Bar dataKey="totalDemand" name="Total Demand" radius={[4, 4, 0, 0]}>
                      {ageing.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ---- Per Staff ---- */}
        <TabsContent value="per-staff">
          <Card>
            <NoticesCardHeader title="Per Staff" badge={perStaff.length} />
            <CardContent className="p-0">
              <Table containerClassName="overflow-auto rounded-md border">
                <TableHeader>
                  <TableRow>
                    <TableHead className="bg-muted text-[10px] font-semibold uppercase">Staff</TableHead>
                    <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Open Matters</TableHead>
                    <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Total Demand</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perStaff.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-xs text-center text-muted-foreground py-6">No data</TableCell></TableRow>
                  )}
                  {perStaff.map((r) => (
                    <TableRow key={r.staffName}>
                      <TableCell className="text-xs">{r.staffName}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{r.count}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{INR.format(r.totalDemand)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Upcoming Hearings ---- */}
        <TabsContent value="hearings">
          <Card>
            <NoticesCardHeader
              title="Upcoming Hearings"
              description={
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Open matters with a scheduled hearing
                </span>
              }
              badge={upcomingHearings.length}
            />
            <CardContent className="p-0">
              <Table containerClassName="overflow-auto rounded-md border">
                <TableHeader>
                  <TableRow>
                    <TableHead className="bg-muted text-[10px] font-semibold uppercase">Matter</TableHead>
                    <TableHead className="bg-muted text-[10px] font-semibold uppercase">Client</TableHead>
                    <TableHead className="bg-muted text-[10px] font-semibold uppercase">Hearing Date</TableHead>
                    <TableHead className="bg-muted text-[10px] font-semibold uppercase">Stage</TableHead>
                    <TableHead className="bg-muted text-[10px] font-semibold uppercase">Owner</TableHead>
                    <TableHead className="bg-muted text-right text-[10px] font-semibold uppercase">Demand</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcomingHearings.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-xs text-center text-muted-foreground py-6">No upcoming hearings</TableCell></TableRow>
                  )}
                  {upcomingHearings.map((r) => {
                    const d = new Date(r.hearingDate);
                    const daysAway = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
                    return (
                      <TableRow key={r.matterId}>
                        <TableCell className="text-xs font-medium">
                          <Link to={`/litigation/${r.matterId}`} className="text-[11px] font-semibold text-primary hover:underline">
                            {r.matterNo}
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs">{r.clientName}</TableCell>
                        <TableCell className="text-xs tabular-nums">
                          {d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                          {daysAway <= 3 && (
                            <span className="ml-1 rounded-full bg-destructive/10 px-1.5 py-0 text-[9px] font-bold text-destructive">
                              {daysAway === 0 ? 'Today' : daysAway === 1 ? 'Tomorrow' : `${daysAway}d`}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{r.stage}</TableCell>
                        <TableCell className="text-xs">{r.owner}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{INR.format(r.demand)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default LitigationMISPage;
