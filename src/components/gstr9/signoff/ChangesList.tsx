import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { describeChange } from '@/lib/gstr9/audit';
import { displayName } from '@/lib/gstr9/signoffFlow';
import { loadChangesSince } from '@/lib/gstr9/store';
import { fmtWhen } from '../overview/steps';

type Loaded = Awaited<ReturnType<typeof loadChangesSince>>;

/** The latest figure changes since a sign-off — who, where, from → to — loaded when shown. */
export const ChangesList: React.FC<{
  clientId: string;
  financialYear: string;
  since: string;
  limit?: number;
  /** Leave out this person's own changes (the signer's — what the count above the list leaves out). */
  excludeBy?: string;
  onOpenHistory?: () => void;
}> = ({ clientId, financialYear, since, limit = 8, excludeBy, onOpenHistory }) => {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    loadChangesSince(clientId, financialYear, since, limit, excludeBy)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [clientId, financialYear, since, limit, excludeBy]);

  if (error) return <p className="text-[11px] text-destructive-strong">Could not load the changes: {error}</p>;
  if (!data) return <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading the changes…</p>;
  if (!data.entries.length) return <p className="text-[11px] text-muted-foreground">No figure has changed since.</p>;
  const more = data.total - data.entries.length;
  return (
    <div className="space-y-1">
      <ul className="max-h-48 space-y-0.5 overflow-y-auto text-[11px] leading-snug">
        {data.entries.map((e) => {
          const d = describeChange(e);
          return (
            <li key={e.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-1.5">
              <span className="text-muted-foreground">{displayName(d.who)}</span>
              <span className="min-w-0">
                <span className="text-muted-foreground">{d.sheet} › </span>{d.place}
                {(d.from !== '—' || d.to !== '—') && <span className="tabular-nums">: {d.from} → {d.to}</span>}
                <span className="text-muted-foreground"> · {fmtWhen(d.when)}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {more > 0 && (
        <p className="text-[11px] text-muted-foreground">
          +{more} more{onOpenHistory ? <> in the <button type="button" onClick={onOpenHistory} className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">revision history</button></> : ''}.
        </p>
      )}
    </div>
  );
};

export default ChangesList;
