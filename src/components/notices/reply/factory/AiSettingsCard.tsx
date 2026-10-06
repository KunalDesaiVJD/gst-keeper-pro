// AI reading settings (roadmap Phase 4; audit R-15: the reader's switches are
// settings the page shows, not code): read new notices by themselves, the
// model, effort, the daily spend cap, the page limit and the prices the cost
// estimates use. A GST manager changes them; everyone else reads them.
import React, { useEffect, useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SectionCard } from '@/components/gstr9/ui';
import { WS_BTN, WS_CONTROL } from '@/components/workspace/theme';
import { fmtInr } from '@/lib/noticeFormat';
import { AI_EFFORTS, AI_MODELS, saveAiSettings, type Actor, type AiSettings } from '@/lib/replyFactory';
import { cn } from '@/lib/utils';

type Draft = Pick<AiSettings, 'auto_read_new' | 'model' | 'effort' | 'daily_cap_usd' | 'max_pages' | 'price_in_per_mtok' | 'price_out_per_mtok' | 'usd_inr'>;
const draftOf = (s: AiSettings): Draft => ({
  auto_read_new: s.auto_read_new, model: s.model, effort: s.effort, daily_cap_usd: Number(s.daily_cap_usd), max_pages: Number(s.max_pages),
  price_in_per_mtok: Number(s.price_in_per_mtok), price_out_per_mtok: Number(s.price_out_per_mtok), usd_inr: Number(s.usd_inr),
});

const Field: React.FC<{ id: string; label: string; hint?: React.ReactNode; value?: string; children: React.ReactNode }> = ({ id, label, hint, value, children }) => (
  <div className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
    <div className="min-w-0 space-y-0.5">
      {value === undefined ? <Label htmlFor={id} className="text-sm">{label}</Label> : <div className="text-sm font-medium">{label}</div>}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
    <div className="shrink-0">{value === undefined ? children : <span className="text-sm font-semibold">{value}</span>}</div>
  </div>
);

