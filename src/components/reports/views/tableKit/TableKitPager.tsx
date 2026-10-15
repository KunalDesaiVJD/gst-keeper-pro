// The kit's pager under a long list (more than 500 lines): which lines are
// shown, lines per page, previous / next. Nothing at all for a short list.
import React from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TableKit } from './useTableKit';

export const TableKitPager: React.FC<{ kit: TableKit; className?: string }> = ({ kit, className }) => {
  if (!kit.paged) return null;
  const { pageView, view } = kit;
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground', className)}>
      <span className="tabular-nums">
        Lines {(pageView.from + 1).toLocaleString('en-IN')} to {pageView.to.toLocaleString('en-IN')} of {view.items.length.toLocaleString('en-IN')}
      </span>
      <div className="flex items-center gap-1.5">
        <span>Per page</span>
        <Select value={String(kit.pageSize)} onValueChange={(v) => kit.setPageSize(Number(v))}>
          <SelectTrigger className="h-7 w-[76px] text-xs" aria-label="Lines per page"><SelectValue /></SelectTrigger>
          <SelectContent>
            {kit.pageSizes.map((n) => <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={pageView.page === 0} onClick={() => kit.setPage(pageView.page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="tabular-nums">Page {pageView.page + 1} of {pageView.pages}</span>
        <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={pageView.page >= pageView.pages - 1} onClick={() => kit.setPage(pageView.page + 1)} aria-label="Next page">
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};
