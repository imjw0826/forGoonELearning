import type { ExtractStatus, SummaryStatus } from "@/lib/types";

const tone = {
  gray: "bg-zinc-100 text-zinc-600 ring-zinc-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
};

export function Badge({ color, children }: { color: keyof typeof tone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone[color]}`}>{children}</span>;
}

export function LectureBadges({
  hasAudio,
  extract,
  summary,
}: {
  hasAudio: boolean;
  extract: ExtractStatus;
  summary: SummaryStatus;
}) {
  if (!hasAudio) return <Badge color="amber">오디오 없음</Badge>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {extract === "idle" && <Badge color="gray">대본 전</Badge>}
      {extract === "transcribing" && <Badge color="blue">음성 인식 중</Badge>}
      {extract === "correcting" && <Badge color="blue">대본 교정 중</Badge>}
      {extract === "done" && <Badge color="green">대본 ✓</Badge>}
      {(summary === "planning" || summary === "writing") && <Badge color="blue">노트 작성 중</Badge>}
      {summary === "done" && <Badge color="green">강의노트 ✓</Badge>}
    </span>
  );
}
