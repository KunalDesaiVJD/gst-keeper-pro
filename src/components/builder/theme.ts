// The Annual Return (GSTR-9/9C) table look, adapted for the shadcn <Table>
// pieces the builder pages use. The kit's TableHead / TableCell carry their own
// h-12 / p-4, so these add the overrides the shared WS_* constants leave out.
// Pair with <Table className={B_TABLE} containerClassName={WS_TABLE_WRAP}>.

import { cn } from '@/lib/utils';
import { WS_TABLE, WS_TD, WS_TD_NUM, WS_TH, WS_TR } from '@/components/workspace/theme';

export const B_TABLE = WS_TABLE;
export const B_TH = cn(WS_TH, 'h-auto align-middle');
export const B_TH_NUM = cn(B_TH, 'text-right');
export const B_TD = cn(WS_TD, 'align-middle');
export const B_TD_NUM = cn(WS_TD_NUM, 'align-middle');
/** Body row: the kit's border-b is dropped (cells carry their own borders). */
export const B_TR = cn(WS_TR, 'border-0 hover:bg-muted/30');
/** Header row: no hover. */
export const B_TR_HEAD = 'border-0 hover:bg-transparent';
