"use client";

import { AlertCircle, ArrowDown, ArrowUp, Check, Film, Music, Upload, X } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { isVideo } from "@/lib/client/audio";
import { sortFilesByName, uploadLectureMedia, type AudioMode, type MediaStage } from "@/lib/client/upload";
import { formatBytes, formatTime } from "@/lib/format";
import { SERVER_CONVERSION_THRESHOLD } from "@/lib/upload-limits";
import { cn } from "@/lib/utils";

export const MEDIA_ACCEPT = "video/*,audio/*,.mkv,.m4a,.ts,.mts";

export const MODE_OPTIONS: { value: AudioMode; label: string }[] = [
  { value: "auto", label: "자동" },
  { value: "browser", label: "브라우저" },
  { value: "server", label: "서버" },
];

/* ------------------------------------------------------------------ Dropzone */

export function Dropzone({
  onFiles,
  accept,
  multiple = true,
  title,
  hint,
  compact,
  disabled,
  onBeforeOpen,
}: {
  onFiles: (files: File[]) => void;
  accept: string;
  multiple?: boolean;
  title: string;
  hint?: string;
  compact?: boolean;
  disabled?: boolean;
  /** Return false to cancel opening the file picker (e.g. ask for the access code first). */
  onBeforeOpen?: () => boolean;
}) {
  const inputId = useId();
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  return (
    <label
      htmlFor={inputId}
      onClick={(e) => {
        if (disabled || (onBeforeOpen && !onBeforeOpen())) e.preventDefault();
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        if (disabled || (onBeforeOpen && !onBeforeOpen())) return;
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
      className={cn(
        "group flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed text-center",
        "transition-[border-color,background-color,transform] duration-200 ease-[var(--ease-out)]",
        compact ? "gap-1 px-4 py-5" : "gap-1.5 px-6 py-10",
        over ? "scale-[1.01] border-brand bg-brand-soft/60" : "hover:border-ring/60 hover:bg-muted/40",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <span
        className={cn(
          "mb-1 flex items-center justify-center rounded-full bg-secondary text-muted-foreground transition-[transform,color] duration-200",
          compact ? "size-8" : "size-10",
          over ? "-translate-y-0.5 text-brand" : "group-hover:-translate-y-0.5",
        )}
      >
        <Upload className={compact ? "size-4" : "size-[18px]"} />
      </span>
      <span className="text-sm font-medium">{over ? "여기에 놓으세요" : title}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      <input
        id={inputId}
        type="file"
        multiple={multiple}
        accept={accept}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </label>
  );
}

/* ------------------------------------------------------------------ Queue state */

export type ItemStatus = "queued" | "convert" | "upload" | "server" | "done" | "error";

export interface QueueItem {
  key: string;
  file: File;
  status: ItemStatus;
  ratio: number | null;
  detail: string;
  note?: string;
  error?: string;
}

let seq = 0;

/** Holds the selected video/audio files and uploads them to a lecture one after another, in order. */
export function useMediaQueue() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);

  const patch = (key: string, p: Partial<QueueItem>) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...p } : it)));

  const add = useCallback((files: File[]) => {
    const fresh = sortFilesByName(files).map((file) => ({
      key: `f${++seq}`,
      file,
      status: "queued" as const,
      ratio: null,
      detail: "",
    }));
    setItems((list) => [...list, ...fresh]);
  }, []);

  const remove = (key: string) => setItems((list) => list.filter((it) => it.key !== key));
  const clear = () => setItems([]);

  const move = (key: string, dir: -1 | 1) =>
    setItems((list) => {
      const i = list.findIndex((it) => it.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  /** Uploads every not-yet-done item in order. Returns how many failed. */
  const run = async (lectureId: string, mode: AudioMode, current: QueueItem[]) => {
    setRunning(true);
    let failed = 0;
    try {
      for (const it of current) {
        if (it.status === "done") continue;
        patch(it.key, { status: "convert", ratio: null, detail: "준비 중", error: undefined, note: undefined });
        try {
          await uploadLectureMedia(lectureId, it.file, mode, (s: MediaStage) => {
            if (s.stage === "convert") {
              const p = s.progress;
              patch(it.key, {
                status: "convert",
                ratio: p.ratio,
                detail: p.duration ? `음성 추출 ${formatTime(p.seconds)} / ${formatTime(p.duration)}` : "음성 추출 준비 중",
              });
            } else if (s.stage === "upload") {
              patch(it.key, {
                status: "upload",
                ratio: s.ratio,
                detail: `${s.target === "server" ? "서버로 업로드" : "업로드"} ${Math.round(s.ratio * 100)}%`,
              });
            } else if (s.stage === "server-convert") {
              patch(it.key, { status: "server", ratio: null, detail: "서버에서 음성 추출 중" });
            } else if (s.stage === "fallback") {
              patch(it.key, {
                note: s.to === "server" ? "브라우저 변환이 안 돼 서버에서 변환해요" : "서버 공간이 부족해 브라우저에서 변환해요",
              });
            } else {
              patch(it.key, { status: "done", ratio: 1, detail: "완료" });
            }
          });
        } catch (err) {
          failed++;
          patch(it.key, { status: "error", ratio: null, detail: "", error: err instanceof Error ? err.message : String(err) });
        }
      }
    } finally {
      setRunning(false);
    }
    return failed;
  };

  return { items, add, remove, move, clear, run, running };
}

/* ------------------------------------------------------------------ Queue list */

export function MediaQueueList({
  items,
  onRemove,
  onMove,
  locked,
}: {
  items: QueueItem[];
  onRemove: (key: string) => void;
  onMove: (key: string, dir: -1 | 1) => void;
  /** true while uploading: no reordering or removing */
  locked: boolean;
}) {
  if (!items.length) return null;
  return (
    <ol className="divide-y overflow-hidden rounded-xl border">
      {items.map((it, i) => (
        <li key={it.key} className="animate-enter bg-card px-3.5 py-3">
          <div className="flex items-center gap-3">
            <span className="w-4 shrink-0 text-center text-xs font-medium text-muted-foreground tabular">{i + 1}</span>
            <FileIcon file={it.file} status={it.status} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium tracking-[-0.01em]">{it.file.name}</p>
              <p className="truncate text-xs text-muted-foreground tabular">
                {formatBytes(it.file.size)}
                {it.status === "queued" &&
                  (it.file.size >= SERVER_CONVERSION_THRESHOLD ? " · 서버에서 변환" : " · 브라우저에서 변환")}
                {it.detail && it.status !== "queued" && ` · ${it.detail}`}
              </p>
            </div>
            {!locked && it.status !== "done" && (
              <div className="flex shrink-0 items-center">
                <Button variant="ghost" size="icon-xs" onClick={() => onMove(it.key, -1)} disabled={i === 0} aria-label="위로">
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onMove(it.key, 1)}
                  disabled={i === items.length - 1}
                  aria-label="아래로"
                >
                  <ArrowDown />
                </Button>
                <Button variant="ghost" size="icon-xs" onClick={() => onRemove(it.key)} aria-label="목록에서 빼기">
                  <X />
                </Button>
              </div>
            )}
          </div>
          {(it.status === "convert" || it.status === "upload" || it.status === "server") && (
            <Progress value={it.ratio} className="mt-2.5 ml-[3.25rem] w-auto" />
          )}
          {it.note && <p className="mt-1.5 ml-[3.25rem] text-xs text-muted-foreground">{it.note}</p>}
          {it.error && <p className="mt-1.5 ml-[3.25rem] text-xs text-destructive">{it.error}</p>}
        </li>
      ))}
    </ol>
  );
}

function FileIcon({ file, status }: { file: File; status: ItemStatus }) {
  const base = "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-200";
  if (status === "done")
    return (
      <span className={cn(base, "bg-success-soft text-success")}>
        <Check className="size-4 animate-pop-in" />
      </span>
    );
  if (status === "error")
    return (
      <span className={cn(base, "bg-destructive-soft text-destructive")}>
        <AlertCircle className="size-4" />
      </span>
    );
  const Icon = isVideo(file) ? Film : Music;
  return (
    <span className={cn(base, status === "queued" ? "bg-secondary text-muted-foreground" : "bg-brand-soft text-brand")}>
      <Icon className="size-4" />
    </span>
  );
}