export const AiSettingsCard: React.FC<{ settings: AiSettings; canEdit: boolean; actor: Actor | null }> = ({ settings: s, canEdit, actor }) => {
  const uid = useId();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => draftOf(s));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(draftOf(s)); }, [s.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const id = (k: string) => `${uid}-${k}`;
  const ro = (text: string) => (canEdit ? undefined : text);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const saved = draftOf(s);
  const changed = (Object.keys(draft) as (keyof Draft)[]).some((k) => String(draft[k]) !== String(saved[k]));
  const invalid = !(draft.daily_cap_usd >= 0) || !(draft.max_pages >= 1 && draft.max_pages <= 600) || !(draft.price_in_per_mtok >= 0)
    || !(draft.price_out_per_mtok >= 0) || !(draft.usd_inr > 0);
  const model = AI_MODELS.find((m) => m.id === draft.model);
  const offList = !!model && (model.priceIn !== draft.price_in_per_mtok || model.priceOut !== draft.price_out_per_mtok);
  const modelName = (mid: string) => { const m = AI_MODELS.find((x) => x.id === mid); return m ? `${m.id} (${m.note})` : mid; };
  const effortName = (e: string) => AI_EFFORTS.find((x) => x.id === e)?.label ?? e;

  const save = async () => {
    setSaving(true);
    try {
      await saveAiSettings(draft, actor);
      toast.success('AI reading settings saved.');
      qc.invalidateQueries({ queryKey: ['reply-factory-status'] });
    } catch (e) {
      toast.error(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="Settings" description="Spend is an estimate from the tokens each call used and the prices below.">
      <form className="divide-y" onSubmit={(e) => { e.preventDefault(); if (canEdit && changed && !invalid) save(); }}>
        <Field id={id('auto')} label="Read new notices by themselves" value={ro(s.auto_read_new ? 'On' : 'Off')}
          hint={'A new notice with a PDF, for a client with consent, joins the queue as it arrives. Off: only "Read with AI" on a notice queues one.'}>
          <Switch id={id('auto')} checked={draft.auto_read_new} onCheckedChange={(v) => set('auto_read_new', v)} />
        </Field>
        <Field id={id('model')} label="Model" value={ro(modelName(s.model))} hint="The Claude model the office agent reads with.">
          <Select value={draft.model} onValueChange={(v) => set('model', v)}>
            <SelectTrigger id={id('model')} className={cn(WS_CONTROL, 'w-[17rem] max-w-full')}><SelectValue /></SelectTrigger>
            <SelectContent>
              {AI_MODELS.map((m) => <SelectItem key={m.id} value={m.id} className="text-xs">{m.id} ({m.note})</SelectItem>)}
              {!AI_MODELS.some((m) => m.id === draft.model) && <SelectItem value={draft.model} className="text-xs">{draft.model}</SelectItem>}
            </SelectContent>
          </Select>
        </Field>
        <Field id={id('effort')} label="Effort" value={ro(effortName(s.effort))}
          hint="How carefully the model works through each notice: higher is more thorough and costs more. claude-haiku-4-5 has no effort setting.">
          <Select value={draft.effort} onValueChange={(v) => set('effort', v)}>
            <SelectTrigger id={id('effort')} className={cn(WS_CONTROL, 'w-36')}><SelectValue /></SelectTrigger>
            <SelectContent>{AI_EFFORTS.map((e) => <SelectItem key={e.id} value={e.id} className="text-xs">{e.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field id={id('cap')} label="Daily cap (USD)" value={ro(`$${Number(s.daily_cap_usd).toFixed(2)} (${fmtInr(Number(s.daily_cap_usd) * Number(s.usd_inr))})`)}
          hint={<>The agent reads nothing more that day (India time) once the estimated spend reaches this — about {fmtInr(draft.daily_cap_usd * draft.usd_inr)}.</>}>
          <Input id={id('cap')} type="number" min={0} step={0.5} value={draft.daily_cap_usd} onChange={(e) => set('daily_cap_usd', Number(e.target.value))} className={cn(WS_CONTROL, 'w-28')} />
        </Field>
        <Field id={id('pages')} label="Most pages per notice" value={ro(String(s.max_pages))} hint="A longer PDF is not sent; its reading fails with the reason (1–600).">
          <Input id={id('pages')} type="number" min={1} max={600} step={1} value={draft.max_pages} onChange={(e) => set('max_pages', Number(e.target.value))} className={cn(WS_CONTROL, 'w-28')} />
        </Field>
        <Field id={id('pin')} label="Price of input, USD per million tokens" value={ro(`$${Number(s.price_in_per_mtok)}`)}>
          <Input id={id('pin')} type="number" min={0} step={0.01} value={draft.price_in_per_mtok} onChange={(e) => set('price_in_per_mtok', Number(e.target.value))} className={cn(WS_CONTROL, 'w-28')} />
        </Field>
        <Field id={id('pout')} label="Price of output, USD per million tokens" value={ro(`$${Number(s.price_out_per_mtok)}`)}
          hint={model ? <>List price for {model.id}: ${model.priceIn} in / ${model.priceOut} out.
            {canEdit && offList && <> <button type="button" className="font-medium text-primary underline underline-offset-2" onClick={() => setDraft((d) => ({ ...d, price_in_per_mtok: model.priceIn, price_out_per_mtok: model.priceOut }))}>Use the list price</button></>}</> : undefined}>
          <Input id={id('pout')} type="number" min={0} step={0.01} value={draft.price_out_per_mtok} onChange={(e) => set('price_out_per_mtok', Number(e.target.value))} className={cn(WS_CONTROL, 'w-28')} />
        </Field>
        <Field id={id('fx')} label="Rupees per US dollar" value={ro(`₹${Number(s.usd_inr)}`)} hint="For the ₹ figures on this page.">
          <Input id={id('fx')} type="number" min={1} step={0.01} value={draft.usd_inr} onChange={(e) => set('usd_inr', Number(e.target.value))} className={cn(WS_CONTROL, 'w-28')} />
        </Field>
        {canEdit && (
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2.5">
            {invalid && <span className="mr-auto text-xs text-destructive-strong">Check the numbers: pages 1–600, prices and the cap not below 0.</span>}
            <Button type="button" size="sm" variant="ghost" className={WS_BTN} disabled={!changed || saving} onClick={() => setDraft(draftOf(s))}>Undo changes</Button>
            <Button type="submit" size="sm" className={WS_BTN} disabled={!changed || invalid || saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Save
            </Button>
          </div>
        )}
      </form>
    </SectionCard>
  );
};

export default AiSettingsCard;
