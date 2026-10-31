"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  Download,
  FileText,
  Loader2,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  RotateCw,
  ScrollText,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input, Label } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/sonner";
import { Tooltip } from "@/components/ui/tooltip";
import { api } from "@/lib/client/api";
import { uploadMaterial, type AudioMode } from "@/lib/client/upload";
import { formatBytes, formatDuration, formatTime } from "@/lib/format";
import type { AudioSegmentView, MediaItem, PipelineState, TranscriptChunk } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAccess } from "./AccessProvider";
import { useConfirm } from "./ConfirmProvider";
import { Highlight } from "./Highlight";
import { LecturePlayer, type PlayerHandle } from "./LecturePlayer";
import { Dropzone, MEDIA_ACCEPT, MODE_OPTIONS, MediaQueueList, useMediaQueue } from "./MediaQueue";
import { NoteView } from "./NoteView";

export interface MaterialView {
  id: string;
  filename: string;
  size: number | null;
  chars: number;
  url: string | null;
}

interface LectureView {
  id: string;
  session_no: number;
  title: string;
  duration_sec: number | null;
  note: string | null;
}

type Chunk = Omit<TranscriptChunk, "lecture_id">;
type Job = "extract" | "summarize";

function isActive(job: Job, s: PipelineState) {
  return job === "extract"
    ? s.extract_status === "transcribing" || s.extract_status === "correcting"
    : s.summary_status === "planning" || s.summary_status === "writing";
}

const isConverting = (s: PipelineState) => s.media.some((m) => m.status === "converting");

/* ------------------------------------------------------------------ */
/* Pipeline: the Railway worker does the work; the page starts jobs and  */
/* polls the saved progress (no code needed just to watch).             */
/* ------------------------------------------------------------------ */

function usePipeline(lectureId: string, initial: PipelineState) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [starting, setStarting] = useState<Job | null>(null);
  const [error, setError] = useState<Partial<Record<Job, string>>>({});
  const stateRef = useRef(state);
  stateRef.current = state;

  // Fresh server data after router.refresh() wins over the last poll.
  useEffect(() => setState(initial), [initial]);

  const active = isActive("extract", state) || isActive("summarize", state) || isConverting(state);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let ticks = 0;
    const timer = setInterval(async () => {
      try {
        const { state: next } = await api<{ state: PipelineState }>(`/api/lectures/${lectureId}`);
        if (cancelled) return;
        const prev = stateRef.current;
        setState(next);
        ticks++;
        const finished =
          (isActive("extract", prev) && !isActive("extract", next)) ||
          (isActive("summarize", prev) && !isActive("summarize", next)) ||
          prev.media.map((m) => m.status).join() !== next.media.map((m) => m.status).join();
        // Refresh server data (chunks / note / playlist) when a stage ends, and every ~9s while correcting/writing.
        if (finished || (next.progress && ticks % 3 === 0)) router.refresh();
      } catch {
        /* transient; try again next tick */
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, lectureId, router]);

  const run = useCallback(
    async (job: Job, restart: boolean) => {
      setStarting(job);
      setError((e) => ({ ...e, [job]: undefined }));
      try {
        const { state: next } = await api<{ state: PipelineState }>(`/api/lectures/${lectureId}/${job}`, {
          body: { restart },
        });
        setState(next);
        router.refresh();
      } catch (err) {
        setError((e) => ({ ...e, [job]: err instanceof Error ? err.message : String(err) }));
      } finally {
        setStarting(null);
      }
    },
    [lectureId, router],
  );

  return { state, busy: starting, error, run };
}

/* ------------------------------------------------------------------ */

