// Editing one reply rule (roadmap Phase 4 "Reply rules"; audit R-11): the
// firm's position text, the documents the client is asked for, and the two
// paragraphs a prepared reply uses for the issue (reply_issue_types.para_contest
// and para_accept; contract §B). A changed position goes back to Proposed until
// a partner approves the new words. The paragraphs are reply wording, so they go
// through the same checks as a template: no hyphen or dash (the database refuses
// one) and no placeholders.
import React, { useEffect, useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Note } from '@/components/gstr9/ui';
import {
  dehyphen, documentsFromText, findDashes, placeholderProblems, type IssueType, type IssueTypePatch,
} from '@/lib/replyFactory';
import { DashCheck, PlaceholderCheck } from './TextChecks';

const CONTEST = 'Paragraph when contesting';
const ACCEPT = 'Paragraph when accepting';

export const RuleEditDialog: React.FC<{
  rule: IssueType | null;
  saving: boolean;
  onClose: () => void;
  onSave: (rule: IssueType, patch: IssueTypePatch) => void;
}> = ({ rule, saving, onClose, onSave }) => {
  const uid = useId();
  const [position, setPosition] = useState('');
  const [docs, setDocs] = useState('');
  const [contest, setContest] = useState('');
  const [accept, setAccept] = useState('');
  useEffect(() => {
    setPosition(rule?.firm_position ?? '');
    setDocs((rule?.documents ?? []).join('\n'));
    setContest(rule?.para_contest ?? '');
    setAccept(rule?.para_accept ?? '');
  }, [rule]);
  if (!rule) return null;
  const changedPosition = position.trim() !== (rule.firm_position ?? '').trim();
  const resets = changedPosition && rule.position_status !== 'proposed';
  const hits = [...findDashes(contest, CONTEST), ...findDashes(accept, ACCEPT)];
  const problems = [...placeholderProblems(contest, CONTEST, false), ...placeholderProblems(accept, ACCEPT, false)];
  const blocked = hits.length > 0 || problems.length > 0;
  const id = (k: string) => `${uid}-${k}`;

  return (
    <Dialog open={!!rule} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit the reply rule: {rule.title}</DialogTitle>
          <DialogDescription>
            Issue code <span className="font-mono">{rule.code}</span>. The position is what the reply argues for this issue; the documents are
            what the client is asked for when a notice raises it; the two paragraphs go into the replies prepared for such a notice.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          if (blocked) return;
          onSave(rule, {
            firm_position: position.trim() || null, documents: documentsFromText(docs),
            para_contest: contest.trim() || null, para_accept: accept.trim() || null,
          });
        }}>
          <div className="space-y-1">
            <Label htmlFor={id('pos')}>Firm position</Label>
            <Textarea id={id('pos')} value={position} onChange={(e) => setPosition(e.target.value)} rows={7} className="text-sm" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={id('docs')}>Documents asked from the client (one per line)</Label>
            <Textarea id={id('docs')} value={docs} onChange={(e) => setDocs(e.target.value)} rows={5} className="text-sm" />
          </div>
          {resets && (
            <Note tone="warn">
              The position was {rule.position_status === 'approved' ? 'approved' : 'sent back for changes'}; saving new words sets it back to
              Proposed until a partner approves them.
            </Note>
          )}

          <fieldset className="space-y-2 rounded-md border p-2.5">
            <legend className="px-1 text-sm font-medium">Reply paragraphs</legend>
            <p className="text-xs text-muted-foreground">
              Each prepared reply writes "Issue (a): the issue and its amount" and then one of these, written impersonally in two to five
              sentences. No placeholders, and no hyphen or dash. Left blank, the reply uses a general paragraph.
            </p>
            <div className="space-y-1">
              <Label htmlFor={id('contest')}>{CONTEST}</Label>
              <Textarea id={id('contest')} value={contest} onChange={(e) => setContest(e.target.value)} rows={5} className="text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor={id('accept')}>{ACCEPT}</Label>
              <Textarea id={id('accept')} value={accept} onChange={(e) => setAccept(e.target.value)} rows={4} className="text-sm" />
            </div>
            <DashCheck hits={hits} disabled={saving} onReplace={() => { setContest((v) => dehyphen(v)); setAccept((v) => dehyphen(v)); }} />
            <PlaceholderCheck problems={problems} />
          </fieldset>

          <DialogFooter className="gap-2">
            {blocked && <p className="mr-auto self-center text-xs text-muted-foreground" aria-live="polite">Fix the reply paragraphs to save.</p>}
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || blocked}>{saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default RuleEditDialog;
