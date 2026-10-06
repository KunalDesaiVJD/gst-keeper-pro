// The notice's evidence (roadmap Phase 4, audit R-10): the recipes that answer
// its issues from the portal figures the app holds, their annexures with each
// row's source, and the data still missing. Placeholder until the recipes land.
import React from 'react';
import type { Workspace } from '@/lib/noticeWorkspace';

export const EvidenceTab: React.FC<{ ws: Workspace; canEdit: boolean; onChanged: () => void }> = () => (
  <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
    Evidence is being prepared.
  </div>
);

export default EvidenceTab;
