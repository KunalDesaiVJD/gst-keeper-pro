import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Save, Bell, CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buildEmailHtml } from '@/lib/emailTemplate';

interface Tpl {
  key: string;
  name: string;
  kind: 'reminder' | 'confirmation' | 'notice_alert';
  step: number | null;
  subject: string;
  body: string;
  is_active: boolean;
  sort_order: number;
}

// Variables available in every template + representative sample values for the
// live preview. Keep in sync with what the sender fills at send time.
const VARS = [
  'contact_person', 'client_name', 'gstin', 'return_type', 'period',
  'due_date', 'data_by_date', 'arn', 'filing_date',
  'staff_name', 'firm_name', 'firm_email', 'firm_phone',
];
const NOTICE_VARS = [
  'contact_person', 'client_name', 'gstin', 'notice_type', 'reference_number',
  'description', 'issue_date', 'due_date', 'days_remaining', 'priority',
  'hearing_date', 'issued_by', 'old_status', 'new_status', 'reply_date',
  'reply_ref_number', 'order_date', 'order_number', 'actor_name',
  'staff_name', 'firm_name', 'firm_email',
  'overdue_count', 'unassigned_count', 'notice_list',
  'deadline_type', 'deadline_date', 'statutory_basis',
  'document_list', 'next_step', 'staff_status',
  'report_date', 'mis_content', 'anomaly_description',
];
const SAMPLE: Record<string, string> = {
  contact_person: 'Rajesh Shah',
  client_name: 'ABC Enterprises',
  gstin: '24ABCDE1234F1Z5',
  return_type: 'GSTR-3B',
  period: 'July 2025',
  due_date: '20 Aug 2025',
  data_by_date: '12 Aug 2025',
  arn: 'AA2407250000000',
  filing_date: '18 Aug 2025',
  staff_name: 'GST Team',
  firm_name: 'V. J. Desai & Co. LLP',
  firm_email: 'gst@vjdesai.com',
  firm_phone: '+91 265 000 0000',
  notice_type: 'DRC-01',
  reference_number: 'ZA2409000012345',
  description: 'Show cause notice for ITC mismatch',
  issue_date: '01 Sep 2026',
  days_remaining: '5',
  priority: 'High',
  hearing_date: '15 Sep 2026',
  issued_by: 'Deputy Commissioner',
  old_status: 'Under Review',
  new_status: 'Reply Drafted',
  reply_date: '10 Sep 2026',
  reply_ref_number: 'RPL/2026/001',
  order_date: '',
  order_number: '',
  actor_name: 'Kunal Desai',
  overdue_count: '3',
  unassigned_count: '2',
  notice_list: '  DRC-01 - ZA2409000012345 (Due: 15/09/2026)\n  ASMT-10 - ZB2409000067890 (Due: 12/09/2026)',
  deadline_type: 'Appeal u/s 107',
  deadline_date: '01 Dec 2026',
  statutory_basis: 'Section 107(1) CGST Act',
  document_list: '1. Purchase invoices for Q2 2025-26\n2. Bank statements',
  next_step: 'Awaiting client documents',
  staff_status: 'Under Review',
  report_date: '14 Sep 2026',
  mis_content: 'Open: 12 | Overdue: 3 | Due in 7 days: 5',
  anomaly_description: 'Duplicate notice detected',
};
const renderPreview = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_m, k) => SAMPLE[k] ?? `{{${k}}}`);

