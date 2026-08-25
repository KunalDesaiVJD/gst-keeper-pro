// "Add Notice" — manual entry, matching Notice Alert's own dialog
// (confirmed live 2026-08-25): GSTIN-TradeName, Section, Ref/Notice Id,
// Issued By, Type, Issued Date, Due Date, Amount Of Demand, Attachment,
// Description. Writes straight into gst_notices with source='notices' —
// the one bucket every other Notices Dashboard piece (KPI tiles, Notice
// Summary, drill-down list, the per-client report) actually reads — so a
// manually-added notice shows up everywhere a portal-pulled one would.
// Notice Alert's own Section field also offers "Additional Notices &
// Orders", but that source has no read path anywhere in this app (the
// per-client "Additional Notices and Orders" report is a permanently-
// empty mirror by design — see noticeRefundDrc03Reports.ts), so picking it
// here would silently vanish the notice; the field is dropped rather than
// wired to a dead end.
import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Loader2 } from 'lucide-react';

interface AddNoticeDialogProps {
  onSuccess: () => void;
}

const EMPTY = {
  clientId: '', refId: '', issuedBy: '', type: '',
  issuedDate: '', dueDate: '', amountOfDemand: '', description: '',
};

export const AddNoticeDialog: React.FC<AddNoticeDialogProps> = ({ onSuccess }) => {
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<SearchableSelectOption[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || clients.length > 0) return;
    (async () => {
      const { data } = await supabase.from('clients').select('id, name, gstin').order('name');
      setClients((data || []).map((c) => ({ value: c.id, label: c.name, sublabel: c.gstin || undefined })));
    })();
  }, [open, clients.length]);

  const reset = () => { setForm(EMPTY); setFile(null); };

  const handleSubmit = async () => {
    if (!form.clientId || !form.refId.trim() || !form.type || !form.issuedDate) {
      toast.error('GSTIN-TradeName, Ref/Notice Id, Type and Issued Date are required.');
      return;
    }
    const amount = form.amountOfDemand.trim() === '' ? null : Number(form.amountOfDemand);
    if (amount !== null && !Number.isFinite(amount)) { toast.error('Amount of Demand must be a number.'); return; }

    setSaving(true);
    let pdfUrl: string | null = null;
    if (file) {
      const path = `manual/${form.clientId}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
      const { error: uploadError } = await supabase.storage.from('return-pdfs').upload(path, file);
      if (uploadError) {
        setSaving(false);
        toast.error('Failed to upload attachment: ' + uploadError.message);
        return;
      }
      pdfUrl = supabase.storage.from('return-pdfs').getPublicUrl(path).data.publicUrl;
    }

    const { error } = await supabase.from('gst_notices').insert({
      client_id: form.clientId,
      source: 'notices',
      reference_number: form.refId.trim(),
      notice_type: form.type,
      issued_by: form.issuedBy.trim() || null,
      issue_date: form.issuedDate,
      due_date: form.dueDate || null,
      amount_of_demand: amount,
      description: form.description.trim() || null,
      staff_status: 'Open',
      pdf_url: pdfUrl,
      pulled_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) { toast.error('Failed to add notice: ' + error.message); return; }

    toast.success('Notice added');
    reset();
    setOpen(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Notice
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Notice</DialogTitle>
          <DialogDescription>Manually log a notice or order the portal hasn't captured.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>GSTIN-Trade Name *</Label>
              <SearchableSelect
                options={clients}
                value={form.clientId}
                onValueChange={(v) => setForm((f) => ({ ...f, clientId: v }))}
                placeholder="Select client…"
                searchPlaceholder="Search clients…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Ref/Notice Id *</Label>
              <Input value={form.refId} onChange={(e) => setForm((f) => ({ ...f, refId: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Issued By</Label>
              <Input value={form.issuedBy} onChange={(e) => setForm((f) => ({ ...f, issuedBy: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Type *</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Notice">Notice</SelectItem>
                  <SelectItem value="Order">Order</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Issued Date *</Label>
              <Input type="date" value={form.issuedDate} onChange={(e) => setForm((f) => ({ ...f, issuedDate: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Due Date</Label>
              <Input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Amount Of Demand</Label>
              <Input type="number" inputMode="decimal" value={form.amountOfDemand} onChange={(e) => setForm((f) => ({ ...f, amountOfDemand: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Attachment</Label>
              <Input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Notice/Order Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {saving ? 'Saving…' : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
