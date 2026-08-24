import type * as React from "react";

import { Badge } from "@/components/ui/badge";

type StatusTone =
  | "neutral"
  | "success"
  | "warning"
  | "info"
  | "danger"
  | "accent";

interface StatusChipProps
  extends Omit<React.ComponentProps<typeof Badge>, "variant"> {
  tone?: StatusTone;
}

function StatusChip({ tone = "neutral", ...props }: StatusChipProps) {
  return <Badge data-slot="status-chip" variant={tone} {...props} />;
}

export { StatusChip, type StatusChipProps, type StatusTone };
