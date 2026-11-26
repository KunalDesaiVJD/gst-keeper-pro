import { useMemo } from 'react';
import { buildGstr9cPortalJson } from '@/lib/gstr9/gstr9cJson';
import { selfCheckStatus, type SelfCheckStatus } from '@/lib/gstr9/selfCheck';
import type { SelfCheckAnswer } from '@/lib/gstr9/types';
import { useApplicability } from '../register/useApplicability';
import { useWorkspace } from '../WorkspaceContext';

/** The preparer's self-validation as it stands, and a setter for one answer. */
export function useSelfCheck(): {
  status: SelfCheckStatus;
  file9c: boolean;
  jsonErrors: number;
  setAnswer: (key: string, answer: SelfCheckAnswer, note?: string) => void;
  setNote: (key: string, note: string) => void;
  /** The questions are put (and answerable) only while the working is with its preparer; afterwards they are a record. */
  asking: boolean;
} {
  const { workings, docs, client, financialYear, update, me, signoffState } = useWorkspace();
  const st = signoffState.stage;
  const asking = st === 'not_started' || st === 'preparing' || (st === 'sent_back' && signoffState.returned?.to !== 'verifier');
  const { result: app } = useApplicability(client, financialYear);
  // Unknown applicability counts as filing 9C: the questions are asked rather than skipped.
  const file9c = !app || app.gstr9 === 'unknown' || app.file9c;
  const jsonErrors = useMemo(
    () => (file9c
      ? buildGstr9cPortalJson({ gstin: client.gstin, financialYear, workings, doc: docs.gstr9c, tolerance: docs.settings?.tolerance ?? 0 }).errors
      : 0),
    [file9c, client.gstin, financialYear, workings, docs.gstr9c, docs.settings?.tolerance],
  );
  const status = useMemo(
    () => selfCheckStatus({ w: workings, gstr9c: docs.gstr9c, file9c }, docs.selfcheck, { jsonErrors }),
    [workings, docs.gstr9c, docs.selfcheck, file9c, jsonErrors],
  );
  const write = (key: string, patch: { answer?: SelfCheckAnswer; note?: string }) =>
    update('selfcheck', (doc) => {
      const prev = doc.answers?.[key];
      const answer = patch.answer ?? prev?.answer;
      if (!answer) return doc;
      return {
        ...doc,
        answers: { ...doc.answers, [key]: { answer, note: patch.note ?? prev?.note ?? '', by: me.name || null, at: new Date().toISOString() } },
      };
    }, { action: 'Self-validation answered' });
  return {
    status,
    file9c,
    jsonErrors,
    setAnswer: (key, answer, note) => write(key, { answer, ...(note !== undefined ? { note } : {}) }),
    setNote: (key, note) => write(key, { note }),
    asking,
  };
}
