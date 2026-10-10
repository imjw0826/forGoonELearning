"use client";

import {
  ArrowLeft,
  Check,
  Download,
  FileText,
  Loader2,
  NotebookPen,
  Paperclip,
  Pencil,
  RotateCw,
  ScrollText,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { processAndUploadAudio, uploadMaterial } from "@/lib/client/upload";
import { formatBytes, formatTime } from "@/lib/format";
import type { PipelineState, TranscriptChunk } from "@/lib/types";
import { useAccess } from "./AccessProvider";
import { Highlight } from "./Highlight";
import { NoteView } from "./NoteView";
import { ProgressBar } from "./ProgressBar";

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
  source_filename: string | null;
  duration_sec: number | null;
  note: string | null;
  hasAudio: boolean;
}

type Chunk = Omit<TranscriptChunk, "lecture_id">;
type Job = "extract" | "summarize";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isActive(job: Job, s: PipelineState) {
  return job === "extract"
    ? s.extract_status === "transcribing" || s.extract_status === "correcting"
    : s.summary_status === "planning" || s.summary_status === "writing";
}

/* ------------------------------------------------------------------ */
/* Pipeline runner: calls the step endpoint in a loop until the job ends */
/* ------------------------------------------------------------------ */

function usePipeline(lectureId: string, initial: PipelineState) {
  const router = useRouter();
  const { unlocked } = useAccess();
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState<Job | null>(null);
  const [error, setError] = useState<Partial<Record<Job, string>>>({});
  const alive = useRef(true);
  const runningRef = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(
    async (job: Job, start: boolean) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setBusy(job);
      setError((e) => ({ ...e, [job]: undefined }));
      const url = `/api/lectures/${lectureId}/${job}`;
      try {
        let s: PipelineState;
        if (start) {
          s = (await api<{ state: PipelineState }>(url, { body: { action: "start" } })).state;
          setState(s);
          router.refresh();
        }
        while (alive.current) {
          s = (await api<{ state: PipelineState }>(url, { body: { action: "step" } })).state;
          if (!alive.current) break;
          setState(s);
          if (!isActive(job, s)) break;
          if (s.extract_status === "transcribing") await sleep(5000);
          else router.refresh(); // show newly corrected chunks / sections as they land
        }
        if (alive.current) {
          const latest = (await api<{ state: PipelineState }>(`/api/lectures/${lectureId}`)).state;
          setState(latest);
          const failed = job === "extract" ? latest.extract_error : latest.summary_error;
          if (failed && !isActive(job, latest)) setError((e) => ({ ...e, [job]: failed }));
        }
      } catch (err) {
        if (alive.current) setError((e) => ({ ...e, [job]: err instanceof Error ? err.message : String(err) }));
      } finally {
        runningRef.current = false;
        if (alive.current) {
          setBusy(null);
          router.refresh();
        }
      }
    },
    [lectureId, router],
  );

  // Resume a job that was in progress when the page was (re)opened.
  useEffect(() => {
    if (!unlocked || runningRef.current) return;
    if (isActive("extract", state)) void run("extract", false);
    else if (isActive("summarize", state)) void run("summarize", false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  return { state, busy, error, run };
}

/* ------------------------------------------------------------------ */

export function LectureWorkspace(props: {
  courseId: string;
  courseName: string;
  lecture: LectureView;
  audioUrl: string | null;
  materials: MaterialView[];
  chunks: Chunk[];
  initialState: PipelineState;
  query: string | null;
}) {
  const { courseId, courseName, lecture, audioUrl, materials, chunks, query } = props;
  const { guard, unlocked } = useAccess();
  const { state, busy, error, run } = usePipeline(lecture.id, props.initialState);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [tab, setTab] = useState<"note" | "transcript">(lecture.note && !query ? "note" : "transcript");

  useEffect(() => {
    if (state.summary_status === "done" && lecture.note && !query) setTab("note");
  }, [state.summary_status, lecture.note, query]);

  const seek = (sec: number | null) => {
    const el = audioRef.current;
    if (!el || sec == null) return;
    el.currentTime = sec;
    void el.play();
  };

  const extractRunning = busy === "extract" || isActive("extract", state);
  const summaryRunning = busy === "summarize" || isActive("summarize", state);
  const anyRunning = extractRunning || summaryRunning;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
      <Link href={`/courses/${courseId}`} className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="h-4 w-4" /> {courseName}
      </Link>

      <LectureHeader courseId={courseId} lecture={lecture} disabled={anyRunning} />

      {/* Audio + materials */}
      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_20rem]">
        <section className="rounded-2xl border border-zinc-200 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-700">오디오</h2>
          {lecture.hasAudio && audioUrl ? (
            <>
              <audio ref={audioRef} src={audioUrl} controls preload="metadata" className="w-full" />
              <p className="mt-2 truncate text-xs text-zinc-400">
                원본: {lecture.source_filename ?? "-"}
                {lecture.duration_sec ? ` · ${formatTime(lecture.duration_sec)}` : ""}
              </p>
            </>
          ) : (
            <AudioUploader lectureId={lecture.id} />
          )}
        </section>
        <MaterialsPanel lectureId={lecture.id} materials={materials} disabled={anyRunning} />
      </div>

      {/* Actions: 추출 → 요약 */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <ActionCard
          step={1}
          icon={<Wand2 className="h-4 w-4" />}
          title="추출"
          subtitle="Whisper로 대본 생성 → DeepSeek로 오탈자·문맥 교정"
          status={extractStatusText(state)}
          done={state.extract_status === "done"}
          running={extractRunning}
          progress={state.extract_status === "correcting" ? state.progress : null}
          error={error.extract ?? (!extractRunning ? state.extract_error : null)}
          disabledReason={!lecture.hasAudio ? "먼저 오디오를 업로드하세요." : summaryRunning ? "요약이 끝난 뒤 실행할 수 있어요." : null}
          primaryLabel={state.extract_status === "done" ? "다시 추출" : "추출"}
          onPrimary={() =>
            guard(() => {
              if (state.extract_status === "done" && !confirm("대본을 처음부터 다시 만들까요? 기존 대본은 덮어씁니다.")) return;
              void run("extract", true);
            })
          }
          onResume={isActive("extract", state) ? () => guard(() => void run("extract", false)) : undefined}
          locked={!unlocked}
        />
        <ActionCard
          step={2}
          icon={<Sparkles className="h-4 w-4" />}
          title="요약"
          subtitle="대본 + 강의자료로 목차·위계 구조의 강의노트 생성"
          status={summaryStatusText(state)}
          done={state.summary_status === "done"}
          running={summaryRunning}
          progress={state.summary_status === "writing" ? state.progress : null}
          error={error.summarize ?? (!summaryRunning ? state.summary_error : null)}
          disabledReason={state.extract_status !== "done" ? "추출(대본 생성)을 먼저 완료하세요." : null}
          primaryLabel={state.summary_status === "done" ? "다시 요약" : "요약"}
          onPrimary={() =>
            guard(() => {
              if (state.summary_status === "done" && !confirm("강의노트를 다시 만들까요? 기존 노트는 덮어씁니다.")) return;
              void run("summarize", true);
            })
          }
          onResume={isActive("summarize", state) ? () => guard(() => void run("summarize", false)) : undefined}
          locked={!unlocked}
        />
      </div>

      {/* Tabs */}
      <div className="mt-8 flex gap-1 border-b border-zinc-200">
        <TabButton active={tab === "note"} onClick={() => setTab("note")} icon={<NotebookPen className="h-4 w-4" />}>
          강의노트
        </TabButton>
        <TabButton active={tab === "transcript"} onClick={() => setTab("transcript")} icon={<ScrollText className="h-4 w-4" />}>
          대본
        </TabButton>
      </div>

      <div className="py-6">
        {tab === "note" ? (
          lecture.note ? (
            <NoteView note={lecture.note} filename={`${lecture.session_no}회차_${lecture.title}`} />
          ) : (
            <Empty icon={<NotebookPen className="h-7 w-7" />} text={summaryRunning ? "강의노트를 작성하고 있어요…" : "아직 강의노트가 없어요. 추출 후 ‘요약’을 눌러주세요."} />
          )
        ) : chunks.length ? (
          <TranscriptView chunks={chunks} query={query} onSeek={audioUrl ? seek : undefined} />
        ) : (
          <Empty icon={<ScrollText className="h-7 w-7" />} text={extractRunning ? "음성을 인식하고 있어요…" : "아직 대본이 없어요. ‘추출’을 눌러 대본을 만들어 보세요."} />
        )}
      </div>
    </div>
  );
}

function extractStatusText(s: PipelineState) {
  switch (s.extract_status) {
    case "transcribing":
      return "Whisper 음성 인식 중… (1시간 강의 기준 수 분)";
    case "correcting":
      return s.progress ? `DeepSeek 대본 교정 중 · ${s.progress.done}/${s.progress.total} 구간` : "DeepSeek 대본 교정 중…";
    case "done":
      return "대본 완료";
    default:
      return "대기 중";
  }
}

function summaryStatusText(s: PipelineState) {
  switch (s.summary_status) {
    case "planning":
      return "강의 흐름을 분석해 목차를 짜는 중…";
    case "writing":
      return s.progress ? `섹션별 강의노트 작성 중 · ${s.progress.done}/${s.progress.total}` : "강의노트 작성 중…";
    case "done":
      return "강의노트 완료";
    default:
      return "대기 중";
  }
}

/* ------------------------------------------------------------------ */

function LectureHeader({ courseId, lecture, disabled }: { courseId: string; lecture: LectureView; disabled: boolean }) {
  const router = useRouter();
  const { guard } = useAccess();
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
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async () => {
    if (!confirm(`${lecture.session_no}회차 ‘${lecture.title}’을(를) 삭제할까요? 오디오·대본·노트가 모두 삭제됩니다.`)) return;
    try {
      await api(`/api/lectures/${lecture.id}`, { method: "DELETE" });
      router.push(`/courses/${courseId}`);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  if (editing) {
    return (
      <form onSubmit={save} className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={1}
          value={sessionNo}
          onChange={(e) => setSessionNo(Number(e.target.value))}
          className="w-20 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
          aria-label="회차"
        />
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1.5 text-lg font-semibold"
          aria-label="제목"
        />
        <button type="submit" className="rounded-md bg-brand-600 p-2 text-white" aria-label="저장">
          <Check className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => setEditing(false)} className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100" aria-label="취소">
          <X className="h-4 w-4" />
        </button>
      </form>
    );
  }

  return (
    <div className="mt-3 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-brand-600">{lecture.session_no}회차</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight break-keep">{lecture.title}</h1>
      </div>
      <button onClick={() => guard(() => setEditing(true))} className="rounded-md p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" title="제목 수정">
        <Pencil className="h-4 w-4" />
      </button>
      <button
        onClick={() => guard(remove)}
        disabled={disabled}
        className="rounded-md p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
        title="강의 삭제"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function AudioUploader({ lectureId }: { lectureId: string }) {
  const router = useRouter();
  const { guard } = useAccess();
  const [status, setStatus] = useState<string | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async (file: File) => {
    setError(null);
    try {
      await processAndUploadAudio(lectureId, file, (s) => {
        if (s.stage === "convert") {
          setStatus(`음성 추출 중 ${s.progress.duration ? `${formatTime(s.progress.seconds)} / ${formatTime(s.progress.duration)}` : ""}`);
          setRatio(s.progress.ratio);
        } else if (s.stage === "upload") {
          setStatus(`업로드 중 ${Math.round(s.ratio * 100)}%`);
          setRatio(s.ratio);
        }
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStatus(null);
    }
  };

  if (status) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-zinc-600">{status}</p>
        <ProgressBar ratio={ratio} />
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-zinc-500">오디오가 아직 없어요. 강의 영상이나 오디오를 올려주세요.</p>
      <label
        className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
        onClick={(e) => {
          // Ask for the code before opening the file picker.
          let allowed = false;
          guard(() => (allowed = true));
          if (!allowed) e.preventDefault();
        }}
      >
        <Upload className="h-4 w-4" /> 영상/오디오 선택
        <input type="file" accept="video/*,audio/*,.mkv,.m4a" className="hidden" onChange={(e) => e.target.files?.[0] && start(e.target.files[0])} />
      </label>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

function MaterialsPanel({ lectureId, materials, disabled }: { lectureId: string; materials: MaterialView[]; disabled: boolean }) {
  const router = useRouter();
  const { guard } = useAccess();
  const [uploading, setUploading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const add = async (files: File[]) => {
    setMessage(null);
    const warnings: string[] = [];
    try {
      for (const f of files) {
        setUploading(f.name);
        const res = await uploadMaterial(lectureId, f);
        if (res.warning) warnings.push(`${f.name}: ${res.warning}`);
      }
      if (warnings.length) setMessage(warnings.join("\n"));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(null);
      router.refresh();
    }
  };

  const remove = async (m: MaterialView) => {
    if (!confirm(`‘${m.filename}’을(를) 삭제할까요?`)) return;
    try {
      await api(`/api/lectures/${lectureId}/materials/${m.id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="rounded-2xl border border-zinc-200 p-4">
      <h2 className="mb-3 text-sm font-semibold text-zinc-700">강의자료</h2>
      {materials.length === 0 && !uploading && <p className="text-sm text-zinc-400">업로드된 자료가 없어요.</p>}
      <ul className="space-y-1">
        {materials.map((m) => (
          <li key={m.id} className="group flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{m.filename}</span>
              <span className="block text-xs text-zinc-400">
                {m.size ? formatBytes(m.size) : ""}
                {m.chars ? ` · 텍스트 ${m.chars.toLocaleString()}자` : " · 텍스트 없음"}
              </span>
            </span>
            {m.url && (
              <a href={m.url} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" title="다운로드">
                <Download className="h-4 w-4" />
              </a>
            )}
            <button
              onClick={() => guard(() => remove(m))}
              disabled={disabled}
              className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
              title="삭제"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      {uploading && (
        <p className="mt-2 flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {uploading}
        </p>
      )}
      {message && <p className="mt-2 text-xs whitespace-pre-line text-amber-700">{message}</p>}
      <label
        className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
        onClick={(e) => {
          let allowed = false;
          guard(() => (allowed = true));
          if (!allowed) e.preventDefault();
        }}
      >
        <Paperclip className="h-4 w-4" /> 자료 추가
        <input
          type="file"
          multiple
          accept=".pdf,.pptx,.docx,.txt,.md"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) void add(files);
          }}
        />
      </label>
    </section>
  );
}

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
  locked: boolean;
}) {
  const { running, progress } = props;
  return (
    <section className={`rounded-2xl border p-4 ${props.done ? "border-emerald-200 bg-emerald-50/30" : "border-zinc-200"}`}>
      <div className="flex items-start gap-3">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            props.done ? "bg-emerald-500 text-white" : "bg-brand-50 text-brand-700"
          }`}
        >
          {props.done ? <Check className="h-4 w-4" /> : props.step}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{props.title}</h3>
          <p className="text-xs text-zinc-500">{props.subtitle}</p>
        </div>
        <button
          onClick={props.onPrimary}
          disabled={running || !!props.disabledReason}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium shadow-sm disabled:opacity-40 ${
            props.done ? "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50" : "bg-brand-600 text-white hover:bg-brand-700"
          }`}
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : props.done ? <RotateCw className="h-4 w-4" /> : props.icon}
          {running ? "진행 중" : props.primaryLabel}
        </button>
      </div>

      <div className="mt-3 pl-10">
        <p className="text-sm text-zinc-600">{props.disabledReason && !props.done && !running ? props.disabledReason : props.status}</p>
        {running && (
          <div className="mt-2">
            <ProgressBar ratio={progress && progress.total ? progress.done / progress.total : null} />
          </div>
        )}
        {props.error && (
          <div className="mt-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-700">
            <p className="break-words">{props.error}</p>
            {props.onResume && !running && (
              <button onClick={props.onResume} className="mt-1.5 font-medium underline">
                이어서 다시 시도
              </button>
            )}
          </div>
        )}
        {!props.error && props.onResume && !running && props.locked && (
          <button onClick={props.onResume} className="mt-2 text-xs font-medium text-brand-600 underline">
            코드를 입력하면 이어서 진행합니다
          </button>
        )}
      </div>
    </section>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium ${
        active ? "border-brand-600 text-brand-700" : "border-transparent text-zinc-500 hover:text-zinc-800"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center text-zinc-300">
      {icon}
      <p className="mt-3 text-sm text-zinc-500">{text}</p>
    </div>
  );
}

function TranscriptView({ chunks, query, onSeek }: { chunks: Chunk[]; query: string | null; onSeek?: (sec: number | null) => void }) {
  const [showRaw, setShowRaw] = useState(false);
  const corrected = chunks.filter((c) => c.corrected_text).length;
  const firstHit = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query) firstHit.current?.scrollIntoView({ block: "center" });
  }, [query]);

  let hitAssigned = false;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-500">
          {corrected === chunks.length ? "DeepSeek 교정 완료" : `교정 ${corrected}/${chunks.length} 구간`} · 시간을 누르면 해당 위치부터 재생돼요
        </p>
        <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 text-xs">
          <button onClick={() => setShowRaw(false)} className={`rounded-md px-2.5 py-1 ${!showRaw ? "bg-white shadow-sm" : "text-zinc-500"}`}>
            교정본
          </button>
          <button onClick={() => setShowRaw(true)} className={`rounded-md px-2.5 py-1 ${showRaw ? "bg-white shadow-sm" : "text-zinc-500"}`}>
            Whisper 원문
          </button>
        </div>
      </div>
      <div className="space-y-5">
        {chunks.map((c) => {
          const text = showRaw ? c.raw_text : c.corrected_text ?? c.raw_text;
          const pending = !showRaw && !c.corrected_text;
          const isHit = !!query && !hitAssigned && text.toLowerCase().includes(query.toLowerCase());
          if (isHit) hitAssigned = true;
          return (
            <div key={c.idx} ref={isHit ? firstHit : undefined} className="grid grid-cols-[3.5rem_1fr] gap-3">
              <button
                onClick={() => onSeek?.(c.start_sec)}
                disabled={!onSeek || c.start_sec == null}
                className="h-fit rounded-md px-1.5 py-0.5 text-left font-mono text-xs text-brand-600 tabular-nums hover:bg-brand-50 disabled:text-zinc-400 disabled:hover:bg-transparent"
              >
                {formatTime(c.start_sec) || `#${c.idx + 1}`}
              </button>
              <div className={`space-y-3 text-[15px] leading-7 ${pending ? "text-zinc-400" : "text-zinc-800"}`}>
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
