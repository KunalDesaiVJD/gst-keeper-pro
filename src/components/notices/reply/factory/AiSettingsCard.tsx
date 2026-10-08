// The AI settings (roadmap Phase 4, Phase 7): who reads (the Supabase Edge
// Function or the office agent), which clients, what is read (new and older
// notices, attachments and replies), how carefully, the day's caps for reading
// and for the assistant, whether new replies teach the assistant by themselves,
// the model and the prices the cost estimates use. A GST manager changes them;
// everyone else reads them. Explanations sit behind (i).
import React, { useEffect, useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { WS_BTN, WS_CONTROL } from '@/components/workspace/theme';
import { InfoTip, Panel } from '@/components/notices/ui/Panel';
import { fmtInr } from '@/lib/noticeFormat';
import { AI_EFFORTS, AI_MODELS, saveAiSettings, type Actor, type AiSettings } from '@/lib/replyFactory';
import { cn } from '@/lib/utils';

const KEYS = [
  'runner', 'consent_scope', 'auto_read_new', 'read_backfill', 'read_documents', 'model', 'effort', 'doc_effort', 'assist_effort',
  'daily_cap_usd', 'assist_daily_cap_usd', 'max_pages', 'doc_max_pages', 'edge_seconds', 'learning_auto_include',
  'price_in_per_mtok', 'price_out_per_mtok', 'usd_inr',
] as const;
type Draft = Pick<AiSettings, (typeof KEYS)[number]>;
const NUMS = new Set(['daily_cap_usd', 'assist_daily_cap_usd', 'max_pages', 'doc_max_pages', 'edge_seconds', 'price_in_per_mtok', 'price_out_per_mtok', 'usd_inr']);
const draftOf = (s: AiSettings): Draft => Object.fromEntries(KEYS.map((k) => [k, NUMS.has(k) ? Number(s[k]) : s[k]])) as Draft;

const Row: React.FC<{ id: string; label: string; info?: React.ReactNode; children: React.ReactNode }> = ({ id, label, info, children }) => (
  <div className="flex min-h-[2.25rem] items-center justify-between gap-3 py-1">
    <label htmlFor={id} className="flex min-w-0 items-center gap-1 text-sm">{label}{info && <InfoTip>{info}</InfoTip>}</label>
    <div className="shrink-0">{children}</div>
  </div>
);

const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="min-w-0">
    <div className="pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
    <div className="divide-y">{children}</div>
  </div>
);

