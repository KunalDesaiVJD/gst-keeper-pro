// Where one value on the notice came from (per-notice spec "a source badge per
// field"; audit R-08, R-28): Portal, Portal list, Case folder, Read from the
// PDF — verify (with Confirm and Clear), From the PDF · confirmed, From the
// form, Typed, Computed, Extended.
import React from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { SOURCE_CHIP, type Provenance } from '@/lib/noticeReading';
import { fmtDateTime } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

function chipTitle(p: Provenance): string | undefined {
  const e = p.entry;
  if (p.kind === 'confirmed' && e) return `Read from the notice PDF; confirmed by ${e.verified_by || 'staff'} on ${fmtDateTime(e.verified_at)}`;
  if (p.kind === 'verify' && e) return `Read from the notice PDF on ${fmtDateTime(e.at)}; not checked by a person yet`;
  if (p.kind === 'portal' && e) return `Read from the portal's case folder on ${fmtDateTime(e.at)}`;
  if (p.kind === 'portal_list') return 'As the portal\'s notice list shows it';
  if (p.kind === 'computed') return p.note ?? 'Computed from the form\'s reply period';
  return undefined;
}

export const ReadSourceChip: React.FC<{ p: Provenance; className?: string }> = ({ p, className }) => {
  if (p.kind === 'empty') return null;
  const c = SOURCE_CHIP[p.kind];
  return (
    <Badge variant={c.tone} className={cn('whitespace-nowrap px-1.5 py-0 text-[10px] font-normal', className)} title={chipTitle(p)}>
      {c.label}
    </Badge>
  );
};

/** Confirm (the value stays, marked checked) and Clear (an unchecked value is removed). */
export const VerifyButtons: React.FC<{
  what: string;
  busy: boolean;
  onConfirm: () => void;
  onClear?: () => void;
}> = ({ what, busy, onConfirm, onClear }) => (
  <span className="inline-flex items-center gap-1">
    <Button type="button" size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" disabled={busy} onClick={onConfirm}>
      {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}Confirm<span className="sr-only"> {what}</span>
    </Button>
    {onClear && (
      <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={busy} onClick={onClear}>
        Clear<span className="sr-only"> {what}</span>
      </Button>
    )}
  </span>
);

export default ReadSourceChip;
