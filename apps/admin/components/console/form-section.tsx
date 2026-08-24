import type * as React from "react";

import { cn } from "@/lib/utils";

interface FormSectionProps extends React.ComponentProps<"section"> {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

function FormSection({
  title,
  description,
  actions,
  children,
  className,
  ...props
}: FormSectionProps) {
  return (
    <section
      data-slot="form-section"
      className={cn("rounded-lg bg-card p-5 shadow-card", className)}
      {...props}
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold leading-6">{title}</h2>
          {description === undefined ? null : (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export { FormSection, type FormSectionProps };
