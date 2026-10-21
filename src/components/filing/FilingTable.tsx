import React, { useState } from 'react';
import {
  AlertTriangle, ChevronDown, ClipboardCheck, Download, Eye, Info, Loader2, Lock, LogIn, Paperclip, RefreshCw, ShieldCheck, Undo2, Unlock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/gstr9/badge';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TH, WS_TR } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import ClientHoverDetails from '@/components/filing/ClientHoverDetails';
import { FilingStatusType, filingStatusDisplayLabel } from '@/types';
import { filingSourceText, hasPortalPull, isPullOnly, outcomeWords, type FilingLogRow } from '@/lib/filingPull';
import type { ManualSourceAllowance } from '@/lib/manualSourceAllowances';

export interface FilingRecord {
  id: string;
  client_id: string;
  return_type: string;
  period_month: string;
  status: FilingStatusType;
  target_date: number | null;
  filed_date: string | null;
  remarks: string | null;
  is_locked: boolean | null;
  updated_by: string | null;
  updated_at: string | null;
  arn: string | null;
  return_pdf_url: string | null;
  is_nil?: boolean | null;
  /** Set when the return was pushed to the portal through GST Keeper. */
  pushed_at?: string | null;
  /** 'portal' (the extension's pull) or 'manual' (attached by hand); null before 21 Oct 2026. */
  filed_source?: 'portal' | 'manual' | null;
  manual_allowance_id?: string | null;
  pulled_at?: string | null;
  /** Why the row has no checked PDF. */
  pdf_note?: string | null;
  // Joined client data
  clientName?: string;
  clientEmail?: string;
  contactNumber?: string;
  accountantName?: string;
  filingFrequency?: string;
  updatedByName?: string;
  updatedByRole?: string;
}

/** What the page knows about one row beyond the row itself. */
export interface FilingRowContext {
  /** The latest pull outcome for this return this month. */
  outcome: FilingLogRow | null;
  /** The superadmin's live allowance for this return (used or not). */
  allowance: ManualSourceAllowance | null;
  /** The allowance this row was attached under. */
  usedAllowance: ManualSourceAllowance | null;
  /** The sibling row (GSTR-1 / GSTR-1 (IFF), GSTR-3B / GSTR-3B (Q)) that is Filed, when this one is not. */
  filedTwin: FilingRecord | null;
  /** A pull of this return is running. */
  pulling: boolean;
  /** The direct-filing rule holds this return back (its pull would be refused). */
  pullBlocked: boolean;
}

// A column-header filter trigger: reads as header text (muted, semibold) with a caret.
const HEADER_FILTER_BTN = 'h-auto gap-1 p-0 text-xs font-semibold text-muted-foreground hover:bg-transparent hover:text-foreground';
// A body cell holding a control (select / input / textarea): tighter padding than WS_TD.
const CELL_CONTROL = cn(WS_TD, 'px-1.5 py-1');

// Left-accent + subtle tint for the Filing Status control, so a "Filed" row reads
// differently from "Mismatch"/"Pending" at a glance — using the semantic tokens.
const filingStatusAccent = (status: string): string => {
  switch (status) {
    case 'Filed': return 'border-l-4 border-l-success bg-success/5';
    // Pushed sits one step short of Filed — close enough to read as progress,
    // distinct enough that nobody mistakes it for a filed return.
    case 'Pushed': return 'border-l-4 border-l-primary bg-primary/5';
    case 'Mismatch in Data': return 'border-l-4 border-l-destructive bg-destructive/5';
    case 'Data Pending':
    case 'Prepared Pending': return 'border-l-4 border-l-warning bg-warning/5';
    case 'Data Received':
    case 'Prepared': return 'border-l-4 border-l-info bg-info/5';
    default: return '';
  }
};

// When GST Keeper pushed the return to the portal ("09 Oct, 3:41 pm", IST).
const pushedAtLabel = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const dayLabel = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export interface FilingTableProps {
  /** Every row of the tab (for the header filters' choices). */
  records: FilingRecord[];
  /** The rows to show (the page's filters applied). */
  rows: FilingRecord[];
  returnType: string;
  contextFor: (r: FilingRecord) => FilingRowContext;
  userNames: Record<string, string>;
  // Filters held by the page, so they survive a refresh.
  allStatuses: FilingStatusType[];
  selectedStatuses: FilingStatusType[];
  toggleStatus: (s: FilingStatusType) => void;
  clearStatuses: () => void;
  selectedFrequencies: string[];
  toggleFrequency: (f: string) => void;
  clearFrequencies: () => void;
  selectedTargetDates: number[];
  toggleTargetDate: (d: number) => void;
  clearTargetDates: () => void;
  selectedRemarks: string[];
  toggleRemark: (r: string) => void;
  clearRemarks: () => void;
  // Who may do what.
  canUnlockSheets: boolean;
  canEditFilingStatus: boolean;
  isSuperadmin: boolean;
  extReady: boolean;
  extOutdated: boolean;
  // Row facts.
  gstr1DataClientIds: Set<string>;
  gstr1IsNilByClient: Map<string, boolean>;
  retryingCarryForwardId: string | null;
  directFilingBadge: (r: FilingRecord) => React.ReactNode;
  // Actions.
  onStatusChange: (r: FilingRecord, s: FilingStatusType) => void;
  onRemarksChange: (r: FilingRecord, remarks: string) => void;
  onRetryCarryForward: (r: FilingRecord) => void;
  onUnlock: (r: FilingRecord) => void;
  onPull: (r: FilingRecord) => void;
  onPullClient: (r: FilingRecord) => void;
  onAttach: (r: FilingRecord) => void;
  onAllowManual: (r: FilingRecord) => void;
  onUnfile: (r: FilingRecord) => void;
  onOpenFiling: (r: FilingRecord) => void;
}

/**
 * The filing grid of one return tab. A component of its own (it used to be
 * defined inside the page, so every redraw of the page remounted it and threw
 * away whatever was being typed in a remark).
 */
const FilingTable: React.FC<FilingTableProps> = (p) => {
  const [editingRemarks, setEditingRemarks] = useState<Record<string, string>>({});
  const [remarkSearch, setRemarkSearch] = useState('');
  const { records, rows, returnType } = p;

  const uniqueTargetDates = Array.from(new Set(records.filter((r) => r.target_date !== null).map((r) => r.target_date!))).sort((a, b) => a - b);
  const uniqueRemarks = Array.from(new Set(records.map((r) => (r.remarks || '').trim()).filter((r) => r !== ''))).sort((a, b) => a.localeCompare(b));
  const remarkMatches = uniqueRemarks.filter((r) => r.toLowerCase().includes(remarkSearch.toLowerCase()));

  const sourceLine = (record: FilingRecord, ctx: FilingRowContext): React.ReactNode => {
    if (record.filed_source === 'portal') {
      return (
        <span className="text-[10px] leading-tight text-muted-foreground" title="ARN and filing date read from the GST portal by the extension">
          Portal{record.pulled_at ? `, pulled ${dayLabel(record.pulled_at)}` : ''}
        </span>
      );
    }
    const text = filingSourceText(record, ctx.usedAllowance, p.userNames);
    if (record.filed_source === 'manual' && text) {
      return <Badge variant="warning" className="max-w-full truncate px-1.5 text-[10px] font-medium" title={text}>{text}</Badge>;
    }
    if (text) {
      return <span className="text-[10px] leading-tight text-muted-foreground" title="Recorded before 21 Oct 2026, when Filed was still marked by hand">{text}</span>;
    }
    return null;
  };

  const outcomeLine = (ctx: FilingRowContext): React.ReactNode => {
    const o = ctx.outcome;
    if (ctx.pulling) {
      return <span className="inline-flex items-center gap-1 text-[10px] text-primary"><Loader2 className="h-3 w-3 animate-spin" /> Pulling from the portal…</span>;
    }
    if (!o || o.event === 'manual_attach' || o.event === 'filed' || o.event === 'refreshed' || o.event === 'conflict_accepted') return null;
    const open = o.event === 'conflict' && !o.resolved_at;
    if (o.event === 'conflict' && !open) return null;
    const tone = o.event === 'conflict' || o.event === 'not_found' ? 'text-amber-700 dark:text-amber-400' : 'text-destructive';
    return (
      <span className={cn('line-clamp-2 text-[10px] leading-tight', tone)} title={o.message || ''}>
        {outcomeWords(o.event)}{open ? ' (superadmin decides)' : ''}: {o.message}
      </span>
    );
  };

  return (
    // One scroll box for both axes, so the muted header stays pinned while
    // the grid scrolls sideways too.
    <div className={cn(WS_TABLE_WRAP, 'max-h-[72vh]')}>
      <table className={cn(WS_TABLE, 'min-w-[1380px] table-fixed')} aria-label={`${returnType} filing status`}>
        <thead>
          <tr>
            <th className={cn(WS_TH, 'w-12 text-center')}>No.</th>
            <th className={cn(WS_TH, 'w-52')}>Client name</th>
            <th className={cn(WS_TH, 'w-28')}>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" className={HEADER_FILTER_BTN}>
                    Frequency
                    <ChevronDown className="h-3 w-3" />
                    {p.selectedFrequencies.length > 0 && (
                      <Badge variant="info" className="ml-0.5 h-4 px-1 text-[10px] font-medium tabular-nums">{p.selectedFrequencies.length}</Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-44 p-2 bg-background border" align="start">
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground mb-2">Filter by Frequency</div>
                    {[{ v: 'Monthly', l: 'Monthly (M)' }, { v: 'Quarterly', l: 'Quarterly (Q)' }, { v: 'IFF', l: 'IFF' }].map((f) => (
                      <div key={f.v} className="flex items-center space-x-2 p-1 hover:bg-muted rounded">
                        <Checkbox id={`freq-${f.v}`} checked={p.selectedFrequencies.includes(f.v)} onCheckedChange={() => p.toggleFrequency(f.v)} />
                        <label htmlFor={`freq-${f.v}`} className="text-xs cursor-pointer flex-1">{f.l}</label>
                      </div>
                    ))}
                    {p.selectedFrequencies.length > 0 && (
                      <Button variant="ghost" size="sm" className="w-full mt-2 h-6 text-xs" onClick={p.clearFrequencies}>Clear</Button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </th>
            <th className={cn(WS_TH, 'w-40')}>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" className={HEADER_FILTER_BTN}>
                    Status
                    <ChevronDown className="h-3 w-3" />
                    {p.selectedStatuses.length > 0 && (
                      <Badge variant="info" className="ml-0.5 h-4 px-1 text-[10px] font-medium tabular-nums">{p.selectedStatuses.length}</Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-2 bg-background border" align="start">
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground mb-2">Filter by Status</div>
                    {p.allStatuses.map((status) => (
                      <div key={status} className="flex items-center space-x-2 p-1 hover:bg-muted rounded">
                        <Checkbox id={`status-${status}`} checked={p.selectedStatuses.includes(status)} onCheckedChange={() => p.toggleStatus(status)} />
                        <label htmlFor={`status-${status}`} className="text-xs cursor-pointer flex-1">{filingStatusDisplayLabel(status)}</label>
                      </div>
                    ))}
                    {p.selectedStatuses.length > 0 && (
                      <Button variant="ghost" size="sm" className="w-full mt-2 h-6 text-xs" onClick={p.clearStatuses}>Clear</Button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </th>
            <th className={cn(WS_TH, 'w-44')}>ARN</th>
            <th className={cn(WS_TH, 'w-36 text-center')}>Return PDF</th>
            <th className={cn(WS_TH, 'w-24')}>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" className={HEADER_FILTER_BTN}>
                    Target
                    <ChevronDown className="h-3 w-3" />
                    {p.selectedTargetDates.length > 0 && (
                      <Badge variant="info" className="ml-0.5 h-4 px-1 text-[10px] font-medium tabular-nums">{p.selectedTargetDates.length}</Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-40 p-2 bg-background border" align="start">
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground mb-2">Filter by Target Date</div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {uniqueTargetDates.map((date) => (
                        <div key={date} className="flex items-center space-x-2 p-1 hover:bg-muted rounded">
                          <Checkbox id={`target-${date}`} checked={p.selectedTargetDates.includes(date)} onCheckedChange={() => p.toggleTargetDate(date)} />
                          <label htmlFor={`target-${date}`} className="text-xs cursor-pointer flex-1">Day {date}</label>
                        </div>
                      ))}
                    </div>
                    {p.selectedTargetDates.length > 0 && (
                      <Button variant="ghost" size="sm" className="w-full mt-2 h-6 text-xs" onClick={p.clearTargetDates}>Clear</Button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </th>
            <th className={cn(WS_TH, 'w-28')}>Filed date</th>
            <th className={cn(WS_TH, 'w-48')}>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" className={HEADER_FILTER_BTN}>
                    Remarks
                    <ChevronDown className="h-3 w-3" />
                    {p.selectedRemarks.length > 0 && (
                      <Badge variant="info" className="ml-0.5 h-4 px-1 text-[10px] font-medium tabular-nums">{p.selectedRemarks.length}</Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2 bg-background border" align="start">
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground mb-2">Filter by Remarks</div>
                    <Input value={remarkSearch} onChange={(e) => setRemarkSearch(e.target.value)} placeholder="Search remarks..." className="h-7 text-xs mb-1" />
                    <div className="max-h-56 overflow-y-auto space-y-1">
                      <div className="flex items-center space-x-2 p-1 hover:bg-muted rounded">
                        <Checkbox id="rem-blank" checked={p.selectedRemarks.includes('__BLANK__')} onCheckedChange={() => p.toggleRemark('__BLANK__')} />
                        <label htmlFor="rem-blank" className="text-xs italic text-muted-foreground cursor-pointer flex-1">(No remark)</label>
                      </div>
                      {remarkMatches.map((rem, i) => (
                        <div key={i} className="flex items-center space-x-2 p-1 hover:bg-muted rounded">
                          <Checkbox id={`rem-${i}`} checked={p.selectedRemarks.includes(rem)} onCheckedChange={() => p.toggleRemark(rem)} />
                          <label htmlFor={`rem-${i}`} className="text-xs cursor-pointer flex-1 truncate" title={rem}>{rem}</label>
                        </div>
                      ))}
                      {remarkMatches.length === 0 && <div className="text-xs text-muted-foreground px-1 py-2">No matching remarks.</div>}
                    </div>
                    {p.selectedRemarks.length > 0 && (
                      <Button variant="ghost" size="sm" className="w-full mt-2 h-6 text-xs" onClick={p.clearRemarks}>Clear</Button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </th>
            <th className={cn(WS_TH, 'w-16 text-center', !p.canUnlockSheets && 'border-r-0')}>Login</th>
            {p.canUnlockSheets && <th className={cn(WS_TH, 'w-16 border-r-0 text-center')}>Unlock</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((record, idx) => {
            const ctx = p.contextFor(record);
            const isFiled = record.status === 'Filed';
            const twin = ctx.filedTwin;
            const notApplicable = !!twin && !isFiled;
            const unlockedFiled = !isFiled && !!record.arn;
            const lockedOut = !!record.is_locked && !p.canUnlockSheets;
            const allowanceOpen = ctx.allowance && !ctx.allowance.used_at ? ctx.allowance : null;
            const canAttach = p.canEditFilingStatus && !notApplicable && !lockedOut
              && (!isPullOnly(record.return_type) ? !(isFiled && record.return_pdf_url) : !!allowanceOpen);
            const canAllow = p.isSuperadmin && isPullOnly(record.return_type) && !notApplicable && !ctx.allowance
              && !(isFiled && record.return_pdf_url);
            const showPull = hasPortalPull(record.return_type) && !notApplicable;
            const pullTitle = !p.extReady
              ? 'GST Keeper extension not detected yet: install or enable it and reload this page'
              : p.extOutdated ? 'Update the GST Keeper extension to 0.15.0 or later to pull filed returns'
                : ctx.pullBlocked ? `Pull is held back: this ${record.return_type} was not pushed through GST Keeper. Click to Request approval of the direct filing from the superadmin first.`
                  : isFiled ? 'Pull again from the GST portal: the same ARN refreshes the date and PDF; a different ARN goes to the superadmin'
                    : 'Pull the filed return from the GST portal: its ARN, filing date and PDF';
            return (
              <tr key={record.id} className={cn(WS_TR, record.is_locked && 'bg-muted/30')}>
                <td className={cn(WS_TD, 'text-center tabular-nums text-muted-foreground')}>{idx + 1}</td>
                <td className={cn(WS_TD, 'truncate')}>
                  <ClientHoverDetails
                    clientName={record.clientName || ''}
                    accountant={record.accountantName || '-'}
                    contact={record.contactNumber || '-'}
                    email={record.clientEmail || '-'}
                    lockIcon={record.is_locked ? <Lock className="ml-1.5 inline h-3 w-3 text-muted-foreground" aria-label="Locked" /> : undefined}
                  />
                </td>
                <td className={WS_TD}>
                  <Badge variant={record.filingFrequency === 'Quarterly' ? 'warning' : record.filingFrequency === 'IFF' ? 'info' : 'outline'} className="px-1.5 text-[10px] font-medium">
                    {record.filingFrequency === 'Quarterly' ? 'Q' : record.filingFrequency === 'IFF' ? 'IFF' : 'M'}
                  </Badge>
                </td>
                <td className={CELL_CONTROL}>
                  {notApplicable ? (
                    <Badge variant="outline" className="px-1.5 text-[10px] font-medium" title={`One return for the period: filed as ${twin!.return_type}${twin!.arn ? ` (ARN ${twin!.arn})` : ''}`}>
                      Not applicable (filed as {twin!.return_type})
                    </Badge>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Select
                        value={record.status}
                        disabled={isFiled || lockedOut || !p.canEditFilingStatus}
                        onValueChange={(value) => p.onStatusChange(record, value as FilingStatusType)}
                      >
                        <SelectTrigger
                          className={cn('h-7 w-full px-2 text-xs [appearance:none]', filingStatusAccent(record.status))}
                          title={isFiled ? 'Filed comes from the portal pull. A GST Manager unlocks a filed GSTR-3B; only the superadmin takes a return off Filed.'
                            : p.canEditFilingStatus ? undefined : 'Needs the Filing status & portal push permission — ask a GST Manager to add it to your position'}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Prepared">Prepared</SelectItem>
                          <SelectItem value="Prepared Pending">Not to File</SelectItem>
                          <SelectItem value="Data Pending">Data Pending</SelectItem>
                          <SelectItem value="Data Received">Data Received</SelectItem>
                          <SelectItem value="Mismatch in Data">Mismatch in Data</SelectItem>
                          {/* Pushed and Filed are evidence, never chosen by hand: Pushed comes
                              from a push the portal accepted, Filed from the portal pull. They
                              are listed (disabled) so a row holding one still shows its label. */}
                          <SelectItem value="Pushed" disabled title="Set automatically when a push to the GST portal succeeds.">Pushed</SelectItem>
                          <SelectItem value="Filed" disabled title="Set by the portal pull (Pull), or an attach the superadmin allowed.">Filed</SelectItem>
                        </SelectContent>
                      </Select>
                      {returnType === 'GSTR-1' && isFiled && !record.is_nil && !p.gstr1DataClientIds.has(record.client_id) && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="shrink-0" title="GSTR-1 data not imported"><AlertTriangle className="h-3.5 w-3.5 text-warning" /></button>
                          </PopoverTrigger>
                          <PopoverContent side="left" className="w-[260px] p-3 text-xs">
                            <p className="font-medium text-foreground">GSTR-1 data not imported</p>
                            <p className="text-muted-foreground mt-1">
                              Marked Filed, but no GSTR-1 data has been imported into GST Keeper for this period — the GSTR-3B draft will show ₹0 outward tax until this is imported.
                            </p>
                          </PopoverContent>
                        </Popover>
                      )}
                      {/* Not gated on Filed: the case that most needs it is a period never
                          filed, whose pending items never carried into the next period. */}
                      {(returnType === 'GSTR-3B' || returnType === 'GSTR-3B (Q)') && (
                        <button
                          type="button"
                          className="shrink-0 disabled:opacity-50"
                          title="Re-run carry forward to next month — use this if pending 2B items look missing next period"
                          disabled={p.retryingCarryForwardId === record.id}
                          onClick={() => p.onRetryCarryForward(record)}
                        >
                          {p.retryingCarryForwardId === record.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                            : <RefreshCw className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />}
                        </button>
                      )}
                      {returnType === 'GSTR-3B' && p.gstr1IsNilByClient.get(record.client_id) === true && !record.is_nil && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="shrink-0" title="NIL not carried forward from GSTR-1"><AlertTriangle className="h-3.5 w-3.5 text-warning" /></button>
                          </PopoverTrigger>
                          <PopoverContent side="left" className="w-[260px] p-3 text-xs">
                            <p className="font-medium text-foreground">NIL not carried forward</p>
                            <p className="text-muted-foreground mt-1">
                              GSTR-1 for this period is marked NIL — consider marking GSTR-3B NIL too (see the NIL Return checkbox on the GSTR-3B page).
                            </p>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  )}
                  {record.pushed_at && (
                    <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground" title="Pushed to the GST portal through GST Keeper">
                      Pushed {pushedAtLabel(record.pushed_at)}
                    </p>
                  )}
                  {unlockedFiled && (
                    <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground" title="Unlocked by a GST Manager or the superadmin. Pull it again to file the row again.">
                      Unlocked: filed, ARN kept
                    </p>
                  )}
                  {p.directFilingBadge(record)}
                </td>
                <td className={WS_TD}>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-1">
                      <span className={cn('truncate font-mono text-xs', !record.arn && 'text-muted-foreground')}>{record.arn || '—'}</span>
                      {p.isSuperadmin && (isFiled || record.arn) && (
                        <button type="button" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => p.onUnfile(record)}
                          title="Take this return off Filed (superadmin, with a reason). Its ARN, date and PDF are kept in the log.">
                          <Undo2 className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                    {sourceLine(record, ctx)}
                    {outcomeLine(ctx)}
                  </div>
                </td>
                <td className={cn(WS_TD, 'text-center')}>
                  <div className="flex flex-col items-center gap-1">
                    <div className="flex items-center justify-center gap-2">
                      {record.return_pdf_url ? (
                        <a href={record.return_pdf_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80"
                          title={record.pdf_note ? `View PDF. ${record.pdf_note}` : 'View the filed return'}>
                          <Eye className="h-3.5 w-3.5" />
                        </a>
                      ) : isFiled ? (
                        <span className="text-[10px] text-muted-foreground" title={record.pdf_note || 'No PDF stored'}>No PDF</span>
                      ) : null}
                      {showPull && (
                        <button
                          type="button"
                          onClick={() => p.onPull(record)}
                          disabled={ctx.pulling}
                          className={cn('inline-flex items-center gap-1 text-xs disabled:cursor-not-allowed disabled:opacity-50',
                            p.extReady && !p.extOutdated && !ctx.pullBlocked ? 'text-primary hover:text-primary/80' : 'text-muted-foreground hover:text-foreground')}
                          title={pullTitle}
                        >
                          {ctx.pulling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                          <span>Pull</span>
                        </button>
                      )}
                      {showPull && (
                        <button type="button" onClick={() => p.onPullClient(record)} disabled={ctx.pulling}
                          className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                          title={`Pull every return of ${record.clientName || 'this client'} for this month`}>
                          all
                        </button>
                      )}
                      {canAttach && (
                        <button type="button" onClick={() => p.onAttach(record)} className="inline-flex items-center text-amber-700 dark:text-amber-400 hover:text-foreground"
                          title={isPullOnly(record.return_type)
                            ? `Attach the filed return by hand: allowed by the superadmin (${allowanceOpen?.reason || ''})`
                            : `Attach the filed return by hand (${record.return_type} has no portal pull yet)`}>
                          <Paperclip className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {canAllow && (
                        <button type="button" onClick={() => p.onAllowManual(record)} className="inline-flex items-center text-muted-foreground hover:text-foreground"
                          title="Allow one manual upload for this return (superadmin, with a reason), when a pull cannot be done">
                          <ShieldCheck className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {allowanceOpen && (
                      <span className="line-clamp-2 text-[10px] leading-tight text-amber-700 dark:text-amber-400" title={allowanceOpen.reason}>
                        Manual allowed by {p.userNames[allowanceOpen.allowed_by] || 'the superadmin'}: {allowanceOpen.reason}
                      </span>
                    )}
                  </div>
                </td>
                <td className={cn(WS_TD, 'text-center tabular-nums')}>{record.target_date ?? <span className="text-muted-foreground">—</span>}</td>
                <td className={WS_TD}>
                  <div className="flex items-center gap-1">
                    <span className="tabular-nums">
                      {record.filed_date
                        ? new Date(record.filed_date).toLocaleDateString('en-IN')
                        : isFiled ? <span className="text-[10px] text-amber-700 dark:text-amber-400" title="The portal's filing date was not read. Pull again to fill it.">Date not read</span> : '-'}
                    </span>
                    {record.updatedByName && record.updated_at && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button className="shrink-0"><Info className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" /></button>
                        </PopoverTrigger>
                        <PopoverContent side="left" className="w-[220px] p-3 text-xs">
                          <p className={record.status !== 'Filed' ? 'text-amber-600 dark:text-amber-400' : ''}>
                            Last changed by <strong>{record.updatedByName}</strong> ({record.updatedByRole})
                          </p>
                          <p className={record.status !== 'Filed' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>
                            on {new Date(record.updated_at).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}, {new Date(record.updated_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </td>
                <td className={CELL_CONTROL}>
                  <div className="flex items-start gap-1">
                    <textarea
                      value={editingRemarks[record.id] ?? record.remarks ?? ''}
                      onChange={(e) => setEditingRemarks((prev) => ({ ...prev, [record.id]: e.target.value }))}
                      onBlur={() => {
                        const newRemarks = editingRemarks[record.id];
                        if (newRemarks !== undefined && newRemarks !== record.remarks) p.onRemarksChange(record, newRemarks);
                      }}
                      placeholder="Add remarks..."
                      className="block min-h-[28px] max-h-[80px] w-full resize-y rounded border border-input bg-background px-2 py-1 text-xs leading-snug focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={lockedOut}
                    />
                  </div>
                </td>
                <td className={cn(WS_TD, 'py-1 text-center', !p.canUnlockSheets && 'border-r-0')}>
                  <button
                    onClick={() => p.onOpenFiling(record)}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded ${p.extReady ? 'text-primary hover:bg-primary/10' : 'text-muted-foreground hover:bg-muted'}`}
                    title={p.extReady
                      ? `Log ${record.clientName || 'this client'} in and open the ${record.return_type} filing page — you do the CAPTCHA & submit with OTP/DSC`
                      : 'GST Keeper extension not detected yet — install/enable it and reload this page'}
                  >
                    <LogIn className="h-3.5 w-3.5" />
                  </button>
                </td>
                {p.canUnlockSheets && (
                  <td className={cn(WS_TD, 'border-r-0 py-1 text-center')}>
                    {record.is_locked && (
                      <Button variant="ghost" size="sm" onClick={() => p.onUnlock(record)} className="h-7 px-2" title="Unlock this record (the ARN, filing date and PDF are kept)">
                        <Unlock className="h-3 w-3" />
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={p.canUnlockSheets ? 11 : 10} className="px-3 py-10 text-center text-muted-foreground">
                <ClipboardCheck className="mx-auto mb-1.5 h-5 w-5" />
                <div className="font-medium text-foreground">No records</div>
                {records.length === 0 ? `No clients have ${returnType} selected.` : 'No records match your filters.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default FilingTable;
