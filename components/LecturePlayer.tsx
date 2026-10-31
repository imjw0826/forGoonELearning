"use client";

import { Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/format";
import type { AudioSegmentView, MediaItem } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface PlayerHandle {
  /** Seek to a position on the whole-lecture timeline and start playing. */
  seek: (sec: number) => void;
}

const RATES = [1, 1.25, 1.5, 1.75, 2];

/**
 * Plays a lecture made of several files (each possibly split into ≤2h mp3 segments) as one
 * continuous timeline, so transcript timestamps can point anywhere in the lecture.
 */
export function LecturePlayer({
  playlist,
  media,
  ref,
}: {
  playlist: AudioSegmentView[];
  media: MediaItem[];
  ref?: React.Ref<PlayerHandle>;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [idx, setIdx] = useState(0);
  const [local, setLocal] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const pending = useRef<{ at: number; play: boolean } | null>(null);

  const total = playlist.reduce((s, x) => s + x.duration_sec, 0);
  const current = playlist[idx];
  const position = (current?.offset_sec ?? 0) + local;

  const seek = useCallback(
    (sec: number, play = true) => {
      if (!playlist.length) return;
      const g = Math.max(0, Math.min(sec, total));
      let i = playlist.findIndex((s) => g < s.offset_sec + s.duration_sec);
      if (i < 0) i = playlist.length - 1;
      const at = g - playlist[i].offset_sec;
      const el = audioRef.current;
      if (i === idx && el && el.readyState >= 1) {
        el.currentTime = at;
        setLocal(at);
        if (play) void el.play();
      } else {
        pending.current = { at, play };
        setLocal(at);
        setIdx(i);
      }
    },
    [playlist, total, idx],
  );

  useImperativeHandle(ref, () => ({ seek }), [seek]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, idx]);

  if (!playlist.length) return null;

  const fileOf = (s: AudioSegmentView) => media.find((m) => m.id === s.media_id);
  const file = current ? fileOf(current) : undefined;
  const fileNo = file ? media.filter((m) => m.status === "ready").findIndex((m) => m.id === file.id) + 1 : 0;
  const fileCount = new Set(playlist.map((s) => s.media_id)).size;
  // Boundaries between files, drawn as ticks on the scrubber.
  const ticks = playlist.filter((s, i) => i > 0 && s.media_id !== playlist[i - 1].media_id).map((s) => s.offset_sec / total);

  return (
    <div className="flex items-center gap-3">
      <audio
        ref={audioRef}
        src={current?.url ?? undefined}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          el.playbackRate = rate;
          const p = pending.current;
          pending.current = null;
          if (p) {
            el.currentTime = p.at;
            if (p.play) void el.play();
          }
        }}
        onTimeUpdate={(e) => setLocal(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          if (idx < playlist.length - 1) {
            pending.current = { at: 0, play: true };
            setLocal(0);
            setIdx(idx + 1);
          }
        }}
      />

      <Button
        size="icon"
        className="size-10 rounded-full"
        onClick={() => {
          const el = audioRef.current;
          if (!el) return;
          if (el.paused) void el.play();
          else el.pause();
        }}
        aria-label={playing ? "일시정지" : "재생"}
      >
        {playing ? <Pause className="size-[18px] fill-current" /> : <Play className="ml-0.5 size-[18px] fill-current" />}
      </Button>

      <div className="min-w-0 flex-1">
        <div className="relative flex h-5 items-center">
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.floor(total))}
            step={1}
            value={Math.floor(position)}
            onChange={(e) => seek(Number(e.target.value), playing)}
            aria-label="재생 위치"
            className="player-range w-full"
            style={{ "--pct": `${total ? (position / total) * 100 : 0}%` } as React.CSSProperties}
          />
          {ticks.map((t) => (
            <span
              key={t}
              aria-hidden
              className="pointer-events-none absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded-full bg-background"
              style={{ left: `${t * 100}%` }}
            />
          ))}
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            {fileCount > 1 && <span className="font-medium text-foreground tabular">{fileNo}/{fileCount} · </span>}
            {file?.filename}
          </span>
          <span className="shrink-0 tabular">
            {formatTime(position) || "0:00"} / {formatTime(total)}
          </span>
        </div>
      </div>

      <div className="hidden items-center sm:flex">
        <Button variant="ghost" size="icon-sm" onClick={() => seek(position - 15, playing)} aria-label="15초 뒤로">
          <RotateCcw />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => seek(position + 15, playing)} aria-label="15초 앞으로">
          <RotateCw />
        </Button>
      </div>
      <button
        onClick={() => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length])}
        className={cn(
          "h-7 w-12 shrink-0 rounded-md border text-xs font-medium tabular transition-colors hover:bg-accent",
          rate !== 1 && "border-brand/40 text-brand",
        )}
        aria-label="재생 속도"
      >
        {rate}×
      </button>
    </div>
  );
}
