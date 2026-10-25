import React, { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/gstr9/badge';
import { buildEmailHtml } from '@/lib/emailTemplate';
import type { ReminderEmail } from '@/lib/reminderPlans';

// The variables queue-gst-reminders fills in a reminder (as the templates).
const VARS = ['contact_person', 'client_name', 'gstin', 'return_type', 'period', 'due_date', 'data_by_date', 'staff_name', 'firm_name', 'firm_email', 'firm_phone'];

/** Subject and wording of one reminder e-mail, with a live preview. */
const ReminderEmailComposer: React.FC<{
  value: ReminderEmail;
  onChange: (v: ReminderEmail) => void;
  /** reminder_1 / reminder_2 / reminder_final: the letterhead's colours. */
  templateKey: string;
  /** Real values for the preview (return, period, dates); the client is a sample. */
  sample: { return_type: string; period: string; due_date: string; data_by_date: string };
  disabled?: boolean;
}> = ({ value, onChange, templateKey, sample, disabled }) => {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const vars: Record<string, string> = {
    contact_person: 'Rajesh Shah', client_name: 'ABC Enterprises', gstin: '24ABCDE1234F1Z5',
    staff_name: 'GST Team', firm_name: 'V. J. Desai & Co. LLP', firm_email: 'gst@vjdesai.com', firm_phone: '',
    ...sample,
  };
  const render = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? `{{${k}}}`);

  const insertVar = (v: string) => {
    const el = bodyRef.current;
    const tag = `{{${v}}}`;
    if (!el) { onChange({ ...value, body: value.body + tag }); return; }
    const start = el.selectionStart ?? value.body.length;
    const end = el.selectionEnd ?? start;
    onChange({ ...value, body: value.body.slice(0, start) + tag + value.body.slice(end) });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + tag.length, start + tag.length); });
  };

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="space-y-2">
        <label className="block space-y-1 text-xs font-medium text-muted-foreground">
          <span>Subject</span>
          <Input value={value.subject} onChange={(e) => onChange({ ...value, subject: e.target.value })} disabled={disabled} className="h-8 text-sm" />
        </label>
        <label className="block space-y-1 text-xs font-medium text-muted-foreground">
          <span>Message</span>
          <Textarea ref={bodyRef} value={value.body} onChange={(e) => onChange({ ...value, body: e.target.value })} disabled={disabled} rows={11} className="text-[13px] leading-relaxed" />
        </label>
        <p className="text-[11px] text-muted-foreground">Just the wording: the letterhead, details box and signature are added. Leave a blank line between paragraphs. Click to insert:</p>
        <div className="flex flex-wrap gap-1">
          {VARS.map((v) => (
            <button key={v} type="button" onClick={() => insertVar(v)} disabled={disabled}>
              <Badge variant="secondary" className="cursor-pointer font-mono text-[10px]">{`{{${v}}}`}</Badge>
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-md border bg-muted/30 p-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Preview (sample client)</p>
        <p className="mb-2 truncate text-sm font-medium" title={render(value.subject)}>{render(value.subject) || '—'}</p>
        <iframe
          title="E-mail preview"
          sandbox=""
          className="w-full rounded border bg-white"
          style={{ height: 380 }}
          srcDoc={buildEmailHtml({ key: templateKey, kind: 'reminder', message: render(value.body), vars })}
        />
      </div>
    </div>
  );
};

export default ReminderEmailComposer;