const EmailTemplatesEditor: React.FC = () => {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [selKey, setSelKey] = useState<string>('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from('email_templates').select('*').order('sort_order');
    if (error) { toast.error('Failed to load templates'); setLoading(false); return; }
    const rows = (data ?? []) as Tpl[];
    setTemplates(rows);
    const first = rows.find(r => r.key === selKey) ?? rows[0];
    if (first) { setSelKey(first.key); setSubject(first.subject); setBody(first.body); }
    setLoading(false);
  }

  function pick(t: Tpl) {
    setSelKey(t.key);
    setSubject(t.subject);
    setBody(t.body);
  }

  const current = templates.find(t => t.key === selKey);
  const dirty = !!current && (current.subject !== subject || current.body !== body);

  function insertVar(v: string) {
    const token = `{{${v}}}`;
    const el = bodyRef.current;
    if (!el) { setBody(b => b + token); return; }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => { el.focus(); const p = start + token.length; el.setSelectionRange(p, p); });
  }

  async function save() {
    if (!current) return;
    setSaving(true);
    const { error } = await supabase
      .from('email_templates')
      .update({ subject, body, updated_by: (user as unknown as { id?: string })?.id ?? null })
      .eq('key', selKey);
    setSaving(false);
    if (error) { toast.error(`Save failed: ${error.message}`); return; }
    toast.success('Template saved');
    setTemplates(ts => ts.map(t => (t.key === selKey ? { ...t, subject, body } : t)));
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const reminders = templates.filter(t => t.kind === 'reminder');
  const confirmations = templates.filter(t => t.kind === 'confirmation');
  const noticeAlerts = templates.filter(t => t.kind === 'notice_alert');
  const activeVars = current?.kind === 'notice_alert' ? NOTICE_VARS : VARS;

  const listItem = (t: Tpl) => (
    <button
      key={t.key}
      type="button"
      onClick={() => pick(t)}
      className={cn(
        'w-full text-left rounded-md border px-3 py-2 text-sm transition-colors',
        t.key === selKey ? 'border-primary bg-primary/5 font-medium' : 'border-border hover:bg-muted',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span>{t.name}</span>
        {t.key === selKey && dirty && <span className="h-2 w-2 rounded-full bg-amber-500" title="Unsaved changes" />}
      </span>
    </button>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>GST email templates</CardTitle>
        <CardDescription>
          The copy used for data reminders and filing confirmations, sent from gst@vjdesai.com.
          Edit the wording freely — <code className="text-xs">{'{{variables}}'}</code> are filled in automatically per client and return.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 md:grid-cols-[240px_1fr]">
          {/* Template list */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Bell className="h-3.5 w-3.5" /> Reminders</p>
              <div className="space-y-1.5">{reminders.map(listItem)}</div>
            </div>
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5" /> Confirmations</p>
              <div className="space-y-1.5">{confirmations.map(listItem)}</div>
            </div>
            {noticeAlerts.length > 0 && (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5" /> Notice Alerts</p>
                <div className="space-y-1.5">{noticeAlerts.map(listItem)}</div>
              </div>
            )}
          </div>

          {/* Editor */}
          {current && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-subject">Subject</Label>
                <Input id="tpl-subject" value={subject} onChange={e => setSubject(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tpl-body">Message</Label>
                <p className="text-xs text-muted-foreground">Just the wording. The letterhead, details box, signature and colours are added automatically — you can't break the layout. Leave a blank line between paragraphs.</p>
                <Textarea id="tpl-body" ref={bodyRef} value={body} onChange={e => setBody(e.target.value)} rows={9} className="text-[13px] leading-relaxed" />
              </div>

              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Click a variable to insert it into the body at the cursor:</p>
                <div className="flex flex-wrap gap-1.5">
                  {activeVars.map(v => (
                    <button key={v} type="button" onClick={() => insertVar(v)}>
                      <Badge variant="secondary" className="cursor-pointer hover:bg-primary/10 font-mono text-[11px]">{`{{${v}}}`}</Badge>
                    </button>
                  ))}
                </div>
              </div>

              {/* Live preview — rendered HTML in a sandboxed iframe */}
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview (sample data)</p>
                <p className="text-xs text-muted-foreground">Subject</p>
                <p className="mb-3 text-sm font-medium">{renderPreview(subject)}</p>
                <iframe
                  title="Email preview"
                  srcDoc={buildEmailHtml({ key: selKey, kind: current.kind, message: renderPreview(body), vars: SAMPLE })}
                  sandbox=""
                  className="w-full rounded-md border bg-white"
                  style={{ height: 620 }}
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
                <Button onClick={save} disabled={saving || !dirty} className="gap-1.5">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save template
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default EmailTemplatesEditor;
