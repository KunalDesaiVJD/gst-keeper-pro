import React, { useState } from 'react';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CLOSE_REASONS, STAGES, stageDef, type StageKey } from '@/lib/noticeStages';
import { StageBadge } from './StageBadge';
import { cn } from '@/lib/utils';

/** The close reason: one of the firm's reasons, with a note required for "Other" (audit U-13-1). */
export function useCloseReason() {
  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState('');
  const value = reason === 'Other' ? note.trim() : [reason, note.trim()].filter(Boolean).join(' — ');
  const valid = !!reason && (reason !== 'Other' || !!note.trim());
  return { reason, setReason, note, setNote, value, valid, reset: () => { setReason(''); setNote(''); } };
}

export const CloseReasonFields: React.FC<{ state: ReturnType<typeof useCloseReason>; idPrefix?: string }> = ({ state, idPrefix = 'close' }) => (
  <div className="space-y-2">
    <div className="space-y-1">
      <Label htmlFor={`${idPrefix}-reason`} className="text-xs">Reason <span className="text-destructive">*</span></Label>
      <Select value={state.reason} onValueChange={state.setReason}>
        <SelectTrigger id={`${idPrefix}-reason`} className="h-8 text-xs"><SelectValue placeholder="Why is it closed?" /></SelectTrigger>
        <SelectContent>
          {CLOSE_REASONS.map((r) => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
    <div className="space-y-1">
      <Label htmlFor={`${idPrefix}-note`} className="text-xs">Note{state.reason === 'Other' && <span className="text-destructive"> *</span>}</Label>
      <Textarea id={`${idPrefix}-note`} rows={2} value={state.note} onChange={(e) => state.setNote(e.target.value)}
        placeholder={state.reason === 'Other' ? 'Say why' : 'Optional — e.g. order number'} className="text-xs" />
    </div>
  </div>
);

/**
 * The one stage control (U-13-2, U-29-1, U-31-1): the shared eleven stages,
 * each with what it means; Closed asks for a reason before it applies.
 */
export const StagePicker: React.FC<{
  value: string | null | undefined;
  onChange: (stage: StageKey, closeReason?: string) => Promise<void> | void;
  disabled?: boolean;
  since?: string | null;
  by?: string | null;
  /** A plain button instead of the badge (e.g. "Change stage" in a toolbar). */
  trigger?: React.ReactElement;
  align?: 'start' | 'end' | 'center';
  /** What is being closed, for the close panel's wording. */
  noun?: 'notice' | 'matter';
}> = ({ value, onChange, disabled, since, by, trigger, align = 'start', noun = 'notice' }) => {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [saving, setSaving] = useState(false);
  const close = useCloseReason();
  const current = value ? stageDef(value).key : null;

  const apply = async (stage: StageKey, reason?: string) => {
    setSaving(true);
    try {
      await onChange(stage, reason);
      setOpen(false);
      setClosing(false);
      close.reset();
    } finally { setSaving(false); }
  };

  if (disabled) return <StageBadge stage={value} since={since} by={by} />;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setClosing(false); close.reset(); } }}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button type="button" className="inline-flex items-center gap-0.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Stage: ${stageDef(value).label}. Change stage`}>
            <StageBadge stage={value} since={since} by={by} />
            <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-80 p-2">
        {!closing ? (
          <div role="menu" aria-label="Stages" className="max-h-[60vh] overflow-y-auto">
            {STAGES.map((s) => (
              <button key={s.key} type="button" role="menuitemradio" aria-checked={s.key === current} disabled={saving}
                onClick={() => (s.key === 'closed' ? setClosing(true) : s.key !== current && apply(s.key))}
                className={cn('flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
                  s.key === current && 'bg-primary/5')}>
                <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', s.key === current ? 'text-primary' : 'invisible')} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-xs font-medium">{s.label}</span>
                  <span className="block text-[11px] leading-tight text-muted-foreground">{s.description}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-3 p-1">
            <div className="text-sm font-semibold">Close this {noun}</div>
            <CloseReasonFields state={close} idPrefix="stage-close" />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setClosing(false)}>Back</Button>
              <Button size="sm" className="h-8 text-xs" disabled={!close.valid || saving} onClick={() => apply('closed', close.value)}>
                {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Close {noun}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default StagePicker;
