import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface NeedsAttentionStripProps {
  overdue: number;
  total: number;
  dueSoon: number;
  dueSoonBreakdown?: { replies: number; appeals: number; hearings: number };
  nextDeadline?: string;
  newCount: number;
  newGstinCount: number;
  newWithDemand?: number;
  unassignedCount?: number;
  exposureAmount: number;
  exposureCount: number;
  exposureTax?: number;
  exposureInterest?: number;
  exposurePenalty?: number;
  preDepositPaid?: number;
  oldestOverdueDays?: number;
  demandAtRisk?: number;
  needClosingCount?: number;
  loading?: boolean;
  onClickOverdue?: () => void;
  onClickDueSoon?: () => void;
  onClickNew?: () => void;
  onClickExposure?: () => void;
}

function formatINR(amount: number): string {
  if (amount >= 10_000_000) return `₹ ${(amount / 10_000_000).toFixed(2)} cr`;
  if (amount >= 100_000) return `₹ ${(amount / 100_000).toFixed(1)} L`;
  return `₹ ${amount.toLocaleString("en-IN")}`;
}

function NeedsAttentionStrip({
  overdue,
  total,
  dueSoon,
  dueSoonBreakdown,
  nextDeadline,
  newCount,
  newGstinCount,
  newWithDemand,
  unassignedCount,
  exposureAmount,
  exposureCount,
  exposureTax,
  exposureInterest,
  exposurePenalty,
  preDepositPaid,
  oldestOverdueDays,
  demandAtRisk,
  needClosingCount,
  loading = false,
  onClickOverdue,
  onClickDueSoon,
  onClickNew,
  onClickExposure,
}: NeedsAttentionStripProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="border-l-4 border-l-muted">
            <CardContent className="flex items-center justify-center p-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {/* Overdue & still open */}
      <Card
        className="border-l-4 border-l-destructive cursor-pointer transition-shadow hover:shadow-md"
        onClick={onClickOverdue}
      >
        <CardContent className="p-3.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Overdue &amp; still open
            </span>
            {overdue > 0 && (
              <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
                Act now
              </span>
            )}
          </div>
          <p className="text-3xl font-bold tabular-nums leading-none">
            {overdue}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              of {total} open{needClosingCount ? ` · ${needClosingCount} need closing` : ''}
            </span>
          </p>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {demandAtRisk ? `${formatINR(demandAtRisk)} at risk` : ''}
              {oldestOverdueDays ? ` · oldest ${oldestOverdueDays}d` : ''}
            </span>
            <span className="font-semibold text-primary">Open queue →</span>
          </div>
        </CardContent>
      </Card>

      {/* Due in next 7 days */}
      <Card
        className="border-l-4 border-l-amber-500 cursor-pointer transition-shadow hover:shadow-md"
        onClick={onClickDueSoon}
      >
        <CardContent className="p-3.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Due in next 7 days
            </span>
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
              This week
            </span>
          </div>
          <p className="text-3xl font-bold tabular-nums leading-none">
            {dueSoon}
            {dueSoonBreakdown && (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                {dueSoonBreakdown.replies} replies · {dueSoonBreakdown.appeals} appeals · {dueSoonBreakdown.hearings} hearings
              </span>
            )}
          </p>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="truncate">{nextDeadline || ''}</span>
            <span className="shrink-0 font-semibold text-primary">Plan week →</span>
          </div>
        </CardContent>
      </Card>

      {/* New since last sync */}
      <Card
        className="border-l-4 border-l-blue-500 cursor-pointer transition-shadow hover:shadow-md"
        onClick={onClickNew}
      >
        <CardContent className="p-3.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              New since last sync
            </span>
            {(unassignedCount ?? 0) > 0 && (
              <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:text-blue-400">
                Unassigned {unassignedCount}
              </span>
            )}
          </div>
          <p className="text-3xl font-bold tabular-nums leading-none">
            {newCount}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              from {newGstinCount} GSTINs{newWithDemand ? ` · ${newWithDemand} with demand` : ''}
            </span>
          </p>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span></span>
            <span className="font-semibold text-primary">Triage →</span>
          </div>
        </CardContent>
      </Card>

      {/* Exposure under dispute */}
      <Card
        className="border-l-4 border-l-slate-800 dark:border-l-slate-300 cursor-pointer transition-shadow hover:shadow-md"
        onClick={onClickExposure}
      >
        <CardContent className="p-3.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Exposure under dispute
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
              {exposureCount} matters
            </span>
          </div>
          <p className="text-3xl font-bold tabular-nums leading-none">
            {formatINR(exposureAmount)}
          </p>
          <div className="text-[11px] text-muted-foreground">
            {exposureTax != null && (
              <span>tax {formatINR(exposureTax)} · int {formatINR(exposureInterest ?? 0)} · pen {formatINR(exposurePenalty ?? 0)}</span>
            )}
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{preDepositPaid ? `Pre-deposit ${formatINR(preDepositPaid)}` : ''}</span>
            <span className="font-semibold text-primary">Exposure report →</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export { NeedsAttentionStrip };
export default NeedsAttentionStrip;
