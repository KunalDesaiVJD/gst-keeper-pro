// Portal sync health per client, counted exactly as the command centre counts it
// (public.notices_command_centre: the eligible / sync_state / failing CTEs in
// migration 20261006122000), so "8 / 12 synced", "never synced" and each
// failure reason on the dashboard open a list here with the same number
// (audit U-50-1, U-50-2, U-51-1..3, cross-cutting "numbers disagree").
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { fetchAllRows } from '@/lib/fetchAllRows';

export type StepStatus = Database['public']['Views']['client_sync_status']['Row'];
export type SyncRun = Database['public']['Tables']['sync_runs']['Row'];
export type SyncItem = Database['public']['Tables']['sync_run_items']['Row'];
export type Step = 'login' | 'notices' | 'refunds' | 'drc03';

const STEPS: Step[] = ['login', 'notices', 'refunds', 'drc03'];
const DAY_MS = 86_400_000;

export interface ClientBase {
  id: string;
  name: string;
  gstin: string;
  gst_user_id: string | null;
  inactive_at_hand: boolean | null;
  notices_sync_excluded: boolean | null;
  assigned_accountant: string | null;
  /** When the portal password or user ID last changed (20261010110000); absent on an older database. */
  gst_password_changed_at?: string | null;
}

export type OffReason = 'excluded' | 'inactive' | 'no_user_id';
/** One state per client for the badge and the default order. */
export type SyncState = 'failed' | 'never' | 'stale' | 'fresh' | 'off';
/** The list's status filter (?status=). "all" is every client the sync covers. */
export type StatusFilter = 'all' | 'fresh' | 'stale' | 'never' | 'failed' | 'off';

export interface ClientHealth {
  client: ClientBase;
  eligible: boolean;
  off: OffReason | null;
  steps: Partial<Record<Step, StepStatus>>;
  /** Last good notices pull (status ok / held). */
  lastSuccessAt: string | null;
  /** Latest login or notices attempt, good or not. */
  lastAttemptAt: string | null;
  fresh: boolean;
  never: boolean;
  /** The password was changed after every attempt so far: earlier failures no longer count; waiting for its next sync. */
  passwordReset: boolean;
  /** The reason class the command centre counts this client under, else null. */
  failReason: string | null;
  failStep: 'login' | 'notices' | null;
  failMessage: string | null;
  failAt: string | null;
  state: SyncState;
}

/** Compares two timestamps from PostgREST to the microsecond (a < b → negative). */
export function tsCmp(a: string, b: string): number {
  const d = Date.parse(a) - Date.parse(b);
  if (d !== 0) return d;
  const micro = (s: string) => Number(((s.match(/\.(\d+)/)?.[1] ?? '') + '000000').slice(3, 6));
  return micro(a) - micro(b);
}

export function classify(client: ClientBase, steps: Partial<Record<Step, StepStatus>>, now = Date.now()): ClientHealth {
  const userId = client.gst_user_id ?? '';
  const eligible = userId !== '' && !client.inactive_at_hand && !client.notices_sync_excluded;
  const off: OffReason | null = eligible ? null
    : client.notices_sync_excluded ? 'excluded' : client.inactive_at_hand ? 'inactive' : 'no_user_id';
  const notices = steps.notices;
  const login = steps.login;
  const lastSuccessAt = notices?.last_success_at ?? null;
  const attempts = [notices?.last_attempt_at, login?.last_attempt_at].filter((t): t is string => !!t).sort(tsCmp);
  const lastAttemptAt = attempts.length ? attempts[attempts.length - 1] : null;
  // As the command centre (20261010110000): a password changed after every
  // attempt so far puts the client back to "not synced" until its next sync.
  const changedAt = client.gst_password_changed_at ?? null;
  const passwordReset = eligible && !!changedAt && (!lastAttemptAt || tsCmp(changedAt, lastAttemptAt) > 0);
  const fresh = eligible && !passwordReset && !!lastSuccessAt && Date.parse(lastSuccessAt) > now - DAY_MS;
  const never = eligible && ((!lastSuccessAt && !notices?.last_attempt_at && !login?.last_attempt_at) || passwordReset);

  // CASE WHEN login failed at or after the last good pull THEN its reason
  //      WHEN the notices step's last attempt failed THEN its reason END
  let failReason: string | null = null;
  let failStep: 'login' | 'notices' | null = null;
  let failMessage: string | null = null;
  let failAt: string | null = null;
  if (eligible && !passwordReset) {
    if (login?.last_status === 'failed' && login.last_attempt_at && (!lastSuccessAt || tsCmp(login.last_attempt_at, lastSuccessAt) >= 0)) {
      failReason = login.last_reason_class ?? null;
      failStep = 'login';
      failMessage = login.last_message ?? null;
      failAt = login.last_attempt_at;
    } else if (notices?.last_status === 'failed') {
      failReason = notices.last_reason_class ?? null;
      failStep = 'notices';
      failMessage = notices.last_message ?? null;
      failAt = notices.last_attempt_at ?? null;
    }
    if (!failReason) { failStep = null; failMessage = null; failAt = null; }
  }
  const state: SyncState = !eligible ? 'off' : failReason ? 'failed' : never ? 'never' : fresh ? 'fresh' : 'stale';
  return { client, eligible, off, steps, lastSuccessAt, lastAttemptAt, fresh, never, passwordReset, failReason, failStep, failMessage, failAt, state };
}

