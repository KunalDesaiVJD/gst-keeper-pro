// The GSTR-9 step's differences from the system-computed GSTR-9 (src/lib/gstr9/variance.ts),
// computed once per render of the workings and shared by the tables, the tab badges and the card.
import { useMemo } from 'react';
import { countByTable, gatherRemarks, systemVariances, varianceDigest, varianceLookup, type VarianceCol, type VarianceTable } from '@/lib/gstr9/variance';
import { useWorkspace } from '../WorkspaceContext';

export function useVariance() {
  const { docs, workings } = useWorkspace();
  return useMemo(() => {
    const cells = systemVariances(docs, workings);
    const remarks = gatherRemarks(docs, workings);
    const at = varianceLookup(cells);
    return {
      cells,
      remarks,
      counts: countByTable(cells),
      digest: varianceDigest(cells, remarks),
      /** A table's lookup, as MatrixTable / FormTable take it. */
      of: (table: VarianceTable) => (rowKey: string, col: VarianceCol | string) => at(table, rowKey, col),
    };
  }, [docs, workings]);
}
