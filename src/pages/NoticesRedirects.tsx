// Pages the UX audit of 25 October 2026 folded into others. Old links (e-mails,
// bookmarks, the MIS) still land on the page that now holds the same thing,
// with the master filters they carried.
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { MASTER_KEYS } from '@/lib/masterFilters';

function keep(search: string, extra: Record<string, string> = {}, names: readonly string[] = MASTER_KEYS): string {
  const from = new URLSearchParams(search);
  const to = new URLSearchParams();
  names.forEach((k) => { const v = from.get(k); if (v) to.set(k, v); });
  Object.entries(extra).forEach(([k, v]) => to.set(k, v));
  const s = to.toString();
  return s ? `?${s}` : '';
}

/** Work queue → Home's My work, on the same tab (Mine, Team, Unassigned, Review). */
export const QueueRedirect: React.FC = () => {
  const { search } = useLocation();
  const tab = new URLSearchParams(search).get('tab');
  const work = tab === 'mine' || tab === 'unassigned' || tab === 'review' ? tab : 'team';
  return <Navigate to={`/notices-dashboard${keep(search, { work })}`} replace />;
};

/** Hearings → the Calendar's agenda of what is coming. */
export const HearingsRedirect: React.FC = () => {
  const { search } = useLocation();
  return <Navigate to={`/notices-calendar${keep(search, { view: 'agenda' })}`} replace />;
};

/** GSTIN-wise count → Clients, which now lists every client's cases with the same figures. */
export const ClientCountRedirect: React.FC = () => {
  const { search } = useLocation();
  return <Navigate to={`/notices-company-list${keep(search, {}, [...MASTER_KEYS, 'q', 'sort', 'dir', 'show'])}`} replace />;
};
