"use client";

import { ChevronLeft, FileText, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/client/api";
import { uploadMaterial, type AudioMode } from "@/lib/client/upload";
import { formatBytes } from "@/lib/format";
import { useAccess } from "./AccessProvider";
import { Dropzone, MEDIA_ACCEPT, MODE_OPTIONS, MediaQueueList, useMediaQueue } from "./MediaQueue";

const MATERIAL_ACCEPT = ".pdf,.pptx,.docx,.txt,.md";

export function NewLectureForm({ courseId, courseName, nextSessionNo }: { courseId: string; courseName: string; nextSessionNo: number }) {
  const router = useRouter();
  const { guard } = useAccess();
  const queue = useMediaQueue();
  const [sessionNo, setSessionNo] = useState(nextSessionNo);
  const [title, setTitle] = useState("");
  const [materials, setMaterials] = useState<File[]>([]);
  const [mode, setMode] = useState<AudioMode>("auto");
  const [lectureId, setLectureId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "media" | "materials">("idle");
  const [failed, setFailed] = useState(0);

  const running = phase !== "idle";
  const totalBytes = queue.items.reduce((s, it) => s + it.file.size, 0);

  // Warn before closing the tab while converting/uploading.
  useEffect(() => {
    if (!running) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [running]);

  const run = async () => {
    if (!queue.items.length) return;
    setFailed(0);
    let id = lectureId;
    try {
      if (!id) {
        const { lecture } = await api<{ lecture: { id: string } }>("/api/lectures", {
          body: { courseId, sessionNo, title: title.trim() || undefined, sourceFilename: queue.items[0].file.name },
        });
        id = lecture.id;
        setLectureId(id);
      }

      setPhase("media");
      const failedCount = await queue.run(id, mode, queue.items);

      if (materials.length) {
        setPhase("materials");
        const pending = [...materials];
        for (const f of pending) {
          try {
            const res = await uploadMaterial(id, f);
            if (res.warning) toast.warning(f.name, { description: res.warning });
            setMaterials((m) => m.filter((x) => x !== f));
          } catch (err) {
            toast.error(`${f.name} 업로드 실패`, { description: err instanceof Error ? err.message : String(err) });
          }
        }
      }

      setFailed(failedCount);
      if (failedCount === 0) {
        router.push(`/courses/${courseId}/lectures/${id}`);
        router.refresh();
        return;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
    setPhase("idle");
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-28 sm:px-8 sm:py-10">
      <Link
        href={`/courses/${courseId}`}
        className="inline-flex items-center gap-0.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> {courseName}
      </Link>
      <h1 className="mt-3 animate-enter text-2xl">강의 추가</h1>
      <p className="mt-1 animate-enter text-sm text-muted-foreground">
        영상에서 음성만 뽑아 저장하고, 대본 추출과 요약은 서버에서 진행돼요. 한 강의가 여러 영상으로 나뉘어 있으면 모두
        올려 주세요.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          guard(run);
        }}
        className="mt-8 space-y-5"
      >
        <Card className="animate-enter">
          <CardHeader>
            <CardTitle>기본 정보</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-[5.5rem_1fr] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="session">회차</Label>
              <Input
                id="session"
                type="number"
                min={1}
                value={sessionNo}
                disabled={!!lectureId}
                onChange={(e) => setSessionNo(Number(e.target.value))}
                className="tabular"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="title">제목</Label>
              <Input
                id="title"
                value={title}
                disabled={!!lectureId}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`${sessionNo}회차 강의`}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="animate-enter [animation-delay:40ms]">
          <CardHeader className="flex-wrap justify-between">
            <div>
              <CardTitle>영상 · 오디오</CardTitle>
              <CardDescription>여러 파일은 이 순서대로 이어서 한 강의가 돼요. 크기 제한은 없어요.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">변환</span>
              <Segmented value={mode} onChange={setMode} options={MODE_OPTIONS} disabled={running} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Dropzone
              onFiles={queue.add}
              accept={MEDIA_ACCEPT}
              title="영상이나 오디오를 끌어 놓거나 클릭해서 선택"
              hint="MP4 · MOV · MKV · WEBM · MP3 · M4A · WAV, 여러 개 선택 가능"
              compact={queue.items.length > 0}
              disabled={running}
            />
            <MediaQueueList items={queue.items} onRemove={queue.remove} onMove={queue.move} locked={running || !!lectureId} />
            <p className="text-xs leading-5 text-muted-foreground">
              자동: 512MB 미만은 이 브라우저에서, 그 이상은 서버에서 음성을 추출해요. 한쪽이 실패하면 다른 쪽으로 다시
              시도해요.
            </p>
          </CardContent>
        </Card>

        <Card className="animate-enter [animation-delay:80ms]">
          <CardHeader>
            <div>
              <CardTitle>
                강의자료 <span className="font-normal text-muted-foreground">(선택)</span>
              </CardTitle>
              <CardDescription>PDF · PPTX · DOCX · TXT. 교정과 요약에 함께 사용돼요.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Dropzone
              onFiles={(files) => setMaterials((m) => [...m, ...files])}
              accept={MATERIAL_ACCEPT}
              title="강의자료 추가"
              compact
              disabled={running}
            />
            {materials.length > 0 && (
              <ul className="divide-y rounded-xl border">
                {materials.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex animate-enter items-center gap-3 px-3.5 py-2.5">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                    <span className="text-xs text-muted-foreground tabular">{formatBytes(f.size)}</span>
                    {!running && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setMaterials((m) => m.filter((_, j) => j !== i))}
                        aria-label="자료 빼기"
                      >
                        <X />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Sticky action bar */}
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/85 backdrop-blur-md md:left-60">
          <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3 sm:px-8">
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular">
              {phase === "media"
                ? "영상 처리 중 · 끝날 때까지 이 탭을 닫지 마세요"
                : phase === "materials"
                  ? "강의자료 올리는 중"
                  : failed > 0
                    ? `${failed}개 파일이 실패했어요. 다시 시도하거나 강의 페이지에서 추가할 수 있어요.`
                    : queue.items.length
                      ? `영상 ${queue.items.length}개 · ${formatBytes(totalBytes)}${materials.length ? ` · 자료 ${materials.length}개` : ""}`
                      : "영상이나 오디오를 하나 이상 추가하세요"}
            </p>
            {lectureId && !running && (
              <Button type="button" variant="ghost" asChild>
                <Link href={`/courses/${courseId}/lectures/${lectureId}`}>강의로 이동</Link>
              </Button>
            )}
            <Button type="submit" disabled={!queue.items.length || running}>
              {running && <Loader2 className="animate-spin" />}
              {running ? "처리 중" : failed > 0 ? "실패한 파일 다시 시도" : "업로드"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
