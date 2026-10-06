// Editing one reply rule (roadmap Phase 4 "Reply rules"; audit R-11): the
// firm's position text and the documents the client is asked for. A changed
// position goes back to Proposed until a partner approves the new words.
import React, { useEffect, useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Note } from '@/components/gstr9/ui';
import { documentsFromText, type IssueType } from '@/lib/replyFactory';

export const RuleEditDialog: React.FC<{
  rule: IssueType | null;
  saving: boolean;
  onClose: () => void;
  onSave: (rule: IssueType, position: string | null, documents: string[]) => void;
}> = ({ rule, saving, onClose, onSave }) => {
  const uid = useId();
  const [position, setPosition] = useState('');
  const [docs, setDocs] = useState('');
  useEffect(() => {
    setPosition(rule?.firm_position ?? '');
    setDocs((rule?.documents ?? []).join('\n'));
  }, [rule]);
  if (!rule) return null;
  const changedPosition = position.trim() !== (rule.firm_position ?? '').trim();
  const resets = changedPosition && rule.position_status !== 'proposed';

  return (
    <Dialog open={!!rule} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit the reply rule: {rule.title}</DialogTitle>
          <DialogDescription>
            Issue code <span className="font-mono">{rule.code}</span>. The position is what the reply argues for this issue; the documents are
            what the client is asked for when a notice raises it.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSave(rule, position.trim() || null, documentsFromText(docs)); }}>
          <div className="space-y-1">
            <Label htmlFor={`${uid}-pos`}>Firm position</Label>
            <Textarea id={`${uid}-pos`} value={position} onChange={(e) => setPosition(e.target.value)} rows={7} className="text-sm" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${uid}-docs`}>Documents asked from the client (one per line)</Label>
            <Textarea id={`${uid}-docs`} value={docs} onChange={(e) => setDocs(e.target.value)} rows={5} className="text-sm" />
          </div>
          {resets && (
            <Note tone="warn">
              The position was {rule.position_status === 'approved' ? 'approved' : 'sent back for changes'}; saving new words sets it back to
              Proposed until a partner approves them.
            </Note>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default RuleEditDialog;
