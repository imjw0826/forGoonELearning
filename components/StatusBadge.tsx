import { Badge } from "@/components/ui/badge";
import type { ExtractStatus, SummaryStatus } from "@/lib/types";

export function LectureBadges({
  hasAudio,
  busy,
  extract,
  summary,
}: {
  hasAudio: boolean;
  busy?: boolean;
  extract: ExtractStatus;
  summary: SummaryStatus;
}) {
  if (busy) {
    return (
      <Badge variant="brand" dot pulse>
        영상 변환 중
      </Badge>
    );
  }
  if (!hasAudio) return <Badge variant="warning">영상 없음</Badge>;
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {extract === "idle" && <Badge variant="outline">대본 전</Badge>}
      {extract === "transcribing" && (
        <Badge variant="brand" dot pulse>
          음성 인식
        </Badge>
      )}
      {extract === "correcting" && (
        <Badge variant="brand" dot pulse>
          대본 교정
        </Badge>
      )}
      {extract === "done" && summary === "idle" && <Badge variant="secondary">대본</Badge>}
      {(summary === "planning" || summary === "writing") && (
        <Badge variant="brand" dot pulse>
          노트 작성
        </Badge>
      )}
      {summary === "done" && (
        <Badge variant="success" dot>
          강의노트
        </Badge>
      )}
    </span>
  );
}
