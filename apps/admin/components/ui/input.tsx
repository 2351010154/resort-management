import type * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base shadow-xs transition-[border-color,box-shadow] duration-200 ease-ui selection:bg-accent selection:text-accent-foreground file:inline-flex file:h-9 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        /* Invalid is a border at full --umber against the resting border's
         * --umber at 24%. With no red in the palette the weight change is the
         * whole signal, so it is paired with a message rendered beside the
         * field — the guest site's `.error` pattern, which sets the text in
         * --umber behind a rule of the same colour. A field that goes invalid
         * silently has not said anything. */
        "aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
