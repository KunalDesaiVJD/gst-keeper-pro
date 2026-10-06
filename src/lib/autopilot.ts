// Portal Autopilot (roadmap Phase 3; audit S-01, S-13, S-23, U-07-1, U-51-1):
// what the app reads and writes for the queue's runner — its queue, the
// acceptance numbers and the switches (migrations 20261007120000–123000) — and,
// since the firm's decision of 6 Oct 2026 (20261008170000), who runs it:
// 'chrome' (the default: GST Keeper extension 0.7.0 in the firm's own Chrome,
// whose CAPTCHA extension fills the CAPTCHA; no wall) or 'office_agent' (the
// Phase 3 office agent with the CAPTCHA wall, set by SQL). One place for the
// words: failure reasons, where a job came from, job states and the reports a
// runner can fetch, so the Autopilot page, the command centre and Sync now say
// the same thing.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { addDays, istToday } from '@/lib/noticeFacts';
import { fmtDate, fmtDateTime, plural } from '@/lib/noticeFormat';

type Tables = Database['public']['Tables'];
export type AutopilotSettings = Tables['autopilot_settings']['Row'];
export type PortalJob = Tables['portal_jobs']['Row'];
export type PortalEmail = Tables['portal_emails']['Row'];
export type PortalApplication = Tables['gst_portal_applications']['Row'];
export type MetricsRow = Database['public']['Functions']['autopilot_metrics']['Returns'][number];

export type LoginFix = 'password' | 'account_locked' | 'captcha' | 'no_password' | 'other';
export type JobStatus = 'queued' | 'claimed' | 'running' | 'needs_human' | 'waiting_captcha' | 'succeeded' | 'failed' | 'cancelled';
export type Tone = 'success' | 'warning' | 'info' | 'destructive' | 'secondary';

export interface Actor { id: string; firstName: string }

// ── What the RPCs return ───────────────────────────────────────────────────
export interface WallCaptcha {
  job_id: string;
  prompt_id: string;
  client_id: string;
  client_name: string;
  gstin: string | null;
  image: string;
  attempt: number;
  shown_at: string | null;
  origin: string | null;
  job_type: string;
  report: string | null;
}

export interface WallState {
  captchas: WallCaptcha[];
  waiting: number;
  queued: number;
  running: number;
  typed_today: number;
  done_today: number;
  agent_online: boolean;
  /** Switched on and not paused. */
  enabled: boolean;
  present: string[];
}

export interface AgentWorker { n?: number; state?: string; client_name?: string; job_id?: string; since?: string }
export interface AgentInfo {
  /** A Chrome runner's (extension 0.7.0): why it is idle — person_sync, portal_in_use, autopilot_off … */
  waiting?: string | null;
  kind?: string;
  label?: string;
  version?: string;
  ext_version?: string;
  headful?: boolean;
  host?: string;
  started_at?: string;
  workers?: AgentWorker[];
  inbox?: { enabled?: boolean; address?: string; last_poll_at?: string; error?: string };
}
export interface AgentRow { agent_id: string; last_seen: string; online: boolean; info: AgentInfo | null }

export interface FailureClient {
  client_id: string;
  name: string;
  gstin: string | null;
  message: string | null;
  at: string | null;
  last_ok: string | null;
}
export interface FailureGroup { reason: string; fix: LoginFix | null; count: number; clients: FailureClient[] }

export interface SlotRun { fired_at: string; jobs: number; run_id: string | null }

export type RunnerMode = 'chrome' | 'office_agent';

/** A runner of the queue as its heartbeat reports it (autopilot_status.runners; online = seen within 150 s). */
export interface RunnerRow {
  agent_id: string;
  kind: RunnerMode;
  label: string | null;
  version: string | null;
  online: boolean;
  last_seen: string;
  busy: boolean;
  client_name: string | null;
  step: string | null;
}

export interface AutopilotStatus {
  freshness: { eligible: number; fresh: number; named: number; never: number; stale: number };
  failures: FailureGroup[];
  settings: AutopilotSettings | null;
  agent_online: boolean;
  agents: AgentRow[];
  wall: { open: boolean; present: string[] };
  queue: { queued: number; retrying: number; waiting_captcha: number; needs_human: number; running: number };
  today: { succeeded: number; failed: number; cancelled: number; captchas_typed: number; typing_minutes: number; sessions_reused: number };
  human: { wall_minutes: number; people: { name: string; minutes: number }[] };
  slots: Partial<Record<'morning' | 'afternoon' | 'nudge' | 'close', SlotRun>>;
  email: {
    enabled: boolean;
    address: string | null;
    last_poll_at: string | null;
    last_error: string | null;
    today: { received: number; queued: number; unmatched: number };
  };
  /** Who runs the queue (20261008170000; absent on an older database, which only had the office agent). */
  runner?: RunnerMode;
  /** How long a Chrome runner waits for the CAPTCHA box to be filled. */
  captcha_wait_secs?: number;
  /** The runners of the configured kind, newest report first. */
  runners?: RunnerRow[];
  server_time: string;
}

