// Editing a reply template, or adding one (New template, Duplicate): its
// title, the line on when to use it, the stance, the forms it is for and the
// wording. Before Save the wording is checked as the database will check it:
// no hyphen or dash anywhere (each shown where it sits, with Replace dashes),
// and no {{placeholder}} the renderer would not fill. Saving raises the
// version and the database prepares the options of every open notice again.
// A GST manager or the superadmin only.
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { STANCE } from '@/components/notices/workspace/ReplyOptions';
import { useAuth } from '@/contexts/AuthContext';
import {
  TEMPLATE_KEY_RE, createTemplate, dehyphen, findDashes, invalidateReplyTemplates, placeholderProblems, saveTemplate, suggestTemplateKey,
  type Actor, type PlaceholderProblem, type ReplyTemplate,
} from '@/lib/replyFactory';
import { FormsPicker, type FormOption } from './FormsPicker';
import { TemplatePreview } from './TemplatePreview';
import { ChecksPassed, DashCheck, PlaceholderCheck, PlaceholdersPanel } from './TextChecks';
import { cn } from '@/lib/utils';

export interface TemplateEditState {
  mode: 'edit' | 'new' | 'duplicate';
  /** The template edited or copied. */
  source: ReplyTemplate | null;
}

/** The usual shape of a reply (docs/REPLY_TEMPLATES.md "How a reply is built"), to start a new template from. */
const STARTER = `To,
The {{officer}}

Subject: Reply to {{form_name}} with reference number {{notice_ref}} dated {{notice_date_long}}{{din_clause}} for {{period_text}}

Respected Sir/Madam,

1. {{client_name}} (hereinafter referred to as "the noticee") is registered under the Central Goods and Services Tax Act, 2017 (hereinafter referred to as "the Act") and {{sgst_act}} with GSTIN {{gstin}}.

2. [Set out the facts of the notice and the submissions of the noticee.]

3. In view of the foregoing, it is respectfully prayed that [the relief sought].

Thanking you,

Yours faithfully,
For {{client_name}}

{{signatory}}
GSTIN: {{gstin}}
Place: {{place}}
Date: {{today_long}}`;

type Field = 'title' | 'summary' | 'body';
const FIELD_NAME: Record<Field, string> = { title: 'Title', summary: 'When to use it', body: 'Wording' };

