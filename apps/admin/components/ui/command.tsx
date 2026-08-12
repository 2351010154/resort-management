"use client";

import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon } from "lucide-react";
import type * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/* cmdk, restyled to the console's tokens.
 *
 * Domain-blind like everything else in this folder: it knows how a filtered
 * list of items looks and how the arrows move through one, and nothing about
 * what the console's commands are. `features/command-palette/` owns those.
 *
 * cmdk brings its own list semantics — `role="listbox"` on the list,
 * `aria-selected` on the active item, and the input pointed at both through
 * `aria-activedescendant`. That is why the input keeps focus the whole time and
 * the highlight moves without it: the arrows are the input's, and the row a
 * screen reader announces is the one the highlight is on. Nothing here should
 * add `tabIndex` to a row, which would break that arrangement into two
 * competing focus models.
 *
 * `lib/keyboard`'s roving group is the other half of that pair and is not
 * interchangeable with it: a roving list is a *real* focus walk through
 * elements that are each focusable, which is what a table of bookings needs and
 * what a combobox must not do. */

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The palette's modal shell.
 *
 * Built on the console's own `Dialog` rather than cmdk's `Command.Dialog`.
 * cmdk's version bundles a second copy of Radix's dialog beside the pinned
 * `radix-ui` package, and it draws its own scrim — so the palette would dim the
 * screen to a different black than every other surface in the console. This
 * spelling reuses `bg-overlay` and inherits the folder's rule that operational
 * surfaces do not animate in.
 *
 * The title and description are present and visually hidden. Radix requires
 * both — it warns without them — and a dialog whose only visible label is a
 * placeholder announces as nothing at all to a screen reader.
 */
function CommandDialog({
  title = "Command palette",
  description = "Search for a command to run.",
  children,
  className,
  showCloseButton = false,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string;
  description?: string;
  className?: string;
  showCloseButton?: boolean;
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn("overflow-hidden p-0", className)}
        showCloseButton={showCloseButton}
      >
        {/* Inside the content, not beside it: Radix points the panel's
         * `aria-labelledby` at this title, and a title rendered outside the
         * portal leaves the reference pointing across the document. */}
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Command>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex h-9 items-center gap-2 border-b px-3"
      cmdk-input-wrapper=""
    >
      <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
      <CommandPrimitive.Input
        data-slot="command-input"
        /* `outline-hidden` is the one place in the console where suppressing
         * the focus ring is correct rather than a lapse. The input holds focus
         * for the whole life of the palette and never gives it up — the ring
         * would sit there permanently, marking the only thing that could be
         * focused, while the amber highlight does the actual work of saying
         * which command Enter would run. */
        className={cn(
          "flex h-10 w-full bg-transparent py-3 text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      /* A ceiling rather than a height, so a palette holding four commands is
       * four rows tall and one holding forty scrolls instead of running off the
       * bottom of the viewport. */
      className={cn(
        "max-h-80 scroll-py-1 overflow-x-hidden overflow-y-auto",
        className,
      )}
      {...props}
    />
  );
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn(
        "py-6 text-center text-sm text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      /* The heading is the caps caption the brand already uses to label a
       * block — `tracking-caps` at the small step, in the muted foreground —
       * rather than a second, palette-only treatment for the same job.
       *
       * It is styled through cmdk's own `[cmdk-group-heading]` attribute
       * because cmdk renders that element itself from the `heading` prop, so
       * there is no component here to hang a class on. */
      className={cn(
        "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:tracking-caps [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      /* The highlight is `data-[selected=true]`, which cmdk sets on the row the
       * arrows are on — not `:focus`, because focus never leaves the input.
       * It is the amber doing the job it is reserved for in the theme: a fill
       * saying where the cursor is, with --ink on top of it. */
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The key hint on the right of a row.
 *
 * Rendered `aria-hidden`: it repeats a fact the row's own label already carries
 * for anyone not looking at it, and read aloud it is a string of punctuation.
 */
function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      aria-hidden="true"
      className={cn(
        "ml-auto text-xs tracking-caps text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
};
