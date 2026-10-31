"use client";

import { Lock, LockOpen, Menu, Plus, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { Tooltip } from "@/components/ui/tooltip";
import { api } from "@/lib/client/api";
import type { Course } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAccess } from "./AccessProvider";

/** Stable soft colour per course, so the list is easy to scan. */
function courseHue(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function CourseMark({ course, className }: { course: Pick<Course, "id" | "name">; className?: string }) {
  const hue = courseHue(course.id);
  return (
    <span
      aria-hidden
      className={cn("flex size-5 shrink-0 items-center justify-center rounded-[5px] text-[10px] font-semibold", className)}
      style={{
        background: `oklch(0.94 0.045 ${hue})`,
        color: `oklch(0.45 0.12 ${hue})`,
      }}
    >
      {course.name.trim().charAt(0) || "·"}
    </span>
  );
}

export function Sidebar({ courses }: { courses: Course[] }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex h-12 items-center gap-2 border-b bg-sidebar px-3 md:hidden">
        <Button variant="ghost" size="icon-sm" onClick={() => setMobileOpen(true)} aria-label="메뉴 열기">
          <Menu />
        </Button>
        <Brand />
      </div>

      <div
        onClick={() => setMobileOpen(false)}
        className={cn(
          "fixed inset-0 z-30 bg-black/25 transition-opacity duration-300 md:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar",
          "transition-transform duration-300 ease-[var(--ease-drawer)] md:static md:w-60 md:translate-x-0",
          mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center justify-between px-4">
          <Brand />
          <Button variant="ghost" size="icon-xs" onClick={() => setMobileOpen(false)} className="md:hidden" aria-label="메뉴 닫기">
            <X />
          </Button>
        </div>

        <CourseList courses={courses} pathname={pathname} />
        <AccessFooter />
      </aside>
    </>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-md">
      <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-[13px] font-bold tracking-[-0.04em] text-primary-foreground">
        Yo
      </span>
      <span className="text-[15px] font-semibold tracking-[-0.025em]">Yoyaku</span>
    </Link>
  );
}

function CourseList({ courses, pathname }: { courses: Course[]; pathname: string }) {
  const router = useRouter();
  const { guard } = useAccess();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { course } = await api<{ course: Course }>("/api/courses", { body: { name } });
      setName("");
      setAdding(false);
      router.push(`/courses/${course.id}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <nav className="flex-1 overflow-y-auto px-2 pt-2">
      <div className="flex h-8 items-center justify-between pr-1 pl-2.5">
        <span className="text-2xs font-medium text-muted-foreground">듣는 과목</span>
        <Tooltip label="과목 추가" side="right">
          <Button variant="ghost" size="icon-xs" onClick={() => guard(() => setAdding(true))} aria-label="과목 추가">
            <Plus />
          </Button>
        </Tooltip>
      </div>

      {adding && (
        <form onSubmit={submit} className="mb-1 animate-enter px-1 pb-1">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
            placeholder="과목 이름"
            disabled={busy}
            className="h-8 bg-background"
          />
          <div className="mt-1.5 flex justify-end gap-1">
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => setAdding(false)}>
              취소
            </Button>
            <Button type="submit" size="sm" className="h-7 px-2.5" disabled={busy || !name.trim()}>
              추가
            </Button>
          </div>
        </form>
      )}

      <ul className="space-y-px">
        {courses.map((c, i) => {
          const active = pathname.startsWith(`/courses/${c.id}`);
          return (
            <li key={c.id} className="stagger" style={{ "--i": i } as React.CSSProperties}>
              <Link
                href={`/courses/${c.id}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors duration-150",
                  active
                    ? "bg-background font-medium text-foreground shadow-xs ring-1 ring-border"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <CourseMark course={c} />
                <span className="truncate">{c.name}</span>
              </Link>
            </li>
          );
        })}
        {courses.length === 0 && !adding && (
          <li className="px-2.5 py-2 text-xs leading-5 text-muted-foreground">
            아직 과목이 없어요.
            <br />+ 를 눌러 추가하세요.
          </li>
        )}
      </ul>
    </nav>
  );
}

function AccessFooter() {
  const { unlocked, openDialog, lock } = useAccess();
  return (
    <div className="border-t border-sidebar-border p-2">
      <button
        onClick={() => (unlocked ? lock() : openDialog())}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
      >
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-md",
            unlocked ? "bg-success-soft text-success" : "bg-secondary text-muted-foreground",
          )}
        >
          {unlocked ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />}
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] leading-4 font-medium">{unlocked ? "편집 가능" : "읽기 전용"}</span>
          <span className="block text-2xs text-muted-foreground">{unlocked ? "눌러서 다시 잠그기" : "코드를 입력해 편집하기"}</span>
        </span>
      </button>
    </div>
  );
}
