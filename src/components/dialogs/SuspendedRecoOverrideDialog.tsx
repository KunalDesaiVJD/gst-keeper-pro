import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

const MIN_JUSTIFICATION = 20;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCgst: number;
  initialSgst: number;
  initialIgst: number;
  onSave: (values: { cgst: number; sgst: number; igst: number; justification: string }) => void | Promise<void>;
}

const SuspendedRecoOverrideDialog: React.FC<Props> = ({
  open, onOpenChange, initialCgst, initialSgst, initialIgst, onSave,
}) => {
  const [cgst, setCgst] = useState(initialCgst);
  const [sgst, setSgst] = useState(initialSgst);
  const [igst, setIgst] = useState(initialIgst);
  const [justification, setJustification] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCgst(initialCgst);
      setSgst(initialSgst);
      setIgst(initialIgst);
      setJustification('');
    }
  }, [open, initialCgst, initialSgst, initialIgst]);

  const trimmedLength = justification.trim().length;
  const canSave = trimmedLength >= MIN_JUSTIFICATION && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({ cgst, sgst, igst, justification: justification.trim() });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manual Override</DialogTitle>
          <DialogDescription>
            Override the opening balance values. A justification of at least {MIN_JUSTIFICATION} characters is required.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ov-cgst" className="text-xs">CGST</Label>
              <Input
                id="ov-cgst"
                type="number"
                value={cgst || ''}
                onChange={(e) => setCgst(parseFloat(e.target.value) || 0)}
                className="text-right"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ov-sgst" className="text-xs">SGST</Label>
              <Input
                id="ov-sgst"
                type="number"
                value={sgst || ''}
                onChange={(e) => setSgst(parseFloat(e.target.value) || 0)}
                className="text-right"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ov-igst" className="text-xs">IGST</Label>
              <Input
                id="ov-igst"
                type="number"
                value={igst || ''}
                onChange={(e) => setIgst(parseFloat(e.target.value) || 0)}
                className="text-right"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ov-just" className="text-xs">Reason for override</Label>
            <Textarea
              id="ov-just"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Explain why you are overriding the source values (min 20 characters)..."
              rows={3}
            />
            <p className={`text-xs ${trimmedLength >= MIN_JUSTIFICATION ? 'text-muted-foreground' : 'text-destructive'}`}>
              {trimmedLength}/{MIN_JUSTIFICATION} characters
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? 'Saving...' : 'Save Override'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SuspendedRecoOverrideDialog;
