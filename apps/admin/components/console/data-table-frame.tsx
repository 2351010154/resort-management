import type * as React from "react";

import { cn } from "@/lib/utils";

function DataTableFrame({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="data-table-frame"
      className={cn(
        "overflow-hidden rounded-lg bg-card shadow-card",
        className,
      )}
      {...props}
    />
  );
}

export { DataTableFrame };
