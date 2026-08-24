import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type * as React from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  href: string;
  action: string;
  icon?: LucideIcon;
  className?: string;
  busy?: boolean;
}

function StatCard({
  label,
  value,
  href,
  action,
  icon: Icon,
  className,
  busy,
}: StatCardProps) {
  return (
    <Card
      className={cn(
        "transition-[box-shadow,transform] duration-200 ease-ui hover:-translate-y-0.5 hover:shadow-raised active:translate-y-px",
        className,
      )}
    >
      <Link
        href={href}
        aria-busy={busy || undefined}
        className="grid min-h-32 grid-cols-[auto_1fr] grid-rows-[auto_1fr_auto] gap-x-3 gap-y-1 rounded-lg p-4"
      >
        {Icon === undefined ? null : (
          <span className="row-span-2 inline-grid size-9 place-items-center rounded-md bg-accent-soft text-accent-strong">
            <Icon className="size-4" strokeWidth={1.8} />
          </span>
        )}
        <strong className="text-3xl font-semibold leading-9 tabular-nums">
          {value}
        </strong>
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="col-span-2 mt-2 flex items-center justify-between border-border border-t pt-2 text-sm font-semibold">
          {action}
          <span aria-hidden="true">→</span>
        </span>
      </Link>
    </Card>
  );
}

export { StatCard, type StatCardProps };
