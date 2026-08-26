"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { useRovingFocusItem } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

import type { NavItem as NavItemData } from "./nav-inventory";

export interface NavItemProps {
  item: NavItemData;
  icon: LucideIcon;
  active: boolean;
  onSelect?(): void;
}

export function NavItem({ item, icon: Icon, active, onSelect }: NavItemProps) {
  const roving = useRovingFocusItem(item.id);

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/nav-item relative flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-200 ease-ui active:translate-y-px",
        active
          ? "bg-primary text-primary-foreground shadow-xs before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-accent-mark"
          : "text-nav-muted hover:-translate-y-px hover:bg-nav-raised hover:text-nav-text",
      )}
      onClick={onSelect}
      {...roving}
    >
      <Icon
        aria-hidden="true"
        className={cn("size-[18px] shrink-0", active && "text-accent-mark")}
        strokeWidth={1.8}
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </Link>
  );
}
