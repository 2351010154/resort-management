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
  "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-semibold whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-200 ease-ui active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",

        /* The one variant that differs from `default` by shape rather than
         * by colour, because colour is not available to it: --color-destructive
         * is a warm red-brown and --color-primary the umber a shade off it, so
         * a solid destructive button beside a solid default one — which is
         * exactly where it stands, an act and its safe neighbour — would be two
         * dark slabs an operator has to read the label of to tell apart.
         *
         * So it is the only variant drawn as a doubled rule on the ground it
         * stands on, which reads as a control asking to be read rather than the
         * confident filled one beside it, and it fills on hover and on
         * focus-visible so a committed state still looks committed. Danger on
         * the card is 7.1:1 as text and as a 2px rule; the fill inverts to
         * --color-destructive-foreground at the same ratio, so neither state
         * spends the contrast the other had.
         *
         * The shape is half the signal. The other half is the label: a
         * destructive button in this console says the verb — "Cancel booking",
         * "Void folio" — never "OK" and never "Confirm". */
        destructive:
          "border-2 border-danger bg-transparent text-danger hover:bg-danger hover:text-destructive-foreground focus-visible:bg-danger focus-visible:text-destructive-foreground",

        outline:
          "border border-border bg-card shadow-xs hover:bg-muted hover:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-muted hover:text-foreground",
        link: "text-accent-strong underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-4 has-[>svg]:px-3",
        xs: "h-9 gap-1 px-2 text-sm before:absolute before:-inset-1 before:content-[''] has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-10 gap-1.5 px-3 before:absolute before:-inset-0.5 before:content-[''] has-[>svg]:px-2.5",
        lg: "h-12 px-6 has-[>svg]:px-4",
        icon: "size-11",
        "icon-xs":
          "size-9 before:absolute before:-inset-1 before:content-[''] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-10 before:absolute before:-inset-0.5 before:content-['']",
        "icon-lg": "size-12",
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
