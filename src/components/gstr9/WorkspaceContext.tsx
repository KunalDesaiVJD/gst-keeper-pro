import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { computeWorkings, Workings } from '@/lib/gstr9/engine';
import { AnnualReturnDocs, DocKey, DOC_KEYS, Justification, ValTax } from '@/lib/gstr9/types';
import {
  AnnualReturnPeriod,
  DocConflictError,
  loadDoc,
  loadPeriod,
  loadWorkspace,
  PeriodChangedError,
  PeriodStatus,
  saveDoc,
  setPeriodStatus,
  YearLockedError,
} from '@/lib/gstr9/store';

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
  update: <K extends DocKey>(key: K, updater: (doc: AnnualReturnDocs[K]) => AnnualReturnDocs[K], opts?: { archive?: boolean }) => void;
  /** Write (or clear, with empty text) the justification for a difference line. */
  justify: (lineKey: string, text: string, diffAt: ValTax) => void;
  saveState: SaveState;
  lastSavedAt: Date | null;
  period: AnnualReturnPeriod | null;
  locked: boolean;
  /** Locked, or a client login: nothing is editable. */
  readOnly: boolean;
  canUnlock: boolean;
  setStatus: (status: PeriodStatus) => Promise<void>;
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

  const docsRef = useRef<AnnualReturnDocs | null>(null);
  const versions = useRef<Record<DocKey, number>>(Object.fromEntries(DOC_KEYS.map((k) => [k, 0])) as Record<DocKey, number>);
  const dirty = useRef<Set<DocKey>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  const forceHistory = useRef<Set<DocKey>>(new Set());
  const periodRef = useRef<AnnualReturnPeriod | null>(null);
  const scope = useRef(`${client.id}|${financialYear}`);
  const noItcBuilder = client.regular_sub_type === 'Builder' && client.builder_itc_type === 'NO_ITC';
  const compute = useCallback(
    (d: AnnualReturnDocs) => computeWorkings(d, { clientName: client.name, gstin: client.gstin, financialYear, noItcBuilder }),
    [client.name, client.gstin, financialYear, noItcBuilder],
  );
  const applyPeriod = useCallback((p: AnnualReturnPeriod | null) => {
    periodRef.current = p;
    setPeriod(p);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [ws, p] = await Promise.all([loadWorkspace(client.id, financialYear), loadPeriod(client.id, financialYear)]);
      versions.current = ws.versions;
      dirty.current.clear();
      forceHistory.current.clear();
      docsRef.current = ws.docs;
      setDocs(ws.docs);
      applyPeriod(p);
      setSaveState('idle');
    } catch (e) {
      toast.error('Could not load the working: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, [client.id, financialYear, applyPeriod]);

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
        setSaveState('saving');
        try {
          const v = await saveDoc(client.id, financialYear, key, data, versions.current[key], userName, archive);
          if (mine !== scope.current) return false;
          versions.current[key] = v;
          forceHistory.current.delete(key);
        } catch (e) {
          if (mine !== scope.current) return false;
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
  }, [client.id, financialYear, userName, reload]);

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

  const update = useCallback<WorkspaceValue['update']>((key, updater, opts) => {
    if (readOnly || !docsRef.current) return;
    const next = { ...docsRef.current, [key]: updater(docsRef.current[key]) } as AnnualReturnDocs;
    docsRef.current = next;
    setDocs(next);
    dirty.current.add(key);
    if (opts?.archive) forceHistory.current.add(key);
    schedule();
  }, [readOnly, schedule]);

  const justify = useCallback<WorkspaceValue['justify']>((lineKey, text, diffAt) => {
    update('justifications', (j) => {
      const lines = { ...j.lines };
      if (!text.trim()) delete lines[lineKey];
      else lines[lineKey] = { text, diffAt, by: userName, at: new Date().toISOString() } satisfies Justification;
      return { ...j, lines };
    });
  }, [update, userName]);

  /**
   * Change the period status from the one the user is looking at. Locking
   * first saves everything and re-checks, on the saved figures, that no
   * difference is open — a failed or overtaken save never locks the year.
   */
  const setStatus = useCallback(async (status: PeriodStatus) => {
    const from: PeriodStatus = periodRef.current?.status ?? 'not_started';
    if (status === 'locked') {
      const r = await flush();
      if (!r.ok || !r.workings) {
        throw new Error('your latest changes could not be saved (or were replaced by someone else\'s), so the year was not locked. Check them and try again.');
      }
      if (r.workings.openCount > 0) {
        throw new Error(`${r.workings.openCount} difference${r.workings.openCount === 1 ? ' still needs' : 's still need'} a reason, so the year was not locked.`);
      }
    }
    try {
      await setPeriodStatus(client.id, financialYear, status, userName, from);
    } catch (e) {
      if (e instanceof PeriodChangedError) {
        applyPeriod(await loadPeriod(client.id, financialYear));
      }
      throw e;
    }
    applyPeriod(await loadPeriod(client.id, financialYear));
  }, [client.id, financialYear, userName, flush, applyPeriod]);

  const workings = useMemo(() => (docs ? compute(docs) : null), [docs, compute]);

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
    canUnlock: canUnlockSheets(),
    setStatus,
    reload,
    flush,
    userName,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};