export const TemplateEditDialog: React.FC<{
  state: TemplateEditState | null;
  templates: ReplyTemplate[];
  formOptions: FormOption[];
  ownForms: string[];
  onClose: () => void;
  onSaved: (key: string) => void;
}> = ({ state, templates, formOptions, ownForms, onClose, onSaved }) => {
  const uid = useId();
  const qc = useQueryClient();
  const { user } = useAuth();
  const actor: Actor | null = user ? { id: user.id, firstName: user.firstName } : null;
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const taken = useMemo(() => new Set(templates.map((t) => t.key)), [templates]);

  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [stance, setStance] = useState('general');
  const [forms, setForms] = useState<string[]>([]);
  const [body, setBody] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const mode = state?.mode ?? 'edit';
  const src = state?.source ?? null;
  useEffect(() => {
    if (!state) return;
    const s = state.source;
    setTitle(s ? (state.mode === 'duplicate' ? `${s.title} (copy)` : s.title) : '');
    setSummary(s?.summary ?? '');
    setStance(s?.stance ?? 'general');
    setForms(s?.forms ?? []);
    setBody(s?.body ?? (state.mode === 'new' ? STARTER : ''));
    setActive(true);
    setKeyTouched(false);
    setKey(state.mode === 'duplicate' && s ? suggestTemplateKey({ copyOf: s.key }, taken) : '');
    setShowPreview(false);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new template's key follows its title and forms until it is typed over.
  useEffect(() => {
    if (mode === 'new' && !keyTouched) setKey(title.trim() ? suggestTemplateKey({ title, forms }, taken) : '');
  }, [mode, keyTouched, title, forms, taken]);

  const isNew = mode !== 'edit';
  const hits = useMemo(() => [
    ...findDashes(title, FIELD_NAME.title), ...findDashes(summary, FIELD_NAME.summary), ...findDashes(body, FIELD_NAME.body),
  ], [title, summary, body]);
  const problems = useMemo(() => [
    ...placeholderProblems(title, FIELD_NAME.title, false), ...placeholderProblems(summary, FIELD_NAME.summary, false),
    ...placeholderProblems(body, FIELD_NAME.body, true),
  ], [title, summary, body]);
  const keyProblem = !isNew ? null
    : !key ? 'Give it a key.'
    : !TEMPLATE_KEY_RE.test(key) ? 'The key may hold only small letters, digits and underscores.'
    : key.length > 60 ? 'Keep the key under 60 characters.'
    : taken.has(key) ? 'Another template has this key.'
    : null;
  const finalBody = body.trimEnd();
  const changed = !src || isNew || title.trim() !== src.title || summary.trim() !== src.summary || stance !== src.stance
    || finalBody !== src.body.trimEnd() || [...forms].sort().join('\n') !== [...src.forms].sort().join('\n');
  const blockers = [
    !title.trim() && 'The title is empty.',
    !finalBody.trim() && 'The wording is empty.',
    keyProblem,
    hits.length > 0 && 'Replace the hyphens and dashes.',
    problems.length > 0 && 'Fix the placeholders.',
    !isNew && !changed && 'Nothing has changed yet.',
  ].filter(Boolean) as string[];

  if (!state) return null;

  const replaceDashes = () => {
    setTitle((v) => dehyphen(v));
    setSummary((v) => dehyphen(v));
    setBody((v) => dehyphen(v));
  };
  const fix = (p: PlaceholderProblem) => {
    if (!p.fix) return;
    const swap = (v: string) => v.split(p.token).join(p.fix as string);
    if (p.field === FIELD_NAME.body) setBody(swap); else if (p.field === FIELD_NAME.title) setTitle(swap); else setSummary(swap);
  };
  const insert = (k: string) => {
    const token = `{{${k}}}`;
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    if (blockers.length) return;
    setSaving(true);
    try {
      const d = { title: title.trim(), summary: summary.trim(), stance, forms, body: finalBody };
      if (!isNew && src) {
        const v = await saveTemplate(src, d, actor);
        toast.success(`Saved as version ${v}. Open notices get the new wording.`);
        onSaved(src.key);
      } else {
        await createTemplate({ ...d, key, is_active: active, sort: src?.sort ?? 100 }, actor);
        toast.success(!active
          ? `Added "${d.title}". It is switched off, so no notice gets it until it is switched on.`
          : `Added "${d.title}" as version 1. ${forms.length ? 'Open notices of its forms get it now.' : 'Open notices with no template of their own get it now.'}`);
        onSaved(key);
      }
      invalidateReplyTemplates(qc);
    } catch (e) {
      toast.error(`Not saved. ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const heading = mode === 'edit' ? `Edit the template: ${src?.title ?? ''}` : mode === 'duplicate' ? `Duplicate: ${src?.title ?? ''}` : 'New template';
  const id = (k: string) => `${uid}-${k}`;

  return (
    <Dialog open={!!state} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="pr-6 leading-snug">{heading}</DialogTitle>
          <DialogDescription>
            {mode === 'edit' && src
              ? <>Key <span className="font-mono">{src.key}</span>, version {src.version}. Saving makes it version {src.version + 1}, and the replies prepared for every open notice it applies to are written again. Drafts already started keep their own text.</>
              : <>A new template is offered on every open notice it applies to as soon as it is saved, unless it is switched off below.</>}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
          {isNew && (
            <div className="space-y-1">
              <Label htmlFor={id('key')}>Key</Label>
              <Input id={id('key')} value={key} onChange={(e) => { setKeyTouched(true); setKey(e.target.value.trim()); }}
                className="h-9 font-mono text-sm sm:w-96" aria-describedby={id('key-hint')} aria-invalid={!!keyProblem} autoComplete="off" spellCheck={false} />
              <p id={id('key-hint')} className={cn('text-xs', keyProblem ? 'text-destructive-strong' : 'text-muted-foreground')}>
                {keyProblem ?? 'Small letters, digits and underscores, as drc01_contest. It cannot be changed later.'}
              </p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <div className="space-y-1">
              <Label htmlFor={id('title')}>Title</Label>
              <Input id={id('title')} value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 text-sm" maxLength={200} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={id('stance')}>Stance</Label>
              <Select value={stance} onValueChange={setStance}>
                <SelectTrigger id={id('stance')} className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STANCE).map(([k, s]) => <SelectItem key={k} value={k} className="text-sm">{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={id('summary')}>When to use it (one line on the option card)</Label>
            <Input id={id('summary')} value={summary} onChange={(e) => setSummary(e.target.value)} className="h-9 text-sm" maxLength={400} />
          </div>

          <FormsPicker value={forms} onChange={setForms} options={formOptions} />

          {isNew && (
            <div className="flex items-start gap-2">
              <Checkbox id={id('active')} checked={active} onCheckedChange={(v) => setActive(v === true)} className="mt-0.5" />
              <Label htmlFor={id('active')} className="text-sm font-normal leading-snug">
                Offer it on open notices as soon as it is saved
              </Label>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor={id('body')}>Wording</Label>
            <p id={id('body-hint')} className="text-xs text-muted-foreground">
              Paragraphs are separated by a blank line. Placeholders in double braces are filled from each notice; anything in square brackets is a
              fill in the person completes in the draft.
            </p>
            <Textarea id={id('body')} ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} rows={16} spellCheck
              aria-describedby={id('body-hint')} className="font-mono text-[13px] leading-relaxed" />
          </div>

          <PlaceholdersPanel onInsert={insert} />

          <div className="space-y-2">
            <DashCheck hits={hits} onReplace={replaceDashes} disabled={saving} />
            <PlaceholderCheck problems={problems} onFix={fix} />
            {hits.length === 0 && problems.length === 0 && (finalBody.trim() || title.trim())
              && <ChecksPassed>No hyphen or dash, and every placeholder is one the app fills.</ChecksPassed>}
          </div>

          <div className="rounded-md border">
            <button type="button" onClick={() => setShowPreview((o) => !o)} aria-expanded={showPreview} aria-controls={id('preview')}
              className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-2 text-left text-xs font-semibold hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {showPreview ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
              Preview on a notice
              <span className="font-normal text-muted-foreground">the wording as it stands, filled with one notice's facts</span>
            </button>
            {showPreview && (
              <div id={id('preview')} className="border-t p-2.5">
                <TemplatePreview body={finalBody} forms={forms} ownForms={ownForms} editing />
              </div>
            )}
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {blockers.length ? `To save: ${blockers.join(' ')}` : 'Ready to save.'}
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={saving || blockers.length > 0}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} {isNew ? 'Add the template' : 'Save'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default TemplateEditDialog;
