// The four dashboards' tabs (Notices & demands · Refunds · Registration ·
// Other), each with its open cases and how many have something new.
import React from 'react';
import { TRACKS, type Track, type TrackCounts } from '@/lib/noticeCases';
import { WS_TAB, WS_TAB_ACTIVE, WS_TABS_LIST } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';

export const KindTabs: React.FC<{
  value: Track;
  counts: Record<Track, TrackCounts> | undefined;
  onChange: (t: Track) => void;
}> = ({ value, counts, onChange }) => (
  <div role="tablist" aria-label="Kind of portal service" className={cn(WS_TABS_LIST, 'w-full sm:w-auto')}>
    {TRACKS.map((t) => {
      const c = counts?.[t.key];
      const active = value === t.key;
      return (
        <button key={t.key} type="button" role="tab" aria-selected={active} title={t.blurb}
          onClick={() => onChange(t.key)} className={cn(WS_TAB, 'h-8 px-3', active && WS_TAB_ACTIVE)}>
          {t.label}
          {c && (t.key === 'other' ? c.cases : c.open) > 0 && (
            <span className="rounded-full bg-card/30 px-1.5 text-[10px] font-semibold tabular-nums">{t.key === 'other' ? c.cases : c.open}</span>
          )}
          {c && c.new > 0 && t.key !== 'other' && (
            <span className="rounded-full bg-info px-1.5 text-[10px] font-semibold text-white tabular-nums" title={`${c.new} with new correspondence`}>{c.new} new</span>
          )}
        </button>
      );
    })}
  </div>
);

export default KindTabs;