export interface AutopilotBadgeData { live: number; waiting: number; enabled: boolean | null; runner: RunnerMode | null }

export interface EnqueueResult {
  queued: number;
  already: number;
  run_id: string | null;
  eligible: number;
  out_of_scope: number;
  skipped: { no_credentials: number; excluded: number; inactive: number };
}

// ── Who runs the queue ─────────────────────────────────────────────────────
/** 'chrome' unless the settings name the office agent (a database without the column had only the agent). */
export function runnerMode(s: AutopilotStatus | undefined | null): RunnerMode {
  const r = s?.runner ?? s?.settings?.runner;
  if (r === 'office_agent' || r === 'chrome') return r;
  return s && !('runner' in s) && !s.settings?.runner ? 'office_agent' : 'chrome';
}

/** The Chrome runners as they last reported, newest first. */
export const chromeRunners = (s: AutopilotStatus | undefined): RunnerRow[] => (s?.runners ?? []).filter((r) => r.kind === 'chrome');

/** What a Chrome runner says about why it is idle (its heartbeat's info.waiting), from the full agent row. */
export function runnerWaiting(s: AutopilotStatus | undefined, agentId: string): string | null {
  const w = s?.agents?.find((a) => a.agent_id === agentId)?.info?.waiting;
  return typeof w === 'string' && w ? w : null;
}

const RUNNER_WAITING: Record<string, string> = {
  autopilot_off: 'waiting: the autopilot is off',
  paused: 'waiting: the autopilot is paused',
  office_agent: 'not used: the autopilot is set to the office agent',
  person_sync: 'waiting: a person is syncing in this Chrome',
  portal_in_use: 'waiting: someone at this PC has the GST portal open',
  window_closed: 'waiting a moment: its window was closed',
  offline: 'cannot reach the database',
  old_database: 'the database is not updated for Chrome runners',
};

const RUNNER_STEPS: Record<string, string> = {
  starting: 'opening the portal',
  logout: 'opening the portal',
  login: 'logging in, waiting for the CAPTCHA extension',
  notices: 'reading notices and orders',
  refunds: 'reading refund applications',
  refunds_reg_check: 'reading refund applications',
  refunds_warmup: 'reading refund applications',
  refund_docs: 'reading refund documents',
  drc03: 'reading DRC-03 payments',
  applications: 'reading applications on the portal',
  taxpayerprofile: 'reading the taxpayer profile',
};

/** "Asha Traders: reading notices and orders", "idle", "waiting: a person is syncing in this Chrome". */
export function runnerWords(r: RunnerRow, waiting: string | null = null): string {
  if (!r.online) return 'not reporting';
  if (r.busy) return `${r.client_name ? `${r.client_name}: ` : ''}${RUNNER_STEPS[r.step ?? ''] ?? (r.step ? r.step.replace(/_/g, ' ') : 'starting')}`;
  return (waiting && RUNNER_WAITING[waiting]) || 'idle, ready for the next client';
}

// ── Labels ─────────────────────────────────────────────────────────────────
/** Why a client was not read, by the reason class the runner and the extension record (the Chrome runner's words). */
export const REASON_LABELS: Record<string, string> = {
  login_failed: 'Login failed',
  captcha_timeout: 'CAPTCHA not filled in time',
  skipped_at_wall: 'Skipped on the CAPTCHA wall',
  session_mismatch: 'Portal session was another GSTIN',
  portal_error: 'Portal error',
  timeout: 'Portal timed out',
  stalled: 'Run stalled',
  agent_error: 'Error in the scheduled sync',
  agent_offline: 'The scheduled Chrome was offline',
  not_reached: 'Not reached today',
  cancelled: 'Cancelled',
  save_failed: 'Save error in the app',
  other: 'Other failure',
};
/** The office agent's words where they differ (runner = 'office_agent'). */
const AGENT_REASON_LABELS: Record<string, string> = {
  captcha_timeout: 'Nobody typed the CAPTCHA',
  agent_error: 'Office agent error',
  agent_offline: 'Office agent was offline',
};

/** A failed login, by what fixes it (public.autopilot_login_fix). */
export const LOGIN_FIX_LABELS: Record<LoginFix, string> = {
  password: 'Portal rejected the saved password',
  account_locked: 'Portal account locked',
  captcha: 'CAPTCHA wrong three times',
  no_password: 'No portal password saved',
  other: 'Login failed',
};

