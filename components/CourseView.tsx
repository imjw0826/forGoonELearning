"use client";

import { FileText, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { Course, LectureSummary, SearchHit } from "@/lib/types";
import { useAccess } from "./AccessProvider";
import { Highlight } from "./Highlight";
import { LectureBadges } from "./StatusBadge";

export function CourseView({ course, lectures }: { course: Course; lectures: LectureSummary[] }) {
  const router = useRouter();
  const { guard } = useAccess();
  const [query, setQuery] = useState("");

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
      {/* Top bar: 과목 이름 | 검색 | 강의 추가 */}
      <header className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[1fr_minmax(0,22rem)_1fr]">
        <CourseTitle course={course} />
        <SearchBox value={query} onChange={setQuery} />
        <div className="flex sm:justify-end">
          <button
            onClick={() => guard(() => router.push(`/courses/${course.id}/lectures/new`))}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" />
            강의 추가
          </button>
        </div>
      </header>

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
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(course.name);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setName(course.name), [course.name]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name.trim() === course.name) return setEditing(false);
    try {
      await api(`/api/courses/${course.id}`, { method: "PATCH", body: { name } });
      setEditing(false);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async () => {
    if (!confirm(`'${course.name}' 과목과 모든 강의·대본·노트를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      await api(`/api/courses/${course.id}`, { method: "DELETE" });
      router.push("/");
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  if (editing) {
    return (
      <form onSubmit={save} className="flex items-center gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1 text-xl font-bold outline-none focus:border-brand-500"
        />
      </form>
    );
  }

  return (
    <div className="relative flex min-w-0 items-center gap-1" ref={menuRef}>
      <h1 className="truncate text-2xl font-bold tracking-tight">{course.name}</h1>
      <button onClick={() => setMenu((v) => !v)} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" aria-label="과목 메뉴">
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {menu && (
        <div className="absolute top-full left-0 z-20 mt-1 w-40 rounded-lg bg-white py-1 text-sm shadow-lg ring-1 ring-zinc-200">
          <button
            onClick={() => {
              setMenu(false);
              guard(() => setEditing(true));
            }}
            className="flex w-full items-center gap-2 px-3 py-2 hover:bg-zinc-50"
          >
            <Pencil className="h-4 w-4 text-zinc-400" /> 이름 변경
          </button>
          <button
            onClick={() => {
              setMenu(false);
              guard(remove);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-red-600 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" /> 과목 삭제
          </button>
        </div>
      )}
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative block">
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="강의 대본에서 검색"
        className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2 pr-8 pl-9 text-sm outline-none focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-100"
      />
      {value && (
        <button onClick={() => onChange("")} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-700" aria-label="검색어 지우기">
          <X className="h-4 w-4" />
        </button>
      )}
    </label>
  );
}

function LectureList({ courseId, lectures }: { courseId: string; lectures: LectureSummary[] }) {
  if (lectures.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-16 text-center">
        <FileText className="mx-auto h-8 w-8 text-zinc-300" />
        <p className="mt-3 text-sm font-medium text-zinc-700">아직 강의가 없어요</p>
        <p className="mt-1 text-sm text-zinc-500">오른쪽 위 ‘강의 추가’로 강의 영상이나 오디오를 올려보세요.</p>
      </div>
    );
  }
  return (
    <>
      <h2 className="mb-3 text-sm font-semibold text-zinc-500">강의 목록 · {lectures.length}개</h2>
      <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        {lectures.map((l) => (
          <li key={l.id}>
            <Link href={`/courses/${courseId}/lectures/${l.id}`} className="flex items-center gap-4 px-4 py-4 hover:bg-zinc-50 sm:px-5">
              <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <span className="text-base leading-none font-bold">{l.session_no}</span>
                <span className="mt-0.5 text-[10px] leading-none">회차</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{l.title}</span>
                <span className="mt-0.5 block text-xs text-zinc-400">{new Date(l.created_at).toLocaleDateString("ko-KR")}</span>
              </span>
              <LectureBadges hasAudio={!!l.audio_path} extract={l.extract_status} summary={l.summary_status} />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function SearchResults({ courseId, query }: { courseId: string; query: string }) {
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHits(null);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const res = await api<{ hits: SearchHit[] }>(`/api/courses/${courseId}/search?q=${encodeURIComponent(query)}`);
        if (!cancelled) setHits(res.hits);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [courseId, query]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!hits) return <p className="text-sm text-zinc-400">검색 중…</p>;
  if (hits.length === 0) return <p className="text-sm text-zinc-500">‘{query}’이(가) 나오는 강의 대본이 없어요.</p>;

  return (
    <>
      <h2 className="mb-3 text-sm font-semibold text-zinc-500">
        ‘{query}’ 검색 결과 · {hits.length}개 강의
      </h2>
      <ul className="space-y-2">
        {hits.map((h) => (
          <li key={h.id}>
            <Link
              href={`/courses/${courseId}/lectures/${h.id}?q=${encodeURIComponent(query)}`}
              className="block rounded-xl border border-zinc-200 bg-white px-5 py-4 hover:border-brand-200 hover:bg-brand-50/30"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-medium">
                  {h.session_no}회차 · {h.title}
                </span>
                <span className="shrink-0 text-xs text-zinc-400">{h.match_count}회 등장</span>
              </div>
              <p className="mt-1.5 line-clamp-2 text-sm text-zinc-600">
                …<Highlight text={h.snippet} query={query} />…
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