export function LectureWorkspace(props: {
  courseId: string;
  courseName: string;
  lecture: LectureView;
  playlist: AudioSegmentView[];
  materials: MaterialView[];
  chunks: Chunk[];
  initialState: PipelineState;
  query: string | null;
}) {
  const { courseId, courseName, lecture, playlist, materials, chunks, query } = props;
  const { guard } = useAccess();
  const confirm = useConfirm();
  const { state, busy, error, run } = usePipeline(lecture.id, props.initialState);
  const player = useRef<PlayerHandle>(null);
  const [tab, setTab] = useState<"note" | "transcript">(lecture.note && !query ? "note" : "transcript");

  useEffect(() => {
    if (state.summary_status === "done" && lecture.note && !query) setTab("note");
  }, [state.summary_status, lecture.note, query]);

  const extractRunning = busy === "extract" || isActive("extract", state);
  const summaryRunning = busy === "summarize" || isActive("summarize", state);
  const anyRunning = extractRunning || summaryRunning;
  const hasAudio = playlist.length > 0;
  const audioTotal = playlist.reduce((s, x) => s + x.duration_sec, 0);
  // The transcript was made from a different set of files than what is there now.
  const stale =
    state.extract_status === "done" && hasAudio && Math.abs(audioTotal - Number(lecture.duration_sec ?? audioTotal)) > 5;

  const confirmRedo = (title: string, description: string, confirmLabel: string) =>
    confirm({ title, description, confirmLabel });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
      <Link
        href={`/courses/${courseId}`}
        className="inline-flex items-center gap-0.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> {courseName}
      </Link>

      <LectureHeader
        courseId={courseId}
        lecture={lecture}
        audioTotal={audioTotal}
        fileCount={state.media.length}
        disabled={anyRunning}
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        {/* Main column */}
        <div className="min-w-0 space-y-4">
          {hasAudio && (
            <Card className="animate-enter px-4 py-3.5 sm:px-5">
              <LecturePlayer ref={player} playlist={playlist} media={state.media} />
            </Card>
          )}

          {stale && (
            <div className="flex animate-enter items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft/70 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <p className="min-w-0 flex-1">
                영상 구성이 바뀌었어요.{" "}
                <span className="text-muted-foreground">다시 추출하면 바뀐 영상까지 대본에 반영돼요.</span>
              </p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <ActionCard
              step={1}
              icon={<Wand2 />}
              title="추출"
              subtitle="Whisper로 대본을 만들고 DeepSeek로 오탈자·문맥을 교정해요"
              status={extractStatusText(state)}
              done={state.extract_status === "done"}
              running={extractRunning}
              progress={state.extract_status === "correcting" ? state.progress : null}
              error={error.extract ?? (!extractRunning ? state.extract_error : null)}
              disabledReason={
                !hasAudio
                  ? "먼저 영상이나 오디오를 올려주세요."
                  : isConverting(state)
                    ? "서버에서 영상을 변환하는 중이에요."
                    : summaryRunning
                      ? "요약이 끝난 뒤 실행할 수 있어요."
                      : null
              }
              primaryLabel={state.extract_status === "done" ? "다시 추출" : "추출"}
              onPrimary={() =>
                guard(async () => {
                  if (
                    state.extract_status === "done" &&
                    !(await confirmRedo("대본을 다시 만들까요?", "지금의 대본과 교정 결과는 새 결과로 바뀌어요.", "다시 추출"))
                  )
                    return;
                  void run("extract", true);
                })
              }
              onResume={isActive("extract", state) ? () => guard(() => void run("extract", false)) : undefined}
            />
            <ActionCard
              step={2}
              icon={<Sparkles />}
              title="요약"
              subtitle="대본과 강의자료로 목차·위계가 있는 강의노트를 만들어요"
              status={summaryStatusText(state)}
              done={state.summary_status === "done"}
              running={summaryRunning}
              progress={state.summary_status === "writing" ? state.progress : null}
              error={error.summarize ?? (!summaryRunning ? state.summary_error : null)}
              disabledReason={state.extract_status !== "done" ? "추출을 먼저 완료해주세요." : null}
              primaryLabel={state.summary_status === "done" ? "다시 요약" : "요약"}
              onPrimary={() =>
                guard(async () => {
                  if (
                    state.summary_status === "done" &&
                    !(await confirmRedo("강의노트를 다시 만들까요?", "지금의 강의노트는 새 노트로 바뀌어요.", "다시 요약"))
                  )
                    return;
                  void run("summarize", true);
                })
              }
              onResume={isActive("summarize", state) ? () => guard(() => void run("summarize", false)) : undefined}
            />
          </div>

          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "note", label: "강의노트", icon: <NotebookPen /> },
              { value: "transcript", label: "대본", icon: <ScrollText /> },
            ]}
          />

          <div key={tab} className="animate-fade-in pt-2">
            {tab === "note" ? (
              lecture.note ? (
                <NoteView note={lecture.note} filename={`${lecture.session_no}회차_${lecture.title}`} />
              ) : (
                <Empty
                  icon={<NotebookPen />}
                  text={summaryRunning ? "강의노트를 작성하고 있어요…" : "아직 강의노트가 없어요. 추출 후 ‘요약’을 눌러주세요."}
                />
              )
            ) : chunks.length ? (
              <TranscriptView chunks={chunks} query={query} onSeek={hasAudio ? (s) => player.current?.seek(s) : undefined} />
            ) : (
              <Empty
                icon={<ScrollText />}
                text={extractRunning ? "음성을 인식하고 있어요…" : "아직 대본이 없어요. ‘추출’을 눌러 대본을 만들어 보세요."}
              />
            )}
          </div>
        </div>

        {/* Side column */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <MediaPanel lectureId={lecture.id} media={state.media} locked={extractRunning} />
          <MaterialsPanel lectureId={lecture.id} materials={materials} disabled={anyRunning} />
        </aside>
      </div>
    </div>
  );
}

