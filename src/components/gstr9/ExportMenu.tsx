import React from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type ExportKind = 'excel' | 'gstr9pdf' | 'noticepdf';

/**
 * Export actions for the open working (stub — the implementation lands with
 * src/lib/gstr9/exportWorkbook.ts / exportPdf.ts).
 */
export const ExportMenu: React.FC<{ only?: ExportKind[]; size?: 'sm' | 'default' }> = ({ size = 'sm' }) => (
  <Button variant="outline" size={size} disabled>
    <Download className="mr-1 h-3.5 w-3.5" /> Export
  </Button>
);

export default ExportMenu;
