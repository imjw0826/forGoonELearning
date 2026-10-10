"use client";

import { ArrowLeft, Check, FileUp, Film, Loader2, Music, Paperclip, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { isVideo, needsConversion } from "@/lib/client/audio";
import { processAndUploadAudio, uploadMaterial, type AudioStage } from "@/lib/client/upload";
import { formatBytes, formatTime } from "@/lib/format";
import { useAccess } from "./AccessProvider";
import { ProgressBar } from "./ProgressBar";

type StepKey = "create" | "convert" | "upload" | "materials";
type StepState = "pending" | "active" | "done" | "skip";

const MATERIAL_ACCEPT = ".pdf,.pptx,.docx,.txt,.md";

export function NewLectureForm({ courseId, courseName, nextSessionNo }: { courseId: string; courseName: string; nextSessionNo: number }) {
  const router = useRouter();
  const { guard } = useAccess();
  const [sessionNo, setSessionNo] = useState(nextSessionNo);
  const [title, setTitle] = useState("");
  const [media, setMedia] = useState<File | null>(null);
  const [materials, setMaterials] = useState<File[]>([]);

  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Record<StepKey, StepState>>({ create: "pending", convert: "pending", upload: "pending", materials: "pending" });
  const [detail, setDetail] = useState<string>("");
  const [ratio, setRatio] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lectureId, setLectureId] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Warn before closing the tab while converting/uploading.
  useEffect(() => {
    if (!running) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [running]);

  const mark = (k: StepKey, s: StepState) => setSteps((prev) => ({ ...prev, [k]: s }));

  const run = async () => {
    if (!media) return;
    setRunning(true);
    setError(null);
    setWarnings([]);
    const convert = needsConversion(media);
    setSteps({ create: "active", convert: convert ? "pending" : "skip", upload: "pending", materials: materials.length ? "pending" : "skip" });

    let id = lectureId;
    try {
      if (!id) {
        const { lecture } = await api<{ lecture: { id: string } }>("/api/lectures", {
          body: { courseId, sessionNo, title: title.trim() || undefined, sourceFilename: media.name },
        });
        id = lecture.id;
        setLectureId(id);
      }
      mark("create", "done");

      await processAndUploadAudio(id, media, (s: AudioStage) => {
        if (s.stage === "convert") {
          mark("convert", "active");
          const p = s.progress;
          setRatio(p.ratio);
          setDetail(p.duration ? `${formatTime(p.seconds)} / ${formatTime(p.duration)}` : p.seconds ? formatTime(p.seconds) : "ffmpeg 불러오는 중…");
        } else if (s.stage === "upload") {
          if (convert) mark("convert", "done");
          mark("upload", "active");
          setRatio(s.ratio);
          setDetail(`${Math.round(s.ratio * 100)}%`);
        } else {
          mark("upload", "done");
        }
      });

      if (materials.length) {
        mark("materials", "active");
        for (let i = 0; i < materials.length; i++) {
          const f = materials[i];
          setDetail(`${i + 1}/${materials.length} · ${f.name}`);
          setRatio(0);
          const res = await uploadMaterial(id, f, setRatio);
          if (res.warning) setWarnings((w) => [...w, `${f.name}: ${res.warning}`]);
        }
        mark("materials", "done");
      }

      router.push(`/courses/${courseId}/lectures/${id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSteps((prev) => {
        const next = { ...prev };
        (Object.keys(next) as StepKey[]).forEach((k) => next[k] === "active" && (next[k] = "pending"));
        return next;
      });
      setRunning(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    guard(run);
  };

  const started = running || lectureId != null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-8 sm:py-8">
      <Link href={`/courses/${courseId}`} className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="h-4 w-4" /> {courseName}
      </Link>
      <h1 className="mt-3 text-2xl font-bold tracking-tight">강의 추가</h1>
      <p className="mt-1 text-sm text-zinc-500">영상을 올리면 브라우저에서 바로 음성(mp3)만 추출해 업로드합니다. 원본 영상은 서버로 전송되지 않아요.</p>

      <form onSubmit={submit} className="mt-6 space-y-6">
        <div className="grid grid-cols-[6rem_1fr] gap-3">
          <label className="block">
            <span className="text-sm font-medium text-zinc-700">회차</span>
            <input
              type="number"
              min={1}
              value={sessionNo}
              disabled={started}
              onChange={(e) => setSessionNo(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-zinc-700">제목</span>
            <input
              value={title}
              disabled={started}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`${sessionNo}회차 강의`}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>
        </div>

        {/* Media */}
        <div>
          <span className="text-sm font-medium text-zinc-700">강의 영상 또는 오디오 *</span>
          {media ? (
            <div className="mt-1 flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
              {isVideo(media) ? <Film className="h-5 w-5 text-brand-600" /> : <Music className="h-5 w-5 text-brand-600" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{media.name}</p>
                <p className="text-xs text-zinc-500">
                  {formatBytes(media.size)} · {needsConversion(media) ? "브라우저에서 mp3로 변환 후 업로드" : "mp3 그대로 업로드"}
                </p>
              </div>
              {!started && (
                <button type="button" onClick={() => setMedia(null)} className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700" aria-label="파일 제거">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ) : (
            <label className="mt-1 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 px-6 py-10 text-center hover:border-brand-400 hover:bg-brand-50/30">
              <FileUp className="h-7 w-7 text-zinc-400" />
              <span className="mt-2 text-sm font-medium text-zinc-700">클릭해서 파일 선택</span>
              <span className="mt-0.5 text-xs text-zinc-500">MP4, MOV, MKV, WEBM, MP3, M4A, WAV … (1~2GB 영상 가능)</span>
              <input type="file" accept="video/*,audio/*,.mkv,.m4a" className="hidden" onChange={(e) => setMedia(e.target.files?.[0] ?? null)} />
            </label>
          )}
        </div>

        {/* Materials */}
        <div>
          <span className="text-sm font-medium text-zinc-700">강의자료 (선택)</span>
          <p className="text-xs text-zinc-500">PPT는 PPTX 또는 PDF로 올려주세요. 요약할 때 대본과 함께 사용됩니다.</p>
          <ul className="mt-2 space-y-1.5">
            {materials.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm">
                <Paperclip className="h-4 w-4 text-zinc-400" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-xs text-zinc-400">{formatBytes(f.size)}</span>
                {!started && (
                  <button type="button" onClick={() => setMaterials((m) => m.filter((_, j) => j !== i))} className="rounded p-0.5 text-zinc-400 hover:text-zinc-700" aria-label="자료 제거">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!started && (
            <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">
              <Paperclip className="h-4 w-4" /> 자료 추가
              <input
                type="file"
                multiple
                accept={MATERIAL_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  setMaterials((m) => [...m, ...files]);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>

        {/* Progress */}
        {started && (
          <div className="space-y-3 rounded-xl border border-zinc-200 p-4">
            <Step state={steps.create} label="강의 생성" />
            <Step state={steps.convert} label="영상에서 음성 추출 (ffmpeg)" detail={steps.convert === "active" ? detail : undefined} ratio={steps.convert === "active" ? ratio : undefined} />
            <Step state={steps.upload} label="오디오 업로드" detail={steps.upload === "active" ? detail : undefined} ratio={steps.upload === "active" ? ratio : undefined} />
            <Step state={steps.materials} label="강의자료 업로드 · 텍스트 추출" detail={steps.materials === "active" ? detail : undefined} ratio={steps.materials === "active" ? ratio : undefined} />
            {running && <p className="pt-1 text-xs text-zinc-500">변환이 끝날 때까지 이 탭을 닫지 마세요. 1~2GB 영상은 몇 분 걸릴 수 있어요.</p>}
          </div>
        )}

        {warnings.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <div className="flex justify-end gap-2">
          {lectureId && !running && (
            <Link href={`/courses/${courseId}/lectures/${lectureId}`} className="rounded-lg px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100">
              강의 페이지로 이동
            </Link>
          )}
          <button
            type="submit"
            disabled={!media || running}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
          >
            {running && <Loader2 className="h-4 w-4 animate-spin" />}
            {running ? "처리 중…" : error ? "다시 시도" : "업로드"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Step({ state, label, detail, ratio }: { state: StepState; label: string; detail?: string; ratio?: number | null }) {
  if (state === "skip") return null;
  return (
    <div>
      <div className="flex items-center gap-2.5 text-sm">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full ${
            state === "done" ? "bg-emerald-500 text-white" : state === "active" ? "bg-brand-100 text-brand-600" : "bg-zinc-100 text-zinc-300"
          }`}
        >
          {state === "done" ? <Check className="h-3 w-3" /> : state === "active" ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
        </span>
        <span className={state === "pending" ? "text-zinc-400" : "text-zinc-800"}>{label}</span>
        {detail && <span className="ml-auto text-xs text-zinc-500 tabular-nums">{detail}</span>}
      </div>
      {state === "active" && ratio !== undefined && (
        <div className="mt-2 pl-7">
          <ProgressBar ratio={ratio} />
        </div>
      )}
    </div>
  );
}