export function matchesStatus(h: ClientHealth, status: StatusFilter, reason?: string | null): boolean {
  switch (status) {
    case 'all': return h.eligible;
    case 'fresh': return h.fresh;
    case 'stale': return h.eligible && !h.fresh;
    case 'never': return h.never;
    case 'failed': return !!h.failReason && (!reason || h.failReason === reason);
    case 'off': return !h.eligible;
    default: return h.eligible;
  }
}

export interface HealthCounts {
  all: number; fresh: number; stale: number; never: number; failed: number; off: number;
  reasons: Record<string, number>;
}

export function countHealth(rows: ClientHealth[]): HealthCounts {
  const c: HealthCounts = { all: 0, fresh: 0, stale: 0, never: 0, failed: 0, off: 0, reasons: {} };
  rows.forEach((h) => {
    if (!h.eligible) { c.off += 1; return; }
    c.all += 1;
    if (h.fresh) c.fresh += 1; else c.stale += 1;
    if (h.never) c.never += 1;
    if (h.failReason) { c.failed += 1; c.reasons[h.failReason] = (c.reasons[h.failReason] ?? 0) + 1; }
  });
  return c;
}

// ── What each failure means and the one thing to do about it (U-51-1) ──────
export type ReasonAction = 'password' | 'retry' | 'report';

export const REASONS: Record<string, { label: string; long: string; short: string; hint: string; action: ReasonAction }> = {
  login_failed: {
    label: 'Login failed', long: 'Login failed — password changed?', short: 'login', action: 'password',
    hint: 'The portal refused the user ID or password; it was probably changed. Update it, then retry.',
  },
  captcha_timeout: {
    label: 'CAPTCHA not typed', long: 'CAPTCHA not typed', short: 'CAPTCHA', action: 'retry',
    hint: 'Nobody typed the CAPTCHA within 10 minutes, so the run moved on. Retry when someone can type it.',
  },
  session_mismatch: {
    label: 'Wrong GSTIN on the portal', long: 'Portal session was another GSTIN', short: 'wrong GSTIN', action: 'retry',
    hint: 'The portal was logged in as another client, so nothing was saved. Retry; if it repeats, check the portal user ID.',
  },
  portal_error: {
    label: 'Portal error', long: 'Portal error', short: 'portal error', action: 'retry',
    hint: 'The GST portal returned an error. It is usually temporary; retry later.',
  },
  timeout: {
    label: 'Portal timed out', long: 'Portal timed out', short: 'timed out', action: 'retry',
    hint: 'The portal did not answer in time. Retry later.',
  },
  stalled: {
    label: 'Run stalled', long: 'Run stalled', short: 'stalled', action: 'retry',
    hint: 'No progress for 10 minutes, so the run moved on. Retry.',
  },
  save_failed: {
    label: 'Save error in the app', long: 'Save error in the app', short: 'save error', action: 'report',
    hint: 'The portal data was read but the app could not save it. Report it with the details; retrying will fail the same way.',
  },
  other: {
    label: 'Other failure', long: 'Other failure', short: 'other', action: 'retry',
    hint: 'The run stopped for a reason it did not classify. Retry; report it if it repeats.',
  },
};

