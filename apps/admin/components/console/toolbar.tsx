import type * as React from "react";

import { cn } from "@/lib/utils";

function Toolbar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="toolbar"
      data-slot="toolbar"
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  );
}

export { Toolbar };
