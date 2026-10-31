"use client";

import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "!rounded-lg !border !border-border !bg-popover !text-popover-foreground !shadow-lg !shadow-black/5 !font-sans !text-sm",
          description: "!text-muted-foreground !text-xs",
        },
      }}
    />
  );
}

export { toast } from "sonner";