export function reasonLabel(reason: string | null | undefined, fix?: string | null, mode: RunnerMode = 'chrome'): string {
  if (!reason) return REASON_LABELS.other;
  if (reason === 'login_failed' && fix && fix in LOGIN_FIX_LABELS) return LOGIN_FIX_LABELS[fix as LoginFix];
  const known = (mode === 'office_agent' && AGENT_REASON_LABELS[reason]) || REASON_LABELS[reason];
  if (known) return known;
  const words = reason.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const ORIGIN_LABELS: Record<string, string> = {
  schedule_morning: 'Morning run',
  schedule_afternoon: 'Afternoon run',
  manual: 'Sent by staff',
  report: 'Report fetch',
  email: 'Portal e-mail',
  evidence: 'Evidence for a notice',
};
export const originLabel = (o: string | null | undefined) => (o ? ORIGIN_LABELS[o] ?? o.replace(/_/g, ' ') : '—');

export const ACTIVE_STATUSES: JobStatus[] = ['queued', 'claimed', 'running', 'needs_human', 'waiting_captcha'];

export const JOB_STATUS: Record<JobStatus, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'secondary' },
  claimed: { label: 'Starting', tone: 'info' },
  running: { label: 'Running', tone: 'info' },
  needs_human: { label: 'CAPTCHA on the wall', tone: 'warning' },
  waiting_captcha: { label: 'Waiting for a CAPTCHA', tone: 'warning' },
  succeeded: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'destructive' },
  cancelled: { label: 'Cancelled', tone: 'secondary' },
};
export const jobStatusDef = (s: string) => JOB_STATUS[s as JobStatus] ?? { label: s, tone: 'secondary' as Tone };

export const EMAIL_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: 'Sync queued', tone: 'info' },
  already_queued: { label: 'Already in the queue', tone: 'info' },
  synced: { label: 'Notice captured', tone: 'success' },
  autopilot_off: { label: 'Not queued: trigger off', tone: 'secondary' },
  unmatched: { label: 'No client with this GSTIN', tone: 'warning' },
  ignored: { label: 'Not a notice e-mail', tone: 'secondary' },
};

/** The portal's "My Applications" types (gst_portal_applications.case_type_cd); appeals first. */
export const APPLICATION_TYPES: { code: string; label: string }[] = [
  { code: 'APPEL', label: 'Appeal' },
  { code: 'ADJRO', label: 'Rectification of an order' },
  { code: 'ADJAT', label: 'Objection to provisional attachment' },
  { code: 'ADJWS', label: 'Waiver scheme (s.128A)' },
  { code: 'COMPD', label: 'Compounding' },
  { code: 'ADJPA', label: 'Provisional assessment' },
];

// ── The reports the agent can fetch (public.autopilot_report_modes) ─────────
/** none: the portal lists everything; month: one or more return periods; fy: one financial year. */
export type PeriodKind = 'none' | 'month' | 'fy';

export interface ReportMode {
  mode: string;
  label: string;
  group: 'Notices and cases' | 'Returns as filed' | 'Ledgers and statements' | 'Registration and payments';
  period: PeriodKind;
  /** Where the result shows in the app when it is not a Reports page. */
  lands?: { to: string; label: string };
  note?: string;
}

export const REPORT_MODES: ReportMode[] = [
  { mode: 'notices_bundle', label: 'Notices, refunds and DRC-03 (the full notices sync)', group: 'Notices and cases', period: 'none',
    lands: { to: '/notices-all', label: 'All notices' } },
  { mode: 'notices', label: 'Notices and orders only', group: 'Notices and cases', period: 'none', lands: { to: '/notices-all', label: 'All notices' } },
  { mode: 'refunds', label: 'Refund applications', group: 'Notices and cases', period: 'none', lands: { to: '/refunds-all', label: 'Refunds' } },
  { mode: 'refund_docs', label: 'Refund documents (memos, notices, orders)', group: 'Notices and cases', period: 'none',
    lands: { to: '/refunds-all', label: 'Refunds' } },
  { mode: 'drc03', label: 'DRC-03 payments', group: 'Notices and cases', period: 'none', lands: { to: '/drc03-all', label: 'DRC-03 payments' } },
  { mode: 'gstr3b_pull', label: 'GSTR-3B as filed', group: 'Returns as filed', period: 'month' },
  { mode: 'gstr1_pull', label: 'GSTR-1 as filed (summary)', group: 'Returns as filed', period: 'month' },
  { mode: 'gstr1_json_pull', label: 'GSTR-1 as filed (invoice detail)', group: 'Returns as filed', period: 'month' },
  { mode: 'gstr2a_pull', label: 'GSTR-2A (supplier documents)', group: 'Returns as filed', period: 'month' },
  { mode: 'gstr2b_pull', label: 'GSTR-2B (supplier documents)', group: 'Returns as filed', period: 'month' },
  { mode: 'gstr9_pull', label: 'GSTR-9 as filed', group: 'Returns as filed', period: 'fy',
    lands: { to: '/annual-return', label: 'Annual Return (9/9C)' } },
  { mode: 'liabilityledger', label: 'Liability ledger', group: 'Ledgers and statements', period: 'month' },
  { mode: 'cashledger', label: 'Cash ledger', group: 'Ledgers and statements', period: 'month' },
  { mode: 'creditledgertxn', label: 'Credit ledger (every transaction)', group: 'Ledgers and statements', period: 'month' },
  { mode: 'revrclm_pull', label: 'Credit reversal and re-claim statement', group: 'Ledgers and statements', period: 'fy',
    note: 'The portal gives the whole financial year at once.' },
  { mode: 'rcmliab_pull', label: 'RCM liability / ITC statement', group: 'Ledgers and statements', period: 'fy',
    note: 'The portal gives the whole financial year at once.' },
  { mode: 'taxpayerprofile', label: 'Taxpayer profile and registration status', group: 'Registration and payments', period: 'none',
    lands: { to: '/notices-company-list', label: "each client's profile" } },
  { mode: 'challans', label: 'Challans', group: 'Registration and payments', period: 'none' },
];

