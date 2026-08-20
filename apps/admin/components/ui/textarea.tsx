import type * as React from "react";

import { cn } from "@/lib/utils";

/* The one field in this console that takes sentences rather than a value.
 *
 * Everything else an operator types is a figure, a date, a reference or a
 * choice, and `Input` is the control for all of them. A handover note is the
 * exception the shift close asks for: several sentences about a night that went
 * badly, read by whoever takes the desk next.
 *
 * Styled from `input.tsx` rather than beside it — the same border, the same
 * resting weight, the same invalid rule — so the two controls in one form do not
 * read as two different kinds of field. What differs is what a multi-line box
 * has to decide for itself: a minimum height of about four lines, and vertical
 * resizing only, because a box the operator can drag wider than its own column
 * breaks the grid it sits in.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-24 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
