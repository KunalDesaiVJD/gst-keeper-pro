// The one stage vocabulary for notices and matters (roadmap Phase 2 task 3;
// finding L-25). The database holds the same list in public.notice_stages and
// stores the key in gst_notices.stage / litigation_matters.stage (migration
// 20261006120000_notice_stages.sql). Every queue, list, workspace, matter and
// report labels and colours a stage from here.

export type StageKey =
  | 'new' | 'triaged' | 'evidence' | 'waiting_client' | 'draft' | 'partner_review'
  | 'filed' | 'hearing' | 'order' | 'appeal' | 'closed';

export type StageTone = 'info' | 'warning' | 'success' | 'destructive' | 'secondary';

export interface StageDef {
  key: StageKey;
  label: string;
  /** What being in this stage means (tooltips, the stage picker). */
  description: string;
  tone: StageTone;
}

export const STAGES: StageDef[] = [
  { key: 'new', label: 'New', description: 'Captured; nobody has acted on it yet', tone: 'info' },
  { key: 'triaged', label: 'Triaged', description: 'Owner set and the next step decided', tone: 'info' },
  { key: 'evidence', label: 'Evidence', description: 'Reconciliations and working being built', tone: 'info' },
  { key: 'waiting_client', label: 'Waiting on client', description: 'Documents or data requested from the client', tone: 'warning' },
  { key: 'draft', label: 'Draft', description: 'Reply being drafted', tone: 'info' },
  { key: 'partner_review', label: 'Partner review', description: 'Draft with a partner for approval', tone: 'warning' },
  { key: 'filed', label: 'Filed', description: 'Reply filed; awaiting the officer', tone: 'success' },
  { key: 'hearing', label: 'Hearing', description: 'Personal hearing fixed or attended', tone: 'warning' },
  { key: 'order', label: 'Order', description: 'Order received; accept, rectify or appeal', tone: 'destructive' },
  { key: 'appeal', label: 'Appeal', description: 'Appeal or further proceedings under way', tone: 'destructive' },
  { key: 'closed', label: 'Closed', description: 'Nothing more to do', tone: 'secondary' },
];

const BY_KEY = new Map(STAGES.map((s, i) => [s.key, { ...s, index: i }]));

export const OPEN_STAGES = STAGES.filter((s) => s.key !== 'closed');

export function isStageKey(v: unknown): v is StageKey {
  return typeof v === 'string' && BY_KEY.has(v as StageKey);
}

export function stageDef(key: string | null | undefined): StageDef {
  return BY_KEY.get((key || 'new') as StageKey) ?? STAGES[0];
}

export const stageLabel = (key: string | null | undefined): string => stageDef(key).label;
export const stageTone = (key: string | null | undefined): StageTone => stageDef(key).tone;
export const stageIndex = (key: string | null | undefined): number => BY_KEY.get((key || 'new') as StageKey)?.index ?? 0;

/** Why a notice was closed. Staff pick one; "Other" asks for a note. */
export const CLOSE_REASONS = [
  'Reply accepted by the officer',
  'Proceedings dropped',
  'Withdrawn by the officer',
  'Order accepted and paid',
  'Informational — nothing to do',
  'Duplicate of another notice',
  'Merged into another case',
  'Other',
] as const;

// ── Next best action ───────────────────────────────────────────────────────
// public.notice_plan.next_action (migration 20261006122000). One per open
// notice; the row's button does it, or opens the workspace where it is done.
export type NextAction =
  | 'assign' | 'triage' | 'start_work' | 'build_evidence' | 'chase_client' | 'write_draft'
  | 'review_draft' | 'file_reply' | 'prepare_hearing' | 'decide_order' | 'follow_appeal' | 'await_order'
  | 'read_close';

export type WorkspaceTab = 'issues' | 'evidence' | 'draft' | 'documents' | 'activity' | 'payments' | 'hearings' | 'deadlines';

export interface NextActionDef {
  label: string;
  /** One line under the button: what happens. */
  hint: string;
  /** The workspace tab where the step is done (when the button opens the notice). */
  tab?: WorkspaceTab;
  /** Done in place from a list row (no page change). */
  inline?: 'assign' | 'chase' | 'log_reply';
  primary?: boolean;
}

export const NEXT_ACTIONS: Record<NextAction, NextActionDef> = {
  assign: { label: 'Assign', hint: 'Nobody owns it yet', inline: 'assign', primary: true },
  triage: { label: 'Triage', hint: 'Read it, set priority and the next step', tab: 'issues' },
  start_work: { label: 'Start work', hint: 'List the issues or ask the client', tab: 'issues' },
  build_evidence: { label: 'Build evidence', hint: 'Explain each issue from the firm\'s data', tab: 'evidence' },
  chase_client: { label: 'Chase client', hint: 'Re-send the open document requests', inline: 'chase', tab: 'documents' },
  write_draft: { label: 'Write draft', hint: 'Draft the reply', tab: 'draft' },
  review_draft: { label: 'Review draft', hint: 'Approve or send back', tab: 'draft', primary: true },
  file_reply: { label: 'Log reply', hint: 'File on the portal, then record the ARN', inline: 'log_reply', primary: true },
  prepare_hearing: { label: 'Prepare hearing', hint: 'Documents to carry and who attends', tab: 'hearings' },
  decide_order: { label: 'Decide on the order', hint: 'Accept, rectify or appeal before the clock runs out', tab: 'deadlines', primary: true },
  follow_appeal: { label: 'Follow the appeal', hint: 'Open the matter', tab: 'deadlines' },
  await_order: { label: 'Awaiting the officer', hint: 'Nothing to do until the officer acts', tab: 'activity' },
  // A notice type that needs no reply (notice_type_settings.response_need = 'none'):
  // the notice page's button opens the close flow.
  read_close: { label: 'Read and close', hint: 'No reply needed: read it, then close it' },
};

export function nextActionDef(key: string | null | undefined): NextActionDef {
  return NEXT_ACTIONS[(key || 'await_order') as NextAction] ?? NEXT_ACTIONS.await_order;
}