export const modeDef = (mode: string | null | undefined): ReportMode | undefined => REPORT_MODES.find((m) => m.mode === mode);
export const modeLabel = (mode: string | null | undefined) => modeDef(mode)?.label ?? (mode ? mode.replace(/_/g, ' ') : 'Report');

// ── Periods ────────────────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthIndex = (p: string) => { const [m, y] = p.split('/').map(Number); return y * 12 + (m - 1); };
const fromIndex = (i: number) => `${String((i % 12) + 1).padStart(2, '0')}/${Math.floor(i / 12)}`;

/** "04/2026" → "Apr 2026". */
export function periodLabel(p: string): string {
  const m = p.match(/^(\d{2})\/(\d{4})$/);
  return m ? `${MONTHS[Number(m[1]) - 1]} ${m[2]}` : p;
}

/** "03/2026" → "FY 2025-26" (the March that ends the year). */
export function fyLabel(p: string): string {
  const m = p.match(/^\d{2}\/(\d{4})$/);
  if (!m) return p;
  const end = Number(m[1]);
  return `FY ${end - 1}-${String(end).slice(-2)}`;
}

/** The periods of a job in words: "Apr – Jun 2026", "FY 2025-26", "Apr 2026, Jul 2026". */
export function periodsLabel(mode: string | null | undefined, periods: string[]): string {
  if (!periods.length) return '';
  if (modeDef(mode)?.period === 'fy') return periods.map(fyLabel).join(', ');
  const sorted = [...periods].sort((a, b) => monthIndex(a) - monthIndex(b));
  const contiguous = sorted.every((p, i) => i === 0 || monthIndex(p) === monthIndex(sorted[i - 1]) + 1);
  if (sorted.length > 1 && contiguous) {
    const [a, b] = [sorted[0], sorted[sorted.length - 1]];
    return a.slice(3) === b.slice(3) ? `${MONTHS[Number(a.slice(0, 2)) - 1]} – ${periodLabel(b)}` : `${periodLabel(a)} – ${periodLabel(b)}`;
  }
  const shown = sorted.slice(0, 3).map(periodLabel).join(', ');
  return sorted.length > 3 ? `${shown} and ${sorted.length - 3} more` : shown;
}

/** Return periods from last month back, newest first ("MM/YYYY"). */
export function recentMonths(n = 36): string[] {
  const [y, m] = istToday().split('-').map(Number);
  const last = y * 12 + (m - 1) - 1;
  return Array.from({ length: n }, (_, i) => fromIndex(last - i));
}

/** Every month from a to b inclusive, oldest first. */
export function monthRange(a: string, b: string): string[] {
  const [lo, hi] = [monthIndex(a), monthIndex(b)].sort((x, y) => x - y);
  return Array.from({ length: hi - lo + 1 }, (_, i) => fromIndex(lo + i));
}

/** Financial years as their March ("03/YYYY"), newest first; the running year only when asked. */
export function recentFys(n = 6, includeRunning = false): { value: string; label: string }[] {
  const [y, m] = istToday().split('-').map(Number);
  const runningEnd = m >= 4 ? y + 1 : y;
  const first = includeRunning ? runningEnd : runningEnd - 1;
  return Array.from({ length: n }, (_, i) => { const v = `03/${first - i}`; return { value: v, label: fyLabel(v) }; });
}

/** What a job fetches, in words. */
export function jobWhat(job: { job_type: string; payload: unknown }): string {
  if (job.job_type === 'PULL_NOTICES_BUNDLE') return 'Notices, refunds and DRC-03';
  if (job.job_type === 'LOGIN_TEST') return 'Login test';
  const p = (job.payload && typeof job.payload === 'object' ? job.payload : {}) as { mode?: string; periods?: unknown };
  const periods = Array.isArray(p.periods) ? p.periods.filter((x): x is string => typeof x === 'string') : [];
  const when = periodsLabel(p.mode, periods);
  return `${modeLabel(p.mode)}${when ? ` · ${when}` : ''}`;
}

