"use client";

import type * as React from "react";

import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface DetailSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  contentClassName?: string;
}

function DetailSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  contentClassName,
}: DetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={contentClassName}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description === undefined ? null : (
            <SheetDescription>{description}</SheetDescription>
          )}
        </SheetHeader>
        <SheetBody>{children}</SheetBody>
        {footer === undefined ? null : <SheetFooter>{footer}</SheetFooter>}
      </SheetContent>
    </Sheet>
  );
}

export { DetailSheet, type DetailSheetProps };
