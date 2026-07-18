import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type NumberInputProps = Omit<React.ComponentProps<typeof Input>, "type">;

/** Numeric input with the native spinner arrows suppressed. */
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ className, ...props }, ref) => (
    <Input
      {...props}
      ref={ref}
      type="number"
      className={cn(
        "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        className,
      )}
    />
  ),
);
NumberInput.displayName = "NumberInput";