// ── Times ──────────────────────────────────────────────────────────────────
/** "10:42" in IST. */
export function fmtTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "10:42" today, "yesterday 10:42", else "05 Oct 2026, 10:42" (IST). */
export function fmtWhen(ts: string | null | undefined): string {
  if (!ts) return '—';
  const day = new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const today = istToday();
  if (day === today) return fmtTime(ts);
  if (day === addDays(today, -1)) return `yesterday ${fmtTime(ts)}`;
  return fmtDateTime(ts);
}

/** "42 min", "3 h 5 min", "2 d 4 h". */
export function fmtMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return '—';
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
  return `${Math.floor(m / 1440)} d${Math.floor((m % 1440) / 60) ? ` ${Math.floor((m % 1440) / 60)} h` : ''}`;
}

/** "13:00" from the settings' "13:00:00". */
export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');

/** The start of today in IST, as an ISO timestamp (for "today" filters). */
export const istDayStart = (day = istToday()) => new Date(`${day}T00:00:00+05:30`).toISOString();

/** The coming 05:00 IST (today's if it is not 05:00 yet). */
export function nextFiveAm(): string {
  const now = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
  const today = istToday();
  return new Date(`${now < '05:00:00' ? today : addDays(today, 1)}T05:00:00+05:30`).toISOString();
}

export function autopilotState(s: AutopilotSettings | null | undefined): 'on' | 'off' | 'paused' {
  if (!s?.enabled) return 'off';
  if (s.paused_until && Date.parse(s.paused_until) > Date.now()) return 'paused';
  return 'on';
}

/** "until 14:30" or "until 07 Oct 2026, 05:00". */
export function pausedUntilWords(ts: string | null | undefined): string {
  if (!ts) return '';
  const day = new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return day === istToday() ? `until ${fmtTime(ts)}` : `until ${fmtDate(day)}, ${fmtTime(ts)}`;
}

/** The Autopilot page's queue, filtered to a status (the status line's counts open these). */
export const autopilotQueueHref = (status?: string) => `/notices-autopilot?tab=queue${status ? `&status=${status}` : ''}`;

/** The agent that reported last (the one the page talks about). */
export const latestAgent = (s: AutopilotStatus | undefined): AgentRow | null => s?.agents?.[0] ?? null;

// What each of the agent's browsers is doing (its heartbeat's workers).
const WORKER_STATE: Record<string, string> = {
  idle: 'idle',
  login: 'logging in',
  captcha: 'waiting for a CAPTCHA',
  running: 'reading the portal',
  parking: 'putting a client back in the queue',
};

export const workerWords = (w: AgentWorker) =>
  `${w.client_name ? `${w.client_name}: ` : ''}${WORKER_STATE[w.state ?? ''] ?? w.state ?? 'idle'}`;

/** "Demo Textiles: waiting for a CAPTCHA · Sample Pharma: reading the portal · 1 browser idle" */
export function workersLine(agent: AgentRow | null): string | null {
  const workers = agent?.online ? agent.info?.workers ?? [] : [];
  if (!workers.length) return null;
  const busy = workers.filter((w) => w.state && w.state !== 'idle');
  const idle = workers.length - busy.length;
  return [...busy.map(workerWords), ...(idle ? [`${plural(idle, 'browser')} idle`] : [])].join(' · ');
}

/** The next scheduled run today or tomorrow, in words; null when the schedule is off. */
export function nextRunWords(s: AutopilotSettings | null | undefined): string | null {
  if (!s || !s.schedule_enabled) return null;
  const now = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
  const slots = [
    { at: s.morning_at, what: 'every active client' },
    ...(s.afternoon_scope === 'off' ? [] : [{ at: s.afternoon_at, what: s.afternoon_scope === 'all' ? 'every active client' : 'clients that need it' }]),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const next = slots.find((x) => x.at > now);
  return next ? `today ${hhmm(next.at)} (${next.what})` : `tomorrow ${hhmm(slots[0].at)} (${slots[0].what})`;
}

// ── Page visibility ────────────────────────────────────────────────────────
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

// ── Loaders and hooks ──────────────────────────────────────────────────────
export async function loadAutopilotStatus(): Promise<AutopilotStatus> {
  const { data, error } = await supabase.rpc('autopilot_status');
  if (error) throw error;
  return data as unknown as AutopilotStatus;
}

/** The Autopilot page's state; refreshes every 10 s while the tab is visible (pass a slower rate elsewhere). */
export function useAutopilotStatus(opts: { refetchMs?: number; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['autopilot-status'],
    queryFn: loadAutopilotStatus,
    enabled: opts.enabled ?? true,
    refetchInterval: opts.refetchMs ?? 10_000,
    staleTime: 5_000,
    retry: 1,
  });
}

/** Can a sync be sent to the queue right now: switched on, not paused, its runner (Chrome or office agent) reporting. */
export function agentUsable(s: AutopilotStatus | undefined): boolean {
  return !!s && autopilotState(s.settings) === 'on' && !!s.agent_online;
}