export const AiSettingsCard: React.FC<{ settings: AiSettings; canEdit: boolean; actor: Actor | null }> = ({ settings: s, canEdit, actor }) => {
  const uid = useId();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => draftOf(s));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(draftOf(s)); }, [s.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const id = (k: string) => `${uid}-${k}`;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const saved = draftOf(s);
  const changed = KEYS.some((k) => String(draft[k]) !== String(saved[k]));
  const invalid = !(draft.daily_cap_usd >= 0) || !(draft.assist_daily_cap_usd >= 0) || !(draft.max_pages >= 1 && draft.max_pages <= 600)
    || !(draft.doc_max_pages >= 1 && draft.doc_max_pages <= 100) || !(draft.edge_seconds >= 60 && draft.edge_seconds <= 400)
    || !(draft.price_in_per_mtok >= 0) || !(draft.price_out_per_mtok >= 0) || !(draft.usd_inr > 0);
  const model = AI_MODELS.find((m) => m.id === draft.model);
  const rate = Number(draft.usd_inr) || 84;

  const save = async () => {
    setSaving(true);
    try {
      await saveAiSettings(draft, actor);
      toast.success('AI settings saved.');
      qc.invalidateQueries({ queryKey: ['reply-factory-status'] });
    } catch (e) {
      toast.error(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const sw = (k: 'auto_read_new' | 'read_backfill' | 'read_documents' | 'learning_auto_include') => (
    <Switch id={id(k)} checked={!!draft[k]} disabled={!canEdit} onCheckedChange={(v) => set(k, v)} />
  );
  const effort = (k: 'effort' | 'doc_effort' | 'assist_effort') => (
    <Select value={draft[k]} onValueChange={(v) => set(k, v)} disabled={!canEdit}>
      <SelectTrigger id={id(k)} className={cn(WS_CONTROL, 'w-28')}><SelectValue /></SelectTrigger>
      <SelectContent>{AI_EFFORTS.map((e) => <SelectItem key={e.id} value={e.id} className="text-xs">{e.label}</SelectItem>)}</SelectContent>
    </Select>
  );
  const num = (k: 'daily_cap_usd' | 'assist_daily_cap_usd' | 'max_pages' | 'doc_max_pages' | 'edge_seconds' | 'price_in_per_mtok' | 'price_out_per_mtok' | 'usd_inr', step = 1) => (
    <Input id={id(k)} type="number" step={step} value={draft[k]} disabled={!canEdit} onChange={(e) => set(k, Number(e.target.value))} className={cn(WS_CONTROL, 'w-24 text-right')} />
  );

  return (
    <Panel title="Settings" info={canEdit ? 'Spend is estimated from the tokens each call used and the prices under Model and prices.' : 'Only a GST manager can change these.'}>
      <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); if (canEdit && changed && !invalid) save(); }}>
        <div className="grid gap-x-6 md:grid-cols-2">
          <Group title="Reading">
            <Row id={id('runner')} label="Runs on" info="The Supabase Edge Function reads from the cloud through the firm's Claude CLI gateway (CLAUDE_CLI_GATEWAY_URL and CLAUDE_CLI_GATEWAY_SECRET), or the ANTHROPIC_API_KEY secret. The office agent reads on an office PC with its own key.">
              <Select value={draft.runner} onValueChange={(v) => set('runner', v)} disabled={!canEdit}>
                <SelectTrigger id={id('runner')} className={cn(WS_CONTROL, 'w-36')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="edge" className="text-xs">Supabase (cloud)</SelectItem>
                  <SelectItem value="office_agent" className="text-xs">Office agent</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row id={id('consent_scope')} label="Clients" info="Consent on file: only clients with a consent date (Client consent tab). Every client: all clients except those who opted out.">
              <Select value={draft.consent_scope} onValueChange={(v) => set('consent_scope', v)} disabled={!canEdit}>
                <SelectTrigger id={id('consent_scope')} className={cn(WS_CONTROL, 'w-36')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="consented" className="text-xs">Consent on file</SelectItem>
                  <SelectItem value="all_clients" className="text-xs">Every client</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row id={id('auto_read_new')} label="New notices" info="A new notice with a PDF joins the queue as it arrives.">{sw('auto_read_new')}</Row>
            <Row id={id('read_backfill')} label="Older notices" info="Also read every earlier notice that needs a reply, newest first, a little each day within the cap.">{sw('read_backfill')}</Row>
            <Row id={id('read_documents')} label="Attachments and replies" info="Also read the case folders: notices' annexures, the firm's filed replies, orders and approved drafts.">{sw('read_documents')}</Row>
            <Row id={id('daily_cap_usd')} label="Cap per day (USD)" info={`Reading stops for the day (India time) at this estimated spend: about ${fmtInr(draft.daily_cap_usd * rate)}.`}>{num('daily_cap_usd', 0.5)}</Row>
          </Group>
          <Group title="Care and assistant">
            <Row id={id('effort')} label="Notices: effort" info="How carefully a notice is read; higher is more thorough and costs more.">{effort('effort')}</Row>
            <Row id={id('doc_effort')} label="Documents: effort" info="Attachments and replies are many; Low keeps the cost down.">{effort('doc_effort')}</Row>
            <Row id={id('assist_effort')} label="Assistant: effort">{effort('assist_effort')}</Row>
            <Row id={id('assist_daily_cap_usd')} label="Assistant cap (USD)" info="The assistant's own spend per day, apart from reading.">{num('assist_daily_cap_usd', 0.5)}</Row>
            <Row id={id('learning_auto_include')} label="Replies teach by themselves" info="Off: an admin picks which replies the assistant learns from (Learning tab). On: every new reply does.">{sw('learning_auto_include')}</Row>
            <Row id={id('edge_seconds')} label="Seconds per run" info="How long one run of the Edge Function may take: 150 on Supabase's free plan, up to 400 on a paid plan.">{num('edge_seconds', 10)}</Row>
          </Group>
        </div>
        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1 pt-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden /> Model, pages and prices
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid gap-x-6 md:grid-cols-2">
              <Group title="Model">
                <Row id={id('model')} label="Model">
                  <Select value={draft.model} onValueChange={(v) => set('model', v)} disabled={!canEdit}>
                    <SelectTrigger id={id('model')} className={cn(WS_CONTROL, 'w-44')}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {AI_MODELS.map((m) => <SelectItem key={m.id} value={m.id} className="text-xs">{m.id}</SelectItem>)}
                      {!AI_MODELS.some((m) => m.id === draft.model) && <SelectItem value={draft.model} className="text-xs">{draft.model}</SelectItem>}
                    </SelectContent>
                  </Select>
                </Row>
                <Row id={id('max_pages')} label="Pages per notice">{num('max_pages')}</Row>
                <Row id={id('doc_max_pages')} label="Pages per document">{num('doc_max_pages')}</Row>
              </Group>
              <Group title="Prices">
                <Row id={id('price_in_per_mtok')} label="Input, USD / M tokens" info={model ? `List price for ${model.id}: $${model.priceIn} in, $${model.priceOut} out.` : undefined}>{num('price_in_per_mtok', 0.01)}</Row>
                <Row id={id('price_out_per_mtok')} label="Output, USD / M tokens">{num('price_out_per_mtok', 0.01)}</Row>
                <Row id={id('usd_inr')} label="₹ per US dollar">{num('usd_inr', 0.01)}</Row>
              </Group>
            </div>
          </CollapsibleContent>
        </Collapsible>
        {canEdit && (
          <div className="flex flex-wrap items-center justify-end gap-2 pt-1.5">
            {invalid && <span className="mr-auto text-xs text-destructive-strong">Check the numbers: caps and prices not below 0, pages within limits, 60 to 400 seconds.</span>}
            <Button type="button" size="sm" variant="ghost" className={WS_BTN} disabled={!changed || saving} onClick={() => setDraft(draftOf(s))}>Undo</Button>
            <Button type="submit" size="sm" className={WS_BTN} disabled={!changed || invalid || saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Save
            </Button>
          </div>
        )}
      </form>
    </Panel>
  );
};

export default AiSettingsCard;
