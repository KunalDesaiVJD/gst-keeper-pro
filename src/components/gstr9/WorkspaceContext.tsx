import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { computeWorkings, Workings } from '@/lib/gstr9/engine';
import { AnnualReturnDocs, DocKey, DOC_KEYS, Justification, ValTax } from '@/lib/gstr9/types';
import type { Drc03Filing, SetOff } from '@/lib/gstr9/payables';
import {
  AnnualReturnPeriod,
  DocConflictError,
  loadDoc,
  loadDrc03s,
  loadPeriod,
  loadSetOffs,
  loadSignoffRow,
  loadWorkspace,
  ChangedSinceError,
  saveDoc,
  setPeriodStatus,
  signoffAnnualReturn,
  SignoffStaleError,
  SourceLockedError,
  YearLockedError,
} from '@/lib/gstr9/store';
import { toSignoffState, type SignoffActor, type SignoffChanges, type SignoffState } from '@/lib/gstr9/signoffFlow';
import { useSignoffActor } from './signoff/useSignoffActor';
import { lockedChanges, lockedMessage, SOURCE_EDITOR_ROLE } from '@/lib/gstr9/sourceLock';

const DOC_LABEL: Record<DocKey, string> = {
  sales: 'Sales', purchases: 'Purchases & ITC', duties_output: 'Duties & Taxes (output)', duties_input: 'Duties & Taxes (input)',
  rcm: 'RCM', portal: 'Portal data', gstr9: 'GSTR-9', annexures: 'Annexures', gstr9c: 'GSTR-9C', notice: 'Notice format',
  justifications: 'Reasons', settings: 'Settings',
};

/** What flush() hands back: whether everything saved, and the exact docs/workings that are now saved. */
export interface FlushResult {
  ok: boolean;
  docs: AnnualReturnDocs | null;
  workings: Workings | null;
  period: AnnualReturnPeriod | null;
}

export interface WorkspaceClient {
  id: string;
  name: string;
  gstin: string;
  regular_sub_type: string | null;
  builder_itc_type: string | null;
  /** For GSTR-9 / 9C applicability (register/useApplicability). */
  registration_type?: string | null;
  registration_date?: string | null;
  cancellation_date?: string | null;
  registration_cancellation_date?: string | null;
}

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface WorkspaceValue {
  client: WorkspaceClient;
  financialYear: string;
  loading: boolean;
  docs: AnnualReturnDocs;
  workings: Workings;
  /**
   * Apply a change to one doc; it autosaves shortly after. `archive` keeps the
   * version being replaced in history even inside the throttle window (restores).
   */
  /**
   * Change a sheet; it autosaves. `action` labels the change in the revision
   * log (default "Edited"); `archive` keeps the replaced version as a snapshot.
   */
  update: <K extends DocKey>(key: K, updater: (doc: AnnualReturnDocs[K]) => AnnualReturnDocs[K], opts?: { archive?: boolean; action?: string }) => void;
  /** Write (or clear, with empty text) the justification for a difference line. */
  justify: (lineKey: string, text: string, diffAt: ValTax) => void;
  saveState: SaveState;
  lastSavedAt: Date | null;
  period: AnnualReturnPeriod | null;
  locked: boolean;
  /** Locked, or a client login: nothing is editable. */
  readOnly: boolean;
  /** A staff login (clients get a read-only view). Staff can record set-offs even after the lock. */
  isStaff: boolean;
  canUnlock: boolean;
  /**
   * Review & lock ('locked': saves everything first and refuses with an open
   * difference; records the reviewer, checklist, note and payables) or unlock
   * ('in_progress', with the reason as the note: back to Verified).
   */
  setStatus: (to: 'locked' | 'in_progress', opts?: { note?: string; checklist?: Record<string, boolean>; changesAck?: number; overrideReason?: string }) => Promise<void>;
  /**
   * Prepare / verify / send back, or withdraw a sign-off. Prepare and verify
   * save everything first; verify also refuses with an open difference.
   */
  signoff: (
    action: 'prepare' | 'withdraw_prepared' | 'verify' | 'withdraw_verified' | 'send_back',
    opts?: { note?: string; returnTo?: 'preparer' | 'verifier'; changesAck?: number },
  ) => Promise<void>;
  /** The signed-in user as the sign-off rules see them. */
  me: SignoffActor;
  /** Allotment and sign-off of this working (stage, stamps, changes since). */
  signoffState: SignoffState;
  /** Re-read the period and the changes since sign-off. */
  refreshSignoff: () => Promise<void>;
  /** GST manager or superadmin — they review & lock, act for others, and remove set-offs after the lock. */
  canVerify: boolean;
  /** The user's role as sent to the database (superadmin | gst_manager | employee | client). */
  role: string;
  /**
   * The superadmin, while the year is open: the only user who can change a
   * figure that comes from a source — typed over portal data, or a figure the
   * working fills in (sourceLock.ts). Anyone on staff can still pull or upload.
   */
  canEditSource: boolean;
  /** The payable set-off register (removed ones included) and the client's DRC-03s from the portal. */
  setOffs: SetOff[];
  drc03s: Drc03Filing[];
  reloadPayables: () => Promise<void>;
  reload: () => Promise<void>;
  /**
   * Save everything pending now (before an export, a lock, leaving the page).
   * `ok` is false when something could not be saved or was replaced by
   * someone else's version; `docs`/`workings` are what is saved right now.
   */
  flush: () => Promise<FlushResult>;
  userName: string;
}

