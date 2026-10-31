"use client";

import { cn } from "@/lib/utils";

/** A compact single-choice control (shadcn "tabs" look) for small option sets. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  disabled,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cn("inline-flex rounded-lg bg-secondary p-0.5", disabled && "opacity-60", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-[background-color,color,box-shadow] duration-150",
            o.value === value ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
