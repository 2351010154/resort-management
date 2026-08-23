import type * as React from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps extends React.ComponentProps<"header"> {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

function PageHeader({
  title,
  description,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold leading-9 tracking-[-0.02em]">
          {title}
        </h1>
        {description === undefined ? null : (
          <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}

export { PageHeader, type PageHeaderProps };
