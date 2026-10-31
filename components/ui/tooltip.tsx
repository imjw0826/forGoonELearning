"use client";

import { Tooltip as T } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const TooltipProvider = T.Provider;

/** Wraps a single interactive child with a small label shown on hover/focus. */
export function Tooltip({
  label,
  children,
  side = "top",
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  side?: React.ComponentProps<typeof T.Content>["side"];
}) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-50 origin-(--radix-tooltip-content-transform-origin) rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground",
            "data-[state=closed]:animate-pop-out data-[state=delayed-open]:animate-pop-in",
          )}
        >
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
