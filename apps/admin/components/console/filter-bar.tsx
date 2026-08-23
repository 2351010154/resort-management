import type * as React from "react";

import { cn } from "@/lib/utils";

interface FilterBarProps extends React.ComponentProps<"form"> {
  actions?: React.ReactNode;
  result?: React.ReactNode;
  fieldsClassName?: string;
}

function FilterBar({
  children,
  actions,
  result,
  fieldsClassName,
  className,
  ...props
}: FilterBarProps) {
  return (
    <form
      data-slot="filter-bar"
      className={cn(
        "flex flex-col gap-3 rounded-lg bg-card p-4 shadow-card lg:flex-row lg:items-end",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "grid min-w-0 flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4",
          fieldsClassName,
        )}
      >
        {children}
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
      {result === undefined ? null : (
        <div className="ml-auto shrink-0 pb-3 text-sm text-muted-foreground lg:pb-0">
          {result}
        </div>
      )}
    </form>
  );
}

export { FilterBar, type FilterBarProps };
