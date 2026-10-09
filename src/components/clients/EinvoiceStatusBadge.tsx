import React from 'react';
import { Badge } from '@/components/gstr9/badge';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { exemptionLabel, type EinvoiceAssessment } from '@/lib/einvoice/threshold';

/**
 * A client's e-invoice position in one pill:
 *  Exempt (an exempt class) · E-invoice (ticked) · Mandatory — not ticked ·
 *  Applies next FY · Approaching (≥ ₹4 crore) · nothing (below / not assessed).
 * The tooltip carries the reason (exemption, or the assessment message).
 */
export const EinvoiceStatusBadge: React.FC<{
  ticked: boolean;
  exemption: string | null | undefined;
  assessment?: EinvoiceAssessment;
  className?: string;
}> = ({ ticked, exemption, assessment, className }) => {
  let variant: 'secondary' | 'info' | 'destructive' | 'warning';
  let label: string;
  let tip: string | null = assessment?.message ?? null;

  if (exemption) {
    variant = 'secondary';
    label = 'Exempt';
    tip = `Exempt from e-invoicing: ${exemptionLabel(exemption)}`;
  } else if (assessment?.status === 'mandatory' && !ticked) {
    variant = 'destructive';
    label = 'Mandatory — not ticked';
  } else if (ticked) {
    variant = 'info';
    label = 'E-invoice';
    tip = assessment && assessment.status !== 'below' ? assessment.message : 'Ticked as an e-invoice client.';
  } else if (assessment?.status === 'next_fy') {
    variant = 'warning';
    label = 'Applies next FY';
  } else if (assessment?.status === 'approaching') {
    variant = 'warning';
    label = 'Approaching';
  } else {
    return null;
  }

  const pill = (
    <Badge variant={variant} className={cn('whitespace-nowrap text-[10px] font-medium', className)}>
      {label}
    </Badge>
  );
  if (!tip) return pill;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{pill}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{tip}</TooltipContent>
    </Tooltip>
  );
};

export default EinvoiceStatusBadge;
