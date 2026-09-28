import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { computeWorkings, Workings } from '@/lib/gstr9/engine';
import { AnnualReturnDocs, DocKey, DOC_KEYS, Justification, ValTax } from '@/lib/gstr9/types';
import {
  AnnualReturnPeriod,
  DocConflictError,
  loadPeriod,
  loadWorkspace,
  PeriodStatus,
  saveDoc,
  setPeriodStatus,
  YearLockedError,
} from '@/lib/gstr9/store';

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
  /** Apply a change to one doc; it autosaves shortly after. */
  update: <K extends DocKey>(key: K, updater: (doc: AnnualReturnDocs[K]) => AnnualReturnDocs[K]) => void;
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
  /** Save everything pending now (before an export, a lock, leaving the page). */
  flush: () => Promise<void>;
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
  const saving = useRef<Promise<void> | null>(null);
  const scope = useRef(`${client.id}|${financialYear}`);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [ws, p] = await Promise.all([loadWorkspace(client.id, financialYear), loadPeriod(client.id, financialYear)]);
      versions.current = ws.versions;
      dirty.current.clear();
      docsRef.current = ws.docs;
      setDocs(ws.docs);
      setPeriod(p);
      setSaveState('idle');
    } catch (e) {
      toast.error('Could not load the working: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, [client.id, financialYear]);

  useEffect(() => {
    scope.current = `${client.id}|${financialYear}`;
    reload();
  }, [reload, client.id, financialYear]);

  const saveDirty = useCallback(async () => {
    if (saving.current) {
      await saving.current;
    }
    const run = async () => {
      const mine = scope.current;
      while (dirty.current.size > 0 && docsRef.current && mine === scope.current) {
        const key = dirty.current.values().next().value as DocKey;
        dirty.current.delete(key);
        const data = docsRef.current[key];
        setSaveState('saving');
        try {
          const v = await saveDoc(client.id, financialYear, key, data, versions.current[key], userName);
          if (mine !== scope.current) return;
          versions.current[key] = v;
        } catch (e) {
          if (e instanceof DocConflictError) {
            toast.error('Someone else changed this working while you were editing. Reloaded their version; please re-check your last change.');
            await reload();
            return;
          }
          if (e instanceof YearLockedError) {
            toast.error('This year was locked by someone else. Your last change was not saved.');
            await reload();
            return;
          }
          dirty.current.add(key);
          setSaveState('error');
          toast.error('Autosave failed — will retry on your next change. ' + (e instanceof Error ? e.message : ''));
          return;
        }
      }
      if (mine === scope.current && dirty.current.size === 0) {
        setSaveState('saved');
        setLastSavedAt(new Date());
      }
    };
    saving.current = run().finally(() => { saving.current = null; });
    await saving.current;
  }, [client.id, financialYear, userName, reload]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setSaveState('pending');
    timer.current = setTimeout(() => { timer.current = null; saveDirty(); }, SAVE_DELAY_MS);
  }, [saveDirty]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    await saveDirty();
  }, [saveDirty]);

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

  const update = useCallback<WorkspaceValue['update']>((key, updater) => {
    if (readOnly || !docsRef.current) return;
    const next = { ...docsRef.current, [key]: updater(docsRef.current[key]) } as AnnualReturnDocs;
    docsRef.current = next;
    setDocs(next);
    dirty.current.add(key);
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

  const setStatus = useCallback(async (status: PeriodStatus) => {
    await flush();
    await setPeriodStatus(client.id, financialYear, status, userName);
    setPeriod(await loadPeriod(client.id, financialYear));
  }, [client.id, financialYear, userName, flush]);

  const noItcBuilder = client.regular_sub_type === 'Builder' && client.builder_itc_type === 'NO_ITC';
  const workings = useMemo(
    () => (docs ? computeWorkings(docs, { clientName: client.name, gstin: client.gstin, financialYear, noItcBuilder }) : null),
    [docs, client.name, client.gstin, financialYear, noItcBuilder],
  );

  if (!docs || !workings) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
        {loading ? 'Loading the working…' : 'Could not load the working.'}
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
