export function ProgressBar({ ratio, indeterminate }: { ratio?: number | null; indeterminate?: boolean }) {
  const pct = Math.round(Math.max(0, Math.min(1, ratio ?? 0)) * 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
      {indeterminate || ratio == null ? (
        <div className="h-full w-1/3 animate-[yoyaku-slide_1.2s_ease-in-out_infinite] rounded-full bg-brand-500" />
      ) : (
        <div className="h-full rounded-full bg-brand-500 transition-[width] duration-300" style={{ width: `${pct}%` }} />
      )}
    </div>
  );
}
