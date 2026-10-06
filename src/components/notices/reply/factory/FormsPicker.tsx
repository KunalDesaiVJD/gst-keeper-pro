// The forms a reply template is for (reply_templates.forms). None ticked makes
// it a general template: used for a notice whose form has no active template
// of its own. Form codes and their names come from the notice types
// (notice_type_overview), so they read the same as on the Notice types tab.
import React, { useId, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface FormOption {
  code: string;
  label: string | null;
  /** notice_type_settings.response_need: 'none' gets no reply prepared at all. */
  need: string | null;
}

export const FormsPicker: React.FC<{
  value: string[];
  onChange: (forms: string[]) => void;
  options: FormOption[];
}> = ({ value, onChange, options }) => {
  const uid = useId();
  const [q, setQ] = useState('');
  const all = useMemo(() => {
    const known = new Set(options.map((o) => o.code));
    // A form a template names that is no longer a notice type still shows, so it can be taken off.
    return [...options, ...value.filter((f) => !known.has(f)).map((code) => ({ code, label: null, need: null }))];
  }, [options, value]);
  const shown = all.filter((o) => !q.trim() || `${o.code} ${o.label ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (code: string, on: boolean) => onChange(on ? [...value, code] : value.filter((f) => f !== code));
  const labelOf = (code: string) => all.find((o) => o.code === code)?.label;

  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">Forms</legend>
      <p className="text-xs text-muted-foreground">
        {value.length === 0
          ? 'None ticked: a general template, used for a notice whose form has no active template of its own.'
          : `Prepared for open notices of ${value.length === 1 ? 'this form' : `these ${value.length} forms`}.`}
      </p>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Forms ticked">
          {value.map((f) => (
            <li key={f}>
              <button type="button" onClick={() => toggle(f, false)} title={labelOf(f) ?? undefined}
                className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 font-mono text-[11px] font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {f} <X className="h-3 w-3" aria-hidden /><span className="sr-only">(take this form off)</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative w-full sm:w-72">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Code or name" aria-label="Find a form" className="h-8 pl-7 text-xs" />
      </div>
      <div className="max-h-48 overflow-y-auto rounded-md border">
        {shown.length === 0 ? <p className="px-2.5 py-2 text-xs text-muted-foreground">No form matches.</p> : shown.map((o) => {
          const id = `${uid}-${o.code}`;
          const on = value.includes(o.code);
          return (
            <div key={o.code} className={cn('flex items-start gap-2 border-b px-2.5 py-1.5 last:border-b-0', on && 'bg-primary/5')}>
              <Checkbox id={id} checked={on} onCheckedChange={(v) => toggle(o.code, v === true)} className="mt-0.5" />
              <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer text-xs">
                <span className="font-mono font-semibold">{o.code}</span>
                {o.label && <span className="text-foreground/80"> {o.label}</span>}
                {o.need === 'none' && <span className="text-foreground/70"> (needs no reply: nothing is prepared for it)</span>}
                {o.need === null && o.label === null && <span className="text-foreground/70"> (no longer a notice type)</span>}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
};

export default FormsPicker;