const Ctx = createContext<WorkspaceValue | null>(null);

export const useWorkspace = (): WorkspaceValue => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return v;
};

const SAVE_DELAY_MS = 700;

export const WorkspaceProvider: React.FC<{ client: WorkspaceClient; financialYear: string; children: React.ReactNode }> = ({
  client,
  financialYear,
  children,
}) => {
  const { user, isStaffRole, canUnlockSheets } = useAuth();
  const userName = user?.firstName || user?.email || 'staff';
  const isStaff = isStaffRole();

  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<AnnualReturnDocs | null>(null);
  const [period, setPeriod] = useState<AnnualReturnPeriod | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [setOffs, setSetOffs] = useState<SetOff[]>([]);
  const [drc03s, setDrc03s] = useState<Drc03Filing[]>([]);
  const role: string = user?.role ?? 'employee';
  const canVerify = role === 'superadmin' || role === 'gst_manager';
  const me = useSignoffActor();
  const [changes, setChanges] = useState<SignoffChanges | null>(null);

  const docsRef = useRef<AnnualReturnDocs | null>(null);
  const versions = useRef<Record<DocKey, number>>(Object.fromEntries(DOC_KEYS.map((k) => [k, 0])) as Record<DocKey, number>);
  const dirty = useRef<Set<DocKey>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  const forceHistory = useRef<Set<DocKey>>(new Set());
  /** Revision-log labels of the changes waiting to be saved, per sheet. */
  const pendingActions = useRef<Map<DocKey, Set<string>>>(new Map());
  const periodRef = useRef<AnnualReturnPeriod | null>(null);
  const scope = useRef(`${client.id}|${financialYear}`);
  const noItcBuilder = client.regular_sub_type === 'Builder' && client.builder_itc_type === 'NO_ITC';
  const liveSetOffs = useMemo(() => setOffs.filter((o) => !o.deletedAt).map((o) => ({ side: o.side, method: o.method, tax: o.tax })), [setOffs]);
  const compute = useCallback(
    (d: AnnualReturnDocs) => computeWorkings(d, { clientName: client.name, gstin: client.gstin, financialYear, noItcBuilder, setOffs: liveSetOffs }),
    [client.name, client.gstin, financialYear, noItcBuilder, liveSetOffs],
  );
  const applyPeriod = useCallback((p: AnnualReturnPeriod | null) => {
    periodRef.current = p;
    setPeriod(p);
  }, []);

  /** The set-off register and DRC-03s. A failure here never blocks the working itself. */
  const reloadPayables = useCallback(async () => {
    const [so, drc] = await Promise.allSettled([loadSetOffs(client.id, financialYear), loadDrc03s(client.id)]);
    if (so.status === 'fulfilled') setSetOffs(so.value);
    else toast.error('Could not load the set-off register: ' + (so.reason instanceof Error ? so.reason.message : String(so.reason)));
    if (drc.status === 'fulfilled') setDrc03s(drc.value);
  }, [client.id, financialYear]);

  const reload = useCallback(async () => {
    setLoading(true);
    void reloadPayables();
    try {
      const [ws, p] = await Promise.all([loadWorkspace(client.id, financialYear), loadPeriod(client.id, financialYear)]);
      versions.current = ws.versions;
      dirty.current.clear();
      forceHistory.current.clear();
      pendingActions.current.clear();
      docsRef.current = ws.docs;
      setDocs(ws.docs);
      applyPeriod(p);
      setSaveState('idle');
    } catch (e) {
      toast.error('Could not load the working: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, [client.id, financialYear, applyPeriod, reloadPayables]);

  useEffect(() => {
    scope.current = `${client.id}|${financialYear}`;
    reload();
  }, [reload, client.id, financialYear]);

  /**
   * Save every dirty doc, one at a time. Returns true when everything is saved
   * as the user left it. A version conflict replaces only that doc with the
   * stored version (the other docs keep saving); a lock stops everything.
   */
  const saveDirty = useCallback(async (): Promise<boolean> => {
    // Wait for any run in progress (and any that another caller started meanwhile).
    while (saving.current) await saving.current;
    const run = async (): Promise<boolean> => {
      const mine = scope.current;
      let ok = true;
      while (dirty.current.size > 0 && docsRef.current && mine === scope.current) {
        const key = dirty.current.values().next().value as DocKey;
        dirty.current.delete(key);
        const data = docsRef.current[key];
        const archive = forceHistory.current.has(key);
        const labels = pendingActions.current.get(key);
        pendingActions.current.delete(key);
        const action = labels && labels.size ? [...labels].join(' · ') : undefined;
        setSaveState('saving');
        try {
          const v = await saveDoc(client.id, financialYear, key, data, versions.current[key], userName, archive, action, role);
          if (mine !== scope.current) return false;
          versions.current[key] = v;
          forceHistory.current.delete(key);
        } catch (e) {
          if (mine !== scope.current) return false;
          if (e instanceof SourceLockedError) {
            // The database refused a change to a locked figure: show the stored sheet again.
            ok = false;
            forceHistory.current.delete(key);
            try {
              const fresh = await loadDoc(client.id, financialYear, key);
              if (mine !== scope.current) return false;
              versions.current[key] = fresh.version;
              if (!dirty.current.has(key) && docsRef.current) {
                const next = { ...docsRef.current, [key]: fresh.data } as AnnualReturnDocs;
                docsRef.current = next;
                setDocs(next);
              }
              toast.error(`${lockedMessage(key)} "${DOC_LABEL[key]}" was not saved; the saved version is shown again.`);
            } catch (loadError) {
              dirty.current.add(key);
              setSaveState('error');
              toast.error(`Could not reload "${DOC_LABEL[key]}": ${loadError instanceof Error ? loadError.message : String(loadError)}`);
              return false;
            }
            continue;
          }
          if (e instanceof DocConflictError) {
            ok = false;
            forceHistory.current.delete(key);
            try {
              const fresh = await loadDoc(client.id, financialYear, key);
              if (mine !== scope.current) return false;
              versions.current[key] = fresh.version;
              if (!dirty.current.has(key) && docsRef.current) {
                const next = { ...docsRef.current, [key]: fresh.data } as AnnualReturnDocs;
                docsRef.current = next;
                setDocs(next);
              }
              toast.error(`Someone else saved "${DOC_LABEL[key]}" while you were editing. Their version is loaded — re-check your last change there. Your other changes are still being saved.`);
            } catch (loadError) {
              dirty.current.add(key);
              setSaveState('error');
              toast.error(`Could not reload "${DOC_LABEL[key]}": ${loadError instanceof Error ? loadError.message : String(loadError)}`);
              return false;
            }
            continue;
          }
          if (e instanceof YearLockedError) {
            toast.error('This year was locked by someone else, so your unsaved changes could not be saved. Showing the locked working.');
            await reload();
            return false;
          }
          dirty.current.add(key);
          if (labels) pendingActions.current.set(key, labels);
          setSaveState('error');
          toast.error('Autosave failed — it will retry on your next change. ' + (e instanceof Error ? e.message : ''));
          return false;
        }
      }
      if (mine === scope.current && dirty.current.size === 0) {
        setSaveState('saved');
        setLastSavedAt(new Date());
      }
      return ok && dirty.current.size === 0;
    };
    const p = run().finally(() => { if (saving.current === p) saving.current = null; });
    saving.current = p;
    return p;
  }, [client.id, financialYear, userName, role, reload]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setSaveState('pending');
    timer.current = setTimeout(() => { timer.current = null; saveDirty(); }, SAVE_DELAY_MS);
  }, [saveDirty]);

  const flush = useCallback(async (): Promise<FlushResult> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const ok = await saveDirty();
    const d = docsRef.current;
    return { ok, docs: d, workings: d ? compute(d) : null, period: periodRef.current };
  }, [saveDirty, compute]);

  // Save whatever is pending when switching client/FY or leaving the page.
  useEffect(() => () => { if (dirty.current.size) void saveDirty(); }, [saveDirty]);
  // …and at once when the tab is hidden, the window closes or the laptop sleeps, not after the autosave delay.
  useEffect(() => {
    const now = () => {
      if (!dirty.current.size) return;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      void saveDirty();
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') now(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', now);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', now);
    };
  }, [saveDirty]);
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current.size > 0 || saving.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const locked = period?.status === 'locked';
  const readOnly = locked || !isStaff;
  const canEditSource = !readOnly && role === SOURCE_EDITOR_ROLE;

  const update = useCallback<WorkspaceValue['update']>((key, updater, opts) => {
    if (readOnly || !docsRef.current) return;
    const changed = updater(docsRef.current[key]);
    // The grids already keep these cells read-only; this catches any other way in (paste, a reset, a restore).
    if (!canEditSource && lockedChanges(key, docsRef.current[key], changed).length) {
      toast.error(`${lockedMessage(key)} Your change was not made.`);
      return;
    }
    const next = { ...docsRef.current, [key]: changed } as AnnualReturnDocs;
    docsRef.current = next;
    setDocs(next);
    dirty.current.add(key);
    if (opts?.archive) forceHistory.current.add(key);
    if (opts?.action) {
      const set = pendingActions.current.get(key) ?? new Set<string>();
      set.add(opts.action);
      pendingActions.current.set(key, set);
    }
    schedule();
  }, [readOnly, canEditSource, schedule]);

  const justify = useCallback<WorkspaceValue['justify']>((lineKey, text, diffAt) => {
    update('justifications', (j) => {
      const lines = { ...j.lines };
      if (!text.trim()) delete lines[lineKey];
      else lines[lineKey] = { text, diffAt, by: userName, at: new Date().toISOString() } satisfies Justification;
      return { ...j, lines };
    }, { action: text.trim() ? 'Reason written' : 'Reason cleared' });
  }, [update, userName]);

  /** The period (with the payables snapshot) and the figure changes since sign-off, fresh. */
  const refreshSignoff = useCallback(async () => {
    const [p, row] = await Promise.all([loadPeriod(client.id, financialYear), loadSignoffRow(client.id, financialYear)]);
    applyPeriod(p);
    const c = row?.changes;
    setChanges(c ? { sincePrepared: c.since_prepared ?? 0, sinceVerified: c.since_verified ?? 0, lastAt: c.last_change_at, lastBy: c.last_change_by } : null);
  }, [client.id, financialYear, applyPeriod]);

  // The changes since sign-off: on load, after every sign-off, and a moment after each save.
  const rev = period?.signoff_rev ?? 0;
  const signedOpen = !!period?.prepared_at && period?.status !== 'locked';
  useEffect(() => {
    if (!signedOpen) { setChanges(null); return; }
    const t = setTimeout(() => { void refreshSignoff().catch(() => undefined); }, lastSavedAt ? 1500 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedOpen, rev, lastSavedAt, client.id, financialYear]);

  /** A stale click or changes the signer has not seen: show what is there now, then say why. */
  const afterRefusal = useCallback(async (e: unknown) => {
    if (e instanceof SignoffStaleError || e instanceof ChangedSinceError) await refreshSignoff().catch(() => undefined);
  }, [refreshSignoff]);

  /**
   * Review & lock, or unlock. Locking first saves everything and re-checks,
   * on the saved figures, that no difference is open — a failed or overtaken
   * save never locks the year.
   */
  const setStatus = useCallback<WorkspaceValue['setStatus']>(async (to, opts) => {
    let payables: unknown;
    if (to === 'locked') {
      if (!canVerify) throw new Error('only a GST manager or the superadmin can review and lock the year.');
      const r = await flush();
      if (!r.ok || !r.workings) {
        throw new Error('your latest changes could not be saved (or were replaced by someone else\'s), so the year was not locked. Check them and try again.');
      }
      if (r.workings.openCount > 0) {
        throw new Error(`${r.workings.openCount} difference${r.workings.openCount === 1 ? ' still needs' : 's still need'} a reason, so the year was not locked.`);
      }
      payables = r.workings.payables;
    }
    try {
      await setPeriodStatus(client.id, financialYear, {
        to, expectedRev: periodRef.current?.signoff_rev ?? 0, actorId: me.id,
        note: opts?.note, checklist: opts?.checklist, payables, changesAck: opts?.changesAck, overrideReason: opts?.overrideReason,
      });
    } catch (e) {
      await afterRefusal(e);
      throw e;
    }
    await refreshSignoff();
  }, [client.id, financialYear, flush, canVerify, me.id, afterRefusal, refreshSignoff]);

  const signoff = useCallback<WorkspaceValue['signoff']>(async (action, opts) => {
    if (action === 'prepare' || action === 'verify') {
      const r = await flush();
      const what = action === 'prepare' ? 'marked prepared' : 'verified';
      if (!r.ok) throw new Error(`your latest changes could not be saved, so it was not ${what}. Check them and try again.`);
      if (action === 'verify' && r.workings && r.workings.openCount > 0) {
        throw new Error(`${r.workings.openCount} difference${r.workings.openCount === 1 ? ' still needs' : 's still need'} a reason, so it was not verified.`);
      }
    }
    try {
      await signoffAnnualReturn(client.id, financialYear, action, {
        expectedRev: periodRef.current?.signoff_rev ?? 0, actorId: me.id, note: opts?.note, returnTo: opts?.returnTo, changesAck: opts?.changesAck,
      });
    } catch (e) {
      await afterRefusal(e);
      throw e;
    }
    await refreshSignoff();
  }, [client.id, financialYear, flush, me.id, afterRefusal, refreshSignoff]);

  const workings = useMemo(() => (docs ? compute(docs) : null), [docs, compute]);
  // Sheets saved so far (a version above 0) — "Preparing" as soon as one is.
  const sheets = DOC_KEYS.filter((k) => (versions.current[k] ?? 0) > 0).length;
  const signoffState = useMemo(
    () => toSignoffState(period, { sheets, lastSavedAt: lastSavedAt?.toISOString() ?? period?.updated_at ?? null, changes }),
    [period, sheets, lastSavedAt, changes],
  );

  if (!docs || !workings) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-sm text-muted-foreground">
        {loading ? 'Loading the working…' : (
          <>
            <span>Could not load the working — check the connection and try again.</span>
            <Button variant="outline" size="sm" onClick={() => void reload()}>Retry</Button>
          </>
        )}
      </div>
    );
  }

  const value: WorkspaceValue = {
    client,
    financialYear,
    loading,
    docs,
    workings,
    update,
    justify,
    saveState,
    lastSavedAt,
    period,
    locked,
    readOnly,
    isStaff,
    canUnlock: canUnlockSheets(),
    setStatus,
    signoff,
    me,
    signoffState,
    refreshSignoff,
    canVerify,
    role,
    canEditSource,
    setOffs,
    drc03s,
    reloadPayables,
    reload,
    flush,
    userName,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};
