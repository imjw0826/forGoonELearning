"use client";

import { BookOpen, Lock, LockOpen, Menu, Plus, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { Course } from "@/lib/types";
import { useAccess } from "./AccessProvider";

export function Sidebar({ courses }: { courses: Course[] }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-3 md:hidden">
        <button onClick={() => setMobileOpen(true)} className="rounded-md p-1 text-zinc-600 hover:bg-zinc-200" aria-label="메뉴">
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/" className="text-lg font-bold tracking-tight">
          Yoyaku
        </Link>
      </div>

      {mobileOpen && <div className="fixed inset-0 z-30 bg-zinc-900/30 md:hidden" onClick={() => setMobileOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 transition-transform md:static md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-5 pt-6 pb-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">Y</span>
            <span className="text-xl font-bold tracking-tight">Yoyaku</span>
          </Link>
          <button onClick={() => setMobileOpen(false)} className="rounded-md p-1 text-zinc-500 hover:bg-zinc-200 md:hidden" aria-label="닫기">
            <X className="h-5 w-5" />
          </button>
        </div>

        <CourseList courses={courses} pathname={pathname} />
        <AccessFooter />
      </aside>
    </>
  );
}

function CourseList({ courses, pathname }: { courses: Course[]; pathname: string }) {
  const router = useRouter();
  const { guard } = useAccess();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { course } = await api<{ course: Course }>("/api/courses", { body: { name } });
      setName("");
      setAdding(false);
      router.push(`/courses/${course.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <nav className="flex-1 overflow-y-auto px-3">
      <div className="flex items-center justify-between px-2 pb-2">
        <span className="text-xs font-semibold tracking-wide text-zinc-500">듣는 과목</span>
        <button
          onClick={() => guard(() => setAdding(true))}
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900"
          title="과목 추가"
          aria-label="과목 추가"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {adding && (
        <form onSubmit={submit} className="mb-2 px-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
            placeholder="과목 이름"
            disabled={busy}
            className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          {error && <p className="mt-1 px-1 text-xs text-red-600">{error}</p>}
          <div className="mt-1.5 flex justify-end gap-1">
            <button type="button" onClick={() => setAdding(false)} className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-200">
              취소
            </button>
            <button type="submit" disabled={busy || !name.trim()} className="rounded bg-brand-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
              추가
            </button>
          </div>
        </form>
      )}

      <ul className="space-y-0.5">
        {courses.map((c) => {
          const active = pathname.startsWith(`/courses/${c.id}`);
          return (
            <li key={c.id}>
              <Link
                href={`/courses/${c.id}`}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm ${
                  active ? "bg-white font-medium text-zinc-900 shadow-sm ring-1 ring-zinc-200" : "text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900"
                }`}
              >
                <BookOpen className={`h-4 w-4 shrink-0 ${active ? "text-brand-600" : "text-zinc-400"}`} />
                <span className="truncate">{c.name}</span>
              </Link>
            </li>
          );
        })}
        {courses.length === 0 && !adding && (
          <li className="px-2.5 py-2 text-sm text-zinc-400">아직 과목이 없어요. + 를 눌러 추가하세요.</li>
        )}
      </ul>
    </nav>
  );
}

function AccessFooter() {
  const { unlocked, openDialog, lock } = useAccess();
  return (
    <div className="border-t border-zinc-200 p-3">
      <button
        onClick={() => (unlocked ? lock() : openDialog())}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-zinc-600 hover:bg-zinc-200/60"
        title={unlocked ? "클릭하면 다시 잠급니다" : "접근 코드 입력"}
      >
        {unlocked ? <LockOpen className="h-4 w-4 text-emerald-600" /> : <Lock className="h-4 w-4 text-zinc-400" />}
        <span>{unlocked ? "편집 가능" : "읽기 전용 · 코드 입력"}</span>
      </button>
    </div>
  );
}