export const reasonDef = (code: string | null | undefined) =>
  REASONS[code ?? ''] ?? {
    label: code ? code.replace(/_/g, ' ') : 'Failed', long: code ?? 'Failed', short: code ? code.replace(/_/g, ' ') : 'failed',
    hint: 'See the details.', action: 'retry' as ReasonAction,
  };

/** Failures a retry can fix without a person changing anything first. */
export const isRetryable = (h: ClientHealth) => !!h.failReason && reasonDef(h.failReason).action !== 'password';

export const OFF_LABEL: Record<OffReason, string> = {
  excluded: 'Excluded from notices sync',
  inactive: 'Inactive at hand',
  no_user_id: 'No portal user ID',
};

export const STEP_LABEL: Record<string, string> = {
  login: 'Login', notices: 'Notices', refunds: 'Refunds', drc03: 'DRC-03', case_folder: 'Case folder',
};

/** Clients a hand-picked sync can run for: a portal user ID and not excluded. */
export const syncableIds = (rows: ClientHealth[]) =>
  rows.filter((h) => (h.client.gst_user_id ?? '') !== '' && !h.client.notices_sync_excluded).map((h) => h.client.id);

// ── Loading ────────────────────────────────────────────────────────────────
export async function loadClientHealth(): Promise<ClientHealth[]> {
  const [clients, status] = await Promise.all([
    fetchAllRows<ClientBase>('clients', 'id, name, gstin, gst_user_id, inactive_at_hand, notices_sync_excluded, assigned_accountant, gst_password_changed_at',
      (q) => q.order('name').order('id')),
    fetchAllRows<StepStatus>('client_sync_status', '*', (q) => q.in('step', STEPS).order('client_id').order('step')),
  ]);
  const byClient = new Map<string, Partial<Record<Step, StepStatus>>>();
  status.forEach((s) => {
    if (!s.client_id || !s.step) return;
    const m = byClient.get(s.client_id) ?? {};
    m[s.step as Step] = s;
    byClient.set(s.client_id, m);
  });
  const now = Date.now();
  return clients.map((c) => classify(c, byClient.get(c.id) ?? {}, now));
}

export interface OpenCounts { open: number; overdue: number; due7: number }

/** Open notices per client from notice_facts (the counts /notices-all?client= shows). */
export async function loadOpenCounts(): Promise<Map<string, OpenCounts>> {
  const rows = await fetchAllRows<{ client_id: string | null; is_overdue: boolean | null; is_due_in_7: boolean | null }>(
    'notice_facts', 'client_id, is_overdue, is_due_in_7', (q) => q.eq('is_open', true).order('id'));
  const m = new Map<string, OpenCounts>();
  rows.forEach((r) => {
    if (!r.client_id) return;
    const c = m.get(r.client_id) ?? { open: 0, overdue: 0, due7: 0 };
    c.open += 1;
    if (r.is_overdue) c.overdue += 1;
    if (r.is_due_in_7) c.due7 += 1;
    m.set(r.client_id, c);
  });
  return m;
}

export interface FailureRun { since: string; tries: number }

/** "Failing since … · n tries": failed login / notices attempts after the last good pull (U-51-3). */
export async function loadFailureRuns(fails: ClientHealth[]): Promise<Map<string, FailureRun>> {
  const out = new Map<string, FailureRun>();
  if (!fails.length) return out;
  const floor = new Date(Date.now() - 90 * DAY_MS).toISOString();
  const rows = await fetchAllRows<{ client_id: string; created_at: string }>('sync_run_items', 'client_id, created_at',
    (q) => q.in('client_id', fails.map((f) => f.client.id)).in('step', ['login', 'notices']).eq('status', 'failed')
      .gte('created_at', floor).order('created_at').order('id'));
  const lastGood = new Map(fails.map((f) => [f.client.id, f.lastSuccessAt]));
  rows.forEach((r) => {
    const good = lastGood.get(r.client_id);
    if (good && tsCmp(r.created_at, good) <= 0) return;
    const cur = out.get(r.client_id);
    out.set(r.client_id, cur ? { since: cur.since, tries: cur.tries + 1 } : { since: r.created_at, tries: 1 });
  });
  return out;
}

export async function loadRuns(limit = 12): Promise<SyncRun[]> {
  const { data, error } = await supabase.from('sync_runs').select('*').order('started_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}
