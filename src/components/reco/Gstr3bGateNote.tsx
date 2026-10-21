import React from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { gatePartLabel, gateReadyText, type Gstr3bGateResult } from '@/lib/gstr3bPushGate';

interface Props {
  gate: Gstr3bGateResult | null;
  loading: boolean;
  onRecheck?: () => void;
  /** One line (the reco pages) or the full panel (the GSTR-3B page). */
  compact?: boolean;
  className?: string;
}

// What the GSTR-3B push gate says for the client and month shown
// (gstr3b_push_gate; src/lib/gstr3bPushGate.ts): ready, or blocked with the
// reasons, and where each reco's opening came from.
const Gstr3bGateNote: React.FC<Props> = ({ gate, loading, onRecheck, compact, className }) => {
  const ok = !!gate?.ok && !loading;
  const parts = gate && !gate.error ? [
    gate.suspended ? `Suspended Reco: ${gatePartLabel(gate.suspended)}${gate.suspended.override ? ` · opening overridden by ${gate.suspended.override.by_name || 'someone'}` : ''}${gate.suspended.waived ? ' · difference waived (Builder, no ITC)' : ''}` : '',
    gate.receivable?.required ? `GST Receivable Reco: ${gatePartLabel(gate.receivable)}${gate.receivable.override ? ` · opening overridden by ${gate.receivable.override.by_name || 'someone'}` : ''}` : '',
  ].filter(Boolean) : [];

  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
        loading ? 'border-border bg-muted/30' : ok ? 'border-success/40 bg-success/5' : 'border-destructive/40 bg-destructive/5',
        className,
      )}
    >
      {loading
        ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        : ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
        : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium text-foreground">
          {loading ? 'Checking the GSTR-3B push gate…'
            : ok ? 'GSTR-3B push: ready.'
            : 'GSTR-3B push and JSON download are locked.'}
        </p>
        {ok && <p className="text-muted-foreground">{gateReadyText(gate)}</p>}
        {!loading && gate && !ok && (
          compact
            ? <p className="text-muted-foreground">{gate.reasons.map((r) => r.message).join(' ')}</p>
            : <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">{gate.reasons.map((r) => <li key={r.code + r.message}>{r.message}</li>)}</ul>
        )}
        {!loading && !compact && parts.length > 0 && (
          <p className="text-muted-foreground">{parts.join(' · ')}</p>
        )}
        {!loading && !ok && !compact && (
          <p className="text-muted-foreground">
            Pull both recos from the portal (Suspended Reco or GST Receivable Reco, Pull). A difference is cleared by
            correcting the books, or by an opening override by the superadmin or a GST Manager. If the pull cannot be done,
            the superadmin may allow a manual entry on the reco page.
          </p>
        )}
      </div>
      {onRecheck && (
        <Button size="sm" variant="ghost" className="h-6 shrink-0 gap-1 px-2 text-[11px]" onClick={onRecheck} disabled={loading}>
          <RefreshCw className="h-3 w-3" /> Check again
        </Button>
      )}
    </div>
  );
};

export default Gstr3bGateNote;