export async function wallPing(actor: Actor | null, attentive: boolean): Promise<WallState> {
  const { data, error } = await supabase.rpc('autopilot_wall_ping', {
    p_user_id: uuidOrNull(actor?.id), p_name: actor?.firstName ?? null, p_attentive: attentive,
  });
  if (error) throw error;
  const d = (data ?? {}) as unknown as Partial<WallState>;
  return {
    captchas: Array.isArray(d.captchas) ? d.captchas : [],
    waiting: d.waiting ?? 0,
    queued: d.queued ?? 0,
    running: d.running ?? 0,
    typed_today: d.typed_today ?? 0,
    done_today: d.done_today ?? 0,
    agent_online: !!d.agent_online,
    enabled: !!d.enabled,
    present: Array.isArray(d.present) ? d.present.filter((x): x is string => typeof x === 'string') : [],
  };
}

/** How long after the last key or click on the wall a person still counts as at it. */
export const ATTENTIVE_MS = 10 * 60_000;

/**
 * The CAPTCHA wall's poll: every 2 s for as long as the wall is open, on
 * screen or in a background tab. Each call says whether the person is
 * attentive — the wall on screen, or they typed or clicked on it in the last
 * 10 minutes. The agent opens portal logins only while someone is attentive
 * (≤ 30 s since such a call), and only that time counts as wall minutes; no
 * separate presence write. Call touch() on every key or click on the wall.
 */
export function useWallPing(actor: Actor | null, active = true) {
  const visible = usePageVisible();
  const lastTouch = useRef<number | null>(null);
  const attentiveNow = useCallback(() => document.visibilityState === 'visible'
    || (lastTouch.current !== null && Date.now() - lastTouch.current < ATTENTIVE_MS), []);
  const on = active && !!actor;
  const query = useQuery({
    queryKey: ['autopilot-wall', actor?.id ?? null],
    queryFn: () => wallPing(actor, attentiveNow()),
    enabled: on,
    refetchInterval: on ? 2_000 : false,
    refetchIntervalInBackground: true,
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });
  const touch = useCallback(() => { lastTouch.current = Date.now(); }, []);
  return { query, visible, touch, attentiveNow };
}

/**
 * How long one CAPTCHA has been on screen in front of the person — the human
 * time the acceptance target measures (sent as p_typing_ms). Starts when the
 * card appears with the page visible (or when the page becomes visible), pauses
 * while the page is hidden, restarts for each new CAPTCHA (key); capped at 2 min.
 */
export function useOnScreenClock(key: string, visible: boolean): () => number {
  const acc = useRef(0);
  const since = useRef<number | null>(null);
  useEffect(() => {
    acc.current = 0;
    since.current = document.visibilityState === 'visible' ? Date.now() : null;
  }, [key]);
  useEffect(() => {
    if (visible) { if (since.current === null) since.current = Date.now(); }
    else if (since.current !== null) { acc.current += Date.now() - since.current; since.current = null; }
  }, [visible]);
  return useCallback(() => Math.min(120_000, Math.round(acc.current + (since.current !== null ? Date.now() - since.current : 0))), []);
}

const NOTIFY_KEY = 'gstk-captcha-notify';
const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window;

/**
 * "Notify me on this PC": a desktop notification when CAPTCHAs come in while
 * the wall is in a background tab. Opt-in per browser (kept in localStorage, a
 * convenience only); asks the browser's permission once.
 */
export function useCaptchaNotify() {
  const [on, setOn] = useState(() => {
    try { return notifySupported() && Notification.permission === 'granted' && localStorage.getItem(NOTIFY_KEY) === '1'; } catch { return false; }
  });
  const enable = useCallback(async (): Promise<NotificationPermission | 'unsupported'> => {
    if (!notifySupported()) return 'unsupported';
    const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (p === 'granted') {
      try { localStorage.setItem(NOTIFY_KEY, '1'); } catch { /* the choice just isn't remembered */ }
      setOn(true);
    }
    return p;
  }, []);
  const disable = useCallback(() => {
    try { localStorage.removeItem(NOTIFY_KEY); } catch { /* nothing to forget */ }
    setOn(false);
  }, []);
  const show = useCallback((title: string, body: string) => {
    if (!on || !notifySupported() || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(title, { body, tag: 'gstk-captcha' });
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* a browser that only notifies from a service worker */ }
  }, [on]);
  return { supported: notifySupported(), on, enable, disable, show };
}

