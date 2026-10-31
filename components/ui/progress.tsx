import { cn } from "@/lib/utils";

/** Determinate when `value` is 0..1, indeterminate when null/undefined. */
export function Progress({ value, className }: { value?: number | null; className?: string }) {
  const pct = value == null ? null : Math.round(Math.max(0, Math.min(1, value)) * 1000) / 10;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-secondary", className)}
    >
      {pct == null ? (
        <div className="absolute inset-y-0 w-2/5 animate-indeterminate rounded-full bg-brand" />
      ) : (
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-500 ease-[var(--ease-out)]"
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  );
}
