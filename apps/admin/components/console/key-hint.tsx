import type * as React from "react";

import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

function KeyHint({ className, ...props }: React.ComponentProps<typeof Kbd>) {
  return <Kbd className={cn("shrink-0", className)} {...props} />;
}

export { KeyHint };
