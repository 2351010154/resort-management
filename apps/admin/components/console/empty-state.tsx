import type * as React from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps extends React.ComponentProps<"div"> {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

function EmptyState({
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "rounded-lg bg-card px-6 py-12 text-center shadow-card",
        className,
      )}
      {...props}
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      {description === undefined ? null : (
        <p className="mx-auto mt-1 max-w-[48ch] text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action === undefined ? null : (
        <div className="mt-4 flex justify-center">{action}</div>
      )}
    </div>
  );
}

export { EmptyState, type EmptyStateProps };
