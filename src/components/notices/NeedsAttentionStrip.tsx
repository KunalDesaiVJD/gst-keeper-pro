import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface NeedsAttentionStripProps {
  overdue: number;
  total: number;
  dueSoon: number;
  newCount: number;
  newGstinCount: number;
  exposureAmount: number;
  exposureCount: number;
  loading?: boolean;
  onClickOverdue?: () => void;
  onClickDueSoon?: () => void;
  onClickNew?: () => void;
  onClickExposure?: () => void;
}

function formatExposure(amount: number): string {
  if (amount >= 10_000_000) {
    return `₹${(amount / 10_000_000).toFixed(1)} cr`;
  }
  if (amount >= 100_000) {
    return `₹${(amount / 100_000).toFixed(1)} L`;
  }
  return `₹${amount.toLocaleString("en-IN")}`;
}

interface TileConfig {
  label: string;
  value: string;
  subtitle: string;
  borderColor: string;
  onClick?: () => void;
}

function NeedsAttentionStrip({
  overdue,
  total,
  dueSoon,
  newCount,
  newGstinCount,
  exposureAmount,
  exposureCount,
  loading = false,
  onClickOverdue,
  onClickDueSoon,
  onClickNew,
  onClickExposure,
}: NeedsAttentionStripProps) {
  const tiles: TileConfig[] = [
    {
      label: "Overdue",
      value: String(overdue),
      subtitle: `of ${total}`,
      borderColor: "border-l-destructive",
      onClick: onClickOverdue,
    },
    {
      label: "Due in 7 days",
      value: String(dueSoon),
      subtitle: "need action",
      borderColor: "border-l-amber-500",
      onClick: onClickDueSoon,
    },
    {
      label: "New since last sync",
      value: String(newCount),
      subtitle: `from ${newGstinCount} GSTINs`,
      borderColor: "border-l-blue-500",
      onClick: onClickNew,
    },
    {
      label: "Exposure under dispute",
      value: formatExposure(exposureAmount),
      subtitle: `across ${exposureCount} matters`,
      borderColor: "border-l-slate-800 dark:border-l-slate-300",
      onClick: onClickExposure,
    },
  ];

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Card
            key={tile.label}
            className={cn("border-l-4", tile.borderColor)}
          >
            <CardContent className="flex items-center justify-center p-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Card
          key={tile.label}
          className={cn(
            "border-l-4 hover:shadow-md transition-shadow cursor-pointer",
            tile.borderColor
          )}
          onClick={tile.onClick}
        >
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {tile.label}
            </p>
            <p className="text-2xl font-bold tabular-nums mt-1">
              {tile.value}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {tile.subtitle}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export { NeedsAttentionStrip };
export default NeedsAttentionStrip;