/** The header badge: CAPTCHAs on the wall and clients waiting for one (no presence); none without a wall (Chrome runner). */
export function useAutopilotBadge(enabled = true) {
  return useQuery({
    queryKey: ['autopilot-badge'],
    queryFn: async (): Promise<AutopilotBadgeData> => {
      const { data, error } = await supabase.rpc('autopilot_badge');
      if (error) throw error;
      const d = (data ?? {}) as unknown as Partial<AutopilotBadgeData>;
      const runner = d.runner === 'chrome' || d.runner === 'office_agent' ? d.runner : null;
      return { live: Number(d.live ?? 0), waiting: Number(d.waiting ?? 0), enabled: d.enabled ?? null, runner };
    },
    enabled,
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: false,
  });
}

export function useAutopilotMetrics(days = 14) {
  return useQuery({
    queryKey: ['autopilot-metrics', days],
    queryFn: async (): Promise<MetricsRow[]> => {
      const { data, error } = await supabase.rpc('autopilot_metrics', { p_days: days });
      if (error) throw error;
      return (data ?? []) as MetricsRow[];
    },
    staleTime: 60_000,
  });
}

export interface RegistrationAlert {
  client_id: string;
  name: string;
  gstin: string | null;
  status: string;
  cancellation_date: string | null;
  pulled_at: string | null;
}

