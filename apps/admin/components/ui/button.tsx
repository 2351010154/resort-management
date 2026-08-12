import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

/* Upstream's `focus-visible:ring-[3px] focus-visible:ring-ring/50` is not here,
 * and the omission is deliberate across every primitive in this folder. That
 * ring draws --umber at half strength, which lands near 2.7:1 on --ivory —
 * under the 3:1 a focus indicator owes. globals.css already draws focus as a
 * full-strength 2px --color-ring outline at 2px offset, so the primitives drop
 * `outline-none` and inherit it. One focus treatment, defined once, passing.
 *
 * `font-medium` is `font-normal` for the same kind of reason: layout.tsx loads
 * IBM Plex Mono at 300 and 400 only, so a 500 would be synthesised by the
 * browser. 400 against the body's 300 is the console's real emphasis step. */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-normal whitespace-nowrap transition-all disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",

        /* --color-destructive and --color-primary are the same number, so this
         * variant cannot differ from `default` by colour — it has to differ by
         * shape. It is the only variant drawn as a doubled rule on the page
         * ground, which reads as a control asking to be read rather than the
         * confident filled one beside it, and it fills on hover and focus so
         * the committed state still looks committed.
         *
         * The shape is half the signal. The other half is the label: a
         * destructive button in this console says the verb — "Cancel booking",
         * "Void folio" — never "OK" and never "Confirm". */
        destructive:
          "border-2 border-destructive bg-background text-destructive hover:bg-destructive hover:text-destructive-foreground focus-visible:bg-destructive focus-visible:text-destructive-foreground",

        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
