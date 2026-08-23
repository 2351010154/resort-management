import type * as React from "react";

import { cn } from "@/lib/utils";

interface FieldProps extends React.ComponentProps<"div"> {
  label: string;
  htmlFor: string;
  help?: string;
  error?: string;
}

function Field({
  label,
  htmlFor,
  help,
  error,
  children,
  className,
  ...props
}: FieldProps) {
  const message = error ?? help;

  return (
    <div data-slot="field" className={cn("min-w-0", className)} {...props}>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-xs font-semibold text-muted-foreground"
      >
        {label}
      </label>
      {children}
      {message === undefined ? null : (
        <p
          id={`${htmlFor}-message`}
          className={cn(
            "mt-1 text-xs text-muted-foreground",
            error && "text-danger",
          )}
        >
          {message}
        </p>
      )}
    </div>
  );
}

export { Field, type FieldProps };