/** Active clients whose registration the portal's profile shows as cancelled or suspended. Empty on a database without the column. */
export function useRegistrationAlerts() {
  return useQuery({
    queryKey: ['autopilot-registration'],
    staleTime: 60_000,
    queryFn: async (): Promise<RegistrationAlert[]> => {
      const { data, error } = await supabase.from('gst_taxpayer_profile')
        .select('client_id, gstin_status, cancellation_date, pulled_at, clients(name, gstin, inactive_at_hand)')
        .not('gstin_status', 'is', null);
      if (error) return [];
      type Row = { client_id: string; gstin_status: string | null; cancellation_date: string | null; pulled_at: string | null;
        clients: { name: string; gstin: string | null; inactive_at_hand: boolean | null } | null };
      return ((data ?? []) as unknown as Row[])
        .filter((r) => r.clients && !r.clients.inactive_at_hand && /(cancel|suspend)/i.test(r.gstin_status ?? ''))
        .map((r) => ({ client_id: r.client_id, name: r.clients!.name, gstin: r.clients!.gstin, status: r.gstin_status ?? '',
          cancellation_date: r.cancellation_date, pulled_at: r.pulled_at }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

// ── Writes (each returns words for a toast) ────────────────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrNull(id: string | null | undefined): string | null {
  return id && UUID.test(id) ? id : null;
}

/** "autopilot_enqueue: report gstr3b_pull needs …" → "Report gstr3b_pull needs …". */
export function friendlyDbError(message: string | null | undefined): string {
  const m = (message ?? 'Something went wrong.').replace(/^[a-z_]+:\s*/, '');
  return m.charAt(0).toUpperCase() + m.slice(1);
}

function normaliseEnqueue(data: unknown): EnqueueResult {
  const d = (data ?? {}) as Partial<EnqueueResult>;
  const sk = (d.skipped ?? {}) as Partial<EnqueueResult['skipped']>;
  return {
    queued: Number(d.queued ?? 0), already: Number(d.already ?? 0), run_id: d.run_id ?? null, eligible: Number(d.eligible ?? 0),
    out_of_scope: Number(d.out_of_scope ?? 0),
    skipped: { no_credentials: Number(sk.no_credentials ?? 0), excluded: Number(sk.excluded ?? 0), inactive: Number(sk.inactive ?? 0) },
  };
}

/** "Queued 10 clients · 2 already in the queue · skipped 1 without a portal login." */
export function describeEnqueue(r: EnqueueResult): { tone: 'success' | 'info' | 'warning'; text: string } {
  const parts: string[] = [r.queued ? `Queued ${plural(r.queued, 'client')}` : 'Nothing new was queued'];
  if (r.already) parts.push(`${plural(r.already, 'client')} already in the queue`);
  const skipped = [
    r.skipped.no_credentials && `${r.skipped.no_credentials} without a portal login`,
    r.skipped.excluded && `${r.skipped.excluded} excluded from the notices sync`,
    r.skipped.inactive && `${r.skipped.inactive} inactive`,
  ].filter(Boolean);
  if (skipped.length) parts.push(`skipped ${skipped.join(', ')}`);
  if (r.out_of_scope) parts.push(`${r.out_of_scope} not due`);
  return { tone: r.queued ? 'success' : r.already ? 'info' : 'warning', text: `${parts.join(' · ')}.` };
}

/** ok with the result and its words, or not ok with the error (one shape: the app type-checks without strict mode). */
export interface EnqueueOutcome {
  ok: boolean;
  error: string | null;
  result: EnqueueResult | null;
  tone: 'success' | 'info' | 'warning';
  text: string;
}
const failed = (error: string): EnqueueOutcome => ({ ok: false, error, result: null, tone: 'warning', text: error });

/** Puts work on the office agent's queue. clientIds null = every active client with a portal login. */
export async function enqueueJobs(args: {
  clientIds: string[] | null;
  jobType: 'PULL_NOTICES_BUNDLE' | 'FETCH_REPORT';
  mode?: string;
  periods?: string[];
  origin: 'manual' | 'report' | 'evidence';
  actor: Actor | null;
}): Promise<EnqueueOutcome> {
  const { data, error } = await supabase.rpc('autopilot_enqueue', {
    p_client_ids: args.clientIds,
    p_job_type: args.jobType,
    p_payload: args.jobType === 'FETCH_REPORT' ? { mode: args.mode ?? null, periods: args.periods ?? [] } : {},
    p_origin: args.origin,
    p_priority: null,
    p_requested_by: uuidOrNull(args.actor?.id),
    p_requested_by_name: args.actor?.firstName ?? null,
    p_scope: 'all',
  });
  if (error) return failed(friendlyDbError(error.message));
  const result = normaliseEnqueue(data);
  return { ok: true, error: null, result, ...describeEnqueue(result) };
}

export type AnswerResult = 'ok' | 'stale' | 'empty' | 'gone';

/** From the wall: the characters typed, "can't read it" (refresh) or "skip this client today". */
export async function answerCaptcha(
  c: Pick<WallCaptcha, 'job_id' | 'prompt_id'>, action: 'answer' | 'refresh' | 'skip', text: string | null,
  typingMs: number | null, actor: Actor | null,
): Promise<AnswerResult> {
  const { data, error } = await supabase.rpc('portal_job_answer', {
    p_job_id: c.job_id,
    p_prompt_id: c.prompt_id,
    p_text: text,
    p_action: action,
    p_typing_ms: typingMs === null ? null : Math.max(0, Math.round(typingMs)),
    p_user_id: uuidOrNull(actor?.id),
    p_user_name: actor?.firstName ?? null,
  });
  if (error) throw new Error(friendlyDbError(error.message));
  return ((data as string | null) ?? 'gone') as AnswerResult;
}

export async function cancelJob(jobId: string, actor: Actor | null): Promise<{ ok: boolean; text: string }> {
  const { data, error } = await supabase.rpc('portal_job_cancel', { p_job_id: jobId, p_by_name: actor?.firstName ?? null });
  if (error) return { ok: false, text: `Couldn't cancel: ${friendlyDbError(error.message)}` };
  const res = (data as string | null) ?? 'gone';
  if (res === 'cancelled') return { ok: true, text: 'Cancelled. A job the agent is running stops at its next check.' };
  if (res === 'gone') return { ok: false, text: 'That job is no longer on the queue.' };
  return { ok: false, text: `Nothing to cancel: the job had already ${res === 'succeeded' ? 'finished' : res}.` };
}

export async function retryJob(jobId: string, actor: Actor | null): Promise<EnqueueOutcome> {
  const { data, error } = await supabase.rpc('portal_job_retry', {
    p_job_id: jobId, p_by: uuidOrNull(actor?.id), p_by_name: actor?.firstName ?? null,
  });
  if (error) return failed(friendlyDbError(error.message));
  const d = (data ?? {}) as { error?: string };
  if (d.error === 'gone') return failed('That job is no longer on record.');
  const result = normaliseEnqueue(data);
  return { ok: true, error: null, result, ...describeEnqueue(result) };
}

export interface AskClientResult { sent: boolean; mode?: string; to?: string; reason?: 'no_client_email' | 'not_sent' | null }

/** Same words as the notice workspace's document requests (docEmailOutcome): never implies a send that did not happen. */
export function askClientOutcome(r: AskClientResult): { tone: 'success' | 'warning' | 'info'; text: string } {
  if (r.sent) {
    return r.mode === 'live'
      ? { tone: 'success', text: `E-mailed ${r.to}.` }
      : { tone: 'success', text: 'Written to the outbox as a preview; nothing was sent.' };
  }
  if (r.reason === 'no_client_email') return { tone: 'warning', text: 'The client has no e-mail on file — add it in Edit Client.' };
  return { tone: 'info', text: 'Not e-mailed: e-mails to clients are switched off.' };
}

export async function askClient(clientId: string, kind: 'password' | 'account_locked', actor: Actor | null) {
  const { data, error } = await supabase.rpc('autopilot_ask_client', { p_client_id: clientId, p_kind: kind, p_actor_name: actor?.firstName ?? null });
  if (error) return { tone: 'warning' as const, text: `Couldn't ask the client: ${friendlyDbError(error.message)}` };
  return askClientOutcome((data ?? { sent: false }) as unknown as AskClientResult);
}

export async function saveAutopilotSettings(patch: Partial<AutopilotSettings>, actor: Actor | null): Promise<void> {
  const { id: _id, updated_at: _at, ...rest } = patch;
  const { error } = await supabase.from('autopilot_settings')
    .update({ ...rest, updated_by_name: actor?.firstName ?? null }).eq('id', true);
  if (error) throw new Error(friendlyDbError(error.message));
}
