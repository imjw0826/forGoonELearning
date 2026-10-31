"use client";

import { ChevronRight, FileVideo, MoreHorizontal, Pencil, Plus, Search, SearchX, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/client/api";
import { formatDuration } from "@/lib/format";
import type { Course, LectureSummary, SearchHit } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAccess } from "./AccessProvider";
import { useConfirm } from "./ConfirmProvider";
import { Highlight } from "./Highlight";
import { CourseMark } from "./Sidebar";
import { LectureBadges } from "./StatusBadge";

export function CourseView({ course, lectures }: { course: Course; lectures: LectureSummary[] }) {
  const router = useRouter();
  const { guard } = useAccess();
  const [query, setQuery] = useState("");

  const totalSec = lectures.reduce((s, l) => s + Number(l.duration_sec ?? 0), 0);
  const notes = lectures.filter((l) => l.summary_status === "done").length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
      {/* 과목 이름 | 검색 | 강의 추가 */}
      <header className="grid animate-enter grid-cols-1 items-center gap-3 md:grid-cols-[1fr_minmax(0,20rem)_1fr]">
        <CourseTitle course={course} />
        <SearchBox value={query} onChange={setQuery} />
        <div className="flex md:justify-end">
          <Button onClick={() => guard(() => router.push(`/courses/${course.id}/lectures/new`))}>
            <Plus />
            강의 추가
          </Button>
        </div>
      </header>

      {lectures.length > 0 && !query.trim() && (
        <p className="mt-2 animate-fade-in text-xs text-muted-foreground tabular">
          강의 {lectures.length}개{totalSec > 0 && ` · 총 ${formatDuration(totalSec)}`}
          {notes > 0 && ` · 강의노트 ${notes}개`}
        </p>
      )}

      <section className="mt-8">
        {query.trim() ? (
          <SearchResults courseId={course.id} query={query.trim()} />
        ) : (
          <LectureList courseId={course.id} lectures={lectures} />
        )}
      </section>
    </div>
  );
}

function CourseTitle({ course }: { course: Course }) {
  const router = useRouter();
  const { guard } = useAccess();
  const confirm = useConfirm();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(course.name);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name.trim() === course.name) return setRenaming(false);
    try {
      await api(`/api/courses/${course.id}`, { method: "PATCH", body: { name } });
      setRenaming(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `‘${course.name}’ 과목을 삭제할까요?`,
      description: "모든 강의와 영상, 대본, 강의노트가 함께 삭제되고 되돌릴 수 없어요.",
      confirmLabel: "과목 삭제",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/api/courses/${course.id}`, { method: "DELETE" });
      router.push("/");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <CourseMark course={course} className="size-8 rounded-lg text-sm" />
      <h1 className="truncate text-2xl">{course.name}</h1>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="과목 메뉴">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => guard(() => (setName(course.name), setRenaming(true)))}>
            <Pencil /> 이름 변경
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => guard(remove)}>
            <Trash2 /> 과목 삭제
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="max-w-sm">
          <form onSubmit={save}>
            <DialogTitle>과목 이름 변경</DialogTitle>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="mt-4" />
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRenaming(false)}>
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

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);

  // "/" focuses search, like most docs sites.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <label className="relative block">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")}
        placeholder="강의 대본에서 검색"
        className="bg-muted/60 pr-9 pl-9 shadow-none focus-visible:bg-background"
      />
      {value ? (
        <button
          onClick={() => onChange("")}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="검색어 지우기"
        >
          <X className="size-4" />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border bg-background px-1.5 font-mono text-[10px] text-muted-foreground sm:block">
          /
        </kbd>
      )}
    </label>
  );
}

function LectureList({ courseId, lectures }: { courseId: string; lectures: LectureSummary[] }) {
  if (lectures.length === 0) {
    return (
      <div className="flex animate-enter flex-col items-center rounded-xl border border-dashed px-6 py-16 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <FileVideo className="size-5" />
        </div>
        <p className="mt-4 text-sm font-medium">아직 강의가 없어요</p>
        <p className="mt-1 text-sm text-muted-foreground">오른쪽 위 ‘강의 추가’로 강의 영상을 올려보세요. 여러 개를 한 번에 올릴 수 있어요.</p>
      </div>
    );
  }
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y">
        {lectures.map((l, i) => (
          <li key={l.id} className="stagger" style={{ "--i": i } as React.CSSProperties}>
            <Link
              href={`/courses/${courseId}/lectures/${l.id}`}
              className="group flex items-center gap-3 px-3 py-3.5 sm:gap-4 transition-colors duration-150 hover:bg-muted/50 sm:px-5"
            >
              <span className="w-10 shrink-0 text-center sm:w-12">
                <span className="block text-lg leading-6 font-semibold tracking-[-0.03em] tabular">{l.session_no}</span>
                <span className="block text-2xs text-muted-foreground">회차</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium tracking-[-0.012em]">{l.title}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs whitespace-nowrap text-muted-foreground tabular">
                  {Number(l.duration_sec) > 0 && <span>{formatDuration(Number(l.duration_sec))}</span>}
                  {l.mediaCount > 1 && (
                    <>
                      <Dot />
                      <span>영상 {l.mediaCount}개</span>
                    </>
                  )}
                  <span className="hidden items-center gap-x-1.5 sm:inline-flex">
                    {(Number(l.duration_sec) > 0 || l.mediaCount > 1) && <Dot />}
                    {new Date(l.created_at).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })}
                  </span>
                </span>
              </span>
              <LectureBadges hasAudio={l.mediaCount > 0} busy={l.mediaBusy} extract={l.extract_status} summary={l.summary_status} />
              <ChevronRight className="hidden size-4 shrink-0 text-muted-foreground/50 sm:block transition-transform duration-200 ease-[var(--ease-out)] group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Dot() {
  return <span aria-hidden className="size-0.5 rounded-full bg-current opacity-60" />;
}

function SearchResults({ courseId, query }: { courseId: string; query: string }) {
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const t = setTimeout(async () => {
      setHits(null);
      try {
        const res = await api<{ hits: SearchHit[] }>(`/api/courses/${courseId}/search?q=${encodeURIComponent(query)}`);
        if (!cancelled) setHits(res.hits);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [courseId, query]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!hits) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[76px] rounded-xl" />
        ))}
      </div>
    );
  }
  if (hits.length === 0) {
    return (
      <div className="flex animate-enter flex-col items-center py-14 text-center">
        <SearchX className="size-6 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">‘{query}’이(가) 나오는 대본이 없어요.</p>
      </div>
    );
  }

  return (
    <>
      <h2 className="mb-3 text-xs font-medium text-muted-foreground">
        ‘{query}’ 검색 결과 · 강의 {hits.length}개
      </h2>
      <ul className="space-y-2">
        {hits.map((h, i) => (
          <li key={h.id} className="stagger" style={{ "--i": i } as React.CSSProperties}>
            <Link
              href={`/courses/${courseId}/lectures/${h.id}?q=${encodeURIComponent(query)}`}
              className={cn(
                "block rounded-xl border bg-card px-5 py-4 transition-[border-color,box-shadow] duration-150",
                "hover:border-ring/50 hover:shadow-sm",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-medium">
                  <span className="text-muted-foreground tabular">{h.session_no}회차</span> {h.title}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular">{h.match_count}회</span>
              </div>
              <p className="mt-1.5 line-clamp-2 text-[13px] leading-6 text-muted-foreground">
                …<Highlight text={h.snippet} query={query} />…
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