function extractStatusText(s: PipelineState) {
  switch (s.extract_status) {
    case "transcribing":
      return "Whisper가 음성을 인식하는 중";
    case "correcting":
      return s.progress ? `DeepSeek 교정 중 · ${s.progress.done}/${s.progress.total} 구간` : "DeepSeek 교정 중";
    case "done":
      return "대본 완료";
    default:
      return "대기 중";
  }
}

function summaryStatusText(s: PipelineState) {
  switch (s.summary_status) {
    case "planning":
      return "강의 흐름을 분석해 목차를 짜는 중";
    case "writing":
      return s.progress ? `섹션별 노트 작성 중 · ${s.progress.done}/${s.progress.total}` : "노트 작성 중";
    case "done":
      return "강의노트 완료";
    default:
      return "대기 중";
  }
}

/* ------------------------------------------------------------------ Header */

function LectureHeader({
  courseId,
  lecture,
  audioTotal,
  fileCount,
  disabled,
}: {
  courseId: string;
  lecture: LectureView;
  audioTotal: number;
  fileCount: number;
  disabled: boolean;
}) {
  const router = useRouter();
  const { guard } = useAccess();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(lecture.title);
  const [sessionNo, setSessionNo] = useState(lecture.session_no);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api(`/api/lectures/${lecture.id}`, { method: "PATCH", body: { title, sessionNo } });
      setEditing(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `${lecture.session_no}회차를 삭제할까요?`,
      description: "영상, 대본, 강의노트, 강의자료가 모두 삭제되고 되돌릴 수 없어요.",
      confirmLabel: "강의 삭제",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/api/lectures/${lecture.id}`, { method: "DELETE" });
      router.push(`/courses/${courseId}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="mt-4 flex animate-enter items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-brand tabular">{lecture.session_no}회차</p>
        <h1 className="mt-1 text-3xl">{lecture.title}</h1>
        {(audioTotal > 0 || fileCount > 1) && (
          <p className="mt-2 text-xs text-muted-foreground tabular">
            {audioTotal > 0 && formatDuration(audioTotal)}
            {audioTotal > 0 && fileCount > 1 && " · "}
            {fileCount > 1 && `영상 ${fileCount}개`}
          </p>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label="강의 메뉴">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => guard(() => (setTitle(lecture.title), setSessionNo(lecture.session_no), setEditing(true)))}
          >
            <Pencil /> 제목·회차 수정
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={disabled} onSelect={() => guard(remove)}>
            <Trash2 /> 강의 삭제
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <form onSubmit={save}>
            <DialogTitle>강의 정보 수정</DialogTitle>
            <div className="mt-5 grid grid-cols-[5.5rem_1fr] gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-session">회차</Label>
                <Input
                  id="edit-session"
                  type="number"
                  min={1}
                  value={sessionNo}
                  onChange={(e) => setSessionNo(Number(e.target.value))}
                  className="tabular"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-title">제목</Label>
                <Input id="edit-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                취소
              </Button>
              <Button type="submit">저장</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ Files */

const MEDIA_STATUS: Record<MediaItem["status"], { label: string; variant: "brand" | "success" | "destructive" | "outline" }> = {
  pending: { label: "업로드 대기", variant: "outline" },
  uploading: { label: "업로드 중", variant: "brand" },
  converting: { label: "서버 변환 중", variant: "brand" },
  ready: { label: "준비됨", variant: "success" },
  error: { label: "실패", variant: "destructive" },
};

function MediaPanel({ lectureId, media, locked }: { lectureId: string; media: MediaItem[]; locked: boolean }) {
  const router = useRouter();
  const { guard, unlocked } = useAccess();
  const confirm = useConfirm();
  const queue = useMediaQueue();
  const [mode, setMode] = useState<AudioMode>("auto");

  // Upload newly added files right away (one at a time, in order).
  const queued = queue.items.filter((it) => it.status === "queued");
  useEffect(() => {
    if (queue.running || !queued.length) return;
    void queue.run(lectureId, mode, queued).then((failed) => {
      router.refresh();
      if (!failed) setTimeout(() => queue.clear(), 1500);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued.length, queue.running]);

  const move = async (m: MediaItem, dir: "up" | "down") => {
    try {
      await api(`/api/lectures/${lectureId}/media/${m.id}`, { method: "PATCH", body: { move: dir } });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (m: MediaItem) => {
    const ok = await confirm({
      title: `‘${m.filename}’을(를) 삭제할까요?`,
      description: "이 영상에서 추출한 오디오도 함께 삭제돼요. 대본에 반영하려면 다시 추출해야 해요.",
      confirmLabel: "삭제",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/api/lectures/${lectureId}/media/${m.id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Card className="animate-enter">
      <CardHeader className="pb-2">
        <div className="min-w-0 flex-1">
          <CardTitle>영상</CardTitle>
          <CardDescription>순서대로 이어서 한 강의가 돼요</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {media.length > 0 && (
          <ol className="-mx-2">
            {media.map((m, i) => {
              const st = MEDIA_STATUS[m.status];
              return (
                <li key={m.id} className="group flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-2xs font-medium text-muted-foreground tabular">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium" title={m.filename}>
                      {m.filename}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-muted-foreground tabular">
                      {m.status === "ready" ? (
                        <span>{formatDuration(Number(m.duration_sec ?? 0)) || "길이 정보 없음"}</span>
                      ) : (
                        <Badge
                          variant={st.variant}
                          dot={m.status !== "error"}
                          pulse={m.status === "converting" || m.status === "uploading"}
                        >
                          {st.label}
                        </Badge>
                      )}
                      {m.size_bytes ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>{formatBytes(m.size_bytes)}</span>
                        </>
                      ) : null}
                    </div>
                    {m.error && <p className="mt-1 text-2xs leading-4 text-destructive">{m.error}</p>}
                  </div>
                  {unlocked && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="opacity-60 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                          aria-label="영상 메뉴"
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={locked || i === 0} onSelect={() => move(m, "up")}>
                          <ArrowUp /> 위로
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={locked || i === media.length - 1} onSelect={() => move(m, "down")}>
                          <ArrowDown /> 아래로
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" disabled={locked} onSelect={() => remove(m)}>
                          <Trash2 /> 삭제
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        <MediaQueueList items={queue.items} onRemove={queue.remove} onMove={queue.move} locked />

        <Dropzone
          onFiles={queue.add}
          accept={MEDIA_ACCEPT}
          title={media.length ? "영상 추가" : "영상이나 오디오 올리기"}
          hint="끌어 놓거나 클릭, 여러 개 가능"
          compact
          disabled={locked}
          onBeforeOpen={() => {
            let allowed = false;
            guard(() => (allowed = true));
            return allowed;
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-2xs text-muted-foreground">음성 추출 위치</span>
          <Segmented value={mode} onChange={setMode} options={MODE_OPTIONS} disabled={queue.running} />
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ Materials */

function MaterialsPanel({ lectureId, materials, disabled }: { lectureId: string; materials: MaterialView[]; disabled: boolean }) {
  const router = useRouter();
  const { guard, unlocked } = useAccess();
  const confirm = useConfirm();
  const [uploading, setUploading] = useState<string | null>(null);

  const add = async (files: File[]) => {
    try {
      for (const f of files) {
        setUploading(f.name);
        const res = await uploadMaterial(lectureId, f);
        if (res.warning) toast.warning(f.name, { description: res.warning });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(null);
      router.refresh();
    }
  };

  const remove = async (m: MaterialView) => {
    if (!(await confirm({ title: `‘${m.filename}’을(를) 삭제할까요?`, confirmLabel: "삭제", destructive: true }))) return;
    try {
      await api(`/api/lectures/${lectureId}/materials/${m.id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Card className="animate-enter [animation-delay:40ms]">
      <CardHeader className="pb-2">
        <div>
          <CardTitle>강의자료</CardTitle>
          <CardDescription>스캔 PDF도 추출·요약 때 자동으로 읽어요</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {materials.length > 0 && (
          <ul className="-mx-2">
            {materials.map((m) => (
              <li key={m.id} className="group flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium" title={m.filename}>
                    {m.filename}
                  </span>
                  <span className="block text-2xs text-muted-foreground tabular">
                    {m.size ? formatBytes(m.size) : ""}
                    {m.chars
                      ? ` · ${m.chars.toLocaleString()}자`
                      : m.filename.toLowerCase().endsWith(".pdf")
                        ? " · 요약 때 OCR"
                        : " · 텍스트 없음"}
                  </span>
                </span>
                {m.url && (
                  <Tooltip label="다운로드">
                    <Button variant="ghost" size="icon-xs" asChild>
                      <a href={m.url} aria-label="다운로드">
                        <Download />
                      </a>
                    </Button>
                  </Tooltip>
                )}
                {unlocked && (
                  <Tooltip label="삭제">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      disabled={disabled}
                      onClick={() => remove(m)}
                      className="hover:text-destructive"
                      aria-label="삭제"
                    >
                      <Trash2 />
                    </Button>
                  </Tooltip>
                )}
              </li>
            ))}
          </ul>
        )}
        {uploading && (
          <p className="flex animate-fade-in items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> {uploading}
          </p>
        )}
        <Dropzone
          onFiles={(files) => void add(files)}
          accept=".pdf,.pptx,.docx,.txt,.md"
          title="자료 추가"
          hint="PDF · PPTX · DOCX · TXT"
          compact
          disabled={!!uploading}
          onBeforeOpen={() => {
            let allowed = false;
            guard(() => (allowed = true));
            return allowed;
          }}
        />
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ Actions */

function ActionCard(props: {
  step: number;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  status: string;
  done: boolean;
  running: boolean;
  progress: { done: number; total: number } | null;
  error: string | null;
  disabledReason: string | null;
  primaryLabel: string;
  onPrimary: () => void;
  onResume?: () => void;
}) {
  const { running, progress, done } = props;
  return (
    <Card
      className={cn(
        "animate-enter p-4 transition-[border-color,background-color] duration-300",
        done && !running && "border-success/25 bg-success-soft/25",
        running && "border-brand/30",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-300",
            done && !running
              ? "bg-success text-white"
              : running
                ? "bg-brand text-brand-foreground"
                : "bg-secondary text-muted-foreground",
          )}
        >
          {running ? <Loader2 className="size-3.5 animate-spin" /> : done ? <Check className="size-3.5" /> : props.step}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] leading-7">{props.title}</h3>
          <p className="text-xs leading-5 text-muted-foreground">{props.subtitle}</p>
        </div>
        <Button onClick={props.onPrimary} disabled={running || !!props.disabledReason} variant={done ? "outline" : "default"} size="sm">
          {done && !running ? <RotateCw /> : props.icon}
          {running ? "진행 중" : props.primaryLabel}
        </Button>
      </div>

      <div className="mt-3 pl-10">
        <p className="text-[13px] text-muted-foreground tabular">
          {props.disabledReason && !done && !running ? props.disabledReason : props.status}
        </p>
        {running && (
          <>
            <Progress value={progress && progress.total ? progress.done / progress.total : null} className="mt-2" />
            <p className="mt-1.5 text-2xs text-muted-foreground">서버에서 진행되니 이 페이지를 닫아도 계속돼요.</p>
          </>
        )}
        {props.error && (
          <div className="mt-2 animate-fade-in rounded-lg bg-destructive-soft px-3 py-2 text-xs leading-5 text-destructive">
            <p className="break-words">{props.error}</p>
            {props.onResume && (
              <button onClick={props.onResume} className="mt-1 font-medium underline underline-offset-2">
                이어서 다시 시도
              </button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ Tabs */

function Tabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: string; icon: React.ReactNode }[];
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const el = refs.current[value];
    if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value]);

  return (
    <div role="tablist" className="relative mt-4 flex gap-1 border-b">
      {tabs.map((t) => (
        <button
          key={t.value}
          ref={(el) => {
            refs.current[t.value] = el;
          }}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 pt-1 pb-2.5 text-sm font-medium transition-colors duration-150 [&_svg]:size-4",
            value === t.value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
      {indicator && (
        <span
          aria-hidden
          className="absolute -bottom-px h-0.5 rounded-full bg-foreground transition-[left,width] duration-300 ease-[var(--ease-out)]"
          style={indicator}
        />
      )}
    </div>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex animate-enter flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-secondary text-muted-foreground [&_svg]:size-[18px]">
        {icon}
      </span>
      <p className="mt-3 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ Transcript */

function TranscriptView({ chunks, query, onSeek }: { chunks: Chunk[]; query: string | null; onSeek?: (sec: number) => void }) {
  const [showRaw, setShowRaw] = useState(false);
  const corrected = chunks.filter((c) => c.corrected_text).length;
  const firstHit = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query) firstHit.current?.scrollIntoView({ block: "center" });
  }, [query]);

  let hitAssigned = false;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground tabular">
          {corrected === chunks.length ? "DeepSeek 교정 완료" : `교정 ${corrected}/${chunks.length} 구간`}
          {onSeek && " · 시간을 누르면 그 위치부터 재생돼요"}
        </p>
        <Segmented
          value={showRaw ? "raw" : "corrected"}
          onChange={(v) => setShowRaw(v === "raw")}
          options={[
            { value: "corrected", label: "교정본" },
            { value: "raw", label: "Whisper 원문" },
          ]}
        />
      </div>
      <div className="space-y-6">
        {chunks.map((c) => {
          const text = showRaw ? c.raw_text : c.corrected_text ?? c.raw_text;
          const pending = !showRaw && !c.corrected_text;
          const isHit = !!query && !hitAssigned && text.toLowerCase().includes(query.toLowerCase());
          if (isHit) hitAssigned = true;
          return (
            <div key={c.idx} ref={isHit ? firstHit : undefined} className="grid grid-cols-[3.75rem_1fr] gap-4">
              <button
                onClick={() => c.start_sec != null && onSeek?.(Number(c.start_sec))}
                disabled={!onSeek || c.start_sec == null}
                className="h-fit rounded-md px-1.5 py-0.5 text-left font-mono text-xs text-brand transition-colors hover:bg-brand-soft disabled:text-muted-foreground disabled:hover:bg-transparent"
              >
                {formatTime(c.start_sec) || `#${c.idx + 1}`}
              </button>
              <div className={cn("reading space-y-3 transition-colors duration-500", pending && "text-muted-foreground")}>
                {text.split(/\n{2,}/).map((p, i) => (
                  <p key={i}>
                    <Highlight text={p} query={query} />
                  </p>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
