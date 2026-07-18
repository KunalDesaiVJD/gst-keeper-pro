import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type PasswordInputProps = Omit<React.ComponentProps<typeof Input>, "type">;

/**
 * Password field with a built-in show/hide toggle.
 * forwardRef so it drops straight into react-hook-form's register().
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, disabled, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);

    return (
      <div className="relative">
        <Input
          {...props}
          ref={ref}
          disabled={disabled}
          type={visible ? "text" : "password"}
          className={cn("pr-10", className)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          tabIndex={-1}
          disabled={disabled}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-0 top-0 h-10 w-10 text-muted-foreground hover:bg-transparent hover:text-foreground"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";
