"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type * as React from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/* This is `sonner`, and it is what the task's "toast" primitive resolved to:
 * shadcn/ui retired its own toast component and points at this instead. Same
 * job, still copied in and restyled here rather than imported as a themed
 * black box.
 *
 * Two departures from upstream's version:
 *
 * `useTheme` from next-themes is gone. The console is light only — globals.css
 * declares one palette and no dark block — so the hook would have been a
 * dependency and a provider in the tree to return a constant.
 *
 * The custom properties point at --color-* names. Upstream reads `var(--popover)`
 * because shadcn's own theme declares that name directly; this app maps the
 * semantic layer through Tailwind's `@theme`, which emits it as
 * --color-popover. Wiring it to upstream's spelling would have resolved to
 * nothing and left the toast transparent.
 *
 * `richColors` is deliberately not enabled. It is the prop that would paint
 * success green and error red, and those colours are not in packages/tokens.
 * Left off, every toast is drawn on --popover and the five icons below carry
 * the distinction in shape — which is the same trade the destructive variants
 * in this folder make. */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--color-popover)",
          "--normal-text": "var(--color-popover-foreground)",
          "--normal-border": "var(--color-border)",
          "--border-radius": "var(--radius-md)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
