import type * as React from "react";

import { cn } from "@/lib/utils";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-xs border border-border border-b-2 bg-card px-1.5 font-ui text-[11px] font-semibold leading-none text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
