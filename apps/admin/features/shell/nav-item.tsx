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
  hint: string;
}

export function NavItem({ item, icon: Icon, active, hint }: NavItemProps) {
  const roving = useRovingFocusItem(item.id);

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={`${item.label}, shortcut ${hint}`}
      title={`${item.label} · ${hint}`}
      className={cn(
        "group/nav-item relative flex min-h-11 items-center justify-center gap-3 rounded-md px-2 text-sm font-medium transition-colors duration-150 ease-ui xl:justify-start xl:px-3",
        active
          ? // The marker is the brand amber itself rather than `accent`, which
            // is the pale tint shadcn's controls hover on: a 2px rule in that
            // colour against the rail's own sand would be a marker only
            // somebody told where to look could find.
            "bg-nav-raised text-nav-text shadow-xs before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-accent-mark"
          : "text-nav-muted hover:bg-nav-raised hover:text-nav-text",
      )}
      {...roving}
    >
      <Icon
        aria-hidden="true"
        className="size-[18px] shrink-0"
        strokeWidth={1.8}
      />
      <span className="hidden min-w-0 flex-1 truncate xl:block">
        {item.label}
      </span>
      <kbd
        className={cn(
          "hidden text-sm text-nav-muted  opacity-0 transition-opacity duration-150 ease-ui group-hover/nav-item:opacity-100 group-focus-visible/nav-item:opacity-100 xl:block",
          active && "opacity-100",
        )}
      >
        {hint}
      </kbd>
    </Link>
  );
}
